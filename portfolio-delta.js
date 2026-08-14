// ---------------------------------------------------------------------------
// "The market under this building moved since you last looked."
//
// The desk already shows what a property's own valuation did between two RUNS
// of its report. That number only exists when the owner comes back and re-runs
// it, which makes it a record of visits rather than a reason to make one.
//
// This is the other half, and it costs nothing: the comp corpus fills up from
// everybody's searches, so the market a saved property sits in keeps moving
// whether or not its owner ever returns. Comparing the market's median $/SF
// since their last check against the equal-length window before it turns
// stored history into a sentence worth coming back for, with no billed search
// anywhere in the path.
//
// Deliberately PURE, like valuation.js and entitlements.js: no I/O, no clock
// reads (the caller passes `nowFrac`), no date parsing. server.js owns the
// corpus read and hands in `saleRowsWithDates()`'s output, so this file cannot
// drift from parseDealDate() by holding a second copy of it.
//
// This is a MARKET movement, never a re-valuation of the building. It says the
// comps around it have moved; it does not restate what the property is worth,
// because that needs a search nobody has paid for.
// ---------------------------------------------------------------------------

"use strict";

// Both sides need real evidence. Three is the same floor the watchlist feed's
// trend arrow uses, and for the same reason: two deals in a thin market is a
// coin flip dressed as a direction.
const MIN_PER_SIDE = 3;

// A window narrower than this is noise even with enough comps: half a dozen
// deals inside two weeks says nothing about a market. Someone who re-checks
// daily should see nothing rather than a number that swings with each sale.
const MIN_WINDOW_YEARS = 30 / 365;

// And a window wider than this stops being "since you last looked" and becomes
// market history. A property checked once two years ago gets the last year
// compared against the year before it, which is a fair statement about the
// market and an honest one about the span it covers.
const MAX_WINDOW_YEARS = 1;

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  // Upper-middle, matching medianPsfOf() in server.js and the feed's formula,
  // so the desk and the feed can never quote different medians.
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
}

/**
 * Market movement across a saved property's own since-you-last-checked window.
 *
 * `sales` is saleRowsWithDates() output: [{ yearFrac, psf }], priced sale comps
 * with parseable deal dates. `sinceFrac` is when the owner last checked, on the
 * same yearFrac scale. `nowFrac` is today, passed in rather than read.
 *
 * Returns null whenever the answer would be made up — no window, too short a
 * window, or too few deals on either side. A null here renders nothing, which
 * is the right outcome for a market that genuinely has not said anything.
 */
function marketMoveSince(sales, { sinceFrac, nowFrac, minPerSide = MIN_PER_SIDE } = {}) {
  if (!Array.isArray(sales) || !isFinite(sinceFrac) || !isFinite(nowFrac)) return null;

  // The window is clamped, not rejected, at the top end: a long absence still
  // deserves an answer, just one about a span we are willing to describe.
  const rawWindow = nowFrac - sinceFrac;
  if (!(rawWindow >= MIN_WINDOW_YEARS)) return null;
  const windowYears = Math.min(rawWindow, MAX_WINDOW_YEARS);
  const start = nowFrac - windowYears;
  const priorStart = start - windowYears;

  const current = [];
  const prior = [];
  for (const s of sales) {
    if (!s || !isFinite(s.yearFrac) || !(s.psf > 0)) continue;
    // A deal dated in the future is a bad date, not a fresh comp.
    if (s.yearFrac > nowFrac + 0.02) continue;
    if (s.yearFrac >= start) current.push(s.psf);
    else if (s.yearFrac >= priorStart) prior.push(s.psf);
  }
  if (current.length < minPerSide || prior.length < minPerSide) return null;

  const cur = median(current);
  const pri = median(prior);
  if (!(cur > 0) || !(pri > 0)) return null;

  return {
    pct: Math.round(((cur - pri) / pri) * 1000) / 10,
    current: cur,
    prior: pri,
    currentCount: current.length,
    priorCount: prior.length,
    windowYears: Math.round(windowYears * 1000) / 1000,
    clamped: rawWindow > MAX_WINDOW_YEARS,
  };
}

/**
 * The one sentence the desk prints. Returns "" when there is nothing to say,
 * so the caller can render it unconditionally.
 *
 * It names the market and the comp count, because a percentage with neither is
 * a claim the reader cannot weigh. It says "median $/SF", never "your property
 * is worth", for the reason at the top of this file.
 */
function moveLine(move, { market, type } = {}) {
  if (!move) return "";
  const where = [market, String(type || "").toLowerCase()].filter(Boolean).join(" ");
  const dir = move.pct > 0 ? "up" : move.pct < 0 ? "down" : "flat";
  const size = Math.abs(move.pct).toFixed(1);
  const span = move.clamped ? "over the last year" : "since you last checked";
  const head = dir === "flat"
    ? `${where || "This market"} median $/SF is flat ${span}`
    : `${where || "This market"} median $/SF is ${dir} ${size}% ${span}`;
  return `${head} (${move.currentCount} sale${move.currentCount === 1 ? "" : "s"} vs ${move.priorCount} before).`;
}

module.exports = { marketMoveSince, moveLine, MIN_PER_SIDE, MIN_WINDOW_YEARS, MAX_WINDOW_YEARS };
