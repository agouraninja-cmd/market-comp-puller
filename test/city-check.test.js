// test/city-check.test.js
// The Market Explorer's real-city check. Pure like bov-log.js: no I/O of its
// own — the caller injects fetch, which is what lets npm test cover every
// verdict with no network.
// Spec: docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md

const test = require("node:test");
const assert = require("node:assert");

const CITYCHECK = require("../city-check");

// A recording fetch stub: `plan` is an array of {status} or Error, consumed
// in order; `calls` records every URL asked for.
function stubFetch(plan) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const next = plan.shift();
    if (next instanceof Error) throw next;
    return { status: next.status };
  };
  fn.calls = calls;
  return fn;
}

test("cityVariants: plain city has no variant", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Boise"), ["Boise"]);
  assert.deepEqual(CITYCHECK.cityVariants("Los Angeles"), ["Los Angeles"]);
});

test("cityVariants: St-expansion collapses the space and strip variants together", () => {
  assert.deepEqual(CITYCHECK.cityVariants("St. Louis"), ["St. Louis", "Saint Louis"]);
  assert.deepEqual(CITYCHECK.cityVariants("St Louis"), ["St Louis", "Saint Louis"]);
});

// "Ft. Worth" and "Mt. Vernon" were live-verified refused before this
// expansion existed: GeoNames only knows "Fort Worth" / "Mount Vernon", and
// both punctuation variants of the abbreviation 404. Same rule as "St ".
test("cityVariants: Ft- and Mt-expansion, same shape as St", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Ft. Worth"), ["Ft. Worth", "Fort Worth"]);
  assert.deepEqual(CITYCHECK.cityVariants("Ft Worth"), ["Ft Worth", "Fort Worth"]);
  assert.deepEqual(CITYCHECK.cityVariants("Mt. Vernon"), ["Mt. Vernon", "Mount Vernon"]);
  assert.deepEqual(CITYCHECK.cityVariants("Mt Vernon"), ["Mt Vernon", "Mount Vernon"]);
});

test("cityVariants: expansion only fires on the leading word", () => {
  // A city merely STARTING with those letters must not be rewritten.
  assert.deepEqual(CITYCHECK.cityVariants("Stanton"), ["Stanton"]);
  assert.deepEqual(CITYCHECK.cityVariants("Fruitland"), ["Fruitland"]);
});

test("cityVariants: variant equal to the input (case-insensitive) is deduped", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Saint Louis"), ["Saint Louis"]);
});

test("cityVariants: punctuation-to-space and punctuation-stripped differ, producing three variants", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Coeur d'Alene"), [
    "Coeur d'Alene",
    "Coeur d Alene",
    "Coeur dAlene",
  ]);
  assert.deepEqual(CITYCHECK.cityVariants("Winston-Salem"), [
    "Winston-Salem",
    "Winston Salem",
    "WinstonSalem",
  ]);
  assert.deepEqual(CITYCHECK.cityVariants("O'Fallon"), ["O'Fallon", "O Fallon", "OFallon"]);
  assert.deepEqual(CITYCHECK.cityVariants("Lee's Summit"), [
    "Lee's Summit",
    "Lee s Summit",
    "Lees Summit",
  ]);
});

test("cityVariants: empty or whitespace-only input has no variants", () => {
  assert.deepEqual(CITYCHECK.cityVariants(""), []);
  assert.deepEqual(CITYCHECK.cityVariants("   "), []);
});

test("checkCity: 200 on the first try is ok, one call, correct URL", async () => {
  const f = stubFetch([{ status: 200 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "ok");
  assert.deepEqual(f.calls, ["https://api.zippopotam.us/us/ID/Boise"]);
});

test("checkCity: spaces are URL-encoded", async () => {
  const f = stubFetch([{ status: 200 }]);
  await CITYCHECK.checkCity(f, "Los Angeles", "CA");
  assert.deepEqual(f.calls, ["https://api.zippopotam.us/us/CA/Los%20Angeles"]);
});

test("checkCity: 404 then 200 on the normalized variant is ok, two calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 200 }]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Louis", "MO"), "ok");
  assert.deepEqual(f.calls, [
    "https://api.zippopotam.us/us/MO/St.%20Louis",
    "https://api.zippopotam.us/us/MO/Saint%20Louis",
  ]);
});

// "St. Bosie" is NOT usable for a three-variant cap test: its punctuation-to-
// space and punctuation-stripped forms both collapse to "Saint Bosie" once
// the leading "St " expansion runs, leaving only two distinct variants
// (verified by hand: see the "St-expansion collapses" test above). "O'Bosie"
// has no "St " prefix, so its two normalized forms stay distinct.
test("checkCity: every variant 404 is unknown, capped at three calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 404 }, { status: 404 }]);
  assert.equal(await CITYCHECK.checkCity(f, "O'Bosie", "ID"), "unknown");
  assert.deepEqual(f.calls, [
    "https://api.zippopotam.us/us/ID/O'Bosie",
    "https://api.zippopotam.us/us/ID/O%20Bosie",
    "https://api.zippopotam.us/us/ID/OBosie",
  ]);
});

test("checkCity: 404 then 404 then 200 on the third variant is ok, three calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 404 }, { status: 200 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Coeur d'Alene", "ID"), "ok");
  assert.deepEqual(f.calls, [
    "https://api.zippopotam.us/us/ID/Coeur%20d'Alene",
    "https://api.zippopotam.us/us/ID/Coeur%20d%20Alene",
    "https://api.zippopotam.us/us/ID/Coeur%20dAlene",
  ]);
});

test("checkCity: a single-variant city that 404s is unknown after one call", async () => {
  const f = stubFetch([{ status: 404 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Bosie", "ID"), "unknown");
  assert.equal(f.calls.length, 1);
});

// Fail open: anything that is not a clean yes/no answer must never refuse a
// legitimate market. 5xx, weird statuses, and thrown network errors all map
// to "unavailable" — including a throw AFTER a 404, where the truth is unknown.
test("checkCity: 500 is unavailable", async () => {
  const f = stubFetch([{ status: 500 }]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "unavailable");
});

test("checkCity: a thrown fetch (timeout/network) is unavailable", async () => {
  const f = stubFetch([new Error("aborted")]);
  assert.equal(await CITYCHECK.checkCity(f, "Boise", "ID"), "unavailable");
});

test("checkCity: 404 then a throw is unavailable, not unknown", async () => {
  const f = stubFetch([{ status: 404 }, new Error("aborted")]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Louis", "MO"), "unavailable");
});
