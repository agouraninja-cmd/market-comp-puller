// Blended comps — the broker's own comps inside their own report.
//
// Spec: docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md
//
// The privacy wall is the broker product, so these tests are written to prove
// it rather than to illustrate it. The ones that matter most are the negative
// ones: what must NOT come out.

const test = require("node:test");
const assert = require("node:assert");

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
