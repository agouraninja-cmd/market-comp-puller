// ---------------------------------------------------------------------------
// Comp gating — which comps a visitor actually receives, and what stands in
// for the ones they don't.
//
// The rule this enforces: the itemized LIST is gated, the VALUATION is not.
// A free report shows 10 comps but its headline value range is computed from
// every comp the search found, because an inaccurate free number would cost
// more in credibility than the tier earns in subscriptions.
//
// That is why gateReport() returns two things: the visible comps in full, and
// a `locked_basis` array of anonymized rows carrying ONLY what the valuation
// arithmetic needs — $/SF, size, date, transaction, provenance tier. No
// address, no total price, no source URL, no notes, no coordinates. A basis
// row is a bar on a histogram: it cannot be resold, cited, or tied to a
// property. (Known and accepted tradeoff: $/SF x size implies a sale price.
// Without an address that figure is unattributable, and both fields are
// required for the free number to match the Pro number exactly — the whole
// point of shipping the basis at all.)
//
// Pure and dependency-free, like entitlements.js, so `npm test` can prove the
// gate holds without a database or a network.
// ---------------------------------------------------------------------------

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// ⚠ MIRRORS index.html's compWeight/TIER_WEIGHT/numericValue. The client
// still owns the valuation math (it must keep working offline on saved
// reports), so this is a second copy on purpose — and the two must agree, or
// a free user's range would differ from a Pro user's on identical comps.
// Change one, change the other, and run `npm test`.
// (broker_vault: a blended private comp, full weight — see valuation.js's
// comment for why the key has to exist at all.)
const TIER_WEIGHT = { verified: 1, user: 1, public_record: 1, listing: 0.85, news: 0.7, estimate: 0.5, broker_vault: 1 };

function numericValue(str) {
  if (str == null) return NaN;
  const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function isVerified(c) {
  return c.verified === true || String(c.verified).toLowerCase() === "true";
}

function tierOf(c) {
  if (isVerified(c)) return "verified";
  return TIER_WEIGHT[c.source_type] ? c.source_type : null;
}

function isLease(c) {
  return String(c.transaction || "").toLowerCase().startsWith("lease");
}

// A sale comp's $/SF, with the same price/size fallback the client uses.
function salePsf(c) {
  const v = numericValue(c.price_per_sqft);
  if (v > 0) return v;
  const p = numericValue(c.price_or_rate), s = numericValue(c.size_sqft);
  if (p > 0 && s > 0) {
    const d = p / s;
    if (d >= 1 && d <= 100000) return d;
  }
  return NaN;
}

function compAgeYears(c, asOfMs) {
  const d = Date.parse(c.date);
  if (isNaN(d)) return null;
  const yrs = (asOfMs - d) / YEAR_MS;
  return yrs > 0 ? Math.min(yrs, 5) : 0;
}

// Recency x size fit x provenance, floored at 0.15. See the mirror warning
// above before editing.
function compWeight(c, asOfMs, subjectSqft) {
  let w = 1;
  const age = compAgeYears(c, asOfMs);
  if (age !== null) w *= Math.pow(0.5, age / 2);
  const compSF = numericValue(c.size_sqft);
  if (subjectSqft > 0 && compSF > 0) {
    const octaves = Math.abs(Math.log2(compSF / subjectSqft));
    if (octaves > 1) w *= Math.pow(0.5, octaves - 1);
  }
  const tier = tierOf(c);
  if (tier && TIER_WEIGHT[tier] != null) w *= TIER_WEIGHT[tier];
  return Math.max(0.15, w);
}

/**
 * Choose which comps a limited visitor sees.
 *
 * Sales fill the free slots before leases. The headline valuation is computed
 * from sale comps only (lease $/SF/yr is a different unit), so a free report
 * showing four leases under a sales-derived number would look like it was
 * making the number up. Leases only fill slots sales cannot.
 *
 * Within each group, best-first by compWeight — the same ranking the
 * valuation already trusts, so "the 4 shown" are the 4 that moved the number
 * most, not the first 4 the model happened to name.
 */
function selectVisible(comps, limit, { asOfMs = Date.now(), subjectSqft = 0 } = {}) {
  const all = Array.isArray(comps) ? comps.slice() : [];
  if (!Number.isFinite(limit) || limit >= all.length) return { visible: all, locked: [] };
  if (limit <= 0) return { visible: [], locked: all };

  // Stable: index breaks weight ties so the same report always gates the same
  // way (a cached report re-gated on a later request must not reshuffle).
  const scored = all.map((c, i) => ({ c, i, w: compWeight(c, asOfMs, subjectSqft), lease: isLease(c) }));
  const byRank = (a, b) => (b.w - a.w) || (a.i - b.i);
  const sales = scored.filter((x) => !x.lease).sort(byRank);
  const leases = scored.filter((x) => x.lease).sort(byRank);

  const picked = sales.concat(leases).slice(0, limit);
  const pickedSet = new Set(picked.map((x) => x.i));
  return {
    // Report order is preserved for whatever the visitor does see — the table
    // sorts itself client-side, and renumbering would confuse saved reports.
    visible: all.filter((_, i) => pickedSet.has(i)),
    locked: all.filter((_, i) => !pickedSet.has(i)),
  };
}

// The anonymized stand-in for a locked comp: the arithmetic, nothing else.
// Explicitly an allow-list — a new per-type comp field must be added here
// deliberately, never inherited by a spread.
function basisRow(c) {
  const row = {
    date: c.date || "",
    transaction: c.transaction || "",
    size_sqft: c.size_sqft || "",
    source_type: c.source_type || "",
  };
  const psf = salePsf(c);
  // Precomputed so a basis row never needs price_or_rate (the sale price is
  // the one figure that must not travel).
  if (psf > 0) row.price_per_sqft = String(Math.round(psf));
  if (isVerified(c)) row.verified = true;
  // Multifamily and Land are quoted per unit / per acre, and the hero's
  // cross-check reads these off the comps. Both are already per-something
  // figures, so they carry no more than $/SF does.
  if (c.price_per_unit) row.price_per_unit = c.price_per_unit;
  if (c.price_per_acre) row.price_per_acre = c.price_per_acre;
  return row;
}

/**
 * Apply an entitlement to a finished report.
 *
 * Returns a NEW report object — the caller's copy (the one that gets cached
 * and harvested) must stay complete. Gating is a serialization-time concern:
 * the cache stores full reports so one cached search can serve free and Pro
 * visitors alike.
 *
 * @param {object} report  a parsed report ({ comps, ... })
 * @param {object} ent     from getEntitlements()
 */
function gateReport(report, ent, { asOfMs = Date.now(), subjectSqft = 0 } = {}) {
  if (!report || !Array.isArray(report.comps)) return report;
  const limit = !ent || ent.maxComps === "all" ? Infinity : Number(ent.maxComps);
  if (!Number.isFinite(limit) || limit >= report.comps.length) {
    return { ...report, locked_count: 0 };
  }
  const { visible, locked } = selectVisible(report.comps, limit, { asOfMs, subjectSqft });
  return {
    ...report,
    comps: visible,
    // The count is the conversion driver — "14 more comparables available
    // with Pro" only works if we say the number out loud.
    locked_count: locked.length,
    locked_basis: locked.map(basisRow),
  };
}

module.exports = { gateReport, selectVisible, basisRow, compWeight, salePsf, numericValue, TIER_WEIGHT };
