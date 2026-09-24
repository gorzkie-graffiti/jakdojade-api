#!/usr/bin/env node
/**
 * Local smoke test: no HTTP server needed.
 *
 *   node server/tools/smoke.js ["z A do B"]
 *
 * Exercises the transit core against the live Jakdojade API, renders the legacy
 * R|W|T text, encodes a walk map JPEG and checks the modern JSON view.
 */
const fs = require('node:fs');
const path = require('node:path');
const transit = require('../lib/transit');
const legacy = require('../lib/legacy');
const { renderWalkMap } = require('../lib/mapimage');

const query = process.argv[2] || 'z Placu Defilad do Międzynarodowej';

function fail(message) {
  console.error('FAIL ', message);
  process.exitCode = 1;
}

function pass(message) {
  console.log('PASS ', message);
}

async function main() {
  console.log(`query: ${query}\n`);
  await transit.warmUp();

  const result = await transit.search(query);
  console.log(`from: ${result.from.displayName}`);
  console.log(`to:   ${result.to.displayName}`);
  console.log(`routes: ${result.routes.length}\n`);

  if (!result.routes.length) fail('no routes returned');
  else pass(`${result.routes.length} routes returned`);

  const first = result.routes[0];
  console.log(`route 0: ${first.line} -> ${first.dir}  ${first.dep}-${first.arr} (${first.duration} min)`);
  first.parts.forEach((p, i) => {
    if (p.kind === 'walk') {
      console.log(`  part ${i}: WALK ${p.distance}m "${p.desc}" shape=${p.shape.length} pts type=${p.type}`);
    } else {
      console.log(`  part ${i}: ${p.line} "${p.dir}" ${p.from} -> ${p.to} (${p.stops} stops)`);
    }
  });

  // --- legacy text contract -------------------------------------------------
  const text = legacy.legacyText(result);
  const lines = text.split('\n');
  const rLines = lines.filter((l) => l.startsWith('R|'));
  const wLines = lines.filter((l) => l.startsWith('W|'));
  const tLines = lines.filter((l) => l.startsWith('T|'));
  console.log(`\nlegacy text: ${lines.length} lines, R=${rLines.length} W=${wLines.length} T=${tLines.length}`);

  if (rLines.length !== result.routes.length) fail('R line count does not match route count');
  else pass('one R line per route');

  const rFields = rLines[0].split('|');
  if (rFields.length !== 7) fail(`R line should have 7 fields, got ${rFields.length}`);
  else pass(`R line has 7 fields: ${rLines[0]}`);

  if (!lines.some((l) => l === '')) fail('no blank line between routes');
  else pass('blank line separates routes');

  const badW = wLines.filter((l) => l.split('|').length !== 6);
  if (badW.length) fail(`W lines with wrong field count: ${badW.length}`);
  else pass('every W line has 6 fields');

  const badT = tLines.filter((l) => l.split('|').length !== 6);
  if (badT.length) fail(`T lines with wrong field count: ${badT.length}`);
  else pass('every T line has 6 fields');

  const withShape = wLines.filter((l) => l.split('|')[5].length > 0);
  if (wLines.length && !withShape.length) fail('no W line carried a shape');
  else pass(`${withShape.length}/${wLines.length} W lines carry shapes`);

  console.log('\n--- first route as legacy text ---');
  console.log(text.split('\n\n')[0]);

  // --- map renderer ---------------------------------------------------------
  const walk = first.walks[0];
  if (walk) {
    const jpegBytes = renderWalkMap(walk.shape);
    const out = path.join('/tmp', 'ember-walk0.jpg');
    fs.writeFileSync(out, jpegBytes);
    const isJpeg = jpegBytes[0] === 0xff && jpegBytes[1] === 0xd8 && jpegBytes[jpegBytes.length - 2] === 0xff && jpegBytes[jpegBytes.length - 1] === 0xd9;
    if (isJpeg) pass(`JPEG SOI/EOI ok, ${jpegBytes.length} bytes -> ${out}`);
    else fail('rendered map is not a JPEG');
    if (jpegBytes.length < 1000) fail(`map suspiciously small: ${jpegBytes.length} bytes`);
  } else {
    console.log('(route 0 has no walking part, skipping map render)');
    const bytes = renderWalkMap([]);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) pass(`placeholder map renders (${bytes.length} bytes)`);
    else fail('placeholder map is not a JPEG');
  }

  // --- modern json view ----------------------------------------------------
  const json = JSON.parse(JSON.stringify({
    count: result.routes.length,
    routes: result.routes.map((r) => ({
      id: r.id,
      line: r.line,
      parts: r.parts.map((p) => (p.kind === 'walk' ? { kind: p.kind, points: p.shape.length } : { kind: p.kind, line: p.line })),
    })),
  }));
  const shaped = json.routes.some((r) => r.parts.some((p) => p.kind === 'walk' && p.points > 1));
  if (shaped) pass('json view carries walk geometries');
  else fail('json view lost walk geometries');
}

main().catch((error) => {
  console.error('smoke failed:', error.message);
  process.exit(1);
});
