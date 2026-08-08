"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const RP = require("../report-parse");

// --- normalizeCurrency: the currency/usd_rate pair --------------------------
// Pins the behavior the function had while it lived in server.js. The pair
// drives the front-end's convert-to-USD toggle and harvestComps' non-USD
// skip, so the conventions here (blank = USD, bad rate = null) are contracts.

test("normalizeCurrency passes non-objects through untouched", () => {
  assert.equal(RP.normalizeCurrency(null), null);
  assert.equal(RP.normalizeCurrency(undefined), undefined);
  assert.equal(RP.normalizeCurrency("raw text"), "raw text");
});

test("normalizeCurrency returns the same object it was given (pipeline style)", () => {
  const parsed = { currency: "CAD", usd_rate: 0.73 };
  assert.equal(RP.normalizeCurrency(parsed), parsed);
});

test("blank or missing currency reads as USD (the pre-feature behavior)", () => {
  assert.equal(RP.normalizeCurrency({}).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "  " }).currency, "USD");
});

test("a currency code is three letters or it is USD", () => {
  assert.equal(RP.normalizeCurrency({ currency: "cad" }).currency, "CAD");
  assert.equal(RP.normalizeCurrency({ currency: " EUR " }).currency, "EUR");
  assert.equal(RP.normalizeCurrency({ currency: "C$" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "CANADIAN" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "12" }).currency, "USD");
});

test("a USD report never carries a rate", () => {
  assert.equal(RP.normalizeCurrency({ currency: "USD", usd_rate: 1 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ usd_rate: 0.5 }).usd_rate, null);
});

test("a foreign report keeps a sane positive rate, as a number", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 0.73 }).usd_rate, 0.73);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: "0.73" }).usd_rate, 0.73);
  assert.equal(RP.normalizeCurrency({ currency: "KWD", usd_rate: 3.25 }).usd_rate, 3.25);
});

test("an inverted rate is dropped but the currency label survives", () => {
  // MXN "18.7" is units-per-USD, not USD-per-unit. Relabeling the prices USD
  // would be worse than losing the toggle — the deliberate asymmetry.
  const r = RP.normalizeCurrency({ currency: "MXN", usd_rate: 18.7 });
  assert.equal(r.currency, "MXN");
  assert.equal(r.usd_rate, null);
});

test("rate bounds: (0, 10) exclusive on both ends", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 10 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 9.99 }).usd_rate, 9.99);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 0 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: -0.7 }).usd_rate, null);
});

test("an unparseable rate becomes null, never NaN", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: "abc" }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: Infinity }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD" }).usd_rate, null);
});
