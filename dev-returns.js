// ---------------------------------------------------------------------------
// Development returns — cost -> stabilized value -> return.
//
// PURE and dual-exported (Node + browser global DEVRETURNS), exactly like
// valuation.js and for the same reason: the screen, the print view and the
// export must all quote the same number, and `npm test` has to be able to
// prove every one of these formulas with no browser and no database.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// CompNinja knows what a property is WORTH and nothing about what it COSTS.
// A development pro forma runs cost -> stabilized value -> return, and until
// now the product only had the middle term, which is why a development shop
// got vocabulary (org-access.js's SHOP_COPY) and no arithmetic. The inputs
// here are the smallest set that makes the third term real: land, hard, soft,
// a contingency, and how long the build takes.
//
// ---------------------------------------------------------------------------
// THE RULE THIS FILE IS BUILT AROUND: A MISSING NUMBER IS null, NEVER ZERO
// ---------------------------------------------------------------------------
// broker-vault.js's posture, applied to arithmetic. Every figure below is
// independently gated on the inputs it actually needs, and returns null when
// they are absent. Zero is a catastrophic default here: a 0% yield on cost is
// a real number describing a disastrous project, and a reader who is handed
// one has no way to tell it apart from "you have not typed an NOI yet".
// Nothing is ever partially invented to fill a card.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT MODELED IN v1
// ---------------------------------------------------------------------------
// Financing (a construction loan's draw interest and its effect on levered
// IRR), lease-up between completion and stabilization, phased or S-curve
// draws, and any tax treatment. Each changes the answer materially and each
// needs inputs nobody has been asked for yet. The consequence is stated on
// screen rather than buried: this is an UNLEVERED return on an all-cash,
// straight-line build, which is the number developers screen deals with
// before they model a capital stack.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DEVRETURNS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // A finite, non-negative number or null. Accepts what a person types into a
  // money field ("1,250,000", "$1.25m" is NOT accepted — see below).
  //
  // Shorthand is REFUSED rather than guessed, the broker-vault.js rule: "1.2M"
  // read as 1.2 understates a cost by six orders of magnitude, and a pro forma
  // that quietly prices a $1.2M land parcel at $1.20 produces a spectacular
  // IRR nobody will question until it is far too late.
  function money(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
    const raw = String(v).trim().replace(/^\$/, "").replace(/,/g, "");
    if (!/^\d*\.?\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // A percentage. Accepts "6.25" and "6.25%"; refuses anything else.
  function pct(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const raw = String(v).trim().replace(/%$/, "").replace(/,/g, "");
    if (!/^-?\d*\.?\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function months(v) {
    const n = money(v);
    if (n == null) return null;
    const i = Math.round(n);
    // A build is at least a month and at most twenty years. The ceiling is not
    // fussiness: it bounds the cash-flow array IRR iterates over, so a typo of
    // 240000 cannot hang the browser.
    return i >= 1 && i <= 240 ? i : null;
  }

  /**
   * Total project cost.
   *
   * Contingency is a percentage of HARD + SOFT and deliberately not of land:
   * the land price is known at closing and carries no construction risk, so
   * including it inflates every contingency line by the site cost. Standard
   * practice, and the one place this could quietly be wrong in a way that
   * flatters the project.
   *
   * Returns nulls rather than zeros when nothing has been entered, so a card
   * can tell "no costs yet" from "a project that costs nothing".
   */
  function totalCost(input) {
    const c = input && typeof input === "object" ? input : {};
    const land = money(c.land);
    const hard = money(c.hard);
    const soft = money(c.soft);
    const contPct = pct(c.contingencyPct);

    const anyEntered = land != null || hard != null || soft != null;
    if (!anyEntered) {
      return { land: null, hard: null, soft: null, contingency: null, total: null };
    }
    const l = land || 0, h = hard || 0, s = soft || 0;
    const contingency = contPct != null && contPct > 0
      ? (h + s) * (contPct / 100)
      : 0;
    return { land: l, hard: h, soft: s, contingency, total: l + h + s + contingency };
  }

  /**
   * IRR by bisection on NPV. `flows[i]` is the cash flow at period i (period 0
   * is today, undiscounted).
   *
   * No dependency, and bisection rather than Newton on purpose: Newton is
   * faster and can diverge on the irregular sign patterns a real draw schedule
   * produces, while bisection cannot — it either brackets a root or reports
   * that it could not. This function is allowed to say "I don't know".
   *
   * Returns the PERIODIC rate as a decimal, or null when there is no sign
   * change (every conventional project has one; a series with none has no
   * meaningful IRR and must not be handed a number).
   */
  function irr(flows, { tolerance = 1e-9, maxIterations = 200 } = {}) {
    const f = Array.isArray(flows) ? flows.filter((x) => Number.isFinite(x)) : [];
    if (f.length < 2) return null;
    const hasNeg = f.some((x) => x < 0);
    const hasPos = f.some((x) => x > 0);
    if (!hasNeg || !hasPos) return null;

    const npv = (rate) => f.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);

    // Convergence is measured on the RATE, not on the NPV, because NPV is
    // denominated in the project's own dollars: an absolute NPV tolerance that
    // is tight on a $600k build is loose on a $600M one, so the answer would
    // quietly get less accurate as projects got bigger. A rate bracket is
    // scale-free. The NPV test that remains is scaled to the largest flow for
    // the same reason.
    const scale = Math.max(...f.map((x) => Math.abs(x)), 1);

    // Bracket: -99.99% (total loss) up to 100x per period. A project outside
    // that is not a project, and the upper bound keeps the loop finite.
    let lo = -0.9999, hi = 100;
    let nLo = npv(lo);
    const nHi = npv(hi);
    if (!Number.isFinite(nLo) || !Number.isFinite(nHi)) return null;
    if (nLo * nHi > 0) return null;                    // no root in range

    for (let i = 0; i < maxIterations; i++) {
      const mid = (lo + hi) / 2;
      const nMid = npv(mid);
      if (!Number.isFinite(nMid)) return null;
      if (Math.abs(nMid) < tolerance * scale || (hi - lo) / 2 < tolerance) return mid;
      // Keep the half that still brackets the sign change, and carry that
      // half's own NPV forward. (`nLo = mid && nMid` was written here first
      // and is wrong: it collapses to 0 when mid is exactly 0, which un-brackets
      // the root and walks the search off in the wrong direction.)
      if (nLo * nMid <= 0) { hi = mid; } else { lo = mid; nLo = nMid; }
    }
    return (lo + hi) / 2;
  }

  /**
   * The monthly cash-flow series for a straight-line, all-cash build.
   *
   * Land closes at month 0. Hard, soft and contingency spread evenly across
   * the build. The exit lands in the SAME month as the final draw, which is
   * the honest simplification: a sale the day construction finishes. Lease-up
   * is not modeled (see the header), and pretending otherwise by padding
   * months would invent a stabilization period nobody entered.
   */
  function cashflows(cost, buildMonths, exitValue) {
    const n = months(buildMonths);
    const exit = money(exitValue);
    if (!cost || cost.total == null || n == null || exit == null) return null;
    const perMonth = (cost.hard + cost.soft + cost.contingency) / n;
    const flows = [];
    flows.push(-cost.land);
    for (let m = 1; m <= n; m++) flows.push(-perMonth);
    flows[flows.length - 1] += exit;
    return flows;
  }

  /**
   * The whole scorecard. Every figure independently gated on its own inputs;
   * anything unavailable comes back null with a `missing` list naming what a
   * reader would have to enter to see it, so the screen can ask for the one
   * number it needs instead of showing a blank card.
   *
   * `stabilizedValue` is the report's own valuation (the hero's Likely, or a
   * cap-rate value) — this module never computes a property value, because
   * valuation.js already does and a second opinion would be a second answer.
   * `stabilizedNoi` is the owner's own NOI, private and browser-held.
   * `marketCapPct` is the model's market cap rate, for the spread.
   */
  function summarize(input) {
    const i = input && typeof input === "object" ? input : {};
    const cost = totalCost(i.cost);
    const value = money(i.stabilizedValue);
    const noi = money(i.stabilizedNoi);
    const capPct = pct(i.marketCapPct);
    const buildMonths = months(i.cost && i.cost.buildMonths);
    const sizeSqft = money(i.sizeSqft);

    const missing = [];
    if (cost.total == null) missing.push("project costs");
    if (value == null) missing.push("a stabilized value");

    const out = {
      cost,
      buildMonths,
      stabilizedValue: value,
      // Cost and value per square foot — how a developer sanity-checks a
      // budget against the market before any return is computed.
      costPerSqft: cost.total != null && sizeSqft ? cost.total / sizeSqft : null,
      valuePerSqft: value != null && sizeSqft ? value / sizeSqft : null,
      profit: null,
      profitOnCostPct: null,
      yieldOnCostPct: null,
      spreadBps: null,
      irrPct: null,
      missing,
    };

    if (cost.total != null && value != null) {
      out.profit = value - cost.total;
      // Guarded: a zero-cost project would divide by zero and report Infinity,
      // which formats as a persuasive-looking dash-or-nonsense on screen.
      out.profitOnCostPct = cost.total > 0 ? (out.profit / cost.total) * 100 : null;
    }

    // Yield on cost is the development metric — stabilized NOI over what it
    // cost to create, versus what the market pays for the same income.
    if (noi != null && cost.total != null && cost.total > 0) {
      out.yieldOnCostPct = (noi / cost.total) * 100;
      if (capPct != null && capPct > 0) {
        // In basis points, because that is the unit the decision is made in:
        // a developer wants 100-150bps of spread over the market cap rate to
        // be paid for the risk of building rather than buying.
        out.spreadBps = Math.round((out.yieldOnCostPct - capPct) * 100);
      }
    } else if (noi == null) {
      missing.push("a stabilized NOI");
    }

    const flows = cashflows(cost, buildMonths, value);
    if (flows) {
      const monthly = irr(flows);
      // Annualize the periodic (monthly) rate by compounding. Multiplying by
      // 12 understates every return here and would make short builds look
      // worse than long ones, which is backwards.
      if (monthly != null) out.irrPct = (Math.pow(1 + monthly, 12) - 1) * 100;
    } else if (buildMonths == null) {
      missing.push("a build length in months");
    }

    return out;
  }

  /**
   * Roll several projects into one portfolio line. Sums only what is actually
   * present — bulk.js's rule — and says how many projects it could not price,
   * so a total is never read as covering more than it does.
   *
   * Yield on cost is recomputed from the SUMS rather than averaged: averaging
   * percentages across projects of different sizes is simply the wrong number,
   * and a small project with a wild yield would swing a portfolio's headline.
   */
  function rollup(summaries) {
    const list = Array.isArray(summaries) ? summaries.filter(Boolean) : [];
    let cost = 0, value = 0, noi = 0;
    let costed = 0, valued = 0, incomed = 0;
    for (const s of list) {
      if (s.cost && s.cost.total != null) { cost += s.cost.total; costed++; }
      if (s.stabilizedValue != null) { value += s.stabilizedValue; valued++; }
      if (s.stabilizedNoi != null) { noi += s.stabilizedNoi; incomed++; }
    }
    const bothPriced = costed > 0 && valued > 0;
    return {
      projects: list.length,
      costed, valued,
      // Named for what they are: the total of what was priceable, not of
      // everything. A caller that shows "total cost" over a partial count
      // without saying so is the failure this shape exists to prevent.
      totalCost: costed ? cost : null,
      totalValue: valued ? value : null,
      totalProfit: bothPriced ? value - cost : null,
      profitOnCostPct: bothPriced && cost > 0 ? ((value - cost) / cost) * 100 : null,
      yieldOnCostPct: incomed && costed && cost > 0 ? (noi / cost) * 100 : null,
      unpriced: list.length - Math.min(costed, valued),
    };
  }

  return { money, pct, months, totalCost, irr, cashflows, summarize, rollup };
});
