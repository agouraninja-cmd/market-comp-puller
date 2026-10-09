"use strict";

const test = require("node:test");
const assert = require("node:assert");
const SV = require("../streetview-aim");

// 1820 N 21st St, Boise — the house that made the roof-only popup. A camera
// on the street in front of it is ~18 m south of the centroid.
const HOUSE = { lat: 43.6184, lng: -116.2103 };
const STREET_SOUTH = { lat: HOUSE.lat - 18 / 111320, lng: HOUSE.lng };
const NEIGHBOR = { lat: HOUSE.lat + 80 / 111320, lng: HOUSE.lng };
const WEST = { lat: HOUSE.lat, lng: HOUSE.lng - 20 / (111320 * Math.cos(HOUSE.lat * Math.PI / 180)) };

test("a camera on the street in front of a house is usable and looks at it", () => {
  const aim = SV.aimAt(HOUSE, STREET_SOUTH);
  assert.ok(aim, "18 m is inside the 35 m gate");
  assert.ok(aim.dist > 17 && aim.dist < 19);
  // Camera is south of the house, so it must look north (~0°).
  assert.ok(aim.heading < 8 || aim.heading > 352, `heading ${aim.heading} should be ~0`);
});

test("a camera 80 m away is the neighbor, not this building", () => {
  assert.equal(SV.aimAt(HOUSE, NEIGHBOR), null);
});

test("exactly 35 m is the last accepted camera", () => {
  const atLimit = { lat: HOUSE.lat - SV.MAX_PANO_M / 111320, lng: HOUSE.lng };
  const justOver = { lat: HOUSE.lat - (SV.MAX_PANO_M + 1) / 111320, lng: HOUSE.lng };
  assert.ok(SV.aimAt(HOUSE, atLimit));
  assert.equal(SV.aimAt(HOUSE, justOver), null);
});

test("a camera west of the building looks east", () => {
  const aim = SV.aimAt(HOUSE, WEST);
  assert.ok(aim);
  assert.ok(aim.heading > 80 && aim.heading < 100, `heading ${aim.heading} should be ~90`);
});

test("aimAt refuses missing or non-finite coordinates", () => {
  assert.equal(SV.aimAt(null, STREET_SOUTH), null);
  assert.equal(SV.aimAt(HOUSE, null), null);
  assert.equal(SV.aimAt({ lat: HOUSE.lat, lng: NaN }, STREET_SOUTH), null);
  assert.equal(SV.aimAt(HOUSE, { lat: 91, lng: 0 }), null);
});

test("MAX_PANO_M is the Google radius we send, so the two cannot drift", () => {
  assert.equal(SV.MAX_PANO_M, 35);
});

test("the streetview route aims with this module, never a nearest-pano guess", () => {
  const fs = require("fs");
  const path = require("path");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf('req.url.split("?")[0] === "/api/streetview"');
  assert.ok(start !== -1, "server.js must define GET /api/streetview");
  const route = server.slice(start, start + 3200);
  assert.match(route, /SVAIM\.judgePano\(\{ lat, lng \}, mj, Date\.now\(\)\)/);
  assert.match(route, /radius=" \+ SVAIM\.MAX_PANO_M/);
  assert.match(route, /heading=" \+ Number\(aim\.heading\)\.toFixed\(1\)/);
  assert.match(route, /fov=" \+ Number\(aim\.fov/);
  assert.doesNotMatch(route, /params\.get\("address"\)/);
});

// ---- the quality gate (2026-10-09): "make sure they are actual good pictures"

const NOW = Date.UTC(2026, 9, 9);   // 2026-10-09
function meta(over) {
  return Object.assign({
    status: "OK",
    copyright: "© Google",
    date: "2023-06",
    pano_id: "pano-abc",
    location: { lat: STREET_SOUTH.lat, lng: STREET_SOUTH.lng },
  }, over || {});
}

test("judgePano passes Google's own recent close camera, aimed and framed", () => {
  const j = SV.judgePano(HOUSE, meta(), NOW);
  assert.ok(j);
  assert.ok(j.heading < 8 || j.heading > 352, `heading ${j.heading} should be ~0`);
  assert.equal(j.panoId, "pano-abc");
  assert.ok(j.fov >= SV.FOV_MIN && j.fov <= SV.FOV_MAX);
  assert.ok(j.dist > 17 && j.dist < 19);
});

test("judgePano refuses a user's photosphere: it is outdoor, and not Google's", () => {
  assert.equal(SV.judgePano(HOUSE, meta({ copyright: "© Jane Smith" }), NOW), null);
  assert.equal(SV.judgePano(HOUSE, meta({ copyright: "" }), NOW), null);
  assert.equal(SV.judgePano(HOUSE, meta({ copyright: undefined }), NOW), null);
  // "© 2024 Google" is still Google's.
  assert.ok(SV.judgePano(HOUSE, meta({ copyright: "© 2024 Google" }), NOW));
});

test("judgePano refuses imagery older than ten years, or with no date at all", () => {
  assert.ok(SV.judgePano(HOUSE, meta({ date: "2016-10" }), NOW), "exactly ten years is kept");
  assert.equal(SV.judgePano(HOUSE, meta({ date: "2016-09" }), NOW), null, "ten years and a month is not");
  assert.equal(SV.judgePano(HOUSE, meta({ date: "2009-05" }), NOW), null);
  assert.equal(SV.judgePano(HOUSE, meta({ date: "" }), NOW), null);
  assert.equal(SV.judgePano(HOUSE, meta({ date: undefined }), NOW), null);
  assert.ok(SV.judgePano(HOUSE, meta({ date: "2025" }), NOW), "a bare year is a date");
  assert.ok(SV.judgePano(HOUSE, meta({ date: "2027-01" }), NOW), "a clock behind Google's is not old");
  assert.equal(SV.MAX_PANO_AGE_YEARS, 10);
});

test("judgePano refuses no imagery, the neighbor, and a camera standing on the building", () => {
  assert.equal(SV.judgePano(HOUSE, { status: "ZERO_RESULTS" }, NOW), null);
  assert.equal(SV.judgePano(HOUSE, null, NOW), null);
  assert.equal(SV.judgePano(HOUSE, meta({ location: NEIGHBOR }), NOW), null);
  const onTop = { lat: HOUSE.lat - 2 / 111320, lng: HOUSE.lng };
  assert.equal(SV.judgePano(HOUSE, meta({ location: onTop }), NOW), null);
  assert.equal(SV.aimAt(HOUSE, onTop), null);
  const justOut = { lat: HOUSE.lat - (SV.MIN_PANO_M + 0.5) / 111320, lng: HOUSE.lng };
  assert.ok(SV.aimAt(HOUSE, justOut));
});

test("fovFor narrows the lens as the camera gets farther, inside 45-90 degrees", () => {
  assert.equal(SV.fovFor(8), 90, "close: as wide as it goes");
  assert.equal(SV.fovFor(15), 90);
  assert.equal(SV.fovFor(35), 46);
  assert.ok(SV.fovFor(20) > SV.fovFor(30));
  assert.equal(SV.fovFor(500), 45, "never narrower than 45");
  assert.equal(SV.fovFor(NaN), 90);
  assert.equal(SV.fovFor(0), 90);
});
