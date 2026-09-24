#!/usr/bin/env node
/**
 * Dumps the shape of a real Jakdojade response so the /v mapper can be written
 * against actual field names instead of guesses.
 *
 *   node server/tools/inspect-upstream.js [A] [B]
 *
 * Defaults to Plac Defilad 1 -> Międzynarodowa in Warszawa, tomorrow 18:00.
 */
const { JakdojadeClient } = require('../../src/index');

const CITY = process.env.CITY_SYMBOL || 'WARSZAWA';

function point(name, lat, lon, type, code) {
  const p = {
    citySymbol: CITY,
    coordinate: { y_lat: lat, x_lon: lon },
    locationType: type,
    locationName: name,
  };
  if (code) p.locationCode = code;
  return p;
}

function show(label, value, max = 700) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`    ${label}: ${text === undefined ? 'undefined' : String(text).slice(0, max)}`);
}

async function main() {
  const startName = process.argv[2] || 'Plac Defilad 1';
  const destName = process.argv[3] || 'Międzynarodowa';

  const client = new JakdojadeClient();
  const timeOptions = {
    dateTime: new Date(Date.now() + 86400000).toISOString().split('.')[0] + '+02:00',
    queryTimeType: 'DEPARTURE',
  };

  const start = point(startName, 52.2319, 21.0067, 'ADDRESS');
  const dest = point(destName, 52.22997, 21.068713, 'STOP_POINT', '209802');

  console.log('=== locationSearch("' + destName + '") ===');
  try {
    const loc = await client.locationSearch(destName, CITY);
    show('top keys', Object.keys(loc));
    const list = loc.locations || loc.suggestions || loc.items || [];
    console.log('    results:', Array.isArray(list) ? list.length : typeof list);
    if (Array.isArray(list) && list[0]) {
      show('first', list[0], 500);
    }
  } catch (e) {
    console.log('    locationSearch failed:', e.message);
  }

  console.log('\n=== searchRoute ===');
  const res = await client.searchRoute(start, dest, timeOptions);
  const routes = (res && res.routes) || [];
  console.log('routes:', routes.length);

  routes.slice(0, 2).forEach((route, ri) => {
    console.log(`\n--- route[${ri}] keys: ${Object.keys(route).join(',')}`);
    const parts = route.routeParts || [];
    console.log(`    parts: ${parts.length}`);
    parts.forEach((p, pi) => {
      console.log(`\n    part[${pi}] type=${p.routePartType} durSec=${p.durationSeconds} distM=${p.routePartDistanceMeters}`);
      console.log(`      keys: ${Object.keys(p).join(',')}`);
      show('startDeparture', p.startDeparture, 300);
      show('targetArrival', p.targetArrival, 300);
      if (p.routeWalk) {
        console.log(`      routeWalk keys: ${Object.keys(p.routeWalk).join(',')}`);
        show('routeWalk sample', p.routeWalk, 900);
      }
      const v = p.routeVehicle;
      if (v) {
        console.log(`      routeVehicle keys: ${Object.keys(v).join(',')}`);
        if (v.routeLine) {
          console.log(`        routeLine keys: ${Object.keys(v.routeLine).join(',')}`);
          show('line', v.routeLine.line, 400);
          show('heading', v.routeLine.lineHeadingText, 120);
        }
        const stops = v.routeStops || [];
        console.log(`        routeStops: ${stops.length} startIdx=${v.stopsStartIndex} endIdx=${v.stopsEndIndex}`);
        const first = stops[v.stopsStartIndex];
        const last = stops[v.stopsEndIndex];
        if (first) show('first stop', first, 500);
        if (last) show('last stop', last, 300);
      }
    });
  });
}

main().catch((e) => {
  console.error('inspect failed:', e.message);
  if (e.response) console.error('status', e.response.status, JSON.stringify(e.response.data).slice(0, 300));
  process.exit(1);
});
