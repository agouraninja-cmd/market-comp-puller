// Technical QA for market-page hero JPEGs.
//
// A person still has to look at the photograph (right city, not just clouds).
// This module only flags what a file can prove: missing, the wrong size, or
// so few bytes for 3840×800 that the original was almost certainly smaller
// than the slot and got upscaled (Ontario, CA on the first ship). The live
// header then skips that file and uses Esri World Imagery of the same city.
// Pure, no I/O, so npm test can pin the grades without the JPEGs on disk.

"use strict";

const {
  HERO_WIDTH,
  HERO_HEIGHT,
  HERO_SRCSET_WIDTH,
  HERO_SRCSET_HEIGHT,
} = require("./market-hero");

// Bytes per pixel below this, at the stored 3840×800, is a soft original.
// Ontario, CA measured ~0.057; the next-smallest real skyline was ~0.167.
const SOFT_BYTES_PER_PIXEL = 0.10;

function jpegDimensions(buf) {
  if (!buf || buf.length < 4) return null;
  const b = buf instanceof Uint8Array ? buf : null;
  if (!b) return null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    // RST0–RST7 and TEM have no length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (i + 3 >= b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const isSof = (marker >= 0xc0 && marker <= 0xcf)
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= b.length) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    i += 2 + len;
  }
  return null;
}

function displayCity(key) {
  const parts = String(key || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return String(key || "").trim();
  const city = parts[0].replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return city + ", " + parts[1].toUpperCase();
}

function kb(bytes) {
  return Math.round(Number(bytes || 0) / 1024);
}

function gradeHero(input) {
  const src = input || {};
  const reasons = [];
  const width = src.width;
  const height = src.height;
  const bytes = src.bytes;
  const bpp = (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Number.isFinite(bytes) && bytes > 0)
    ? bytes / (width * height)
    : null;

  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    reasons.push("JPEG is missing or unreadable");
    return {
      ok: false,
      grade: "missing",
      reasons,
      bpp: null,
      width: width || null,
      height: height || null,
      bytes: bytes || 0,
    };
  }

  if (width !== HERO_WIDTH || height !== HERO_HEIGHT) {
    reasons.push("expected " + HERO_WIDTH + "×" + HERO_HEIGHT + ", got " + width + "×" + height);
  }
  if (bpp !== null && bpp < SOFT_BYTES_PER_PIXEL) {
    reasons.push(kb(bytes) + " KB for " + width + "×" + height + " is too light — likely an upscaled original");
  }

  const sibW = src.siblingWidth;
  const sibH = src.siblingHeight;
  const sibB = src.siblingBytes;
  if (!Number.isFinite(sibB) || sibB <= 0 || !Number.isFinite(sibW) || !Number.isFinite(sibH)) {
    reasons.push("1920w sibling is missing");
  } else if (sibW !== HERO_SRCSET_WIDTH || sibH !== HERO_SRCSET_HEIGHT) {
    reasons.push("1920w sibling is " + sibW + "×" + sibH + ", expected " + HERO_SRCSET_WIDTH + "×" + HERO_SRCSET_HEIGHT);
  }

  let grade = "ok";
  if (reasons.some((r) => r.includes("missing or unreadable"))) grade = "missing";
  else if (reasons.some((r) => r.startsWith("expected "))) grade = "wrong_size";
  else if (reasons.some((r) => r.includes("sibling"))) grade = "sibling";
  else if (reasons.some((r) => r.includes("upscaled"))) grade = "soft";

  return {
    ok: reasons.length === 0,
    grade,
    reasons,
    bpp,
    width,
    height,
    bytes,
  };
}

// The files the live pages must not use. Keyed on the FILE rather than the
// city since 2026-08-22: a city can carry both a curated photograph and a
// generated one, and a city key would take the good one down with the bad.
function skipFilesFromRows(rows) {
  const files = [];
  for (const r of rows || []) {
    if (r && r.ok === false && r.file) files.push(r.file);
  }
  return files;
}

module.exports = {
  SOFT_BYTES_PER_PIXEL,
  jpegDimensions,
  displayCity,
  gradeHero,
  skipFilesFromRows,
};
