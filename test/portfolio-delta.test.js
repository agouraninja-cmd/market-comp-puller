// The market movement shown against a saved property.
//
// Two ways this goes wrong and neither is visible on screen: it manufactures a
// direction out of two deals in a thin market, or it reads as a re-valuation
// of the building rather than a statement about the comps around it. The
// second is a copy problem and is tested here too, because the line this
// module returns is printed verbatim.

const test = require("node:test");
const assert = require("node:assert");

const { marketMoveSince, moveLine, MIN_PER_SIDE } = require("../portfolio-delta");

// yearFrac, the scale parseDealDate produces: year + (month - 0.5)/12.
const at = (year, month) => year + (month - 0.5) / 12;
const NOW = at(2026, 8);

// n sales at one price, all inside one month.
const salesAt = (year, month, psf, n) =>
  Array.from({ length: n }, () => ({ yearFrac: at(year, month), psf }));

test("a market that moved is reported with both sides' counts", () => {
  const move = marketMoveSince(
    [...salesAt(2026, 7, 110, 4), ...salesAt(2026, 2, 100, 3)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  assert.ok(move, "three a side over a three-month window is enough");
  assert.equal(move.pct, 10);
  assert.equal(move.currentCount, 4);
  assert.equal(move.priorCount, 3);
});

test("under three deals on either side, it says nothing at all", () => {
  // The same floor the watchlist feed's trend arrow uses. Two deals in a thin
  // market is a coin flip wearing a percentage sign.
  assert.equal(MIN_PER_SIDE, 3);
  const thinNow = marketMoveSince(
    [...salesAt(2026, 7, 110, 2), ...salesAt(2026, 2, 100, 5)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  assert.equal(thinNow, null);
  const thinBefore = marketMoveSince(
    [...salesAt(2026, 7, 110, 5), ...salesAt(2026, 2, 100, 2)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  assert.equal(thinBefore, null);
});

test("a visit yesterday produces no window and no claim", () => {
  // Somebody who checks daily must see nothing rather than a number that
  // swings with every single sale.
  const move = marketMoveSince(
    [...salesAt(2026, 8, 110, 6), ...salesAt(2026, 7, 100, 6)],
    { sinceFrac: NOW - 0.01, nowFrac: NOW });
  assert.equal(move, null);
});

test("a long absence is clamped to a year and says so", () => {
  const move = marketMoveSince(
    [...salesAt(2026, 4, 120, 4), ...salesAt(2025, 4, 100, 4), ...salesAt(2023, 1, 50, 9)],
    { sinceFrac: at(2023, 1), nowFrac: NOW });
  assert.ok(move);
  assert.equal(move.clamped, true, "a two-year absence compares the last year, not two");
  assert.equal(move.windowYears, 1);
  // The 2023 rows sit outside both windows and must not drag the prior median.
  assert.equal(move.prior, 100);
  assert.match(moveLine(move, { market: "Boise, ID", type: "Industrial" }), /over the last year/);
});

test("a deal dated in the future is a bad date, not a fresh comp", () => {
  const move = marketMoveSince(
    [...salesAt(2027, 6, 400, 5), ...salesAt(2026, 7, 110, 3), ...salesAt(2026, 2, 100, 3)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  assert.ok(move);
  assert.equal(move.currentCount, 3, "the 2027 rows must be excluded, not counted as current");
  assert.equal(move.current, 110);
});

test("garbage in produces null, not a throw or a NaN", () => {
  assert.equal(marketMoveSince(null, { sinceFrac: at(2026, 5), nowFrac: NOW }), null);
  assert.equal(marketMoveSince([], { sinceFrac: at(2026, 5), nowFrac: NOW }), null);
  assert.equal(marketMoveSince([{}], { sinceFrac: at(2026, 5), nowFrac: NOW }), null);
  assert.equal(marketMoveSince(salesAt(2026, 7, 100, 9), {}), null);
  assert.equal(marketMoveSince(
    [...salesAt(2026, 7, 0, 5), ...salesAt(2026, 2, 0, 5)],
    { sinceFrac: at(2026, 5), nowFrac: NOW }), null, "zero prices cannot make a percentage");
});

// --- the sentence ---------------------------------------------------------

test("the line names the market and the evidence, never a property value", () => {
  const move = marketMoveSince(
    [...salesAt(2026, 7, 110, 4), ...salesAt(2026, 2, 100, 3)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  const line = moveLine(move, { market: "Boise, ID", type: "Industrial" });
  assert.match(line, /Boise, ID industrial/);
  assert.match(line, /median \$\/SF/, "it is a market statistic and must say so");
  assert.match(line, /up 10\.0%/);
  assert.match(line, /4 sales vs 3 before/, "a percentage with no counts cannot be weighed");
  // The thing it must never sound like: a new valuation of their building.
  assert.equal(/your (property|building) is (now )?worth|valuation|apprais/i.test(line), false);
});

test("a flat market reads as flat rather than as up 0.0%", () => {
  const move = marketMoveSince(
    [...salesAt(2026, 7, 100, 3), ...salesAt(2026, 2, 100, 3)],
    { sinceFrac: at(2026, 5), nowFrac: NOW });
  assert.equal(move.pct, 0);
  assert.match(moveLine(move, { market: "Boise, ID", type: "Industrial" }), /is flat since you last checked/);
});

test("one sale on a side is singular, and no movement renders nothing", () => {
  const move = marketMoveSince(
    [...salesAt(2026, 7, 110, 3), ...salesAt(2026, 2, 100, 3)],
    { sinceFrac: at(2026, 5), nowFrac: NOW, minPerSide: 1 });
  assert.match(moveLine({ ...move, currentCount: 1, priorCount: 1 }, { market: "Boise, ID" }), /1 sale vs 1 before/);
  assert.equal(moveLine(null, { market: "Boise, ID" }), "", "no movement must render nothing at all");
});
