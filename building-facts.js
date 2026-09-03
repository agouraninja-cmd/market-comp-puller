// ---------------------------------------------------------------------------
// Building-level facts in the broker vault: the building remembers.
//
// Spec: docs/superpowers/specs/2026-09-03-vault-building-facts-design.md
// Migration: migrations/050-broker-property-facts.sql
//
// PURE, and dual-exported exactly like gut-check.js and valuation.js: Node
// gets a CommonJS module (so npm test exercises every rule), the browser gets
// the global BFACTS (so /vault prefills from the SAME rule the server fills
// with — a second copy of "which fields inherit" is how a tested number and a
// rendered number quietly diverge).
//
// Every fact in the vault is stored on the DEAL, but most of the facts a
// broker types are about the BUILDING: year built, clear height, unit count,
// lot acres, zoning, class. A broker with three deals on one building typed
// the year built three times, and the deal where they skipped it counted for
// nothing in any median. This file decides two things and nothing else:
//
//   deriveFacts(comps)      what one building's deals AGREE on
//   applyFacts(comp, facts) what an EMPTY cell on one deal may inherit
//
// Direction of data: a broker's own deals in, their own deals out. Nothing in
// this file sees the database, another account, or the public corpus.
//
// TWO RULES A FUTURE EDITOR WILL OTHERWISE BREAK:
//
//   1. Inheritance is READ-TIME ONLY. applyFacts returns a copy and writes
//      nothing; broker_comps keeps exactly what the broker stated on that
//      deal. That is what keeps an export stated-only (export then re-import
//      cannot turn a derived value into a stated one), keeps a published comp
//      a claim somebody actually made, and lets one correction move every
//      sibling's view with no second write to chase.
//
//   2. Disagreement is a CONFLICT, never a winner. Two deals saying 12 and 14
//      dock doors serve no value and name both. The vault's stance everywhere
//      is refuse rather than guess, and a quietly chosen year built is a guess
//      nobody would notice. anchor_tenant is the one exception (a center
//      genuinely changes anchors) and it says so below.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BFACTS = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The facts that are the building's: the same on every deal on that
  // building, whoever did the deal and whenever. Everything else on a comp is
  // the deal's (price, date, cap rate, rent and its basis, lease terms,
  // tenancy — "Single tenant" describes the building at the time of THAT
  // deal — and notes) and never moves.
  //
  // size_sqft is the one that would do damage if it moved carelessly: on a
  // SALE it is the building, on a LEASE it is the suite, and a 4,000 SF suite
  // in a 60,000 SF center is a real, correct row. So it is derived from sale
  // rows only and offered to sale rows only (SALE_ONLY below).
  //
  // The add-comp-field skill's checklist names this list: a new per-type
  // field has to be placed on one side or the other, deliberately.
  const BUILDING_FIELDS = Object.freeze([
    "year_built",
    "size_sqft",
    "clear_height", "dock_doors",
    "building_class", "floor_plate",
    "center_type", "anchor_tenant",
    "units",
    "lot_acres", "zoning",
    "beds_baths",
  ]);

  // Derived from sales only, inherited onto sales only.
  const SALE_ONLY = Object.freeze(["size_sqft"]);

  // The one field where disagreement has a winner: a center genuinely changes
  // anchors, so the most recent dated deal's value stands and the others are
  // listed as prior rather than as a conflict.
  const RECENT_WINS = Object.freeze(["anchor_tenant"]);

  // Deal-level fields, named so a test can hold the two lists apart: every
  // column broker_comps carries must be on exactly one side.
  const DEAL_FIELDS = Object.freeze([
    "address", "property_type", "transaction", "deal_date",
    "price", "price_per_sqft", "cap_rate",
    "rent_psf", "rent_basis", "lease_type", "rent_psf_yr",
    "lease_expiry", "option_notice_date",
    "tenancy", "notes",
    "price_per_unit", "price_per_acre",
  ]);

  function isEmpty(v) {
    return v === null || v === undefined || String(v).trim() === "";
  }

  // The key two values are compared on. Numbers compare as numbers (28 and
  // "28.0" agree); text compares after trim and case-fold ("28 ft" and
  // "28 FT" agree). The value SERVED is the one as typed on the most recent
  // deal, so a broker's own spelling is what comes back to them.
  function compareKey(v) {
    const s = String(v).trim();
    const n = Number(s);
    if (s !== "" && Number.isFinite(n)) return "n:" + String(n);
    return "s:" + s.toLowerCase();
  }

  // Newest dated deal first; an undated deal sorts last. The same rule
  // broker-properties.js's isMoreRecent applies to the descriptive fields.
  function byRecency(a, b) {
    const da = a && a.deal_date ? String(a.deal_date) : "";
    const db = b && b.deal_date ? String(b.deal_date) : "";
    if (da === db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da > db ? -1 : 1;
  }

  /**
   * What one building's deals agree on.
   *
   *   { values: { field: value }, conflicts: { field: [v1, v2] },
   *     prior: { field: [older values] }, derived_at: iso }
   *
   * A field is in values OR conflicts, never both; a field no deal states is
   * in neither. Blank is not a vote: a deal that omits a field neither agrees
   * nor disagrees. size_sqft reads sale rows only.
   */
  function deriveFacts(comps, opts) {
    const now = opts && opts.now instanceof Date ? opts.now : new Date();
    const list = (Array.isArray(comps) ? comps : [])
      .filter((c) => c && typeof c === "object")
      .slice().sort(byRecency);
    const values = {};
    const conflicts = {};
    const prior = {};

    for (const field of BUILDING_FIELDS) {
      const saleOnly = SALE_ONLY.includes(field);
      // Distinct values in order of recency, keyed on the comparison key so
      // "28 ft" and "28 FT" are one vote.
      const seen = new Map();
      for (const c of list) {
        if (saleOnly && String(c.transaction || "").toLowerCase() !== "sale") continue;
        const v = c[field];
        if (isEmpty(v)) continue;
        const k = compareKey(v);
        if (!seen.has(k)) seen.set(k, typeof v === "string" ? v.trim() : v);
      }
      if (!seen.size) continue;
      const distinct = [...seen.values()];
      if (distinct.length === 1) { values[field] = distinct[0]; continue; }
      if (RECENT_WINS.includes(field)) {
        values[field] = distinct[0];
        prior[field] = distinct.slice(1);
        continue;
      }
      conflicts[field] = distinct;
    }

    return { values, conflicts, prior, derived_at: now.toISOString() };
  }

  // Whether a deal may take a given building fact: everything but SALE_ONLY,
  // which a lease never takes.
  function mayInherit(comp, field) {
    if (!SALE_ONLY.includes(field)) return true;
    return String(comp && comp.transaction || "").toLowerCase() === "sale";
  }

  /**
   * One deal with its EMPTY building cells filled from the building's facts.
   *
   * Returns a COPY; the input is never touched. `inherited` names the fields
   * that were filled, and is absent (not empty) when nothing was, so a deal
   * with nothing to inherit serializes exactly as it always has. A stated
   * cell is never overwritten, which is what lets a deal that disagrees with
   * its siblings keep its own value.
   *
   * When a size is inherited onto a priced SALE with no $/SF of its own, the
   * $/SF is computed from THAT deal's own price at the same moment (the same
   * rounding normalizeRow uses) — never copied from another deal — and is
   * named in `inherited` too, so a rate cell can say where it came from.
   */
  function applyFacts(comp, facts) {
    if (!comp || typeof comp !== "object" || Array.isArray(comp)) return comp;
    const out = Object.assign({}, comp);
    const vals = facts && typeof facts === "object" && facts.values && typeof facts.values === "object"
      ? facts.values : null;
    if (!vals) return out;
    const inherited = [];
    for (const field of BUILDING_FIELDS) {
      if (isEmpty(vals[field])) continue;
      if (!isEmpty(out[field])) continue;
      if (!mayInherit(out, field)) continue;
      out[field] = vals[field];
      inherited.push(field);
    }
    if (inherited.includes("size_sqft") && isEmpty(out.price_per_sqft)) {
      const price = Number(out.price);
      const size = Number(out.size_sqft);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0) {
        out.price_per_sqft = Math.round((price / size) * 100) / 100;
        inherited.push("price_per_sqft");
      }
    }
    if (inherited.length) out.inherited = inherited;
    return out;
  }

  /**
   * The building a typed address names, if the book already holds it.
   *
   * Browser-side: the page holds the whole book, every comp on a building
   * carries that building's `facts`, and `keyOf` is the page's own copy of
   * broker-vault.js's addressKey. Returns { facts, deals, type } or null.
   * Nothing leaves the page to ask this.
   */
  function findBuilding(comps, key, keyOf) {
    if (!key || typeof keyOf !== "function") return null;
    const mine = (Array.isArray(comps) ? comps : []).filter((c) =>
      c && typeof c === "object" && keyOf(c.address) === key);
    if (!mine.length) return null;
    const withFacts = mine.find((c) => c.facts && typeof c.facts === "object");
    const newest = mine.slice().sort(byRecency)[0];
    return {
      facts: withFacts ? withFacts.facts : { values: {}, conflicts: {}, prior: {} },
      deals: mine.length,
      type: newest && newest.property_type ? String(newest.property_type) : "",
    };
  }

  return {
    BUILDING_FIELDS, SALE_ONLY, RECENT_WINS, DEAL_FIELDS,
    deriveFacts, applyFacts, findBuilding, mayInherit, isEmpty, compareKey,
  };
});
