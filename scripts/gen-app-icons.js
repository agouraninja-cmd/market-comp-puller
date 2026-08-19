#!/usr/bin/env node
// Generates the PWA + iOS app icons from the CompNinja mark.
//
// Why this exists rather than a checked-in binary nobody can regenerate: the
// mark is two shapes (favicon.svg's navy comp card and its red diagonal
// slice), and an icon set has to be re-cut whenever a size is added or the
// brand colour moves. Zero dependencies on purpose -- this repo has none, and
// an icon script is not the thing to break that for. PNG is written by hand
// (zlib is built into Node); shapes are rasterized with 4x4 supersampling,
// which is enough antialiasing for a mark this simple.
//
// Run:  node scripts/gen-app-icons.js
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// --- The mark, in favicon.svg's 30x30 viewBox. Keep these in step with
// favicon.svg; it is the source of truth for the brand mark and this file is
// a rasterizer, not a second design.
const NAVY = [0x1a, 0x24, 0x33];
const RED = [0xb9, 0x1c, 0x1c];
// The app's light-theme background, and the ground the existing hand-made
// /apple-touch-icon.png already sits on. Every icon here is opaque and uses
// it, so the home-screen icon this ships and the one the site has served for
// months are the same picture -- an installable app is not the moment to
// introduce a second version of the brand mark.
const CREAM = [0xfb, 0xfb, 0xf9];
const CARD = { x: 2, y: 4, w: 26, h: 22, r: 2 };
const SLICE = [[3.5, 26], [28, 5.5], [28, 10], [8, 26]];
const VIEW = 30;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
// RGBA8 -> PNG. Filter byte 0 on every scanline: these are flat-colour marks,
// so a smarter filter would buy bytes nobody is counting.
function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    px.copy(raw, o, y * size * 4, (y + 1) * size * 4);
    o += size * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  // Only the four corner boxes need the radius test.
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  if (cx === px && cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}
function inPolygon(px, py, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// One routine cuts every size. `scale` shrinks the mark within the canvas so
// the maskable variant survives being cropped to a circle; the ground is
// always painted, because a transparent app icon is composited onto black by
// iOS and onto whatever the launcher feels like by Android.
function render(size, { scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;                      // supersampling factor per axis
  const unit = size / VIEW;
  const off = (size - size * scale) / 2;
  const toView = (v) => (v - off) / (unit * scale);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let navy = 0, red = 0, n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const vx = toView(x + (sx + 0.5) / SS);
          const vy = toView(y + (sy + 0.5) / SS);
          n++;
          if (inPolygon(vx, vy, SLICE)) red++;
          else if (inRoundedRect(vx, vy, CARD)) navy++;
        }
      }
      const i = (y * size + x) * 4;
      const rc = red / n, nc = navy / n, bc = 1 - rc - nc;
      for (let ch = 0; ch < 3; ch++) {
        px[i + ch] = Math.round(RED[ch] * rc + NAVY[ch] * nc + CREAM[ch] * bc);
      }
      px[i + 3] = 255;
    }
  }
  return encodePng(px, size);
}

// Scale is a platform safe zone, not taste. A maskable icon may be cropped to
// a circle of 80% diameter and the card's diagonal is 1.135x the canvas at
// full size, so it has to come down to ~0.68 to survive every launcher shape.
// The rest sit at 1.0, which reproduces the framing of the existing
// /apple-touch-icon.png -- that file is hand-made, predates this script, and
// is deliberately left alone rather than regenerated.
const ICONS = [
  ["icons/icon-192.png", 192, {}],
  ["icons/icon-512.png", 512, {}],
  ["icons/icon-maskable-512.png", 512, { scale: 0.68 }],
  // Not served by the app: this is the 1024 App Store icon, read by Xcode at
  // build time. Apple requires it opaque, and applies its own squircle mask.
  ["icons/icon-1024.png", 1024, {}],
];

const outDir = path.join(__dirname, "..");
fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });
for (const [rel, size, opts] of ICONS) {
  const buf = render(size, opts);
  fs.writeFileSync(path.join(outDir, rel), buf);
  console.log(`${rel.padEnd(34)} ${String(size).padStart(4)}px  ${(buf.length / 1024).toFixed(1)} KB`);
}
