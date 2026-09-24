#!/usr/bin/env node
'use strict';
/**
 * Transit API for Jakdojade data, serving two front-ends from one service:
 *
 *   LEGACY (old phones, tiny payloads, plain text)
 *     GET /v?msg=<query>                      -> text/plain, R|W|T lines
 *     GET /v/map?route=<i>&part=<j>           -> 240x320 baseline JPEG
 *
 *   MODERN (anything that can handle long JSON)
 *     GET /api/routes?msg=<query>             -> full JSON with geometries
 *     GET /api/locations?q=<text>             -> location suggestions
 *     GET /api/health                         -> liveness
 *
 * Optional query params on both front-ends: city, from, to, at, limit.
 *
 *   PORT=5000 node server/index.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const transit = require('./lib/transit');
const legacy = require('./lib/legacy');
const { renderWalkMap } = require('./lib/mapimage');

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const SEARCH_CACHE_MS = Number(process.env.SEARCH_CACHE_MS || 45000);
const LAST_RESULT_MS = Number(process.env.LAST_RESULT_MS || 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 40000);

// MIDlet downloads (Ember.jar + Ember.jad) live here; see deploy/README.md.
const DOWNLOAD_DIR = path.resolve(__dirname, '..', 'download');
const MIME_TYPES = {
  '.jar': 'application/java-archive',
  '.jad': 'text/vnd.sun.j2me.app-descriptor',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg',
};

const searchCache = new Map();
const lastByClient = new Map();
let lastGlobal = { expiresAt: 0, result: null };

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function send(res, status, contentType, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  };
  if (Buffer.isBuffer(body)) headers['Content-Length'] = body.length;
  else headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, text) {
  send(res, status, 'text/plain; charset=utf-8', text);
}

function sendJson(res, status, payload) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(payload, null, 2));
}

function remember(result, ip) {
  const entry = { expiresAt: Date.now() + LAST_RESULT_MS, result };
  lastGlobal = entry;
  if (ip) lastByClient.set(ip, entry);
  const cutoff = Date.now();
  for (const [key, value] of lastByClient) {
    if (value.expiresAt < cutoff) lastByClient.delete(key);
  }
}

function cachedSearch(key, loader) {
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.result);
  return loader().then((result) => {
    searchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_MS, result });
    if (searchCache.size > 200) {
      for (const [k, v] of searchCache) {
        if (v.expiresAt < Date.now()) searchCache.delete(k);
      }
    }
    return result;
  });
}

function searchFor(url, ip) {
  const msg = url.searchParams.get('msg') || '';
  const opts = {
    city: url.searchParams.get('city') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    at: url.searchParams.get('at') || undefined,
    limit: Number(url.searchParams.get('limit')) || undefined,
  };
  const key = [opts.city || '', opts.from || '', opts.to || '', opts.at || '', opts.limit || '', msg].join('\u0000');
  return cachedSearch(key, () => transit.search(msg, opts)).then((result) => {
    remember(result, ip);
    return result;
  });
}

/** JSON view: geometry as [lon, lat] pairs, which is what modern clients want. */
function jsonView(result) {
  return {
    ok: true,
    city: result.city,
    query: { from: result.from.displayName, to: result.to.displayName, requestedAt: result.requestedAt },
    from: { name: result.from.locationName, lat: result.from.coordinate.y_lat, lon: result.from.coordinate.x_lon },
    to: { name: result.to.locationName, lat: result.to.coordinate.y_lat, lon: result.to.coordinate.x_lon },
    generatedAt: new Date().toISOString(),
    count: result.routes.length,
    routes: result.routes.map((route) => ({
      id: route.id,
      line: route.line,
      direction: route.dir,
      departure: route.dep,
      arrival: route.arr,
      durationMinutes: route.duration,
      distanceMeters: route.distance,
      parts: route.parts.map((part) => (part.kind === 'walk'
        ? {
          kind: 'walk',
          walkIndex: part.walkIndex,
          type: part.type,
          distanceMeters: part.distance,
          description: part.desc,
          pointCount: part.shape.length,
          shape: part.shape.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
        }
        : {
          kind: 'transit',
          line: part.line,
          direction: part.dir,
          vehicleType: part.vehicleType,
          from: part.from,
          to: part.to,
          stopCount: part.stops,
        })),
    })),
  };
}

/**
 * Serves the MIDlet for over-the-air install. The JAD's MIDlet-Jar-URL is
 * relative, so both files must come from this same directory.
 */
function serveDownload(res, requested) {
  let files;
  try {
    files = fs.readdirSync(DOWNLOAD_DIR).filter((name) => !name.startsWith('.')).sort();
  } catch {
    sendText(res, 404, 'Brak katalogu z plikami do pobrania.');
    return '404';
  }

  if (!requested) {
    const body = files.length
      ? files.map((name) => `<li><a href="/download/${name}">${name}</a> (${fs.statSync(path.join(DOWNLOAD_DIR, name)).size} B)</li>`).join('\n')
      : '<li>(pusto)</li>';
    send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>Ember downloads</title><body style="font:14px system-ui;margin:24px"><h1 style="background:#FF8C00;padding:10px 14px">Ember downloads</h1><ul>${body}</ul></body>`);
    return '200';
  }

  const safeName = path.basename(requested);
  const file = path.join(DOWNLOAD_DIR, safeName);
  let stats;
  try {
    stats = fs.statSync(file);
  } catch {
    sendText(res, 404, `Nie ma pliku ${safeName}.`);
    return '404';
  }
  if (!stats.isFile()) {
    sendText(res, 404, `Nie ma pliku ${safeName}.`);
    return '404';
  }

  send(res, 200, MIME_TYPES[path.extname(safeName).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file));
  return '200';
}

function renderIndex() {
  return `<!doctype html>
<html lang="pl">
<meta charset="utf-8">
<title>Ember transit API</title>
<style>
  body { background:#fff; color:#000; font:14px/1.5 system-ui, sans-serif; margin:24px; max-width:760px }
  h1 { background:#FF8C00; color:#000; padding:10px 14px; margin:0 0 18px }
  code { background:#f4f4f4; padding:1px 5px }
  h2 { margin-top:26px; font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:#666 }
  li { margin:6px 0 }
</style>
<h1>Ember transit API</h1>
<p>Dwa front-endy nad tymi samymi danymi Jakdojade.</p>
<h2>Legacy (stare telefony)</h2>
<ul>
  <li><code>GET /v?msg=z+A+do+B</code> &mdash; tekst <code>R|W|T</code>, do 8 tras</li>
  <li><code>GET /v/map?route=0&amp;part=0</code> &mdash; JPEG 240x320</li>
</ul>
<h2>Modern (JSON)</h2>
<ul>
  <li><code>GET /download/</code> &mdash; instalka MIDletu (JAR + JAD)</li>
</ul>
<h2>Modern (JSON) - ciag dalszy</h2>
<ul>
  <li><code>GET /api/routes?msg=z+A+do+B</code> &mdash; trasy z geometrią</li>
  <li><code>GET /api/locations?q=Miedzynarodowa</code> &mdash; podpowiedzi</li>
  <li><code>GET /api/health</code></li>
</ul>
<p>Wspólne parametry: <code>city</code>, <code>from</code>, <code>to</code>, <code>at</code>, <code>limit</code>.</p>
</body>
</html>`;
}

function errorStatus(error) {
  if (error && error.userFacing) return 400;
  return 502;
}

function errorMessage(error) {
  if (error && error.userFacing) return error.message;
  return `Błąd źródła danych: ${error && error.message ? error.message : 'nieznany błąd'}`;
}

async function handleLegacyText(req, res, url, ip) {
  const result = await searchFor(url, ip);
  if (!result.routes.length) {
    sendText(res, 200, legacy.noRoutesMessage(result));
    return;
  }
  sendText(res, 200, legacy.legacyText(result));
}

async function handleLegacyMap(req, res, url, ip) {
  let result = null;
  const msg = url.searchParams.get('msg');

  if (msg) {
    result = await searchFor(url, ip);
  } else {
    const remembered = lastByClient.get(ip);
    result = (remembered && remembered.expiresAt > Date.now() ? remembered.result : null)
      || (lastGlobal.expiresAt > Date.now() ? lastGlobal.result : null);
  }

  if (!result) {
    sendText(res, 404, 'Brak ostatniego wyszukiwania. Najpierw wywołaj /v?msg=...');
    return;
  }

  const routeIndex = Number(url.searchParams.get('route') || 0);
  const partIndex = Number(url.searchParams.get('part') || 0);
  const route = result.routes[routeIndex];
  const walk = route && route.walks[partIndex];

  if (!walk) {
    sendText(res, 404, `Nie ma trasy ${routeIndex} z częścią pieszą ${partIndex}.`);
    return;
  }

  send(res, 200, 'image/jpeg', renderWalkMap(walk.shape));
}

async function handleModernRoutes(req, res, url, ip) {
  const result = await searchFor(url, ip);
  sendJson(res, 200, jsonView(result));
}

async function handleLocations(req, res, url) {
  const query = url.searchParams.get('q') || url.searchParams.get('msg') || '';
  if (!query) {
    sendJson(res, 400, { ok: false, error: 'Brak parametru q.' });
    return;
  }
  const locations = await transit.locations(query, url.searchParams.get('city') || undefined);
  sendJson(res, 200, { ok: true, query, count: locations.length, locations });
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const ip = clientIp(req);
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendText(res, 400, 'Nieprawidłowy URL.');
    return;
  }

  const finish = (label) => log(`${ip} ${req.method} ${url.pathname} -> ${label} ${Date.now() - started}ms`);

  const route = async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Dozwolone tylko GET.');
      return '405';
    }

    switch (url.pathname) {
      case '/':
        send(res, 200, 'text/html; charset=utf-8', renderIndex());
        return '200';
      case '/v':
        await handleLegacyText(req, res, url, ip);
        return '200';
      case '/v/map':
        await handleLegacyMap(req, res, url, ip);
        return '200';
      case '/api/routes':
        await handleModernRoutes(req, res, url, ip);
        return '200';
      case '/api/locations':
        await handleLocations(req, res, url);
        return '200';
      case '/api/health':
        sendJson(res, 200, { ok: true, uptimeSeconds: Math.round(process.uptime()), city: transit.CITY });
        return '200';
      case '/download':
      case '/download/':
        return serveDownload(res, null);
      default:
        if (url.pathname.startsWith('/download/')) {
          return serveDownload(res, url.pathname.slice('/download/'.length));
        }
        sendText(res, 404, `Nie ma takiego zasobu: ${url.pathname}`);
        return '404';
    }
  };

  let settled = false;
  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    sendText(res, 504, 'Przekroczono czas oczekiwania na dane.');
    finish('504');
  }, REQUEST_TIMEOUT_MS);

  route()
    .then((label) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      finish(label);
    })
    .catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const status = errorStatus(error);
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, status, { ok: false, error: errorMessage(error) });
      } else {
        sendText(res, status, errorMessage(error));
      }
      finish(String(status));
    });
});

server.listen(PORT, HOST, () => {
  log(`transit api listening on http://${HOST}:${PORT} (city=${transit.CITY}, from=${transit.DEFAULT_FROM})`);
  // Warm the anonymous upstream registration so the first client request is fast.
  transit.warmUp().then(
    () => log('upstream registration ok'),
    (error) => log(`upstream registration failed (will retry per request): ${error.message}`),
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = server;
