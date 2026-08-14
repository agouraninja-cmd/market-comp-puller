"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { HEROES, HERO_WIDTH, HERO_HEIGHT, HERO_SRCSET_WIDTH, HERO_SRCSET_HEIGHT, srcsetName } = require("../market-hero");
const { jpegDimensions, displayCity, gradeHero, SOFT_BYTES_PER_PIXEL } = require("../market-hero-quality");

function fakeJpeg(w, h) {
  const buf = Buffer.alloc(20);
  let i = 0;
  buf[i++] = 0xff; buf[i++] = 0xd8;
  buf[i++] = 0xff; buf[i++] = 0xc0;
  buf[i++] = 0x00; buf[i++] = 0x0b;
  buf[i++] = 0x08;
  buf[i++] = (h >> 8) & 0xff; buf[i++] = h & 0xff;
  buf[i++] = (w >> 8) & 0xff; buf[i++] = w & 0xff;
  buf[i++] = 0x01;
  buf[i++] = 0x01; buf[i++] = 0x11; buf[i++] = 0x00;
  buf[i++] = 0xff; buf[i++] = 0xd9;
  return buf.subarray(0, i);
}

test("jpegDimensions reads SOF0 width and height", () => {
  const d = jpegDimensions(fakeJpeg(3840, 800));
  assert.deepEqual(d, { width: 3840, height: 800 });
  assert.equal(jpegDimensions(Buffer.from([0x00, 0x01])), null);
  assert.equal(jpegDimensions(null), null);
});

test("the Dallas JPEG on disk is the 3840×800 we serve", () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "market-heroes", "dallas-tx.jpg"));
  assert.deepEqual(jpegDimensions(buf), { width: HERO_WIDTH, height: HERO_HEIGHT });
});

test("displayCity title-cases the lookup key", () => {
  assert.equal(displayCity("dallas, tx"), "Dallas, TX");
  assert.equal(displayCity("las vegas, nv"), "Las Vegas, NV");
  assert.equal(displayCity("ontario, ca"), "Ontario, CA");
});

test("a full-size file with a 1920w sibling is ok", () => {
  const g = gradeHero({
    width: HERO_WIDTH, height: HERO_HEIGHT, bytes: 900 * 1024,
    siblingWidth: HERO_SRCSET_WIDTH, siblingHeight: HERO_SRCSET_HEIGHT, siblingBytes: 300 * 1024,
  });
  assert.equal(g.ok, true);
  assert.equal(g.grade, "ok");
  assert.equal(g.reasons.length, 0);
});

test("a tiny 3840×800 file is flagged as an upscaled original", () => {
  const pixels = HERO_WIDTH * HERO_HEIGHT;
  const bytes = Math.floor(pixels * (SOFT_BYTES_PER_PIXEL / 2));
  const g = gradeHero({
    width: HERO_WIDTH, height: HERO_HEIGHT, bytes,
    siblingWidth: HERO_SRCSET_WIDTH, siblingHeight: HERO_SRCSET_HEIGHT, siblingBytes: 20 * 1024,
  });
  assert.equal(g.ok, false);
  assert.equal(g.grade, "soft");
  assert.match(g.reasons.join(" "), /upscaled original/);
});

test("the wrong stored size is flagged even when the file is heavy", () => {
  const g = gradeHero({
    width: 1600, height: 720, bytes: 2 * 1024 * 1024,
    siblingWidth: HERO_SRCSET_WIDTH, siblingHeight: HERO_SRCSET_HEIGHT, siblingBytes: 400 * 1024,
  });
  assert.equal(g.ok, false);
  assert.equal(g.grade, "wrong_size");
  assert.match(g.reasons.join(" "), /1600×720/);
});

test("a missing JPEG is missing, not soft", () => {
  const g = gradeHero({});
  assert.equal(g.ok, false);
  assert.equal(g.grade, "missing");
});

test("a missing 1920w sibling is its own flag", () => {
  const g = gradeHero({
    width: HERO_WIDTH, height: HERO_HEIGHT, bytes: 900 * 1024,
  });
  assert.equal(g.ok, false);
  assert.equal(g.grade, "sibling");
});

test("Ontario is the city the softness rule exists to catch", () => {
  const dir = path.join(__dirname, "..", "market-heroes");
  const row = HEROES["ontario, ca"];
  const buf = fs.readFileSync(path.join(dir, row.file));
  const sib = fs.readFileSync(path.join(dir, srcsetName(row.file)));
  const dims = jpegDimensions(buf);
  const sibDims = jpegDimensions(sib);
  const g = gradeHero({
    width: dims.width, height: dims.height, bytes: buf.length,
    siblingWidth: sibDims.width, siblingHeight: sibDims.height, siblingBytes: sib.length,
  });
  assert.equal(g.ok, false, "Ontario's Commons original is smaller than 3840; a passing grade here means the threshold drifted");
  assert.equal(g.grade, "soft");
});
