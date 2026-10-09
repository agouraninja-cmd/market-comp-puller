"use strict";

const test = require("node:test");
const assert = require("node:assert");
const E = require("../scripts/type-guess-eval");

const SEED = {
  "industrial-boise-id": { type: "Industrial", comps: [
    { address: "1 A St, Boise, ID" }, { address: "2 B St, Boise, ID" }, { address: "Downtown (submarket estimate)" },
  ] },
  "industrial-nampa-id": { type: "Industrial", comps: [{ address: "3 C St, Nampa, ID" }, { address: "1 a st, boise, id" }] },
  "office-boise-id": { type: "Office", comps: [{ address: "4 D St, Boise, ID" }] },
};

test("seedRows keeps street addresses only, once each", () => {
  const rows = E.seedRows(SEED);
  assert.deepEqual(rows.map((r) => r.address), ["1 A St, Boise, ID", "2 B St, Boise, ID", "3 C St, Nampa, ID", "4 D St, Boise, ID"]);
  assert.equal(E.isStreetAddress("7270-7292 Broadwyn Dr, Reynoldsburg, OH"), true);
  assert.equal(E.isStreetAddress("Financial District (general submarket estimate)"), false);
});

test("sampleSet takes each type round-robin across its markets", () => {
  const set = E.sampleSet(E.seedRows(SEED), 2);
  const industrial = set.filter((r) => r.label === "Industrial").map((r) => r.market);
  assert.deepEqual(industrial, ["industrial-boise-id", "industrial-nampa-id"]);
  assert.equal(set.filter((r) => r.label === "Office").length, 1);
  assert.equal(new Set(set.map((r) => r.id)).size, set.length);
});

test("blindBatches carries every id exactly once and never the label", () => {
  const set = E.sampleSet(E.seedRows(SEED), 5);
  const batches = E.blindBatches(set, 2, 7);
  const ids = batches.flat().map((r) => r.id).sort();
  assert.deepEqual(ids, set.map((r) => r.id).sort());
  for (const r of batches.flat()) assert.deepEqual(Object.keys(r).sort(), ["address", "id"]);
  assert.deepEqual(E.blindBatches(set, 2, 7), batches, "same seed, same batches");
});

test("guessPrompt names every type and says whether to search", () => {
  const batch = [{ id: "t001", address: "1 A St, Boise, ID" }];
  const web = E.guessPrompt(batch, { search: true });
  const bare = E.guessPrompt(batch, { search: false });
  for (const t of E.TYPES) assert.ok(web.includes("- " + t + ":"), t);
  assert.match(web, /Look each address up/);
  assert.match(bare, /Do NOT search/);
  assert.match(web, /t001: 1 A St, Boise, ID/);
});

test("parseGuesses survives a code fence and refuses junk", () => {
  assert.deepEqual(E.parseGuesses("```json\n[{\"id\":\"t1\",\"type\":\"Office\"}]\n```"), [{ id: "t1", type: "Office" }]);
  assert.deepEqual(E.parseGuesses("no array here"), []);
  assert.deepEqual(E.parseGuesses("[not json]"), []);
});

test("score counts a missing guess as wrong and splits accuracy by confidence", () => {
  const set = [
    { id: "a", label: "Industrial", address: "1 A St" },
    { id: "b", label: "Office", address: "2 B St" },
    { id: "c", label: "Retail", address: "3 C St" },
    { id: "d", label: "Retail", address: "4 D St" },
  ];
  const rep = E.score(set, [
    { id: "a", type: "industrial", confidence: "high" },
    { id: "b", type: "Retail", confidence: "high" },
    { id: "c", type: "Retail", confidence: "Medium" },
    { id: "zzz", type: "Office", confidence: "high" },
  ]);
  assert.equal(rep.right, 2);
  assert.equal(rep.accuracy, 50);
  assert.equal(rep.perType.Retail.right, 1);
  assert.equal(rep.matrix.Retail["(none)"], 1);
  assert.equal(rep.matrix.Office.Retail, 1);
  assert.deepEqual(rep.autoPick, { answered: 2, coverage: 50, wrong: 1, accuracy: 50 });
  assert.equal(rep.byConfidence.low.n, 1, "no guess at all is a low-confidence miss");
  assert.match(E.formatReport("x", rep), /Overall: 2\/4 right \(50%\)/);
});
