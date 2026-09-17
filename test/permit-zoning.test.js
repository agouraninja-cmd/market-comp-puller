// test/permit-zoning.test.js
// The parcel-zoning rules the permit sweep uses to decide "is this industrial
// land". Pure like city-check.js: the fetch is injected.
// Spec: docs/superpowers/specs/2026-09-16-permit-signals-design.md

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const Z = require("../permit-zoning");

const FIX = path.join(__dirname, "fixtures", "permit-portals");
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf8");

test("baseZone strips overlays, development agreements and PUD markers", () => {
  assert.equal(Z.baseZone("I-2/AI-O"), "I-2");
  assert.equal(Z.baseZone("I-1/DA"), "I-1");
  assert.equal(Z.baseZone("M2-DA"), "M2");
  assert.equal(Z.baseZone("C-2-DA-P"), "C-2");
  assert.equal(Z.baseZone("I-1-DA"), "I-1");
  assert.equal(Z.baseZone(" l-o "), "L-O");
  assert.equal(Z.baseZone(""), "");
  assert.equal(Z.baseZone(null), "");
});

test("isIndustrialZone: Ada County's industrial districts, and nothing else", () => {
  for (const z of ["I-1", "I-2", "I-3", "I-L", "M-1", "M2", "LI", "BP", "I-2/AI-O", "I-1-DA"]) {
    assert.equal(Z.isIndustrialZone(z), true, z);
  }
  for (const z of ["L-O", "C-2", "R-1C", "MX-5", "A", "", null, "IND"]) {
    assert.equal(Z.isIndustrialZone(z), false, String(z));
  }
});

test("industrialFor: zoning wins when known, the keyword flag carries the rest", () => {
  // The tracker's two measured cases: zoning caught a warehouse the keywords
  // missed, and cleared an office the word "shell" had flagged.
  assert.equal(Z.industrialFor(false, "I-1"), true);
  assert.equal(Z.industrialFor(true, "L-O"), false);
  assert.equal(Z.industrialFor(true, ""), true);
  assert.equal(Z.industrialFor(false, null), false);
});

test("cleanParcel refuses anything that is not a bare parcel id before it reaches a query", () => {
  assert.equal(Z.cleanParcel(" r2598270010 "), "R2598270010");
  assert.equal(Z.cleanParcel("R2598270010' or 1=1"), "");
  assert.equal(Z.cleanParcel("12345"), "");
  assert.equal(Z.cleanParcel(""), "");
});

test("parcelQueryUrl asks the Ada layer for exactly the three fields, no geometry", () => {
  const u = new URL(Z.parcelQueryUrl("R2598270010"));
  assert.equal(u.origin + u.pathname, Z.ADA_PARCELS_URL);
  assert.equal(u.searchParams.get("where"), "PARCEL='R2598270010'");
  assert.equal(u.searchParams.get("outFields"), "PARCEL,ZONING,ACRES");
  assert.equal(u.searchParams.get("returnGeometry"), "false");
  assert.equal(u.searchParams.get("f"), "json");
});

test("parseParcelAnswer reads the LIVE Ada County answer captured 2026-09-16 (Micron, I-3)", () => {
  const data = JSON.parse(readGz("ada.parcel.json.gz"));
  assert.deepEqual(Z.parseParcelAnswer(data), { zoning: "I-3", zoning_acres: 43.16 });
  assert.equal(Z.isIndustrialZone("I-3"), true);
});

test("parseParcelAnswer: no feature, blank zoning, garbage -> {}", () => {
  assert.deepEqual(Z.parseParcelAnswer({ features: [] }), {});
  assert.deepEqual(Z.parseParcelAnswer({ features: [{ attributes: { ZONING: "" } }] }), {});
  assert.deepEqual(Z.parseParcelAnswer(null), {});
  assert.deepEqual(Z.parseParcelAnswer("nope"), {});
});

test("fetchZoningByParcel never throws: outage, non-200, bad JSON and a bad parcel all answer {}", async () => {
  const boom = async () => { throw new Error("ENOTFOUND"); };
  assert.deepEqual(await Z.fetchZoningByParcel("R2598270010", { fetch: boom }), {});
  const five = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.deepEqual(await Z.fetchZoningByParcel("R2598270010", { fetch: five }), {});
  const junk = async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
  assert.deepEqual(await Z.fetchZoningByParcel("R2598270010", { fetch: junk }), {});
  let called = 0;
  const spy = async () => { called += 1; return { ok: true, json: async () => ({}) }; };
  assert.deepEqual(await Z.fetchZoningByParcel("not a parcel!", { fetch: spy }), {});
  assert.equal(called, 0, "a refused parcel id makes no request");
});

test("fetchZoningByParcel honours an injected parcelsUrl (the test-only origin redirect)", async () => {
  const calls = [];
  const f = async (url) => { calls.push(url); return { ok: true, json: async () => ({ features: [{ attributes: { ZONING: "I-1", ACRES: 2 } }] }) }; };
  const out = await Z.fetchZoningByParcel("R2598270010", { fetch: f, parcelsUrl: "http://127.0.0.1:1/gis/query" });
  assert.deepEqual(out, { zoning: "I-1", zoning_acres: 2 });
  assert.match(calls[0], /^http:\/\/127\.0\.0\.1:1\/gis\/query\?/);
});
