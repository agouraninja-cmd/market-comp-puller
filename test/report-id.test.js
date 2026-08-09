"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ID = require("../report-id");

// --- reportIdFor: the identity a purchase and an export are keyed on --------

test("reportIdFor needs both address and type", () => {
  assert.equal(ID.reportIdFor({}), "");
  assert.equal(ID.reportIdFor({ address: "1 Elm St, Boise, ID" }), "");
  assert.equal(ID.reportIdFor({ type: "Industrial" }), "");
  assert.equal(ID.reportIdFor(), "");
});

test("the id is a 32-char hex hash — no address ever lands in a usage table", () => {
  const id = ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Industrial" });
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("case and whitespace do not change a report's identity", () => {
  // Normalization is over the JOINED string (trim ends, collapse runs) — a
  // trailing space inside the address would survive as " |", so the route's
  // own address trimming is what guards that edge, not this key.
  const a = ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Industrial" });
  assert.equal(ID.reportIdFor({ address: "  1 ELM st,  Boise, id", type: "industrial  " }), a);
});

test("the lookback is NOT part of the identity (2026-08-04 rule)", () => {
  // While months was in the key, a re-run at a wider window matched no
  // purchase, so a $20 unlock could never carry Pro's ten-year window.
  const a = ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Industrial" });
  assert.equal(ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Industrial", months: 120 }), a);
});

test("different address or type is a different report", () => {
  const a = ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Industrial" });
  assert.notEqual(ID.reportIdFor({ address: "2 Elm St, Boise, ID", type: "Industrial" }), a);
  assert.notEqual(ID.reportIdFor({ address: "1 Elm St, Boise, ID", type: "Office" }), a);
});

// --- The mirror: index.html's exportReportKey ---------------------------------
// The purchase key and the export-tally key are the same string: the browser
// builds the plaintext (exportReportKey), POSTs it to /api/export, and the
// server hashes it with reportKeyOf — while a purchase is keyed by
// reportIdFor from the search body. If the two plaintext builders drift, a
// bought report stops matching itself and starts burning paid exports. This
// test compiles the REAL function out of index.html (the check-field-maps /
// vault-page technique) and proves the hashes agree.

test("exportReportKey (index.html) and reportIdFor produce the same key", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/function exportReportKey\(\) \{[\s\S]*?\n  \}/);
  assert.ok(m, "exportReportKey not found in index.html — the mirror is gone");
  const browserKey = new Function("currentMeta", `${m[0]}; return exportReportKey();`);

  const cases = [
    { address: "1 Elm St, Boise, ID", type: "Industrial" },
    { address: "  4521 MAPLE Ave, Dallas, TX ", type: "retail" },
    { address: "100  Main   St, Ontario, CA", type: "Land" },  // internal runs
  ];
  for (const meta of cases) {
    assert.equal(ID.reportKeyOf(browserKey(meta)), ID.reportIdFor(meta),
      `keys diverge for ${JSON.stringify(meta)}`);
  }
});

test("a missing report on screen yields an empty key, matching reportIdFor's refusal", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/function exportReportKey\(\) \{[\s\S]*?\n  \}/);
  assert.ok(m);
  const browserKey = new Function("currentMeta", `${m[0]}; return exportReportKey();`);
  assert.equal(browserKey(null), "");
});
