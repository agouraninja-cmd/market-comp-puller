// Construction type (2026-11-19): the comp search reports how each commercial
// building is built, and the valuation down-weights a comp built differently
// from the subject. Rules pinned here:
//   - the value is a CLOSED vocabulary; anything else normalizes to ""
//   - only Industrial / Office / Retail / Multifamily collect it
//   - a mismatch costs x0.6; a missing side on either end is neutral
//   - locked_basis carries it, so a free range weights exactly like Pro
const test = require("node:test");
const assert = require("node:assert");

const RPARSE = require("../report-parse");
const V = require("../valuation");
const { basisRow } = require("../comp-gate");

const AS_OF = Date.parse("2026-07-01");

test("construction normalizes onto the closed vocabulary", () => {
  assert.strictEqual(RPARSE.normalizeConstructionValue("Tilt-up"), "Tilt-up concrete");
  assert.strictEqual(RPARSE.normalizeConstructionValue("  pre-engineered metal building. "), "Metal building");
  assert.strictEqual(RPARSE.normalizeConstructionValue("Steel Frame"), "Steel frame");
  assert.strictEqual(RPARSE.normalizeConstructionValue("CMU"), "Masonry");
  // Strict: a phrase that is not on the list is unknown, never a guess.
  assert.strictEqual(RPARSE.normalizeConstructionValue("mostly steel with some brick"), "");
  assert.strictEqual(RPARSE.normalizeConstructionValue(null), "");
  for (const v of RPARSE.CONSTRUCTION_VALUES) {
    assert.strictEqual(RPARSE.normalizeConstructionValue(v), v, v + " maps to itself");
  }
});

test("the short key is unique and is not a long field name", () => {
  const S = RPARSE.SHORT_COMP_KEYS;
  assert.strictEqual(S.construction, "cn");
  const shorts = Object.values(S);
  assert.strictEqual(new Set(shorts).size, shorts.length);
  assert.ok(!Object.keys(S).includes("cn"));
});

test("only commercial building types collect construction", () => {
  for (const t of ["Industrial", "Office", "Retail", "Multifamily"]) {
    assert.ok(RPARSE.collectsConstruction(t), t);
  }
  for (const t of ["Land", "Residential"]) {
    assert.ok(!RPARSE.collectsConstruction(t), t);
  }
  const ind = RPARSE.expandCompKeys({ comps: [{ a: "1 Main St", cn: "tilt up" }] }, "Industrial", {});
  assert.strictEqual(ind.comps[0].construction, "tilt up", "expansion keeps the raw word for the normalizer");
  RPARSE.normalizeConstructions(ind);
  assert.strictEqual(ind.comps[0].construction, "Tilt-up concrete");
  const home = RPARSE.expandCompKeys({ comps: [{ a: "1 Main St" }] }, "Residential", {});
  assert.ok(!("construction" in home.comps[0]), "a house row gets no construction key");
});

test("subject construction is normalized or dropped", () => {
  assert.deepStrictEqual(RPARSE.normalizeSubjectConstruction({ subject_construction: "masonry" }),
    { subject_construction: "Masonry" });
  assert.deepStrictEqual(RPARSE.normalizeSubjectConstruction({ subject_construction: "unknown" }), {});
  assert.deepStrictEqual(RPARSE.normalizeSubjectConstruction({}), {});
});

test("a comp built differently counts at x0.6; unknown is neutral", () => {
  const comp = (construction) => ({ date: "Jul 2026", size_sqft: "50,000", price_per_sqft: "$100",
    source_type: "public_record", construction });
  const same = V.compWeight(comp("Tilt-up concrete"), AS_OF, 50000, null, { subjectConstruction: "Tilt-up concrete" });
  const diff = V.compWeight(comp("Metal building"), AS_OF, 50000, null, { subjectConstruction: "Tilt-up concrete" });
  const noSubject = V.compWeight(comp("Metal building"), AS_OF, 50000, null, {});
  const noComp = V.compWeight(comp(""), AS_OF, 50000, null, { subjectConstruction: "Tilt-up concrete" });
  assert.ok(Math.abs(diff / same - V.CONSTRUCTION_MISMATCH) < 1e-9);
  assert.strictEqual(V.CONSTRUCTION_MISMATCH, 0.6);
  assert.strictEqual(noSubject, same);
  assert.strictEqual(noComp, same);
  // Case does not matter: the browser compares what the server normalized.
  assert.strictEqual(
    V.compWeight(comp("tilt-up concrete"), AS_OF, 50000, null, { subjectConstruction: "Tilt-up concrete" }), same);
});

test("valueFromComps forwards the subject's construction into the weights", () => {
  const sale = (psf, construction) => ({ date: "Jun 2026", transaction: "Sale", size_sqft: "50,000",
    price_per_sqft: "$" + psf, source_type: "public_record", construction });
  const comps = [sale(100, "Tilt-up concrete"), sale(102, "Tilt-up concrete"), sale(98, "Tilt-up concrete"),
    sale(101, "Tilt-up concrete"), sale(60, "Metal building"), sale(62, "Metal building")];
  const base = { subjectSF: 50000, asOf: AS_OF, propertyType: "Industrial" };
  const blind = V.valueFromComps(comps, base);
  const aware = V.valueFromComps(comps, { ...base, subjectConstruction: "Tilt-up concrete" });
  assert.ok(aware.mid >= blind.mid, `matching construction should not pull the value toward the metal buildings (${aware.mid} vs ${blind.mid})`);
});

test("the corpus writes and reads construction (migration 064)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /construction: String\(c\.construction \|\| ""\)/, "harvest row keeps it");
  const reads = src.match(/`\$\{ALL_TYPE_COMP_FIELDS\.join\(","\)\}[^`]*`/g) || [];
  assert.ok(reads.length >= 2 && reads.every((s) => s.includes("construction")),
    "every corpus select that names the per-type columns names construction too");
  const { mapCorpusRow } = require("../blend-corpus");
  if (typeof mapCorpusRow === "function") {
    assert.strictEqual(mapCorpusRow({ address: "1 A St", construction: "Masonry" }).construction, "Masonry");
  }
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations", "064-comp-construction.sql"), "utf8");
  assert.match(migration, /add column if not exists construction text/);
});

test("locked_basis carries construction so free and Pro weigh alike", () => {
  const row = basisRow({ address: "9 Elm St", date: "Jun 2026", transaction: "Sale", size_sqft: "40,000",
    price_per_sqft: "$90", source_type: "news", construction: "Masonry" }, 0);
  assert.strictEqual(row.construction, "Masonry");
  assert.ok(!("address" in row));
});
