'use strict';
/**
 * Renders the walk shape of one route part into a 240x320 baseline JPEG, which
 * is what the J2ME MIDlet's Screen 5 paints full screen.
 *
 * Deliberately dependency-light: a schematic (grid + orange track + start/end
 * markers) drawn into an RGBA buffer and encoded with jpeg-js at quality 70.
 * No text is drawn - the MIDlet overlays the walk description itself.
 */
const jpeg = require('jpeg-js');

const WIDTH = 240;
const HEIGHT = 320;
const QUALITY = Number(process.env.MAP_JPEG_QUALITY || 70);
const PADDING = 24;

const WHITE = [255, 255, 255];
const GRID = [232, 232, 232];
const ORANGE = [255, 140, 0];
const START = [26, 145, 62];
const END = [200, 30, 30];
const EMPTY = [245, 236, 224];

function createCanvas() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    data[i * 4] = WHITE[0];
    data[i * 4 + 1] = WHITE[1];
    data[i * 4 + 2] = WHITE[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function setPixel(data, x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = 255;
}

function fillRect(data, x, y, w, h, color) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      setPixel(data, px, py, color);
    }
  }
}

function drawGrid(data) {
  for (let x = 0; x < WIDTH; x += 32) fillRect(data, x, 0, 1, HEIGHT, GRID);
  for (let y = 0; y < HEIGHT; y += 32) fillRect(data, 0, y, WIDTH, 1, GRID);
}

function fillCircle(data, cx, cy, radius, color) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) setPixel(data, cx + x, cy + y, color);
    }
  }
}

function drawThickLine(data, x0, y0, x1, y1, thickness, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const half = Math.max(0, Math.floor(thickness / 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(data, x - half, y - half, thickness, thickness, color);
  }
}

/**
 * Projects lon/lat onto the canvas, preserving aspect ratio (longitude degrees
 * shrink with latitude) and centring whatever is left over.
 */
function projector(shape) {
  const lats = shape.map((p) => p.lat);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lonScale = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));

  const points = shape.map((p) => ({ x: p.lon * lonScale, y: p.lat }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const usableW = WIDTH - PADDING * 2;
  const usableH = HEIGHT - PADDING * 2;

  let scale;
  if (spanX <= 0 && spanY <= 0) {
    scale = 0;
  } else if (spanX <= 0) {
    scale = usableH / spanY;
  } else if (spanY <= 0) {
    scale = usableW / spanX;
  } else {
    scale = Math.min(usableW / spanX, usableH / spanY);
  }

  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  return points.map((p) => ({
    // Latitude grows north, screen y grows south.
    x: Math.round(offsetX + (p.x - minX) * scale),
    y: Math.round(offsetY + (maxY - p.y) * scale),
  }));
}

/** A short or missing shape still returns a valid JPEG, never an error page. */
function placeholder(data) {
  for (let y = 0; y < HEIGHT; y += 16) {
    for (let x = 0; x < WIDTH; x += 16) {
      if (((x / 16) + (y / 16)) % 2 === 0) fillRect(data, x, y, 16, 16, EMPTY);
    }
  }
  drawThickLine(data, WIDTH / 2 - 30, HEIGHT / 2, WIDTH / 2 + 30, HEIGHT / 2, 4, ORANGE);
  fillCircle(data, WIDTH / 2, HEIGHT / 2, 6, END);
}

/**
 * @param {Array<{lon:number,lat:number}>} shape
 * @returns {Buffer} baseline JPEG bytes
 */
function renderWalkMap(shape) {
  const data = createCanvas();
  drawGrid(data);

  const usable = Array.isArray(shape) ? shape.slice(0, 4000) : [];
  if (usable.length === 0) {
    placeholder(data);
  } else {
    const points = projector(usable);
    for (let i = 1; i < points.length; i += 1) {
      drawThickLine(data, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, 3, ORANGE);
    }
    if (points.length === 1) {
      fillCircle(data, points[0].x, points[0].y, 3, ORANGE);
    }
    const first = points[0];
    const last = points[points.length - 1];
    fillCircle(data, first.x, first.y, 5, WHITE);
    fillCircle(data, first.x, first.y, 4, START);
    fillCircle(data, last.x, last.y, 5, WHITE);
    fillCircle(data, last.x, last.y, 4, END);
  }

  // 1px frame so the image reads as a map panel on the phone.
  fillRect(data, 0, 0, WIDTH, 1, ORANGE);
  fillRect(data, 0, HEIGHT - 1, WIDTH, 1, ORANGE);
  fillRect(data, 0, 0, 1, HEIGHT, ORANGE);
  fillRect(data, WIDTH - 1, 0, 1, HEIGHT, ORANGE);

  const encoded = jpeg.encode({ data, width: WIDTH, height: HEIGHT }, QUALITY);
  return encoded.data;
}

module.exports = { renderWalkMap, WIDTH, HEIGHT };
