// Shared market-snapshot distillation: turns one /api/comps response into the
// market-seed entry shape that renderMarketPageHTML consumes. Used by BOTH
// gen-market-seed.js (the curated seed script) and server.js's on-demand
// /api/explore-market endpoint — keep it dependency-free.
//
// DUAL-EXPORTED since 2026-08-21 (Node for the two callers above and npm test,
// a browser global `MARKETSNAP` for index.html), like valuation.js,
// gut-check.js and explore-query.js, and served with the same maxAge: 0 rule
// for the same reason: a stale copy against a newer index.html is the failure
// nobody detects.
//
// WHY the browser needs it. A leases-only report headlines a rent range, and
// that range is rentFromComps — the same function the market pages have used
// since 2026-08-19. The report recomputes it on every render because a reader
// can exclude a comp, so the figure cannot be computed once on the server and
// shipped; and a second copy of leaseRentPsfYr in index.html would be a second
// answer to "is this rate monthly or annual", which is exactly the parse that
// function exists to get right.
//
// The body below is deliberately NOT re-indented into the factory. The wrapper
// is the entire change, and a 270-line whitespace diff would bury it.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MARKETSNAP = api;
})(typeof self !== "undefined" ? self : this, function () {

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Markets with fewer priced sale comps than this are never PUBLISHED (the
// explorer may still show them as an ephemeral preview).
const MIN_PRICED_SALE_COMPS = 3;

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : NaN;
}

function pct(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const r = (p / 100) * (n - 1);
  const lo = Math.floor(r), hi = Math.ceil(r);
  return lo === hi ? sorted[lo] : sorted[lo] + (r - lo) * (sorted[hi] - sorted[lo]);
}

// "Mar 2026" -> sortable integer (year*12 + month). NaN if unparseable.
function dateKey(s) {
  const m = String(s || "").toLowerCase().match(/([a-z]{3})[a-z]*\s+(\d{4})/);
  if (!m || !(m[1] in MONTHS)) return NaN;
  return Number(m[2]) * 12 + MONTHS[m[1]];
}

function slugify(type, city, state) {
  return `${type}-${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Keys a market page never shows, and which would bloat every stored payload.
// `notes` is the long one. `source_url` used to live here too (2026-07-27);
// it is kept as of 2026-08-14 so an analyst can cite a row, sanitized below.
// `cap_rate`, `tenancy` and `year_built` are deliberately NOT dropped — they
// render when any comp carries a value, and stay stored so a seed page that
// later gains them does not need another regeneration.
// `verified_by`/`verified_by_slug` go too: attachVerifiedAttribution writes the
// contributing broker's firm name and profile slug onto comps before a snapshot
// is distilled, and no market page renders either. Keeping them would persist
// dead attribution into market-seed.json — a committed file — and fossilise a
// profile slug that the broker may later un-publish.
const COMP_DROP_KEYS = new Set([
  "notes", "lat", "lng", "verified", "verified_by", "verified_by_slug",
]);

// http/https only, no embedded credentials. A model-supplied string becomes an
// href on a public page, so javascript:/data:/bare paths store as "" rather
// than becoming an active URL. Spec:
// docs/superpowers/specs/2026-08-14-market-page-analyst-research-design.md
function safeHttpUrl(s) {
  const raw = String(s == null ? "" : s).trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return u.href;
  } catch (_) {
    return "";
  }
}

function isLease(c) {
  return String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

// Annual $/SF/yr for a lease row.
//
// THE RATE STRING OUTRANKS price_per_sqft, and that ordering is the whole
// function. `price_per_sqft` is a bare number carrying no basis of its own,
// and the prompt asks the model to put THE QUOTED RATE there - which in
// California industrial and retail is the MONTHLY figure. Trusting it first
// meant the same lease answered 1.08 or 12.96 depending only on which field
// it arrived in, so a two-comp market medianed to $7.02/SF/yr, a rent that
// describes nothing. Worse downstream: leaseQuoteBasis correctly reads that
// comp as monthly-quoted, so the hero divided the already-monthly 1.08 by 12
// again and printed $0.09/SF/mo.
//
// So a figure that NAMES its unit always beats one that does not:
//
//   1. an explicit /SF/yr in the rate string - it states its own unit, and is
//      also right when price_per_sqft happens to hold the other figure;
//   2. an explicit /SF/mo with no annual beside it - REFUSED. That refusal is
//      this file's existing decision and it stands; the bug was that it could
//      only ever be reached when price_per_sqft happened to be empty;
//   3. price_per_sqft, read as annual - reached only when NOTHING states a
//      basis, the one case where there is nothing better to do.
//
// The figure stays annual throughout, which is broker-vault.js's rule
// (migration 029) and its reason: a book holding two bases quotes three
// different rents for one lease. leaseQuoteBasis below is the DISPLAY half
// and converts for reading only.
function leaseRentPsfYr(c) {
  const raw = String((c && c.price_or_rate) || "");
  const yr = raw.match(RATE_PER_YEAR);
  if (yr) {
    const n = num(yr[1]);
    if (n > 0) return n;
  }
  // A monthly quote with no annual figure beside it is REFUSED, not converted
  // and not fallen through. Refusing is this file's existing decision and it
  // stands; what was broken is that the refusal was reachable only when
  // price_per_sqft happened to be empty. With the bare number consulted first,
  // a monthly-quoted comp that carried one returned the monthly rate as an
  // annual band - the 12x error - which is exactly what the refusal below
  // exists to prevent.
  if (RATE_PER_MONTH.test(raw)) return NaN;
  const fromPsf = num(c && c.price_per_sqft);
  return fromPsf > 0 ? fromPsf : NaN;
}

// Which basis a market QUOTES in, read off the comps instead of guessed.
//
// The FIGURE is always annual and stays that way: leaseRentPsfYr normalizes on
// the way in and rentFromComps medians one canonical number, which is
// broker-vault.js's rule (migration 029) and for its reason — a book holding
// two bases quotes three different rents for one lease.
//
// This is the DISPLAY half of that same rule. California industrial and retail
// quote rent MONTHLY while most of the country quotes annually, so $1.35/SF is
// an ordinary monthly rent and an impossible annual one, and a report that
// says "$16.20/SF/yr" in Fontana is quoting a number nobody there says out
// loud. The vault REFUSES to default the basis because it is writing a stored
// figure and a wrong guess is 12x wrong forever. Nothing is stored here and
// the annual figure is already right, so falling back to annual is safe rather
// than a guess: it is at worst unidiomatic, never incorrect. That asymmetry is
// the whole reason this function may have a default and parseRentBasis may not.
//
// EVIDENCE ONLY. A comp carrying a bare numeric price_per_sqft states no basis
// and votes for neither. And the LEADING quote wins: "$1.08/SF/month NNN
// ($12.96/SF/yr NNN)" is a monthly-quoted comp with an annual parenthetical,
// not one vote each.
// The same two shapes as PER_MONTH / PER_YEAR below, with the number
// captured. Kept as one pair of constants rather than four inline literals so
// "what counts as a monthly quote" has a single answer for the figure and for
// the basis - they disagreeing is how a rate gets read in one unit and
// displayed in the other.
const RATE_PER_YEAR = /([\d,.]+)\s*\/\s*sf\s*\/\s*(?:yr\b|year)/i;
const RATE_PER_MONTH = /([\d,.]+)\s*\/\s*sf\s*\/\s*(?:mo\b|month)/i;

const PER_MONTH = /\/\s*sf\s*\/\s*(mo\b|month)/i;
const PER_YEAR = /\/\s*sf\s*\/\s*(yr\b|year)/i;
function leaseQuoteBasis(comps) {
  let monthly = 0, annual = 0;
  for (const c of (comps || [])) {
    if (!isLease(c)) continue;
    const raw = String((c && c.price_or_rate) || "");
    const m = raw.search(PER_MONTH), y = raw.search(PER_YEAR);
    if (m === -1 && y === -1) continue;
    if (m !== -1 && (y === -1 || m < y)) monthly++;
    else annual++;
  }
  return monthly > annual ? "monthly" : "annual";
}

// ≥2 priced leases or null — under-claim, never a one-comp "band".
function rentFromComps(comps) {
  const vals = (comps || []).filter(isLease).map(leaseRentPsfYr).filter((v) => v > 0).sort((a, b) => a - b);
  if (vals.length < 2) return null;
  return {
    count: vals.length,
    median: Math.round(pct(vals, 50) * 100) / 100,
    low: Math.round(pct(vals, 25) * 100) / 100,
    high: Math.round(pct(vals, 75) * 100) / 100,
  };
}

// Both ends required, matching how the page already treats cap_rate_low/high.
function opexRangeFrom(data) {
  const r = data && data.market_opex_range;
  if (!r || typeof r !== "object") return null;
  const low = String(r.low || "").trim();
  const high = String(r.high || "").trim();
  if (!low || !high) return null;
  return { low, high, note: String(r.note || "").trim().slice(0, 120) };
}

// The market's momentum as ONE of three words, or null. The model already
// answers this on every search — `price_discovery.direction` is constrained to
// exactly "expanding" / "flat" / "contracting" by the prompt (server.js), and
// fills on roughly 5 searches in 6 — but the snapshot shape dropped it, so no
// market page has ever carried a direction. Read here so the Explorer can show
// one without a second question to the model.
//
// An unrecognized word is null, never passed through: this string reaches the
// Explorer dropdown as a COLOR (green / grey / red), and a colour is a claim.
// Null renders no badge at all, which is the same under-claim rule the rent
// band and the opex range already follow.
const DIRECTIONS = new Set(["expanding", "flat", "contracting"]);
function directionFrom(data) {
  const pd = data && data.price_discovery;
  if (!pd || typeof pd !== "object") return null;
  const d = String(pd.direction || "").trim().toLowerCase();
  return DIRECTIONS.has(d) ? d : null;
}

// How long a stored direction is allowed to speak for the market it names.
//
// "Expanding" is a claim about RIGHT NOW — a direction of travel — while a
// median $/SF is a claim about a stated window of past sales. So the two age
// differently, and the badge is the one that needs an expiry. The market page
// can afford to show July's medians because it prints "Updated <date>" directly
// above them; the Explorer dropdown, which is where this badge renders, shows
// no date at all.
//
// 90 days rather than 30: these pages only move when someone deliberately
// regenerates them, and the seeded set routinely sits well over a month between
// runs, so a tighter window would leave the badge dark on most markets most of
// the time. An expired direction renders NOTHING, which is what an Explorer row
// already looks like — it degrades to the familiar, not to a warning.
const DIRECTION_MAX_AGE_DAYS = 90;

// The direction a page may still show today, or null. Pure and clock-free —
// `nowMs` is passed in, the same way isBetterSnapshot compares two stamps
// rather than reading a clock — so `npm test` can pin the boundary exactly.
//
// A snapshot with no readable `generatedAt` has an UNKNOWN age, and unknown is
// not young: it returns null rather than assuming the read is current.
function freshDirection(snapshot, nowMs) {
  const d = String((snapshot && snapshot.direction) || "").trim().toLowerCase();
  if (!DIRECTIONS.has(d)) return null;
  const stamp = Date.parse(`${String((snapshot && snapshot.generatedAt) || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(stamp)) return null;
  const ageDays = (nowMs - stamp) / 86400000;
  return ageDays > DIRECTION_MAX_AGE_DAYS ? null : d;
}

// Same bounds as report-parse.js normalizeTrendPct (±30%/yr, refuse 0). Copied
// rather than imported so this file stays dependency-free for gen-market-seed.
function trendPctFrom(data) {
  const v = Number(String((data && data.annual_price_trend_pct) ?? "").replace(/%/g, "").trim());
  return Number.isFinite(v) && v !== 0 && Math.abs(v) <= 30 ? v : null;
}

// Deliberately a DENYLIST, not an allowlist. The per-type comp fields live in
// TYPE_COMP_FIELDS in server.js, and server.js already requires this file — so
// importing that list here would be circular, and gen-market-seed.js would need
// it too. Keeping everything except the bulky keys means a future comp field
// needs no change here at all.
function trimComp(c) {
  const out = {};
  for (const k of Object.keys(c || {})) {
    if (COMP_DROP_KEYS.has(k)) continue;
    if (k === "source_url") {
      out[k] = safeHttpUrl(c[k]);
      continue;
    }
    out[k] = c[k] == null ? "" : String(c[k]);
  }
  return out;
}

// Distill a comps response into a market-page snapshot. Returns
// { snapshot, pricedSaleCount }; snapshot is null when there are ZERO priced
// sale comps (the $/SF tiles would be unrenderable). The ≥MIN_PRICED_SALE_COMPS
// publish gate is the CALLER's job — the explorer shows 1-2-comp snapshots as
// previews, while gen-market-seed drops them entirely.
function distillMarketSnapshot(t, data) {
  const comps = Array.isArray(data.comps) ? data.comps : [];

  // Sale comps only for pricing stats — lease $/SF/yr is a different unit.
  const saleComps = comps.filter((c) => !String(c.transaction || "").toLowerCase().startsWith("lease"));
  const ppsfVals = saleComps.map((c) => num(c.price_per_sqft)).filter((v) => v > 0).sort((a, b) => a - b);
  if (!ppsfVals.length) return { snapshot: null, pricedSaleCount: 0 };

  const keys = comps.map((c) => dateKey(c.date)).filter((k) => isFinite(k));
  const fmtKey = (k) => `${Object.keys(MONTHS)[k % 12].replace(/^./, (c) => c.toUpperCase())} ${Math.floor(k / 12)}`;
  const dateRange = keys.length ? `${fmtKey(Math.min(...keys))} – ${fmtKey(Math.max(...keys))}` : "";

  const snapshot = {
    type: t.type,
    city: t.city,
    state: t.state,
    generatedAt: new Date().toISOString().slice(0, 10),
    summary: String(data.summary || "").trim(),
    market_trend: String(data.market_trend || "").trim(),
    value_drivers: Array.isArray(data.value_drivers)
      ? data.value_drivers.map((d) => String(d || "").trim()).filter(Boolean).slice(0, 4)
      : [],
    cap_rate_low: (data.market_cap_rate_range && data.market_cap_rate_range.low) || "",
    cap_rate_high: (data.market_cap_rate_range && data.market_cap_rate_range.high) || "",
    ppsf: {
      count: ppsfVals.length,
      median: Math.round(pct(ppsfVals, 50)),
      low: Math.round(pct(ppsfVals, 25)),
      high: Math.round(pct(ppsfVals, 75)),
      min: Math.round(ppsfVals[0]),
      max: Math.round(ppsfVals[ppsfVals.length - 1]),
    },
    date_range: dateRange,
    comps: comps.slice(0, 8).map(trimComp),
  };
  const opex = opexRangeFrom(data);
  if (opex) snapshot.market_opex_range = opex;
  const trend = trendPctFrom(data);
  if (trend != null) snapshot.annual_price_trend_pct = trend;
  const direction = directionFrom(data);
  if (direction) {
    snapshot.direction = direction;
    // Provenance. A direction can also be DERIVED from a page's own
    // market_trend sentence for pages built before this field existed
    // (scripts/derive-market-direction.js, which stamps "market_trend").
    // Recording which is which is what lets that script skip a page whose read
    // came from the search itself, and what stops a second-hand read being
    // mistaken for a first-hand one months from now.
    snapshot.direction_source = "price_discovery";
  }
  const rent = rentFromComps(comps);
  if (rent) snapshot.rent = rent;
  return { snapshot, pricedSaleCount: ppsfVals.length };
}

// Should `candidate` replace the snapshot a market page is serving today?
//
// Market pages were write-once in practice. The 27 curated seed pages were all
// stamped 2026-07-14 and could never move: the piggyback publisher skipped any
// slug a seed owned, and reads preferred the seed unconditionally. Since
// `generatedAt` is also the sitemap's `lastmod`, they aged in public.
//
// The rule is deliberately conservative, because these are the public SEO
// surface and a bad swap is worse than a stale page: replace ONLY when the
// candidate is strictly better on BOTH axes it is judged on — genuinely newer,
// and not built on fewer priced sales. "At least as good, and fresher" can
// only improve a page; anything looser could trade a twelve-comp snapshot for
// a three-comp one and call it an update.
//
// Pure and dateless on purpose (it compares the two stamps rather than reading
// a clock) so `npm test` can exercise it with no server and no database.
function isBetterSnapshot(candidate, current) {
  if (!candidate || !candidate.generatedAt) return false;
  if (!current || !current.generatedAt) return true;   // nothing to lose
  if (String(candidate.generatedAt) <= String(current.generatedAt)) return false;
  const n = (s) => (s && s.ppsf && Number(s.ppsf.count)) || 0;
  return n(candidate) >= n(current);
}

return {
  MIN_PRICED_SALE_COMPS, slugify, distillMarketSnapshot, isBetterSnapshot,
  dateKey, safeHttpUrl, isLease, leaseRentPsfYr, leaseQuoteBasis, rentFromComps,
  opexRangeFrom, trendPctFrom, directionFrom, DIRECTIONS,
  freshDirection, DIRECTION_MAX_AGE_DAYS,
};

});
