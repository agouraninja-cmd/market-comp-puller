// ---------------------------------------------------------------------------
// Comp fit — which comps a search found are good enough to value THIS
// property, and when the set left over is too thin to report without a
// second, wider look.
//
// Why this exists (2026-11-17, a 32,000 SF industrial building at 76
// Inverness Dr E, Englewood CO): the report valued it on four comps. Two were
// 7,200 and 7,260 SF buildings (less than a quarter of its size), one was a
// condo unit ("Unit C") whose only source was a parked, for-sale domain, and
// two sat ~9 miles away in another submarket while closer sales existed. The
// prompt already ASKED for half-to-twice the size and for real sources, and
// compWeight already down-weights an off-size comp, but on a four-comp set
// down-weighting changes nothing: the median of four is still set by the two
// that should never have been there. Prompt rules are requests; this module
// is the guarantee, the same split normalizeSourceTypes makes.
//
// Four rules, each a reason a comp is SET ASIDE (kept on the report's
// `set_aside` list for the audit trail and the corpus, never valued):
//   - "dead_source": its source link was dead or a parked domain at search
//     time (link-check.js decides that; this only reads the verdicts).
//   - "unit": a condo or unit SALE ("Unit C", "Suite 200", "#4") valued
//     against a whole building. Leases of a suite are normal and kept.
//   - "size": outside HARD_SIZE_MIN..HARD_SIZE_MAX of the subject's size.
//     Deliberately wider than the prompt's 0.5x-2x ask, so the model's
//     reasonable reach is kept and only a different size class is cut.
//   - "distance": farther than FAR_MILES (or the typed radius, if larger)
//     when at least NEAR_MIN comps already sit within NEAR_MILES. A far comp
//     is only cut when closer ones are there to replace it.
//   - "price_basis" (2026-11-27): the comp's own notes say its price is not
//     an open-market price for one whole property: a portfolio or package
//     sale, a partial interest, a related-party transfer, or a foreclosure,
//     auction or other distressed sale. The prompt has always told the model
//     to put exactly those caveats first in "notes"; until this rule nothing
//     read them, so the caveat sat in a table cell while the price it warned
//     about set the range.
//
// The rules run a second time, at serialization, once saved deals have been
// blended in (refitBlended, below): until 2026-11-27 the blend added every
// saved deal of the type within ten miles with none of these rules applied,
// so a comp this module had just set aside could come straight back from the
// corpus on the next view. Every rule but the size cut, for the measured
// reason given there.
//
// The floor: size and distance never cut the set below MIN_PRICED_SALES
// priced sales. When they would, the best-fitting of those comps (closest in
// size, then nearest) come back, so a thin market still gets a number and the
// trust line's size-class warning still fires. Dead sources and unit sales
// never come back: they are not evidence about this building at all.
//
// needsWiderSearch() says when the kept set is too thin and the server should
// spend one more search on size-matched sales (server.js, getComps). It reads
// only the kept set, so the decision and the report always agree.
//
// Pure, no I/O, like comp-gate.js and link-check.js: the whole decision table
// runs under `npm test` (test/comp-fit.test.js).
// ---------------------------------------------------------------------------

"use strict";

// The types whose $/SF is set by building size. Residential has its own
// neighborhood/beds/vintage rules; Land is valued per acre of LOT; and
// Multifamily is valued per unit, so its building SF is not the yardstick.
const SIZE_TYPES = new Set(["Industrial", "Office", "Retail"]);
// Whole-building product types where a condo/unit sale is a different thing.
const UNIT_TYPES = new Set(["Industrial", "Office", "Retail", "Multifamily"]);
// Distance rule: every type but Residential (houses carry their own
// one-mile neighborhood rule in the prompt and a 1-mile free pass in
// compWeight).
const DISTANCE_EXEMPT = new Set(["Residential"]);

const HARD_SIZE_MIN = 0.4;   // 7,200 SF against 32,000 SF is 0.225
const HARD_SIZE_MAX = 2.5;
const BAND_MIN = 0.5;        // the prompt's SIZE FIT ask, and compWeight's free window
const BAND_MAX = 2;
const NEAR_MILES = 5;
const NEAR_MIN = 4;
const FAR_MILES = 8;
const MIN_PRICED_SALES = 3;
// A sale report with fewer than this many priced, in-band sales gets one
// wider search (needsWiderSearch).
const WIDER_SEARCH_BELOW = 4;

// Which set-aside comps are still real deals worth keeping in the corpus.
// A different size or a farther location is a perfectly good comp for some
// OTHER subject; a dead source or a condo unit is not one we want to store.
// "own_sale" (2026-11-27) is not a comp-fit cut at all: it is the SUBJECT's
// own sale, which came back among its comps and was taken out by the server's
// settleOwnSale because a building is not a comp of itself. It is still a
// real deal and the next building over's best comp, and until that date it
// was harvested as the comp it arrived as, so it still is.
const HARVESTABLE_REASONS = new Set(["size", "distance", "own_sale"]);

function num(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function isSale(c) {
  return !String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

function isPricedSale(c) {
  if (!c || !isSale(c)) return false;
  return num(c.price_or_rate) > 0 || num(c.price_per_sqft) > 0;
}

// A unit inside a building, not the building. Narrower than
// building-photo.js's unitDesignatorOf on purpose: "Building C" in an
// industrial park is usually a whole building, which is exactly the product a
// whole-building subject should be valued against, so "bldg"/"building" do
// NOT count here. The ZIP tail is stripped first so "CO 80112" is not "#".
const UNIT_RE = /(?:^|[\s,])(?:#\s*[a-z0-9-]+|(?:unit|units|ste|suite|apt|apartment|condo|spc|space|fl|floor|rm|room)\.?\s*[a-z0-9-]*\d[a-z0-9-]*|(?:unit|ste|suite|apt|space)\.?\s+[a-z]{1,2})(?=$|[\s,])/i;
const ZIP_TAIL_RE = /,?\s*(?:[a-z]{2}\s+)?\d{5}(?:-\d{4})?\s*$/i;
const CONDO_NOTE_RE = /\b(condo(minium)?s?|unit sale|business condo|office condo|industrial condo|flex condo)\b/i;

// "price_basis": what a comp's notes say about its price. The vocabulary is
// the prompt's own ("portfolio or partial-interest sale, related-party
// transfer, distressed or auction sale"), widened to the words those caveats
// are written in. Each pattern names the SALE, not a word that merely turns
// up in commercial property notes: "auction" alone is a tenant type (an auto
// auction yard), "portfolio" alone is where every buyer puts what it buys,
// and a tenant "in bankruptcy" is not a bankruptcy sale.
const PARTIAL_INTEREST_RE = /\b(?:partial|fractional|minority|undivided)[\s-]+(?:ownership\s+)?interest\b|\b\d{1,2}(?:\.\d+)?\s?%\s+(?:ownership\s+)?(?:interest|stake)\b/i;
const PORTFOLIO_RE = /\bportfolio[\s-]+(?:sale|deal|transaction|acquisition|trade|purchase)\b|\b(?:part|piece|one) of (?:a|an|the)\b[^.;]{0,60}\bportfolio\b|\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|multi)[\s-]+(?:property|building|asset|site)[\s-]+(?:portfolio|package)\b|\b(?:bulk|package)[\s-]+(?:sale|deal)\b|\bprice (?:is |was )?(?:an? )?allocat(?:ed|ion)\b|\ballocated (?:price|value)\b/i;
const NOT_ARMS_LENGTH_RE = /\brelated[\s-]+part(?:y|ies)\b|\bnon[\s-]+arm'?s?[\s-]+length\b|\bnot (?:an? )?arm'?s?[\s-]+length\b|\baffiliated?[\s-]+(?:transfer|sale|entity|entities|buyer|seller)\b|\b(?:intra[\s-]?family|family|internal|inter[\s-]?company)[\s-]+transfer\b|\bquit[\s-]?claim\b/i;
const DISTRESSED_RE = /\bforeclos(?:ure|ed)\b|\b(?:at|via|by|through|online)\s+auction\b|\bauction[\s-]+(?:sale|price|purchase)\b|\b(?:sold|bought|purchased|acquired|traded)\b[^.;]{0,30}\bauction\b|\bsheriff'?s?[\s-]+sale\b|\btrustee'?s?[\s-]+sale\b|\btax[\s-]+(?:sale|deed)\b|\bbank[\s-]+owned\b|\bshort[\s-]+sale\b|\bdistress(?:ed)?\b|\breceivership\b|\bbankruptcy[\s-]+(?:sale|court|auction)\b|\bout of bankruptcy\b|\bdeed[\s-]+in[\s-]+lieu\b/i;
const REO_RE = /\bREO\b/;   // case-sensitive: "Reo" is also a name
// "Not a portfolio sale", "no distress", "non-distressed": a caveat that is
// ruled OUT is not a caveat. Read off the few characters before the match.
const NEGATED_BEFORE_RE = /(?:\bnot|\bno|\bnon|\bnever|n't)[\s-]+(?:an?\s+|the\s+|part of an?\s+)?$/i;

function saysUnnegated(re, text) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(text))) {
    if (!NEGATED_BEFORE_RE.test(text.slice(Math.max(0, m.index - 24), m.index))) return true;
    if (m[0] === "") g.lastIndex += 1;
  }
  return false;
}

/**
 * What a sale comp's own notes say is wrong with its price as evidence of
 * market value: "partial_interest", "portfolio", "related_party",
 * "distressed", or null. Sales only: a lease has no sale price to doubt.
 * An asking price is NOT one of these (its date says "Active" or "Listed",
 * and the valuation weighs a listing as a listing).
 */
function priceBasisOf(c) {
  if (!c || !isSale(c)) return null;
  const notes = String(c.notes || "");
  if (!notes) return null;
  if (saysUnnegated(PARTIAL_INTEREST_RE, notes)) return "partial_interest";
  if (saysUnnegated(PORTFOLIO_RE, notes)) return "portfolio";
  if (saysUnnegated(NOT_ARMS_LENGTH_RE, notes)) return "related_party";
  if (saysUnnegated(DISTRESSED_RE, notes) || saysUnnegated(REO_RE, notes)) return "distressed";
  return null;
}

function unitOf(address) {
  const cleaned = String(address || "").replace(ZIP_TAIL_RE, "");
  const m = UNIT_RE.exec(cleaned);
  return m ? m[0].trim() : null;
}

function isUnitSale(c) {
  if (!c || !isSale(c)) return false;
  if (unitOf(c.address)) return true;
  return CONDO_NOTE_RE.test(String(c.notes || ""));
}

function sizeRatio(c, subjectSqft) {
  const s = num(c && c.size_sqft);
  if (!(subjectSqft > 0) || !(s > 0)) return NaN;
  return s / subjectSqft;
}

function inBand(c, subjectSqft) {
  const r = sizeRatio(c, subjectSqft);
  return r >= BAND_MIN && r <= BAND_MAX;
}

function distanceOf(c) {
  const d = num(c && c.distance_mi);
  return Number.isFinite(d) && d >= 0 ? d : NaN;
}

// How badly a set-aside comp fits, for choosing which to bring back under the
// floor: octaves of size difference first, then miles.
function misfit(c, subjectSqft) {
  const r = sizeRatio(c, subjectSqft);
  const octaves = r > 0 ? Math.abs(Math.log2(r)) : 0;
  const d = distanceOf(c);
  return octaves * 100 + (Number.isFinite(d) ? d : 0);
}

/**
 * Decide which comps a report keeps. MUTATES the report, like the other
 * normalizers in the pipeline: `comps` becomes the kept set, and the cut ones
 * are appended to `set_aside`, each a copy of the comp carrying `set_aside`
 * (the reason). Returns { kept, setAside, counts }.
 *
 * opts: { subjectSqft, propertyType, subjectAddress, deadUrls (Set or array
 *         of source URLs link-check called dead), radiusMiles (typed),
 *         netLease (the subject is single-tenant net leased: no size rule) }
 */
function applyCompFit(report, opts = {}) {
  const out = { kept: 0, setAside: 0, counts: {} };
  if (!report || !Array.isArray(report.comps)) return out;
  const type = String(opts.propertyType || "");
  const subjectSqft = num(opts.subjectSqft) > 0 ? num(opts.subjectSqft) : 0;
  const dead = opts.deadUrls instanceof Set ? opts.deadUrls : new Set(opts.deadUrls || []);
  const subjectIsUnit = Boolean(unitOf(opts.subjectAddress));
  const radius = num(opts.radiusMiles) > 0 ? num(opts.radiusMiles) : 0;

  const keep = [];
  const cut = [];   // { c, reason, restorable }
  for (const c of report.comps) {
    if (!c || typeof c !== "object") continue;
    // A broker-verified comp is our own record, vouched for: never second-guessed.
    if (c.verified === true) { keep.push(c); continue; }
    const url = String(c.source_url || "").trim();
    if (url && dead.has(url)) { cut.push({ c, reason: "dead_source", restorable: false }); continue; }
    if (UNIT_TYPES.has(type) && !subjectIsUnit && isUnitSale(c)) {
      cut.push({ c, reason: "unit", restorable: false }); continue;
    }
    // Every type, houses included: a foreclosure down the street is no more a
    // market price for a house than for a warehouse. A partial interest never
    // comes back under the floor (half a building's price over the whole
    // building's size is not a $/SF of anything); the others are real prices
    // of real sales, and are the last to come back when the set is too thin.
    const basis = priceBasisOf(c);
    if (basis) {
      cut.push({ c, reason: "price_basis", restorable: basis !== "partial_interest", last: true });
      continue;
    }
    // A net-leased subject (opts.netLease, valuation.js isNetLease) is valued
    // on its comps' cap rates, which building size does not set: a 1,400 SF
    // oil-change pad and a 10,000 SF pharmacy on the same lease terms trade
    // at the same rate. So the size rule does not apply, and cutting on it
    // would throw away exactly the comps that mode values from.
    // `sizeRule: false` is refitBlended's (below): the blended set is fitted
    // on everything but size, for the measured reason given there.
    if (opts.sizeRule !== false && SIZE_TYPES.has(type) && subjectSqft > 0 && !opts.netLease) {
      const r = sizeRatio(c, subjectSqft);
      if (r > 0 && (r < HARD_SIZE_MIN || r > HARD_SIZE_MAX)) {
        cut.push({ c, reason: "size", restorable: true }); continue;
      }
    }
    keep.push(c);
  }

  // Distance: only once enough near comps exist to stand in for the far ones.
  if (!DISTANCE_EXEMPT.has(type)) {
    const near = keep.filter((c) => distanceOf(c) <= NEAR_MILES).length;
    if (near >= NEAR_MIN) {
      const far = Math.max(FAR_MILES, radius);
      for (let i = keep.length - 1; i >= 0; i--) {
        const c = keep[i];
        if (c.verified === true) continue;
        if (distanceOf(c) > far) {
          cut.push({ c, reason: "distance", restorable: true });
          keep.splice(i, 1);
        }
      }
    }
  }

  // The floor: never let size/distance leave fewer than MIN_PRICED_SALES
  // priced sales. Bring back the best-fitting restorable ones.
  let priced = keep.filter(isPricedSale).length;
  const floor = Number(opts.minPricedSales) > 0 ? Number(opts.minPricedSales) : MIN_PRICED_SALES;
  if (priced < floor) {
    const back = cut
      .filter((x) => x.restorable && isPricedSale(x.c))
      // An off-size or far comp before one whose price is not a market price.
      .sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0)
        || misfit(a.c, subjectSqft) - misfit(b.c, subjectSqft));
    for (const x of back) {
      if (priced >= floor) break;
      keep.push(x.c);
      x.restored = true;
      priced += 1;
    }
  }

  // Keep the report's own order for what stays (the table numbers comps).
  const keptSet = new Set(keep);
  report.comps = report.comps.filter((c) => keptSet.has(c));
  const aside = cut.filter((x) => !x.restored);
  if (aside.length) {
    report.set_aside = (Array.isArray(report.set_aside) ? report.set_aside : [])
      .concat(aside.map((x) => ({ ...x.c, set_aside: x.reason })));
  }
  const counts = {};
  for (const x of report.set_aside || []) counts[x.set_aside] = (counts[x.set_aside] || 0) + 1;
  if (Object.keys(counts).length) report.set_aside_counts = counts;
  else delete report.set_aside_counts;
  out.kept = report.comps.length;
  out.setAside = aside.length;
  out.counts = counts;
  return out;
}

/** Priced sale comps inside the 0.5x-2x band (or any priced sale when the
 *  subject's size is unknown). */
function goodSaleCount(report, subjectSqft) {
  const comps = report && Array.isArray(report.comps) ? report.comps : [];
  const s = num(subjectSqft) > 0 ? num(subjectSqft) : 0;
  return comps.filter((c) => isPricedSale(c) && (!s || inBand(c, s))).length;
}

/**
 * Whether the kept set is too thin to report without one wider search for
 * size-matched sales. Only for the size-driven commercial types, only when
 * the search wants sales, and only once the subject's size is known (the
 * wider search is TOLD the size band, so without one it would only repeat
 * the first search).
 */
function needsWiderSearch(report, { propertyType, txFocus, subjectSqft, netLease } = {}) {
  if (!SIZE_TYPES.has(String(propertyType || ""))) return false;
  // The wider search asks for SIZE-matched sales, which is not what a
  // net-leased subject is short of when it is short.
  if (netLease) return false;
  if (txFocus === "leases") return false;
  if (!(num(subjectSqft) > 0)) return false;
  return goodSaleCount(report, subjectSqft) < WIDER_SEARCH_BELOW;
}

// What a wider search needs to be worth starting. MEASURED on the live site
// (2026-11-27, Gemini 3.7 Flash at THINKING_LEVEL=low, nine fresh searches):
// a search with one call took 32 to 55 seconds, and a whole search WITH its
// wider leg finished in 41 and 51 seconds, so the wider leg is the short
// one, roughly 10 to 15 seconds: it asks for comps only, with no size lookup
// and no narrative. The first version of this rule expected it to take as
// long as the first leg, on a repo note that a search took about ten
// seconds; live, that skipped the wider search on five of six thin reports,
// some of which had room for it.
const WIDER_MIN_RUN_MS = 15000;

/**
 * Whether the wider search may start inside the search's time budget, and
 * how long it may then run (server.js refineComps; SEARCH_TIME_BUDGET_SECONDS,
 * a minute by default). It starts whenever WIDER_MIN_RUN_MS is left after
 * what must follow it; the deadline it is handed is what keeps the search
 * inside the budget if it runs long. No clock read: the caller says what
 * has elapsed.
 *
 *   budgetMs    the whole search's ceiling; 0 or less means none (always run)
 *   elapsedMs   since the search began
 *   firstLegMs  how long the first call took (no longer the estimate)
 *   afterMs     what follows the wider call (its link check and placement)
 *
 * Returns { run, deadlineMs } and, when it must not run, { leftMs, expectedMs }
 * for the log.
 */
function widerSearchAllowance({ budgetMs = 0, elapsedMs = 0, firstLegMs = 0, afterMs = 0 } = {}) {
  if (!(Number(budgetMs) > 0)) return { run: true, deadlineMs: null };
  const left = Number(budgetMs) - (Number(elapsedMs) || 0) - (Number(afterMs) || 0);
  const expected = WIDER_MIN_RUN_MS;
  if (left < expected) {
    return { run: false, deadlineMs: null, leftMs: Math.max(0, Math.round(left)), expectedMs: Math.round(expected) };
  }
  return { run: true, deadlineMs: Math.round(left) };
}

function addressKey(a) {
  return String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Every address the report already holds or set aside, for the wider
 *  search's "do not return these" list. */
function knownAddresses(report) {
  const all = [].concat((report && report.comps) || [], (report && report.set_aside) || []);
  const seen = new Set();
  const out = [];
  for (const c of all) {
    const a = String((c && c.address) || "").trim();
    const k = addressKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Fold the wider search's comps into the report: new addresses only (checked
 * against both the kept comps and the set-aside ones, so a comp cut for its
 * size cannot walk back in), appended after the first search's comps, and
 * capped at maxComps. MUTATES. Returns how many were added.
 */
function mergeWiderComps(report, wider, maxComps) {
  if (!report || !wider || !Array.isArray(wider.comps) || !wider.comps.length) return 0;
  if (String(wider.currency || "USD") !== String(report.currency || "USD")) return 0;
  const seen = new Set(knownAddresses(report).map(addressKey));
  const cap = Number(maxComps) > 0 ? Number(maxComps) : Infinity;
  report.comps = Array.isArray(report.comps) ? report.comps : [];
  let added = 0;
  for (const c of wider.comps) {
    if (report.comps.length >= cap) break;
    const k = addressKey(c && c.address);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    report.comps.push(c);
    added += 1;
  }
  return added;
}

/**
 * The fit rules again, once saved deals have been blended into the report
 * (server.js finishReportForViewer, after blend-corpus.js and before the
 * paywall). The blend adds every saved deal of the type inside its circle
 * (ten miles for commercial property) and applied none of this module's
 * rules, so three kinds of comp the search's own list is never allowed to
 * hold arrived through it:
 *
 *   1. A comp THIS report's search found and set aside. Size and distance
 *      set-asides are harvested (a good comp for some other subject), so the
 *      7,200 SF building left out of a 32,000 SF building's report came back
 *      from the corpus on its next view, under a notice saying it had been
 *      left out. `opts.setAsideAddresses` (setAsideAddresses(report), read
 *      BEFORE stripSetAside) bars those from coming back.
 *   2. A condo or unit sale against a whole building, and a sale whose own
 *      notes say its price is not a market price (priceBasisOf). Neither is
 *      a matter of degree that a weight can express.
 *   3. A deal far out while nearer ones exist. The saved deals are counted
 *      among the near ones, so a far comp of the search's own, kept for want
 *      of near comps, is set aside here once the corpus supplies them. Those
 *      are counted like any comp the search found and we left out.
 *
 * NOT the size-class cut, and that is a measured decision, not an oversight.
 * A saved deal of a different size stays, restated at the subject's size and
 * weighted down by valuation.js as before. Put through the accuracy lab's
 * hold-one-out on the market pages' own comps (market-seed.json, 2026-11-27:
 * 241 rows, 34 sales scored, pools of four to seven), cutting the pool to
 * its size class moved 15 of them, nearly all down to the three-comp floor,
 * and made 60% of those worse: median miss 22.7% -> 27.8%, the interval from
 * resampling whole markets 0.0 to +11.0 points. That is a small sample and
 * not the production corpus, so it ranks the two and proves neither; what it
 * does say is that nothing supports the cut. With this few comps one more of
 * them is worth more than a cleaner size match the restatement has already
 * mostly paid for. The search's own size cut can afford it because a wider
 * search refills the list; a blend has nothing to refill from.
 * `node scripts/accuracy-lab.js <export> --only fit` asks the question both
 * ways on a real corpus export; turn the cut on here (`sizeRule: true`) only
 * with a run of that which clears the noise.
 *
 * Dropped saved deals are NOT counted: `set_aside_counts` is "comps the
 * search found", and a saved deal that never joined the report was never
 * one. `corpus_count` falls by the number dropped.
 *
 * PURE and non-mutating: `report` may be the cached object, so this returns
 * a new one (or the same one, untouched, when nothing changed). Nothing here
 * is per-viewer: the corpus is public, and every viewer of the report at
 * that moment gets the same kept set.
 *
 * opts: applyCompFit's, minus deadUrls (a saved deal's link is not checked
 * at view time; the search's own dead links were set aside before the cache).
 */
function refitBlended(report, opts = {}) {
  if (!report || typeof report !== "object" || !Array.isArray(report.comps)) return report;
  const isExtra = (c) => Boolean(c && c.from_corpus === true);
  const extrasBefore = report.comps.filter(isExtra).length;
  if (!extrasBefore) return report;
  const barred = new Set((Array.isArray(opts.setAsideAddresses) ? opts.setAsideAddresses : []).map(addressKey).filter(Boolean));
  const work = { comps: report.comps.filter((c) => !(isExtra(c) && barred.has(addressKey(c.address)))) };
  applyCompFit(work, { ...opts, deadUrls: null, sizeRule: opts.sizeRule === true });
  if (work.comps.length === report.comps.length) return report;
  const prior = report.set_aside_counts && typeof report.set_aside_counts === "object" ? report.set_aside_counts : {};
  const counts = { ...prior };
  for (const x of Array.isArray(work.set_aside) ? work.set_aside : []) {
    if (x.from_corpus !== true) counts[x.set_aside] = (counts[x.set_aside] || 0) + 1;
  }
  const extrasDropped = extrasBefore - work.comps.filter(isExtra).length;
  const out = { ...report, comps: work.comps };
  const left = Math.max(0, (Number(report.corpus_count) || 0) - extrasDropped);
  if (left > 0) out.corpus_count = left; else delete out.corpus_count;
  if (Object.keys(counts).length) out.set_aside_counts = counts;
  return out;
}

/**
 * A saved deal's notes are evidence for the rules above and nothing a reader
 * should be shown: the model wrote them about a DIFFERENT subject ("two miles
 * north of the target", "smaller than the target"), so on this report they
 * would describe a building the reader has never heard of. Until 2026-11-27
 * the type-wide corpus read did not select the column at all, so a saved deal
 * never carried notes onto a report; it selects them now, for priceBasisOf
 * and the blend's manufactured-home test, and this keeps the page as it was.
 * Returns a new report only when something had notes to drop.
 */
function withoutSavedNotes(report) {
  if (!report || typeof report !== "object" || !Array.isArray(report.comps)) return report;
  if (!report.comps.some((c) => c && c.from_corpus === true && c.notes)) return report;
  return {
    ...report,
    comps: report.comps.map((c) => {
      if (!c || c.from_corpus !== true || !c.notes) return c;
      const { notes, ...rest } = c;   // eslint-disable-line no-unused-vars
      return rest;
    }),
  };
}

/** The addresses of the comps this report's own search set aside, for
 *  refitBlended's `setAsideAddresses`. Read it before stripSetAside. */
function setAsideAddresses(report) {
  const list = report && Array.isArray(report.set_aside) ? report.set_aside : [];
  return list.map((c) => String((c && c.address) || "").trim()).filter(Boolean);
}

/** The set-aside comps still worth harvesting into the corpus. */
function harvestableSetAside(report) {
  const list = report && Array.isArray(report.set_aside) ? report.set_aside : [];
  return list.filter((c) => c && HARVESTABLE_REASONS.has(c.set_aside));
}

/** A viewer never receives the set-aside comps themselves (they are full
 *  comps with addresses and sources, and the paywall gates comps), only the
 *  counts. Returns a NEW object; the cached report keeps its list. */
function stripSetAside(report) {
  if (!report || typeof report !== "object" || !("set_aside" in report)) return report;
  const { set_aside, ...rest } = report;   // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = {
  applyCompFit, needsWiderSearch, goodSaleCount, knownAddresses, mergeWiderComps,
  harvestableSetAside, stripSetAside, unitOf, isUnitSale, priceBasisOf, refitBlended, setAsideAddresses,
  widerSearchAllowance, WIDER_MIN_RUN_MS, withoutSavedNotes,
  SIZE_TYPES, HARD_SIZE_MIN, HARD_SIZE_MAX, BAND_MIN, BAND_MAX,
  NEAR_MILES, NEAR_MIN, FAR_MILES, MIN_PRICED_SALES, WIDER_SEARCH_BELOW,
};
