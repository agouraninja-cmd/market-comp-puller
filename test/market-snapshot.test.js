// The market-page refresh rule.
//
// Market pages are the public SEO surface, and until 2026-08-06 they were
// write-once in practice: all 27 curated seed pages carried generatedAt
// 2026-07-14 and nothing could ever replace them. `isBetterSnapshot` is what
// unfreezes them, so it is also the thing standing between a good page and a
// worse one. A bad swap is more damaging than a stale page, which is why the
// rule refuses far more often than it accepts.
//
// Cost: zero. Pure function, no server, no database, no clock.

const test = require("node:test");
const assert = require("node:assert");
const { isBetterSnapshot } = require("../market-snapshot");

const snap = (generatedAt, count) => ({ generatedAt, ppsf: { count } });

test("market snapshot refresh rule", async (t) => {
  await t.test("newer and equally deep replaces", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 9), snap("2026-07-14", 9)), true);
  });

  await t.test("newer and deeper replaces", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 12), snap("2026-07-14", 9)), true);
  });

  await t.test("newer but THINNER does not replace", () => {
    // The failure this rule exists to prevent: a quiet market returns three
    // comps, and a twelve-comp page is overwritten with it and called an
    // update. Fresher is not automatically better.
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), snap("2026-07-14", 12)), false);
  });

  await t.test("older never replaces, however deep", () => {
    assert.equal(isBetterSnapshot(snap("2026-06-01", 40), snap("2026-07-14", 4)), false);
  });

  await t.test("same day never replaces", () => {
    // Equal stamps mean a second search the same day rewrites nothing. Without
    // this, every repeat search in a covered market would churn a DB write and
    // bump the sitemap's lastmod for no new information.
    assert.equal(isBetterSnapshot(snap("2026-07-14", 20), snap("2026-07-14", 4)), false);
  });

  await t.test("anything replaces nothing", () => {
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), null), true);
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), undefined), true);
    assert.equal(isBetterSnapshot(snap("2026-08-06", 3), {}), true);
  });

  await t.test("a candidate with no stamp is refused", () => {
    // Fails CLOSED: an undated snapshot cannot be shown to be newer, and
    // accepting it would also write an empty lastmod into the sitemap.
    assert.equal(isBetterSnapshot({ ppsf: { count: 99 } }, snap("2026-07-14", 2)), false);
    assert.equal(isBetterSnapshot(null, snap("2026-07-14", 2)), false);
  });

  await t.test("a missing comp count reads as zero, not as a pass", () => {
    // A malformed candidate must not slip through on a NaN comparison.
    assert.equal(isBetterSnapshot({ generatedAt: "2026-08-06" }, snap("2026-07-14", 5)), false);
    // ...and it may still replace a current page that is equally countless.
    assert.equal(isBetterSnapshot({ generatedAt: "2026-08-06" }, { generatedAt: "2026-07-14" }), true);
  });

  await t.test("ISO date strings compare correctly as strings", () => {
    // The rule leans on lexicographic order, which is only safe for
    // zero-padded YYYY-MM-DD. Pin it so nobody swaps in a looser format.
    assert.equal(isBetterSnapshot(snap("2026-10-01", 5), snap("2026-09-30", 5)), true);
    assert.equal(isBetterSnapshot(snap("2026-09-30", 5), snap("2026-10-01", 5)), false);
    assert.equal(isBetterSnapshot(snap("2027-01-01", 5), snap("2026-12-31", 5)), true);
  });
});
