"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const PT = require("../property-type");
const VAULT = require("../broker-vault");

test("the type list is the app's own list", () => {
  assert.deepEqual(PT.TYPES, VAULT.PROPERTY_TYPES);
});

test("both prompts name every type, ask for a JSON array and carry the address", () => {
  const batch = [{ id: "a1", address: "4080 N Pecos Rd, Las Vegas, NV 89115" }];
  for (const p of [PT.quickPrompt(batch), PT.deepPrompt(batch)]) {
    for (const t of PT.TYPES) assert.ok(p.includes("- " + t + ":"), t);
    assert.match(p, /Reply with ONLY a JSON array/);
    assert.match(p, /a1: 4080 N Pecos Rd, Las Vegas, NV 89115/);
  }
  assert.match(PT.quickPrompt(batch), /at most 3 searches per address/);
  assert.match(PT.deepPrompt(batch), /up to 6 searches per address/);
  assert.match(PT.deepPrompt(batch), /parcel or appraisal-district record/);
  assert.equal(PT.QUICK_SEARCHES, 3);
  assert.equal(PT.DEEP_SEARCHES, 6);
});

test("the eval script measures these exact prompts, not a copy", () => {
  const E = require("../scripts/type-guess-eval");
  const batch = [{ id: "t1", address: "1 A St, Boise, ID" }];
  assert.equal(E.guessPrompt(batch, { search: true, version: 2 }), PT.quickPrompt(batch));
  assert.equal(E.guessPrompt(batch, { search: true, version: 3 }), PT.deepPrompt(batch));
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "type-guess-eval.js"), "utf8");
  assert.ok(!src.includes("What counts as evidence:"), "the quick prompt's text must live only in property-type.js");
});

test("answerFrom reads one address's answer and normalizes it", () => {
  const text = "Here you go:\n```json\n[{\"id\":\"a1\",\"type\":\"office\",\"confidence\":\"HIGH\",\"evidence\":\"  A 12-story   office tower.  \"}]\n```";
  assert.deepEqual(PT.answerFrom(text, "a1"), { type: "Office", confidence: "high", evidence: "A 12-story office tower." });
  assert.equal(PT.answerFrom(text, "zz"), null, "another id is not this address's answer");
});

test("answerFrom refuses a type outside the six instead of guessing one", () => {
  assert.equal(PT.answerFrom("[{\"id\":\"a1\",\"type\":\"Mixed use\",\"confidence\":\"high\"}]", "a1"), null);
  assert.equal(PT.answerFrom("{\"id\":\"a1\",\"type\":\"Office\"}", "a1"), null, "an object, not the array asked for");
  assert.equal(PT.answerFrom("not json", "a1"), null);
  assert.equal(PT.answerFrom("[{\"id\":\"a1\",\"type\":\"Retail\"}]", "a1").confidence, "low", "no confidence reads as a guess");
});

test("the evidence sentence is capped, since the member reads it", () => {
  const long = "x".repeat(1000);
  const a = PT.answerFrom(JSON.stringify([{ id: "a1", type: "Land", confidence: "medium", evidence: long }]), "a1");
  assert.equal(a.evidence.length, 240);
});

test("only a high quick answer skips the deep pass", () => {
  assert.equal(PT.needsDeep({ type: "Office", confidence: "high" }), false);
  assert.equal(PT.needsDeep({ type: "Office", confidence: "medium" }), true);
  assert.equal(PT.needsDeep({ type: "Office", confidence: "low" }), true);
  assert.equal(PT.needsDeep(null), true);
});

test("the deep answer wins when there is one; otherwise the quick one stands", () => {
  const quick = { type: "Industrial", confidence: "low", evidence: "street" };
  const deep = { type: "Retail", confidence: "high", evidence: "LoopNet strip center" };
  assert.deepEqual(PT.finalAnswer(quick, deep), { ...deep, pass: "deep" });
  assert.deepEqual(PT.finalAnswer(quick, null), { ...quick, pass: "quick" });
  assert.equal(PT.finalAnswer(null, null), null);
});

test("a guess from the street is never remembered", () => {
  assert.equal(PT.shouldRemember({ type: "Office", confidence: "high" }), true);
  assert.equal(PT.shouldRemember({ type: "Office", confidence: "medium" }), true);
  assert.equal(PT.shouldRemember({ type: "Office", confidence: "low" }), false);
  assert.equal(PT.shouldRemember({ type: "Castle", confidence: "high" }), false);
  assert.equal(PT.shouldRemember(null), false);
});

test("only a street address is looked up", () => {
  assert.equal(PT.looksLikeStreetAddress("4080 N Pecos Rd, Las Vegas, NV"), true);
  assert.equal(PT.looksLikeStreetAddress("Downtown Boise"), false);
  assert.equal(PT.looksLikeStreetAddress(""), false);
  assert.equal(PT.looksLikeStreetAddress("1 " + "x".repeat(400)), false);
});

// The /admin score. Only a person overturning a type the LOOKUP chose counts
// against it; a report typed by a person or the map ("report_retyped") and the
// map detector's own pings never do.
test("the live score counts the lookup's answers and only its own corrections", () => {
  const look = (source, duration_ms) => ({ kind: "type_lookup", source, duration_ms });
  const ping = (source) => ({ kind: "type_autofill", source });
  const s = PT.lookupStats([
    look("quick_high", 3000), look("quick_high", 5000), look("deep_medium", 20000),
    look("deep_high", 18000), look("memo", null), look("failed", 40000),
    ping("found"), ping("lookup_changed"), ping("found_retyped"),
    ping("report_retyped"), ping("undone"), ping("applied"),
    { kind: "search", source: "quick_high" },
  ]);
  assert.equal(s.lookups, 6);
  assert.equal(s.answered, 5, "a failed lookup answered nothing");
  assert.equal(s.memo, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.firstLook, 2);
  assert.equal(s.secondLook, 2);
  assert.equal(s.sure, 3);
  assert.equal(s.changed, 1);
  assert.equal(s.retyped, 1, "report_retyped is not the lookup's mistake");
  assert.equal(s.corrected, 2);
  assert.equal(s.correctedPct, 40);
  assert.equal(s.keptPct, 60);
  assert.equal(s.medianMs, 18000, "remembered answers cost no time and are left out");
});

test("the live score never divides by nothing, and never reads below zero", () => {
  const empty = PT.lookupStats([]);
  assert.equal(empty.answered, 0);
  assert.equal(empty.keptPct, 0);
  assert.equal(empty.medianMs, null);
  assert.equal(PT.lookupStats(null).lookups, 0);
  // Corrections can outlive the answers they were about in a capped window:
  // the corrected share shows it, and "kept" stops at zero.
  const s = PT.lookupStats([
    { kind: "type_lookup", source: "quick_high" },
    { kind: "type_autofill", source: "lookup_changed" },
    { kind: "type_autofill", source: "found_retyped" },
  ]);
  assert.equal(s.correctedPct, 200);
  assert.equal(s.keptPct, 0);
});
