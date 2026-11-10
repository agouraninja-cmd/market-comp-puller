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

  // ---------------------------------------------------------------------------
  // The words.
  //
  // describe() turns a summary into what a person reads: the line under the
  // card's title, the three tiles, "Value this loan needs", and the read. It
  // lives here, beside the arithmetic, because TWO pages draw this card: the
  // report (index.html) and the public lender page (lenders-page.js, whose
  // working check runs on a sample building). With the sentences in each
  // page, the public page would promise one wording and the product would
  // show another the first time either was edited. Both now call this, and
  // the server renders the lender page's first state with it too.
  //
  // What stays with each page is what only that page knows: the DOM, the
  // colours a tone maps to, and the prompts for a box nobody has typed in.
  //
  //   opts.money  how to write dollars. The report passes its own formatter
  //               (a report can be in another currency); the default is USD.
  //   opts.whose  whose range it is, in the sentences that name it. "this
  //               report's" by default; the lender page says "this sample's".
  // ---------------------------------------------------------------------------
  const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const pct1 = (v) => (Math.round(v * 10) / 10).toFixed(1) + "%";

  function describe(r, opts) {
    if (!r || !r.likely) return null;
    const o = opts && typeof opts === "object" ? opts : {};
    const fmt = typeof o.money === "function" ? o.money : usd;
    const whose = typeof o.whose === "string" && o.whose ? o.whose : "this report's";
    const limit = (Math.round(r.limitPct * 10) / 10) + "%";
    const ranged = Boolean(r.low && r.high);

    // Each tile says what it was measured on, because under the lesser-of
    // rule that is sometimes the price rather than the value in its label.
    const on = (s) => (s.basisIs === "price" ? "the " + fmt(s.basis) + " price" : fmt(s.basis));
    const tile = (s) => {
      if (!s) return null;
      if (s.ltvPct == null) return { figure: null, tone: null, sub: "up to " + fmt(s.maxLoan) + " on " + on(s) };
      const room = Math.round(s.room);
      return {
        figure: pct1(s.ltvPct),
        tone: s.within ? "ok" : "over",
        sub: "on " + on(s) + " · " +
          (room === 0 ? "at your limit" : s.within ? fmt(room) + " of room" : fmt(-room) + " over your limit"),
      };
    };

    const out = {
      limit, ranged,
      basis: (ranged
        ? "Value " + fmt(r.low.value) + " to " + fmt(r.high.value)
        : "Value " + fmt(r.likely.value)) + " · " + limit + " limit",
      low: tile(r.low), likely: tile(r.likely), high: tile(r.high),
      need: null,
      read: [],
    };

    if (r.requiredValue != null) {
      const c = r.cushionPct;
      // When the price binds, how the figure compares with the likely value
      // is beside the point: no appraisal reaches it, because the price caps
      // what counts. Said here so this line never contradicts the read.
      out.need = {
        figure: fmt(r.requiredValue),
        sub: "for " + fmt(r.loan) + " at your " + limit + " limit · " +
          (r.priceBinds ? "more than the " + fmt(r.price) + " price, which caps what a lender counts"
            : Math.abs(c) < 0.05 ? "right at the likely value"
            : c > 0 ? pct1(c) + " under the likely value"
            : pct1(-c) + " above the likely value"),
      };
    }

    // The read: one sentence on the loan, then where the price sits.
    if (r.priceBinds) {
      const maxAtPrice = r.price * (r.limitPct / 100);
      out.read.push("The price is what binds here, not the value. A lender counts the lesser of the two, and at " +
        fmt(r.price) + " your " + limit + " limit allows " + fmt(maxAtPrice) + ": " +
        fmt(r.loan - maxAtPrice) + " less than this loan, whatever the appraisal says.");
    } else if (r.verdict === "covered") {
      out.read.push(r.low
        ? "Covered across the range. Even at the low value this loan sits inside your " + limit + " limit."
        : "Covered. At " + whose + " value the loan sits inside your " + limit + " limit.");
    } else if (r.verdict === "depends") {
      out.read.push("The appraisal decides. This loan fits at the likely value and not at the low one, " +
        "so it needs the building to come in at " + fmt(r.requiredValue) + " or more.");
    } else if (r.verdict === "stretch") {
      out.read.push("A stretch. This loan is over your " + limit +
        " limit at the likely value and fits only toward the top of the range.");
    } else if (r.verdict === "short") {
      out.read.push((r.high
        ? "Over your " + limit + " limit across the whole range."
        : "Over your " + limit + " limit at " + whose + " value.") +
        " At the likely value the limit allows " + fmt(r.likely.maxLoan) + ", " +
        fmt(r.loan - r.likely.maxLoan) + " less than this loan.");
    }
    if (r.pricePosition === "above") {
      out.read.push("The " + fmt(r.price) + " price is " + pct1(r.priceGapPct) + " above " +
        (ranged ? "the top of " + whose + " range." : whose + " value."));
    } else if (r.pricePosition === "below") {
      out.read.push("The " + fmt(r.price) + " price is " + pct1(r.priceGapPct) + " below " +
        (ranged ? "the bottom of " + whose + " range." : whose + " value."));
    } else if (r.pricePosition === "inside") {
      out.read.push(ranged ? "The " + fmt(r.price) + " price sits inside " + whose + " range."
        : "The " + fmt(r.price) + " price matches " + whose + " value.");
    }
    if (r.equityPct != null) {
      out.read.push(r.equityPct >= 0.05 ? "The borrower's equity is " + pct1(r.equityPct) + " of the price."
        : r.equityPct > -0.05 ? "The loan is the whole price."
        : "The loan is more than the price.");
    }
    return out;
  }

  return { DEFAULT_LIMIT_PCT, money, limitPct, rangeOf, summarize, describe };
});
