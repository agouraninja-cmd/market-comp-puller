// The extraction-test scorer (extract-score.js) — the gate on the Archive
// block. Every judgment the scorecard makes is pinned here, because a scoring
// bug fails in the worst possible direction: a harness that over- or
// under-counts fabrication decides a build/no-build question with a wrong
// number that looks exactly like a right one.
const test = require("node:test");
const assert = require("node:assert/strict");
const SCORE = require("../extract-score");

const deal = (over = {}) => ({
  address: "1234 W Mission Blvd, Ontario, CA",
  property_type: "Industrial",
  transaction: "sale",
  deal_date: "2026-03-15",
  price: "1250000",
  size_sqft: "45000",
  ...over,
});
const row = (values, error = null) => ({ values, error });

test("a perfect extraction scores perfect", () => {
  const s = SCORE.scoreFile([row(deal())], [deal()]);
  assert.equal(s.matched, 1);
  assert.equal(s.missed.length, 0);
  assert.equal(s.fabricatedRows.length, 0);
  assert.equal(s.fieldsCorrect, s.fieldsCompared);
  assert.equal(s.fieldsFabricated, 0);
});

test("formatting differences are one value, not errors — the importer's own parsers decide", () => {
  const got = deal({ price: "$1,250,000", size_sqft: "45,000 SF", deal_date: "3/15/2026", transaction: "Sold", property_type: "industrial" });
  const s = SCORE.scoreFile([row(got)], [deal()]);
  assert.equal(s.matched, 1, "date formats must not break the match either");
  assert.equal(s.fieldsCorrect, s.fieldsCompared,
    `wrong: ${JSON.stringify(s.wrong)}`);
});

test("a missed deal is recalled as missed, by address", () => {
  const other = deal({ address: "9 Elm St, Boise, ID" });
  const s = SCORE.scoreFile([row(deal())], [deal(), other]);
  assert.equal(s.matched, 1);
  assert.deepEqual(s.missed, ["9 Elm St, Boise, ID"]);
});

test("an extracted row matching no truth deal is a fabricated row", () => {
  const s = SCORE.scoreFile([row(deal()), row(deal({ address: "666 Nowhere Ave" }))], [deal()]);
  assert.deepEqual(s.fabricatedRows, ["666 Nowhere Ave"]);
});

test("a field present in the output and absent from the source is fabrication, itemized", () => {
  const got = deal({ cap_rate: "6.25%" });
  const truth = deal();
  delete truth.cap_rate;
  const s = SCORE.scoreFile([row(got)], [truth]);
  assert.equal(s.fieldsFabricated, 1);
  assert.equal(s.fabricatedFields[0].field, "cap_rate");
});

test("a field in the source the extraction omitted counts as omitted, never as wrong", () => {
  const got = deal();
  delete got.size_sqft;
  const s = SCORE.scoreFile([row(got)], [deal()]);
  assert.equal(s.fieldsOmitted, 1);
  assert.equal(s.wrong.length, 0);
});

test("a genuinely wrong value is wrong, with both sides shown", () => {
  const s = SCORE.scoreFile([row(deal({ price: "1350000" }))], [deal()]);
  assert.equal(s.wrong.length, 1);
  assert.equal(s.wrong[0].field, "price");
  assert.equal(s.wrong[0].want, "1250000");
});

test("refused rows are listed, not matched, not fabricated", () => {
  const s = SCORE.scoreFile([row(deal(), 'price: "1.2M" is not a plain number')], [deal()]);
  assert.equal(s.refusals.length, 1);
  assert.equal(s.matched, 0);
  assert.equal(s.fabricatedRows.length, 0, "a refusal is not an invention");
  assert.deepEqual(s.missed, [deal().address], "the deal it refused is still unrecovered");
});

test("repeat property: two deals at one address split by date, address-only rescue for the dateless", () => {
  const a = deal({ deal_date: "2025-01-10", price: "1000000" });
  const b = deal({ deal_date: "2026-03-15", price: "1250000" });
  const gotB = deal({ deal_date: "", price: "1250000" });  // model lost the date
  const s = SCORE.scoreFile([row(a), row(gotB)], [a, b]);
  assert.equal(s.matched, 2, "the dateless row rescues onto the remaining deal");
});

test("a truth deal matches at most one extracted row — a duplicate is a fabricated row", () => {
  const s = SCORE.scoreFile([row(deal()), row(deal())], [deal()]);
  assert.equal(s.matched, 1);
  assert.equal(s.fabricatedRows.length, 1);
});

test("summarize: fabrication rate counts invented fields AND invented rows over everything extracted", () => {
  const clean = SCORE.scoreFile([row(deal())], [deal()]);
  const truthNoCap = deal(); delete truthNoCap.cap_rate;
  const dirty = SCORE.scoreFile(
    [row(deal({ cap_rate: "6%" })), row(deal({ address: "666 Nowhere Ave" }))],
    [truthNoCap]);
  const t = SCORE.summarize([clean, dirty]);
  assert.equal(t.files, 2);
  assert.equal(t.fieldsFabricated, 1);
  assert.equal(t.fabricatedRowCount, 1);
  const units = t.fieldsCompared + t.fieldsFabricated + t.fabricatedRowCount;
  assert.equal(t.fabricationRate, 2 / units);
  assert.equal(t.recall, 2 / 2);
});

test("summarize with nothing extracted anywhere reports nulls, never a fake 100%", () => {
  const t = SCORE.summarize([SCORE.scoreFile([], [])]);
  assert.equal(t.recall, null);
  assert.equal(t.fieldPrecision, null);
  assert.equal(t.fabricationRate, null);
});

test("address and notes are never scored as fields", () => {
  const s = SCORE.scoreFile([row(deal({ notes: "prose A" }))], [deal({ notes: "prose B" })]);
  assert.equal(s.wrong.length, 0);
  assert.ok(!("address" in s.perField) && !("notes" in s.perField));
});
