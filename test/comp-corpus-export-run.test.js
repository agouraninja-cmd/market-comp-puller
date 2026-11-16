// The corpus export carries each saved deal's coordinates (2026-11-16).
//
// /api/comp-corpus is what HQ's "Comp corpus CSV" link downloads, and what
// scripts/accuracy-lab.js reads. Without lat/lng the lab could only pool a
// held-out sale's peers by whole market, where a live report pools a mile
// (houses) or ten (commercial) and weights by distance — so its worst misses
// were pairings no report makes. This proves the two columns arrive, LAST so
// no earlier column moves, and that the lab's own reader turns them back into
// a point the radius blend accepts.

const { test } = require("node:test");
const assert = require("node:assert");

const { boot } = require("./helpers/boot");
const LAB = require("../scripts/accuracy-lab");
const BLEND = require("../blend-corpus");

const ADMIN = "corpus-export-admin-key";

const saved = {
  ts: "2026-11-01T12:00:00.000Z",
  property_type: "Residential",
  market: "Boise, ID",
  address: "1404 N Orchard St, Boise, ID 83706",
  transaction: "Sale",
  deal_date: "Oct 2026",
  size_sqft: "1450",
  price_or_rate: "$560,000",
  source_type: "listing",
  verified: false,
  lat: "43.6187",
  lng: "-116.2389",
};

test("the corpus CSV ends with lat and lng, and the lab reads them back as a point", async (t) => {
  const srv = await boot({
    ADMIN_KEY: ADMIN,
    DATA_FILES: { "comp-corpus.jsonl": JSON.stringify(saved) + "\n" },
  });
  t.after(() => srv.stop());

  const refused = await fetch(srv.base + "/api/comp-corpus");
  assert.equal(refused.status, 401, "the export stays behind the admin key");

  const r = await fetch(srv.base + "/api/comp-corpus", { headers: { "x-admin-key": ADMIN } });
  assert.equal(r.status, 200);
  const text = await r.text();
  const header = text.split(/\r?\n/)[0].split(",");
  assert.equal(header[0], "ts");
  assert.deepEqual(header.slice(-3), ["verified", "lat", "lng"],
    "lat/lng are appended after every existing column, so none of them moves");

  const rows = LAB.parseCsv(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, "43.6187");
  // A negative longitude must not pick up the spreadsheet formula guard's
  // leading apostrophe, or the lab would read every Western Hemisphere deal
  // as having no point at all.
  assert.equal(rows[0].lng, "-116.2389");
  assert.deepEqual(BLEND.parseCoords(rows[0]), { lat: 43.6187, lng: -116.2389 });
});
