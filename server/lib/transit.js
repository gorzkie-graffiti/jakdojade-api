'use strict';
/**
 * Shared transit core: turns a free-text query into a normalised route list by
 * driving the Jakdojade client, so both the legacy text API and the modern JSON
 * API serve exactly the same data.
 *
 * Normalised route:
 *   { id, line, dir, dep, arr, duration, distance, parts:[...], walks, transits }
 * Walk part:    { kind:'walk', walkIndex, type, distance, desc, shape:[{lon,lat}] }
 * Transit part: { kind:'transit', line, dir, from, to, stops }
 */
const { JakdojadeClient } = require('../../src/index');

const CITY = process.env.CITY_SYMBOL || 'WARSZAWA';
const DEFAULT_FROM = process.env.DEFAULT_FROM || 'Plac Defilad 1';
const MAX_ROUTES = Number(process.env.MAX_ROUTES || 8);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 25000);

// One client for the whole process: it keeps the anonymous registration and
// avoids re-registering a device on every single request.
const client = new JakdojadeClient();

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} nie odpowiedział w ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stripDiacritics(value) {
  return String(value == null ? '' : value)
    .replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Upstream strings land in a '|'-delimited protocol, so they must stay clean. */
function sanitize(value) {
  return String(value == null ? '' : value).replace(/[|\r\n]+/g, ' ').trim();
}

/** "2026-09-24T16:51:00.000+0200" -> "16:51" (the upstream value is already local). */
function hhmm(dateTimeString) {
  const text = String(dateTimeString || '');
  const match = text.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '--:--';
}

function parseDateTime(dateTimeString) {
  if (!dateTimeString) return null;
  const normalised = String(dateTimeString).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(from, to) {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

function partDeparture(part) {
  const d = part.startDeparture || {};
  return d.realtimeDateTime || d.dateTime || null;
}

function partArrival(part) {
  const d = part.targetArrival || {};
  return d.realtimeDateTime || d.dateTime || null;
}

function lineInfo(part) {
  const vehicle = part.routeVehicle || {};
  const routeLine = vehicle.routeLine || {};
  const line = routeLine.line || {};
  const display = line.lineDisplayName || {};
  return {
    name: sanitize(display.lineName || display.name || '?'),
    heading: sanitize(routeLine.lineHeadingText || ''),
    vehicleType: line.vehicleType || vehicle.routeVehicleType || '',
  };
}

function stopNameAt(routeStops, index) {
  const stop = (routeStops || [])[index];
  const point = stop && stop.lineStop && stop.lineStop.stopPoint;
  return sanitize((point && point.stopName) || '');
}

function walkShapeOf(part) {
  const walk = part.routeWalk || {};
  const shape = walk.walkShape || [];
  return shape
    .map((p) => ({ lon: Number(p.x_lon), lat: Number(p.y_lat) }))
    .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

/**
 * "z A do B", "A -> B", "A do B" or a bare destination (which is then searched
 * from DEFAULT_FROM, so the MIDlet's default query still returns routes).
 */
/** A few city hints so "z Pabianic do Łodzi" does not search Warszawa. */
const CITY_HINTS = [
  { match: /pabianic/i, city: 'PABIANICE' },
  { match: /([łŁ]ód[źz]|[łŁ]odzi|lodz|lodzi)/, city: 'LODZ' },
];

function cityHint(...texts) {
  const joined = texts.filter(Boolean).join(' ');
  for (const hint of CITY_HINTS) {
    if (hint.match.test(joined)) return hint.city;
  }
  return null;
}

function parseQuery(msg) {
  const text = String(msg == null ? '' : msg).trim();
  if (!text) return { from: null, to: '' };

  const patterns = [
    /^(?:z|od)\s+(.+?)\s+do\s+(.+)$/i,
    /^(.+?)\s+(?:->|=>|→|–|—|-)\s+(.+)$/,
    /^(.+?)\s+do\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { from: match[1].trim(), to: match[2].trim() };
    }
  }
  return { from: null, to: text };
}

/**
 * Polish users type inflected forms ("do Międzynarodowej", not "Międzynarodowa"),
 * and the upstream happily returns addresses whose street matches. Scores name
 * similarity and prefers actual stops, so the obvious stop wins.
 */
function matchScore(query, candidate) {
  const q = stripDiacritics(query);
  const name = stripDiacritics(candidate.name || '');
  if (!q || !name) return -1000;

  // Shared prefix ratio is the main signal: Polish inflection keeps the stem
  // ("miedzynarodow" + "a" vs + "ej"), so being a substring of a long POI name
  // such as "Biuro Wspolpracy Miedzynarodowej" must not outrank the stop.
  const longest = Math.max(name.length, q.length);
  const shortest = Math.min(name.length, q.length);
  let common = 0;
  while (common < shortest && name[common] === q[common]) common += 1;
  const ratio = common / longest;

  let score = 0;
  if (name === q) score += 1000;
  else if (name.startsWith(q) || q.startsWith(name)) score += 600;
  else if (name.includes(q) || q.includes(name)) score += 120;
  score += Math.round(ratio * 500);

  // Type preference is scaled by the name match, so an unrelated stop never
  // outranks a well matching address such as "Plac Defilad 1".
  const type = String(candidate.locationType || '');
  const typeBonus = type.indexOf('STOP') === 0 ? 150 : type === 'ADDRESS' ? 20 : 0;
  score += Math.round(typeBonus * ratio);

  if (candidate.stopGroup) score += Math.round(40 * ratio);
  return score;
}

/** Common Polish case endings, longest first, used to guess the base form. */
const SUFFIXES = ['ego', 'emu', 'ych', 'ich', 'ami', 'ach', 'owi', 'ej', 'ów', 'ie', 'em', 'ą', 'ę', 'o', 'e', 'u', 'y', 'i', 'a'];

function deinflectWord(word) {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * Guessed alternative spellings that the upstream actually knows:
 *   "Dworca Fabrycznego" -> "Dworc Fabryczn" (stripped)
 *                        -> "Dworca Fabryczna" (nominative-ish)
 * The stop the user means is "Międzynarodowa", but Poles type
 * "do Międzynarodowej", which upstream answers with an address instead.
 */
function variantForms(query) {
  const words = String(query).split(/\s+/);
  const forms = [];

  const stripped = words.map((word) => deinflectWord(word) || word).join(' ');
  const nominative = words.map((word) => {
    if (word.length > 4 && word.endsWith('ej')) return `${word.slice(0, -2)}a`;
    if (word.length > 5 && word.endsWith('ego')) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && word.endsWith('ym')) return `${word.slice(0, -2)}y`;
    if (word.length > 4 && word.endsWith('ą')) return `${word.slice(0, -1)}a`;
    return word;
  }).join(' ');

  for (const form of [nominative, stripped]) {
    if (form && form !== query && !forms.includes(form)) forms.push(form);
  }
  return forms;
}

/** Queries the upstream with the name as typed plus its guessed variants. */
async function locationCandidates(query, city) {
  const searches = [query, ...variantForms(query)].slice(0, 3);

  const responses = await Promise.all(searches.map((q) => withTimeout(
    client.locationSearch(q, city), UPSTREAM_TIMEOUT_MS, 'locationSearch',
  ).catch(() => null)));

  const merged = [];
  for (const response of responses) {
    for (const location of (response && response.locations) || []) merged.push(location);
  }
  return merged;
}

async function resolvePlace(name, city) {
  const query = String(name || '').trim();
  if (!query) return null;

  const locations = await locationCandidates(query, city);
  if (!locations.length) return null;

  let chosen = locations[0];
  let bestScore = matchScore(query, chosen);
  for (const location of locations) {
    const score = matchScore(query, location);
    if (score > bestScore) {
      bestScore = score;
      chosen = location;
    }
  }

  return {
    citySymbol: chosen.citySymbol || city,
    coordinate: chosen.coordinate,
    locationType: chosen.locationType,
    locationName: chosen.name,
    ...(chosen.locationCode ? { locationCode: chosen.locationCode } : {}),
    displayName: chosen.subName ? `${chosen.name} (${chosen.subName})` : chosen.name,
  };
}

function normaliseRoute(rawRoute) {
  const rawParts = rawRoute.routeParts || [];
  const parts = [];
  const walks = [];
  const transits = [];
  let walkIndex = 0;

  rawParts.forEach((part, position) => {
    if (part.routePartType === 'WALK' || part.routeWalk) {
      const isLast = position === rawParts.length - 1;
      const next = rawParts[position + 1];
      const nextLine = next ? lineInfo(next) : null;
      const nextStop = next && next.routeVehicle
        ? stopNameAt(next.routeVehicle.routeStops, next.routeVehicle.stopsStartIndex)
        : '';

      let desc;
      if (isLast) {
        desc = 'do celu';
      } else if (nextStop) {
        desc = `do przystanku ${nextStop}`;
      } else {
        desc = nextLine ? `do ${nextLine.name}` : 'dalej';
      }

      const walk = {
        kind: 'walk',
        walkIndex,
        type: position === 0 ? 'start' : isLast ? 'end' : 'transfer',
        distance: Number(part.routePartDistanceMeters || 0),
        desc: sanitize(desc),
        shape: walkShapeOf(part),
      };
      walkIndex += 1;
      walks.push(walk);
      parts.push(walk);
      return;
    }

    if (part.routeVehicle) {
      const info = lineInfo(part);
      const vehicle = part.routeVehicle;
      const from = stopNameAt(vehicle.routeStops, vehicle.stopsStartIndex);
      const to = stopNameAt(vehicle.routeStops, vehicle.stopsEndIndex);
      const transit = {
        kind: 'transit',
        line: info.name,
        dir: info.heading,
        vehicleType: info.vehicleType,
        from,
        to,
        stops: Math.max(0, Number(vehicle.stopsEndIndex || 0) - Number(vehicle.stopsStartIndex || 0)),
      };
      transits.push(transit);
      parts.push(transit);
    }
  });

  const first = rawParts[0];
  const last = rawParts[rawParts.length - 1];
  const departure = first ? partDeparture(first) : null;
  const arrival = last ? partArrival(last) : null;
  const primary = transits[0] || { line: 'Pieszo', dir: '' };

  return {
    id: sanitize(rawRoute.routeId || ''),
    line: primary.line,
    dir: primary.dir,
    dep: hhmm(departure),
    arr: hhmm(arrival),
    duration: minutesBetween(parseDateTime(departure), parseDateTime(arrival)),
    distance: rawParts.reduce((sum, p) => sum + Number(p.routePartDistanceMeters || 0), 0),
    parts,
    walks,
    transits,
  };
}

/**
 * Runs a full search for a free-text query and returns the normalised routes.
 * opts: { city, from, to, at, limit }
 */
async function search(msg, opts = {}) {
  const parsed = parseQuery(msg);
  const city = opts.city
    || cityHint(msg)
    || cityHint(parsed.from, parsed.to)
    || CITY;
  const fromName = opts.from || parsed.from || DEFAULT_FROM;
  const toName = opts.to || parsed.to;

  if (!toName) {
    const error = new Error('Brak celu podróży. Użyj "z A do B".');
    error.userFacing = true;
    throw error;
  }

  const departureTime = opts.at ? new Date(opts.at) : new Date();
  if (Number.isNaN(departureTime.getTime())) {
    const error = new Error('Nieprawidłowa data w parametrze "at".');
    error.userFacing = true;
    throw error;
  }

  const [from, to] = await Promise.all([
    resolvePlace(fromName, city),
    resolvePlace(toName, city),
  ]);

  if (!from) {
    const error = new Error(`Nie znaleziono miejsca startowego: ${fromName}`);
    error.userFacing = true;
    throw error;
  }
  if (!to) {
    const error = new Error(`Nie znaleziono miejsca docelowego: ${toName}`);
    error.userFacing = true;
    throw error;
  }

  const timeOptions = {
    dateTime: toUpstreamDateTime(departureTime),
    queryTimeType: 'DEPARTURE',
  };

  const response = await withTimeout(
    client.searchRoute(toRequestPoint(from), toRequestPoint(to), timeOptions),
    UPSTREAM_TIMEOUT_MS,
    'searchRoute',
  );

  const routes = ((response && response.routes) || []).slice(0, opts.limit || MAX_ROUTES);
  return {
    city,
    from,
    to,
    requestedAt: departureTime.toISOString(),
    routes: routes.map(normaliseRoute),
  };
}

/**
 * The upstream wants Warsaw wall-clock time with an explicit offset, e.g.
 * "2026-09-24T16:51:00+02:00". Built from Intl so it is correct whatever
 * timezone the server itself runs in (the VM is UTC, the laptop is not).
 */
function toUpstreamDateTime(date) {
  const wall = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(' ', 'T');

  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'longOffset',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName');

  const offset = (offsetPart ? offsetPart.value : 'GMT+02:00').replace('GMT', '') || '+00:00';
  return `${wall}${offset}`;
}

/**
 * Registers the anonymous device once at startup. Without this, two parallel
 * lookups on a cold process each see empty credentials and register separately.
 */
async function warmUp() {
  await withTimeout(client.register(), UPSTREAM_TIMEOUT_MS, 'register');
}

/** Location suggestions, for the modern clients' autocomplete. */
async function locations(query, city = CITY) {
  const text = String(query == null ? '' : query).trim();
  if (!text) return [];
  const found = await withTimeout(client.locationSearch(text, city), UPSTREAM_TIMEOUT_MS, 'locationSearch');
  return ((found && found.locations) || []).slice(0, 20).map((l) => ({
    name: sanitize(l.name),
    subName: sanitize(l.subName || ''),
    type: l.locationType || '',
    code: l.locationCode || null,
    lat: l.coordinate ? l.coordinate.y_lat : null,
    lon: l.coordinate ? l.coordinate.x_lon : null,
    city: l.citySymbol || city,
  }));
}

function toRequestPoint(place) {
  return {
    citySymbol: place.citySymbol,
    coordinate: place.coordinate,
    locationType: place.locationType,
    locationName: place.locationName,
    ...(place.locationCode ? { locationCode: place.locationCode } : {}),
  };
}

module.exports = {
  search,
  warmUp,
  locations,
  cityHint,
  variantForms,
  matchScore,
  locationCandidates,
  parseQuery,
  resolvePlace,
  sanitize,
  stripDiacritics,
  CITY,
  DEFAULT_FROM,
  MAX_ROUTES,
};
