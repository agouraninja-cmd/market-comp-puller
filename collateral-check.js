// ---------------------------------------------------------------------------
// Collateral check — a loan against the report's value range.
//
// PURE and dual-exported (Node + browser global COLLATERAL), exactly like
// valuation.js and dev-returns.js and for the same reason: the screen, the
// print view and the Excel export must all quote the same number, and
// `npm test` has to prove every one of these figures with no browser.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The report's Debt & Refi card is built on NOI: debt service, DSCR and debt
// yield all divide by it, so the card stays hidden until one is typed. That
// is right for an investor and useless for the lender most small commercial
// buildings actually meet. An owner-occupied building (a vet clinic, a
// machine shop, a self-storage operator buying its own site) has no NOI; the
// loan is repaid by the BUSINESS and the building is collateral. The question
// that lender asks of a comp report is not "does the rent cover the payment"
// but "is this loan covered by what the building is worth, and how wrong can
// the value be before it is not".
//
// So this takes one number nobody else in the report needs an NOI to use (the
// loan) and reads it against all three of the hero's figures.
//
// ---------------------------------------------------------------------------
// THE THREE RULES
// ---------------------------------------------------------------------------
// 1. A MISSING NUMBER IS null, NEVER ZERO. dev-returns.js's rule. A 0% LTV is
//    a real statement about an unlevered building, and a reader handed one
//    cannot tell it from "you have not typed a loan yet".
//
// 2. THE BASIS IS THE LESSER OF PRICE AND VALUE. A lender financing a purchase
//    counts whichever is lower, the contract price or the value, so a
//    building bought under its value does not borrow against the difference.
//    Consequence worth stating: when the price alone already breaks the
//    limit, no appraisal can fix it, and `priceBinds` says so. That is a
//    different conversation (more equity, or a smaller loan) from "the
//    appraisal decides", and a card that could not tell them apart would send
//    a lender off to order an appraisal that cannot change the answer.
//
// 3. THIS NEVER COMPUTES A VALUE. The range is the report's own (the hero's
//    Low / Likely / High), handed in. valuation.js owns that number, and a
//    second opinion here would be a second answer on the same screen.
//
// ---------------------------------------------------------------------------
// WHAT IT IS NOT
// ---------------------------------------------------------------------------
// Not an appraisal and not a bank evaluation. The value range is an automated
// estimate from public comps, so everything here is a PRE-SCREEN: whether a
// deal is worth the weeks and the fee an appraisal costs. Nothing in this
// file is a lending limit either. `DEFAULT_LIMIT_PCT` is only where the box
// starts; the limit is the lender's own policy and is theirs to type.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.COLLATERAL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Where the limit box starts. A common conventional figure for an
  // owner-occupied commercial building, and nothing more than that.
  const DEFAULT_LIMIT_PCT = 80;

  // Comparing a ratio against a limit in floating point: 1,600,000 / 2,000,000
  // must read as AT an 80% limit, not a hair over it.
  const EPS = 1e-9;

  // A finite, positive number of dollars or null. Accepts what a person types
  // ("1,600,000", "$1,600,000") and REFUSES shorthand, dev-returns.js's rule:
  // "1.6M" read as 1.6 turns a $1.6M loan into a $1.60 one, and the card
  // would report a spectacular 0.0% LTV nobody questions.
  function money(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
    const raw = String(v).trim().replace(/^\$/, "").replace(/,/g, "");
    if (!/^\d*\.?\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // The lender's own LTV limit, as a percentage. Above 0, at most 100: a
  // "limit" past the whole value is not one. Anything else falls back to the
  // default rather than to null, because the card must always be reading
  // against SOME limit and the box always shows which.
  function limitPct(v) {
    let n = null;
    if (typeof v === "number") n = v;
    else if (v != null && v !== "") {
      const raw = String(v).trim().replace(/%$/, "");
      if (/^\d*\.?\d+$/.test(raw)) n = Number(raw);
    }
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_LIMIT_PCT;
  }

  // The report's range, or null when it has no Likely figure. Low and High
  // are each kept only when they sit on their own side of Likely: a range
  // that arrives inverted is not stress-tested against, it is ignored.
  function rangeOf(v) {
    const r = v && typeof v === "object" ? v : {};
    const likely = money(r.likely);
    if (likely == null) return null;
    const low = money(r.low);
    const high = money(r.high);
    return {
      low: low != null && low <= likely ? low : null,
      likely,
      high: high != null && high >= likely ? high : null,
    };
  }

  // One line of the table: the loan against one value the building might
  // turn out to have.
  function scenario(key, value, loan, price, limit) {
    if (value == null) return null;
    const priced = price != null && price < value;
    const basis = priced ? price : value;
    const maxLoan = basis * (limit / 100);
    const out = { key, value, basis, basisIs: priced ? "price" : "value", maxLoan, ltvPct: null, within: null, room: null };
    if (loan != null) {
      out.ltvPct = (loan / basis) * 100;
      out.within = out.ltvPct <= limit + EPS;
      out.room = maxLoan - loan;
    }
    return out;
  }

  /**
   * The whole card.
   *
   * @param {object} input
   * @param {number|string} input.loan      the loan being considered
   * @param {number|string} [input.price]   the purchase price, when there is one
   * @param {number|string} [input.limitPct] the lender's own LTV limit
   * @param {{low,likely,high}} input.value  the report's range, never computed here
   *
   * `verdict` is one of:
   *   "covered"  inside the limit even at the low end of the range
   *   "depends"  inside at the likely value, over at the low end
   *   "stretch"  over at the likely value, inside only toward the high end
   *   "short"    over the limit across the whole range
   * and null until there is a loan and a likely value to read it against.
   */
  function summarize(input) {
    const i = input && typeof input === "object" ? input : {};
    const loan = money(i.loan);
    const price = money(i.price);
    const limit = limitPct(i.limitPct);
    const value = rangeOf(i.value);

    const out = {
      loan, price, limitPct: limit, value,
      scenarios: [], low: null, likely: null, high: null,
      requiredValue: null, cushionPct: null,
      priceLtvPct: null, equityPct: null, priceBinds: false, pricePosition: null, priceGapPct: null,
      verdict: null, missing: [],
    };
    if (value == null) out.missing.push("a value estimate");
    if (loan == null) out.missing.push("a loan amount");

    if (value != null) {
      for (const key of ["low", "likely", "high"]) {
        const s = scenario(key, value[key], loan, price, limit);
        if (s) { out.scenarios.push(s); out[key] = s; }
      }
    }

    if (loan != null) {
      // The least the building must be worth for this loan to sit at the
      // limit. The one figure a lender carries into the appraisal.
      out.requiredValue = loan / (limit / 100);
      // How far the likely value can fall before the loan passes the limit.
      // Negative means it is already past it at the likely value.
      if (value != null) out.cushionPct = (1 - out.requiredValue / value.likely) * 100;
    }

    if (price != null) {
      if (loan != null) {
        out.priceLtvPct = (loan / price) * 100;
        out.equityPct = 100 - out.priceLtvPct;
        // The price itself is under what the loan needs, so the lesser-of
        // basis can never reach it whatever the appraisal says.
        out.priceBinds = out.priceLtvPct > limit + EPS;
      }
      if (value != null) {
        const lo = value.low != null ? value.low : value.likely;
        const hi = value.high != null ? value.high : value.likely;
        if (price > hi) { out.pricePosition = "above"; out.priceGapPct = (price / hi - 1) * 100; }
        else if (price < lo) { out.pricePosition = "below"; out.priceGapPct = (1 - price / lo) * 100; }
        else { out.pricePosition = "inside"; out.priceGapPct = 0; }
      }
    }

    if (loan != null && value != null) {
      // A range missing an end is read at Likely for that end, so a report
      // with one figure still gets a verdict and never an invented spread.
      const low = out.low || out.likely;
      const high = out.high || out.likely;
      out.verdict = low.within ? "covered"
        : out.likely.within ? "depends"
        : high.within ? "stretch"
        : "short";
    }
    return out;
  }

  return { DEFAULT_LIMIT_PCT, money, limitPct, rangeOf, summarize };
});
