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

test("cityVariants: punctuation and St-expansion produce ONE normalized variant", () => {
  assert.deepEqual(CITYCHECK.cityVariants("St. Louis"), ["St. Louis", "Saint Louis"]);
  assert.deepEqual(CITYCHECK.cityVariants("St Louis"), ["St Louis", "Saint Louis"]);
  assert.deepEqual(CITYCHECK.cityVariants("Coeur d'Alene"), ["Coeur d'Alene", "Coeur dAlene"]);
});

test("cityVariants: variant equal to the input (case-insensitive) is deduped", () => {
  assert.deepEqual(CITYCHECK.cityVariants("Saint Louis"), ["Saint Louis"]);
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

test("checkCity: every variant 404 is unknown, capped at two calls", async () => {
  const f = stubFetch([{ status: 404 }, { status: 404 }]);
  assert.equal(await CITYCHECK.checkCity(f, "St. Bosie", "ID"), "unknown");
  assert.equal(f.calls.length, 2);
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
