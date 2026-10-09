"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BP = require("../building-photo");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// A point on the street in front of 1820 N 21st St, Boise, and footprints
// around it in Overpass's `out tags bb` shape.
const PT = { lat: 43.6184, lng: -116.2103 };
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos(PT.lat * Math.PI / 180));
function way(dxM, dyM, wM, hM, tags) {
  const lat = PT.lat + dyM * M_LAT, lng = PT.lng + dxM * M_LNG;
  return {
    type: "way",
    tags: Object.assign({ building: "yes" }, tags || {}),
    bounds: { minlat: lat - (hM / 2) * M_LAT, maxlat: lat + (hM / 2) * M_LAT,
      minlon: lng - (wM / 2) * M_LNG, maxlon: lng + (wM / 2) * M_LNG },
  };
}
const ADDR = "1820 N 21st St, Boise, ID 83702";
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("pick takes the footprint that carries the house number and street", () => {
  const house = way(0, 18, 14, 12, { "addr:housenumber": "1820", "addr:street": "North 21st Street" });
  const across = way(0, -18, 30, 20, { "addr:housenumber": "1821", "addr:street": "North 21st Street" });
  const b = BP.pick(PT, ADDR, [across, house]);
  assert.ok(b);
  assert.ok(near(b.lat, PT.lat + 18 * M_LAT), "the house's middle, not the bigger building opposite");
});

test("pick refuses when no footprint proves the address: an aerial beats the neighbor", () => {
  // The report map would take the main mass here; Home and The Board have no
  // geocoder label to lean on, so they do not.
  const untagged = way(0, 18, 14, 12);
  const otherNumber = way(10, 18, 14, 12, { "addr:housenumber": "1824" });
  assert.equal(BP.pick(PT, ADDR, [untagged, otherNumber]), null);
  assert.equal(BP.pick(PT, ADDR, []), null);
  assert.equal(BP.pick(PT, ADDR, undefined), null);
});

test("pick refuses the same number on a cross street, and anything past 120 m", () => {
  const crossStreet = way(0, 30, 14, 12, { "addr:housenumber": "1820", "addr:street": "West Hays Street" });
  assert.equal(BP.pick(PT, ADDR, [crossStreet]), null);
  const far = way(0, 150, 14, 12, { "addr:housenumber": "1820", "addr:street": "North 21st Street" });
  assert.equal(BP.pick(PT, ADDR, [far]), null);
});

test("among footprints that all prove the address, the main mass wins", () => {
  const shed = way(-8, 20, 4, 4, { "addr:housenumber": "1820" });
  const main = way(4, 22, 20, 16, { "addr:housenumber": "1820" });
  const b = BP.pick(PT, ADDR, [shed, main]);
  assert.ok(near(b.lng, PT.lng + 4 * M_LNG));
});

test("eligible: a street number naming a whole property, never a unit or a district", () => {
  assert.equal(BP.eligible(ADDR), true);
  assert.equal(BP.eligible("6728 W Fairview Ave Trailer 51, Boise, ID"), false);
  assert.equal(BP.eligible("1234 Main St Apt 3B, Denver, CO"), false);
  assert.equal(BP.eligible("Financial District (general submarket estimate)"), false);
  assert.equal(BP.eligible(""), false);
  assert.equal(BP.eligible(null), false);
  // The Florida trap index.html's tests pin: FL is a state, not floor 33101.
  assert.equal(BP.eligible("873 E Citation Ct, Miami, FL 33101"), true);
  // And pick() says the same without being asked separately.
  const unitHouse = way(0, 18, 14, 12, { "addr:housenumber": "6728" });
  assert.equal(BP.pick(PT, "6728 W Fairview Ave Trailer 51, Boise, ID", [unitHouse]), null);
});

test("the photo URL carries the building's coordinates, never an address", () => {
  const src = BP.photoSrc({ lat: 43.61856, lng: -116.21031 });
  assert.equal(src, "/api/streetview?lat=43.618560&lng=-116.210310");
  assert.doesNotMatch(src, /address|21st/i);
});

test("one Overpass query asks about every point, by coordinates only", () => {
  const q = BP.queryFor([PT, { lat: 43.6, lng: -116.2 }]);
  assert.match(q, /^\[out:json\]/);
  assert.equal((q.match(/way\(around:90,/g) || []).length, 2);
  assert.match(q, /out tags bb;$/);
  assert.doesNotMatch(q, /21st|Boise/);
});

test("under Node the browser half is inert: nothing known, nothing remembered", async () => {
  assert.equal(BP.building(PT, ADDR), undefined);
  assert.equal(BP.building(PT, "6728 W Fairview Ave Trailer 51"), null, "an ineligible address is a known no");
  assert.equal(BP.building({ lat: null, lng: null }, ADDR), null);
  assert.equal(BP.photoState({ lat: 1, lng: 1 }), undefined);
  assert.equal(BP.overlay(null, { lat: 1, lng: 1 }), null);
  assert.equal(await BP.snap([]), 0);
});

// ---- ⚠ the copies agree with index.html's ---------------------------------------
// building-photo.js carries copies of index.html's address-proving helpers,
// because /vault cannot load index.html's script. Lifted out of index.html the
// way test/index-html.test.js lifts unitDesignatorOf, and run side by side.
function indexHelpers() {
  const from = html.indexOf("function houseNumberOf(address)");
  const to = html.indexOf("const typeGuessCache");
  assert.ok(from > 0 && to > from, "could not bound index.html's address-proving block");
  return new Function(html.slice(from, to) +
    "; return { houseNumberOf, osmNumberMatches, streetLooksSame, unitDesignatorOf };")();
}

test("⚠ houseNumberOf / osmNumberMatches / streetLooksSame / unitDesignatorOf match index.html's", () => {
  const ix = indexHelpers();
  const addresses = [
    ADDR, "6728 W Fairview Ave Trailer 51, Boise, ID 83704", "1234 Main St Apt 3B, Denver, CO",
    "1234 Main St #45, Denver, CO", "500 Market St Ste 200, San Francisco, CA", "9 Pine Dr Unit A, Boise, ID",
    "700 5th Ave Bldg B, Seattle, WA", "One Wilshire Blvd, Los Angeles, CA", "6728 W Fairview Ave 51, Boise, ID",
    "100 Roomy Lane, Austin, TX", "44 Lotus Lane, Sacramento, CA", "1200 United Nations Plaza, New York, NY",
    "123 Ste Genevieve Ave, St Louis, MO", "873 E Citation Ct, Miami, FL 33101", "500 Main St Fl 3, Miami, FL 33101",
    "77 Bay St, Miami, FL 33101-4021", "", "  42 Oak Blvd SPC 12, Mesa, AZ",
  ];
  for (const a of addresses) {
    assert.equal(BP.houseNumberOf(a), ix.houseNumberOf(a), "houseNumberOf: " + a);
    assert.equal(BP.unitDesignatorOf(a), ix.unitDesignatorOf(a), "unitDesignatorOf: " + a);
  }
  const numbers = [["1500", "1500"], ["1500-1510", "1505"], ["1500A", "1500"], ["1500;1502", "1502"],
    ["1501", "1500"], ["", "1500"], ["1510–1500", "1504"], ["12", null]];
  for (const [tag, want] of numbers) {
    assert.equal(BP.osmNumberMatches(tag, want), ix.osmNumberMatches(tag, want), `osmNumberMatches(${tag}, ${want})`);
  }
  const streets = [["West Bethany Home Road", "1500 W Bethany Home Rd"], ["North 21st Street", ADDR],
    ["West Hays Street", ADDR], ["", ADDR], ["Street", ADDR], [undefined, ADDR]];
  for (const [osm, a] of streets) {
    assert.equal(BP.streetLooksSame(osm, a), ix.streetLooksSame(osm, a), `streetLooksSame(${osm}, ${a})`);
  }
});

// ---- served and loaded ----------------------------------------------------------

test("served with maxAge 0 and loaded by the page that draws building photos", () => {
  assert.match(server, /"\/building-photo\.js": \{ file: "building-photo\.js", type: "text\/javascript; charset=utf-8", maxAge: 0 \}/);
  assert.match(html, /<script src="\/building-photo\.js"><\/script>/);
  // /vault loaded it for The Board's deal cards until the deal wall left
  // (2026-10-09); nothing there draws a building photo now.
  const vault = fs.readFileSync(path.join(ROOT, "vault-page.js"), "utf8");
  assert.doesNotMatch(vault, /building-photo\.js|__CN_STREETVIEW__/);
});
