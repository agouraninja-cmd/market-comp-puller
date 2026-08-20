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
  const route = server.slice(start, start + 2800);
  assert.match(route, /SVAIM\.aimAt\(\{ lat, lng \}, panoLL\)/);
  assert.match(route, /radius=" \+ SVAIM\.MAX_PANO_M/);
  assert.match(route, /heading=" \+ Number\(aim\.heading\)\.toFixed\(1\)/);
  assert.doesNotMatch(route, /params\.get\("address"\)/);
});
