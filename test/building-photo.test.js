"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BP = require("../building-photo");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// building-photo.js: Home's and The Board's street photos, looked up by
// address through our own POST /api/building-photo (2026-10-09).

test("eligible: a street number naming a whole property, never a unit or a district", () => {
  assert.equal(BP.eligible("2300 Peachtree Rd NE, Atlanta, GA 30309"), true);
  assert.equal(BP.eligible("6728 W Fairview Ave Trailer 51, Boise, ID"), false);
  assert.equal(BP.eligible("1234 Main St Apt 3B, Denver, CO"), false);
  assert.equal(BP.eligible("Financial District (general submarket estimate)"), false);
  assert.equal(BP.eligible(""), false);
  assert.equal(BP.eligible(null), false);
  // The Florida trap index.html's tests pin: FL is a state, not floor 33101.
  assert.equal(BP.eligible("873 E Citation Ct, Miami, FL 33101"), true);
});

test("one spelling per address, the server's own (photo-token.js normalizeAddress)", () => {
  const T = require("../photo-token");
  for (const a of ["  2300 PEACHTREE Rd NE,  Atlanta, GA 30309, ", "1201 W Idaho St", "1210N17th st Boise Id"]) {
    assert.equal(BP.keyFor(a), T.normalizeAddress(a), a);
  }
});

test("only our own sealed photo URLs are ever laid into a page", () => {
  assert.equal(BP.isPhotoSrc("/api/streetview?t=1AbC_d-9"), true);
  assert.equal(BP.isPhotoSrc("/api/streetview?lat=1&lng=2"), false);
  assert.equal(BP.isPhotoSrc("https://example.com/x.jpg"), false);
  assert.equal(BP.isPhotoSrc("/api/streetview?t=1abc\" onerror=\"x"), false);
  assert.equal(BP.isPhotoSrc(null), false);
});

test("under Node the browser half is inert: nothing known, nothing asked", async () => {
  assert.equal(BP.photo("2300 Peachtree Rd NE"), undefined);
  assert.equal(BP.photo("6728 W Fairview Ave Trailer 51"), null, "an ineligible address is a known no");
  assert.equal(BP.known("2300 Peachtree Rd NE"), false);
  assert.equal(BP.overlay(null, "x", "/api/streetview?t=1a"), null);
  assert.equal(await BP.lookup([]), undefined);
});

// ---- ⚠ the copies agree with index.html's ---------------------------------------
// building-photo.js carries copies of index.html's houseNumberOf and
// unitDesignatorOf, because /vault cannot load index.html's script. Lifted out
// of index.html the way test/index-html.test.js lifts unitDesignatorOf, and
// run side by side.
function indexHelpers() {
  const from = html.indexOf("function houseNumberOf(address)");
  const to = html.indexOf("const typeGuessCache");
  assert.ok(from > 0 && to > from, "could not bound index.html's address-proving block");
  return new Function(html.slice(from, to) + "; return { houseNumberOf, unitDesignatorOf };")();
}

test("⚠ houseNumberOf / unitDesignatorOf match index.html's", () => {
  const ix = indexHelpers();
  for (const a of [
    "1820 N 21st St, Boise, ID 83702", "6728 W Fairview Ave Trailer 51, Boise, ID 83704", "1234 Main St Apt 3B, Denver, CO",
    "1234 Main St #45, Denver, CO", "500 Market St Ste 200, San Francisco, CA", "9 Pine Dr Unit A, Boise, ID",
    "700 5th Ave Bldg B, Seattle, WA", "One Wilshire Blvd, Los Angeles, CA", "6728 W Fairview Ave 51, Boise, ID",
    "100 Roomy Lane, Austin, TX", "44 Lotus Lane, Sacramento, CA", "1200 United Nations Plaza, New York, NY",
    "123 Ste Genevieve Ave, St Louis, MO", "873 E Citation Ct, Miami, FL 33101", "500 Main St Fl 3, Miami, FL 33101",
    "77 Bay St, Miami, FL 33101-4021", "", "  42 Oak Blvd SPC 12, Mesa, AZ",
  ]) {
    assert.equal(BP.houseNumberOf(a), ix.houseNumberOf(a), "houseNumberOf: " + a);
    assert.equal(BP.unitDesignatorOf(a), ix.unitDesignatorOf(a), "unitDesignatorOf: " + a);
  }
});

// ---- wiring ---------------------------------------------------------------------

test("served with maxAge 0 and loaded by both pages that draw building photos", () => {
  assert.match(server, /"\/building-photo\.js": \{ file: "building-photo\.js", type: "text\/javascript; charset=utf-8", maxAge: 0 \}/);
  assert.match(html, /<script src="\/building-photo\.js"><\/script>/);
  const vault = fs.readFileSync(path.join(ROOT, "vault-page.js"), "utf8");
  assert.match(vault, /<script src="\/building-photo\.js"><\/script>[\s\S]*<script src="\/deal-wall\.js"><\/script>/);
});

test("the address travels in a POST body to our own route, never in a URL and never to Overpass", () => {
  const src = fs.readFileSync(path.join(ROOT, "building-photo.js"), "utf8");
  assert.match(src, /fetch\("\/api\/building-photo", \{\s*method: "POST"/);
  assert.doesNotMatch(src, /overpass/i);
  assert.doesNotMatch(src, /\?address=|&address=|location=/);
  const deal = fs.readFileSync(path.join(ROOT, "deal-wall.js"), "utf8");
  assert.match(deal, /G\.BLDGPHOTO\.lookup\(/);
  assert.match(html, /BLDGPHOTO\.lookup\(/);
});
