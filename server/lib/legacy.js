'use strict';
/**
 * Legacy text front-end: the compact, line-delimited protocol that the J2ME
 * MIDlet parses. Everything is ASCII except the Polish descriptions, and the
 * body is UTF-8.
 *
 *   R|routeId|line|direction|depTime|arrTime|durationMin
 *   W|partIndex|type|distanceM|description|lon,lat;lon,lat;...
 *   T|line|direction|fromStop|toStop|stopCount
 *
 * Routes are separated by a blank line; at most MAX_ROUTES are sent.
 */
const { sanitize } = require('./transit');

function shapeField(shape) {
  if (!Array.isArray(shape) || !shape.length) return '';
  return shape.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
}

function legacyText(result) {
  const lines = [];

  result.routes.forEach((route) => {
    lines.push([
      'R',
      route.id,
      route.line,
      route.dir,
      route.dep,
      route.arr,
      route.duration,
    ].join('|'));

    route.parts.forEach((part) => {
      if (part.kind === 'walk') {
        lines.push([
          'W',
          part.walkIndex,
          part.type,
          part.distance,
          part.desc,
          shapeField(part.shape),
        ].join('|'));
      } else {
        lines.push([
          'T',
          part.line,
          part.dir,
          part.from,
          part.to,
          part.stops,
        ].join('|'));
      }
    });

    lines.push(''); // blank line = end of this route
  });

  return lines.join('\n');
}

/** 200 with prose when there is nothing to route: the MIDlet shows it verbatim. */
function noRoutesMessage(result) {
  return `Nie znaleziono tras z "${sanitize(result.from.locationName)}" do "${sanitize(result.to.locationName)}". Spróbuj innego przystanku lub "z A do B".`;
}

module.exports = { legacyText, noRoutesMessage, shapeField };
