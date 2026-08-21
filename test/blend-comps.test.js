// Blended comps — the broker's own comps inside their own report.
//
// Spec: docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md
//
// The privacy wall is the broker product, so these tests are written to prove
// it rather than to illustrate it. The ones that matter most are the negative
// ones: what must NOT come out.

const test = require("node:test");
const assert = require("node:assert");

// The whole module, for the shared-vault cases at the foot of this file: they
// assert about FIELD_MAP itself, so naming each export would defeat the point.
const BLEND = require("../blend-comps.js");

const {
  blendPrivateComps,
  stripPrivateComps,
  toReportComp,
  isPrivateComp,
  PRIVATE_SOURCE_TYPE,
} = require("../blend-comps");

// A realistic broker_comps row, carrying the columns a report must never see.
function vaultRow(over = {}) {
  return {
    id: "row-1",
    user_id: "user-abc",
    upload_id: "upload-9",
    dedupe_key: "1450missionave|2026-03-14|4250000",
    address_key: "1450 mission ave",
    published: false,
    created_at: "2026-03-14T00:00:00Z",
    market: "Boise, ID",
    property_type: "Industrial",
    address: "1450 Mission Ave",
    deal_date: "2026-03-14",
    transaction: "sale",
    price: 4250000,
    size_sqft: 31000,
    price_per_sqft: 137,
    cap_rate: 6.25,
    clear_height: "28'",
    dock_doors: "6",
    notes: "Off-market, closed through our office.",
    ...over,
  };
}

function publicReport(over = {}) {
  return {
    summary: "Boise industrial has tightened.",
    comps: [
      { address: "1 Public Way", date: "2026-02-01", price_or_rate: 3000000, source_type: "public_record" },
      { address: "2 Public Way", date: "2026-01-15", price_or_rate: 3500000, source_type: "listing" },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("a vault row becomes a report comp with the report's own key names", () => {
  const c = toReportComp(vaultRow());
  assert.equal(c.address, "1450 Mission Ave");
  // The single easiest thing to get wrong: the report's price key is
  // price_or_rate, and a mismatch renders as a blank price, not as an error.
  assert.equal(c.price_or_rate, 4250000);
  assert.equal(c.price, undefined);
  assert.equal(c.date, "2026-03-14");
  assert.equal(c.deal_date, undefined);
  assert.equal(c.size_sqft, 31000);
  assert.equal(c.price_per_sqft, 137);
  assert.equal(c.cap_rate, 6.25);
  assert.equal(c.clear_height, "28'");
});

test("a vault row NEVER carries the columns a report has no business seeing", () => {
  const c = toReportComp(vaultRow());
  for (const leaked of ["user_id", "upload_id", "dedupe_key", "address_key", "published", "id", "created_at"]) {
    assert.equal(c[leaked], undefined, `${leaked} leaked into the report comp`);
  }
});

test("a vault comp claims no public provenance", () => {
  const c = toReportComp(vaultRow());
  // "Verified" is a public claim — a broker vouched in the public records and
  // earned credit. A private row has earned no such thing.
  assert.notEqual(c.source_type, "verified");
  assert.equal(c.verified, undefined);
  // Nor may it fall through to the default, which normalizes to "estimate" and
  // would stamp a real closed transaction as guesswork.
  assert.notEqual(c.source_type, "estimate");
  assert.equal(c.source_type, PRIVATE_SOURCE_TYPE);
  assert.equal(c.private, true);
});

test("empty and missing values are dropped, not carried as empty strings", () => {
  const c = toReportComp(vaultRow({ cap_rate: null, notes: "", dock_doors: undefined }));
  assert.equal("cap_rate" in c, false);
  assert.equal("notes" in c, false);
  assert.equal("dock_doors" in c, false);
});

test("a row with no address is refused rather than rendered blank", () => {
  assert.equal(toReportComp(vaultRow({ address: "" })), null);
  assert.equal(toReportComp(null), null);
  assert.equal(toReportComp("nonsense"), null);
});

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

test("private comps join the public ones in the same array", () => {
  const out = blendPrivateComps(publicReport(), [vaultRow()]);
  assert.equal(out.comps.length, 3);
  assert.equal(out.private_count, 1);
  assert.equal(out.comps.filter(isPrivateComp).length, 1);
});

test("a private comp does not outrank a public one", () => {
  const out = blendPrivateComps(publicReport(), [vaultRow()]);
  // Appended, not prepended: the flag is styling, not ranking.
  assert.equal(isPrivateComp(out.comps[0]), false);
  assert.equal(isPrivateComp(out.comps[out.comps.length - 1]), true);
});

test("a duplicate address keeps BOTH rows", () => {
  // Dropping either one is wrong: the broker watching their own deal vanish
  // reads as data loss, and dropping the public row moves the valuation with
  // no explanation.
  const out = blendPrivateComps(publicReport(), [vaultRow({ address: "1 Public Way" })]);
  const atAddress = out.comps.filter((c) => c.address === "1 Public Way");
  assert.equal(atAddress.length, 2);
  assert.equal(atAddress.filter(isPrivateComp).length, 1);
});

test("AN EMPTY VAULT LEAVES THE REPORT BYTE-IDENTICAL", () => {
  // The load-bearing one. The feature must be invisible to every non-broker
  // and to every broker who has not uploaded anything.
  const rep = publicReport();
  const before = JSON.stringify(rep);
  for (const empty of [[], null, undefined, "junk"]) {
    const out = blendPrivateComps(rep, empty);
    assert.equal(out, rep, "an empty vault must return the very same object");
    assert.equal(JSON.stringify(out), before);
    assert.equal("private_count" in out, false, "private_count must not appear at all");
  }
});

test("rows that cannot become comps do not inflate private_count", () => {
  const out = blendPrivateComps(publicReport(), [vaultRow(), { address: "" }, null]);
  assert.equal(out.private_count, 1);
  assert.equal(out.comps.length, 3);
});

test("blending does not mutate the report it was given", () => {
  // The report may be the CACHED object. Mutating it would persist one
  // broker's private comps into every later reader of that cache entry.
  const rep = publicReport();
  const out = blendPrivateComps(rep, [vaultRow()]);
  assert.equal(rep.comps.length, 2, "the source report was mutated");
  assert.equal("private_count" in rep, false);
  assert.notEqual(out, rep);
  assert.notEqual(out.comps, rep.comps);
});

// ---------------------------------------------------------------------------
// Stripping — the /api/share path
// ---------------------------------------------------------------------------

test("sharing strips every private comp", () => {
  const blended = blendPrivateComps(publicReport(), [vaultRow(), vaultRow({ address: "9 Other St" })]);
  const shared = stripPrivateComps(blended);
  assert.equal(shared.comps.length, 2);
  assert.equal(shared.comps.some(isPrivateComp), false);
  assert.equal("private_count" in shared, false);
});

test("sharing leaks no trace of a private comp anywhere in the payload", () => {
  const blended = blendPrivateComps(publicReport(), [vaultRow()]);
  const shared = JSON.stringify(stripPrivateComps(blended));
  for (const secret of ["1450 Mission Ave", "Off-market", "4250000", PRIVATE_SOURCE_TYPE, "user-abc"]) {
    assert.equal(shared.includes(secret), false, `"${secret}" survived into a shared report`);
  }
});

test("a hand-crafted payload cannot smuggle a private comp past the share route", () => {
  // The browser sends the report to /api/share. The server must strip rather
  // than trust what it is handed.
  const hostile = {
    comps: [
      { address: "1 Public Way", source_type: "public_record" },
      { address: "Secret Deal", private: true },
      { address: "Sneakier", private: true, source_type: "public_record" },
    ],
  };
  const shared = stripPrivateComps(hostile);
  assert.equal(shared.comps.length, 1);
  assert.equal(JSON.stringify(shared).includes("Secret"), false);
  assert.equal(JSON.stringify(shared).includes("Sneakier"), false);
});

test("stripping a report that has no private comps changes nothing", () => {
  const rep = publicReport();
  assert.equal(stripPrivateComps(rep), rep);
});

test("stripping survives junk instead of throwing", () => {
  assert.equal(stripPrivateComps(null), null);
  assert.equal(stripPrivateComps("nonsense"), "nonsense");
  assert.deepEqual(stripPrivateComps({ comps: "not an array", private_count: 3 }), { comps: "not an array" });
});

// ---------------------------------------------------------------------------
// The wall, stated as one test
// ---------------------------------------------------------------------------

test("a second broker's report carries no trace of the first broker's vault", () => {
  const ownersReport = blendPrivateComps(publicReport(), [vaultRow()]);
  assert.equal(ownersReport.private_count, 1);

  // The other broker's request blends THEIR vault, which is empty. The public
  // report object is the shared, cached one — and it must be untouched.
  const strangersReport = blendPrivateComps(publicReport(), []);
  const seen = JSON.stringify(strangersReport);
  for (const secret of ["1450 Mission Ave", "Off-market", "user-abc"]) {
    assert.equal(seen.includes(secret), false, `"${secret}" reached another broker`);
  }
  assert.equal("private_count" in strangersReport, false);
});

// ---------------------------------------------------------------------------
// Anonymizing — the /api/invite-share path (Task 5)
// ---------------------------------------------------------------------------

const { anonymizePrivateComps } = require("../blend-comps.js");

function blended() {
  return {
    comps: [
      { address: "1 Public St", date: "2026-01-05", transaction: "sale",
        price_or_rate: 1000000, size_sqft: 10000, price_per_sqft: 100, source_type: "listing" },
      { address: "2 Private Rd", date: "2026-03-14", transaction: "sale",
        price_or_rate: 4250000, size_sqft: 31000, price_per_sqft: 137,
        source_type: "broker_vault", notes: "off market, my seller", private: true },
    ],
    locked_count: 0,
    locked_basis: [],
    private_count: 1,
  };
}

test("anonymize removes the private comp from the table", () => {
  const out = anonymizePrivateComps(blended());
  assert.equal(out.comps.length, 1);
  assert.equal(out.comps[0].address, "1 Public St");
});

test("anonymize keeps the private comp in the valuation basis", () => {
  const out = anonymizePrivateComps(blended());
  assert.equal(out.locked_basis.length, 1);
  assert.equal(out.locked_basis[0].price_per_sqft, "137");
  assert.equal(out.locked_basis[0].size_sqft, 31000);
});

test("no address, price, or note survives into the basis", () => {
  const json = JSON.stringify(anonymizePrivateComps(blended()));
  assert.equal(json.includes("2 Private Rd"), false);
  assert.equal(json.includes("4250000"), false);
  assert.equal(json.includes("my seller"), false);
});

test("private_count survives so the page can say how many are folded in", () => {
  assert.equal(anonymizePrivateComps(blended()).private_count, 1);
});

test("an existing locked_basis is appended to, never replaced", () => {
  const r = blended();
  r.locked_basis = [{ date: "2025-12-01", transaction: "sale", size_sqft: 5000, source_type: "public_record" }];
  const out = anonymizePrivateComps(r);
  assert.equal(out.locked_basis.length, 2);
});

test("a report with no private comps comes back untouched, same object", () => {
  const plain = { comps: [{ address: "1 Public St" }] };
  assert.equal(anonymizePrivateComps(plain), plain);
});

test("junk in, junk out, without throwing", () => {
  assert.equal(anonymizePrivateComps(null), null);
  assert.deepEqual(anonymizePrivateComps({ comps: "nope" }), { comps: "nope" });
});

// --- propertyCoordsById: the report-path coordinate join ---------------------
//
// The rule is BOTH OR NEITHER, and the trap is `Number(null) === 0`: a
// property row with no location on file must contribute no coordinates, not
// Null Island. The export path has the same rule in exportRowsWithCoords
// (broker-vault.js); these tests are the report path's half of that pair.

const { propertyCoordsById } = require("../blend-comps");

test("an unlocated building (lat/lng null) contributes no coordinates", () => {
  const byId = propertyCoordsById([{ id: "p1", lat: null, lng: null, geo_source: null }]);
  assert.equal(byId.size, 0);
});

test("a half-located building is treated as unlocated", () => {
  const byId = propertyCoordsById([
    { id: "p1", lat: 43.6, lng: null },
    { id: "p2", lat: null, lng: -116.2 },
  ]);
  assert.equal(byId.size, 0);
});

test("a located building's coordinates come through as numbers", () => {
  const byId = propertyCoordsById([{ id: "p1", lat: "43.6135", lng: "-116.2035", geo_source: "broker" }]);
  assert.deepEqual(byId.get("p1"), { lat: 43.6135, lng: -116.2035, geo_source: "broker" });
});

test("non-numeric coordinate strings are refused, not guessed", () => {
  const byId = propertyCoordsById([{ id: "p1", lat: "43°36'N", lng: "-116.2" }]);
  assert.equal(byId.size, 0);
});

test("junk rows and junk input do not throw", () => {
  assert.equal(propertyCoordsById(null).size, 0);
  assert.equal(propertyCoordsById([null, {}, { id: null, lat: 1, lng: 2 }]).size, 0);
});

// ---------------------------------------------------------------------------
// The SHARED vault (migration 030) — a colleague's comp, in your report.
//
// Spec §7. The wall here is the same one the rest of this file guards, one
// step further out: a firm comp must carry nothing that identifies the row it
// was copied from, must stay `private` so every downstream strip keeps
// working, and must not be counted twice when two colleagues held the same
// deal.
// ---------------------------------------------------------------------------

test("firmCompPayload carries what a report renders and NONE of the vault's plumbing", () => {
  const row = {
    // plumbing — every one of these is a way to identify or re-key a private row
    user_id: "u1", upload_id: "up1", dedupe_key: "k", address_key: "a",
    property_id: "p1", published: true, published_at: "2026-01-01",
    published_submission_id: "s1", id: "c1", created_at: "2026-01-01",
    // the comp
    address: "100 Main St", deal_date: "2026-05-01", transaction: "sale",
    price: 1000000, size_sqft: 10000, price_per_sqft: 100, cap_rate: 6.25,
    notes: "off market", clear_height: "28", lat: 43.6, lng: -116.2,
  };
  const out = BLEND.firmCompPayload(row);
  for (const leak of ["user_id", "upload_id", "dedupe_key", "address_key",
    "property_id", "published", "published_at", "published_submission_id", "id", "created_at"]) {
    assert.equal(leak in out, false, `${leak} must not travel to another account's table`);
  }
  assert.equal(out.address, "100 Main St");
  assert.equal(out.price, 1000000);
  assert.equal(out.clear_height, "28");
  assert.equal(out.lat, 43.6, "coordinates travel, so a colleague's map needs no geocode");
});

test("firmCompPayload is derived from FIELD_MAP, so a new comp field cannot be forgotten", () => {
  // The reason 030 stores jsonb rather than a column per field: a per-type
  // field arrives through the add-comp-field skill, and this must not become
  // a fifth map to update — still less a migration.
  const row = { address: "1 A St", deal_date: "2026-01-01" };
  for (const col of Object.keys(BLEND.FIELD_MAP)) if (!(col in row)) row[col] = "x";
  const out = BLEND.firmCompPayload(row);
  for (const col of Object.keys(BLEND.FIELD_MAP)) {
    assert.equal(col in out, true, `${col} is in FIELD_MAP so it must be stored`);
  }
});

test("a comp with no address or no date is refused rather than stored unusable", () => {
  assert.equal(BLEND.firmCompPayload({ deal_date: "2026-01-01" }), null);
  assert.equal(BLEND.firmCompPayload({ address: "1 A St" }), null);
  assert.equal(BLEND.firmCompPayload(null), null);
});

test("a firm comp keeps broker_vault and private:true, and adds attribution", () => {
  // Keeping the tier is what makes every downstream rule work by construction
  // rather than by review: /api/share strips or anonymizes it, exports drop
  // it, print and PNG drop it, and the valuation still weights it at 1.
  const stored = {
    comp: { address: "100 Main St", deal_date: "2026-05-01", price: 1000000 },
    firm: "Colliers Boise", shared_by_name: "Brad",
  };
  const c = BLEND.toFirmReportComp(stored);
  assert.equal(c.source_type, "broker_vault");
  assert.equal(c.private, true);
  assert.equal(c.firm, "Colliers Boise");
  assert.equal(c.shared_by, "Brad");
  assert.equal(c.verified, undefined, "never the public Verified claim");
});

test("a firm comp is stripped from a public share and anonymized on an invited one", () => {
  // The property that matters most, and it holds for free because the flag is
  // what both functions filter on.
  const c = BLEND.toFirmReportComp({
    comp: { address: "100 Main St", deal_date: "2026-05-01", price: 1000000, size_sqft: 10000 },
    firm: "Colliers Boise", shared_by_name: "Brad",
  });
  const report = { comps: [{ address: "public", source_type: "listing" }, c] };
  assert.equal(BLEND.stripPrivateComps(report).comps.length, 1);
  const anon = BLEND.anonymizePrivateComps(report);
  assert.equal(anon.comps.length, 1);
  assert.equal(anon.locked_basis.length, 1);
  assert.equal(anon.locked_basis[0].address, undefined, "no address travels");
  assert.equal(anon.locked_basis[0].firm, undefined, "and not the firm's name either");
});

test("one deal is one row: a colleague's copy of a comp you already hold is dropped", () => {
  // Two brokers at one firm were routinely on opposite sides of the same
  // transaction, so a naive blend counts it twice and moves the median with
  // nothing on screen explaining why.
  const mine = [{ address: "100 Main St", date: "2026-05-01", price_or_rate: 1000000, private: true }];
  const theirs = [
    { address: "100 MAIN ST.", date: "2026-05-01", price_or_rate: 1000000, private: true, firm: "F" },
    { address: "900 Other Way", date: "2026-05-01", price_or_rate: 500000, private: true, firm: "F" },
  ];
  const out = BLEND.dedupeFirmComps(mine, theirs);
  assert.equal(out.length, 1);
  assert.equal(out[0].address, "900 Other Way", "yours wins, so your own deal keeps its own badge");
});

test("two colleagues sharing the same deal contribute it once", () => {
  const dupe = { address: "100 Main St", date: "2026-05-01", price_or_rate: 1000000, private: true };
  assert.equal(BLEND.dedupeFirmComps([], [dupe, { ...dupe, firm: "F" }]).length, 1);
});

test("dedupe never merges two different deals at one address", () => {
  const a = { address: "100 Main St", date: "2026-05-01", price_or_rate: 1000000 };
  const b = { address: "100 Main St", date: "2024-05-01", price_or_rate: 800000 };
  assert.equal(BLEND.dedupeFirmComps([], [a, b]).length, 2, "a re-sale is a second comp");
  const c = { address: "100 Main St", date: "2026-05-01", price_or_rate: 1200000 };
  assert.equal(BLEND.dedupeFirmComps([], [a, c]).length, 2, "and so is a different price");
});

test("dedupe survives junk without throwing", () => {
  assert.deepEqual(BLEND.dedupeFirmComps(null, null), []);
  assert.deepEqual(BLEND.dedupeFirmComps(undefined, [null]), [null]);
});
