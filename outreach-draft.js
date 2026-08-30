// ---------------------------------------------------------------------------
// Report-first outreach: which buildings to run, and what the email says.
//
// The ask stops being "sign up and try it" and becomes "here is your building,
// tell me what is wrong with it". That only works if the report exists BEFORE
// the message is sent, which is what outreach.js does with these rules.
//
// Deliberately PURE, like entitlements.js and eval-score.js: no I/O, no fetch,
// no clock reads (the caller passes `now`). outreach.js owns every side effect,
// including the part that spends money and the part that would reach a person.
//
// Nothing here sends anything. It renders text for a human to read, edit and
// send themselves — see the "no send" note in outreach.js.
// ---------------------------------------------------------------------------

"use strict";

// A comp row is a usable TARGET when it names a real building somebody could
// be written to about. The bar is higher than the corpus's own, because a bad
// row here costs a real message to a real person rather than one weak line in
// a report:
//
//   - provenance better than estimate/news, the same rule corpus retrieval and
//     the backtest already apply (a modelled guess is not a building);
//   - an address starting with a street number, which is how this repo has
//     always told an individual property from a submarket statistic
//     ("Financial District (general submarket estimate)");
//   - a market and type matching what was asked for, matched exactly, because
//     `market` is canonicalized by marketOf() on both write and read.
const BAD_PROVENANCE = /^(estimate|news)$/i;

const AUDIT = require("./corpus-audit");

// One building, one key. Punctuation and case go, and so does a trailing ZIP:
// the live corpus holds "873 E Citation Ct, Boise, ID 83716" and
// "873 E. Citation Ct., Boise, ID" as separate rows for the same warehouse,
// and without this they are two messages to the same owner about the same
// building. Measured on the real Boise industrial rows, where two of the ten
// top targets were duplicates of the other two.
//
// The ZIP is stripped only from the END, never anywhere else, so a street
// number is untouched.
//
// Known limit: this collapses the same address written with different
// punctuation or ZIP, not the same building written differently. The live
// corpus also holds "1183 E Exchange Street, Boise Airport, Boise, ID" beside
// "1183 E Exchange St, Boise, ID 83716", and no normalization short of
// geocoding tells those apart. The target list is printed before anything is
// spent and every draft is read by a person, which is where that gets caught.
function addressKeyOf(address) {
  return String(address || "")
    .toLowerCase()
    .replace(/\b\d{5}(-\d{4})?\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Deal recency, for ordering only.
//
// ⚠ Mirrors parseDealDate() in server.js, which is not exported (that file has
// no module.exports at all). Kept to the same shapes it accepts, because the
// corpus rows this reads were written by it: bare years, quarters, "Sep 2025",
// "9/2025" and ISO. Anything unparseable sorts last rather than crashing or
// pretending to be old, since the corpus really does hold blank dates.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dealDateValue(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return -Infinity;
  let m;
  if (/^(19|20)\d{2}$/.test(t)) return Number(t) + 0.5;
  if ((m = t.match(/^q([1-4])\s*((19|20)\d{2})$/))) return Number(m[2]) + (Number(m[1]) * 3 - 1.5) / 12;
  if ((m = t.match(/^([a-z]{3,9})\.?\s+((19|20)\d{2})$/))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3)) + 1;
    return mo ? Number(m[2]) + (mo - 0.5) / 12 : -Infinity;
  }
  if ((m = t.match(/^(\d{1,2})\/((19|20)\d{2})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? Number(m[2]) + (mo - 0.5) / 12 : -Infinity;
  }
  if ((m = t.match(/^((19|20)\d{2})-(\d{2})(-\d{2})?$/))) {
    const mo = Number(m[3]);
    return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : -Infinity;
  }
  return -Infinity;
}

// The unit vocabulary. ⚠ A DELIBERATE MIRROR of index.html's, pinned
// character-for-character by "the two copies of the unit vocabulary agree" in
// test/outreach-draft.test.js. This file is Node and index.html is a static
// page that cannot require a module, so the pair is kept honest by a test
// rather than by sharing code — the ORG.SHOP_COPY precedent.
//
// The copy that used to live here was written loose, and it cost real coverage.
// "\b(...|lot|building|space|room|fl|...)\b" followed by any word matched
// "500 Lot Ave", "900 Building Materials Way" and "100 Space Center Blvd" — and
// because FL is a state abbreviation, EVERY Florida address was excluded from
// outreach targeting. Silently: a refusal here only means a building is never
// written to, so nothing reports it.
//
// After a keyword the identifier must carry a digit ("Apt 3B", "Ste 200") or be
// one or two bare letters after whitespace ("Bldg B"). Matching any following
// word reads "3 Ste Genevieve Ave" as suite Genevieve, and a keyword plus one
// or two letters spells ordinary words: "Roomy" is room + y, "Lotus" is
// lot + us, "United" is unit + ed.
const UNIT_KEYWORDS = "apt|apartment|unit|ste|suite|spc|space|lot|trlr|trailer" +
  "|bldg|building|rm|room|fl|floor|penthouse|ph";
// Written as a literal rather than built from a string, so the keyword list is
// visible inline; the test below pins it against UNIT_KEYWORDS above so the two
// spellings in this file cannot drift from each other either.
const UNIT_DESIGNATOR_RE =
  /(?:^|[\s,])(?:#\s*[a-z0-9-]+|(?:apt|apartment|unit|ste|suite|spc|space|lot|trlr|trailer|bldg|building|rm|room|fl|floor|penthouse|ph)\.?(?:\s*[a-z0-9-]*\d[a-z0-9-]*|\s+[a-z]{1,2}))(?=$|[\s,])/i;

// A trailing state + ZIP is dropped BEFORE the vocabulary is applied: "fl" is a
// keyword and FL is a state. Stripping the tail rather than special-casing FL
// is the general fix — that suffix is never a unit designator whatever the
// keyword list grows to, and a genuine "Fl 3" still matches once it is gone.
const ADDRESS_TAIL_RE = /,?\s*(?:[a-z]{2}\s+)?\d{5}(?:-\d{4})?\s*$/i;
function unitDesignatorOf(address) {
  const m = UNIT_DESIGNATOR_RE.exec(String(address || "").replace(ADDRESS_TAIL_RE, ""));
  return m ? m[0].trim() : null;
}

function isTargetable(row) {
  if (!row) return false;
  if (BAD_PROVENANCE.test(String(row.source_type || ""))) return false;
  const addr = String(row.address || "").trim();
  if (!/^\d/.test(addr)) return false;
  // The corpus's own statistic-shaped-address rule, borrowed rather than
  // restated: a second copy of that vocabulary would drift from the one the
  // audit enforces.
  if (AUDIT.isAggregateAddress(addr)) return false;
  // A unit designator names one tenant's suite, not the property somebody
  // owns. index.html refuses to measure or photograph these for the same
  // reason; writing to "Suite 200" is writing to the wrong person.
  if (unitDesignatorOf(addr)) return false;
  return true;
}

/**
 * Corpus rows -> the buildings worth running, newest deal first.
 *
 * Deduped by address, because one building that traded twice is still one
 * message. `seen` is the set of address keys already contacted, so a second
 * run over the same market does not write to the same person again — the
 * caller owns that list, since it is the only part of this that must survive
 * the process.
 */
function selectTargets(rows, { market, type, limit = 20, seen = [] } = {}) {
  const skip = new Set((seen || []).map(addressKeyOf));
  const byAddress = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isTargetable(row)) continue;
    if (market && String(row.market || "") !== market) continue;
    if (type && String(row.property_type || "") !== type) continue;
    const key = addressKeyOf(row.address);
    if (!key || skip.has(key)) continue;
    const prev = byAddress.get(key);
    // Keep the most recent deal for a repeat property: it is the one the
    // owner remembers, and the one a stale report would look wrong about.
    // Compared as PARSED dates, never as strings — the corpus stores display
    // forms like "Sep 2025", where a string compare puts September above
    // November and every 2026 deal below every 2025 one.
    if (!prev || dealDateValue(row.deal_date) > dealDateValue(prev.deal_date)) {
      byAddress.set(key, row);
    }
  }
  return [...byAddress.values()]
    .sort((a, b) => dealDateValue(b.deal_date) - dealDateValue(a.deal_date))
    .slice(0, Math.max(0, limit));
}

// What the report actually contains, said in the fewest words that stay true.
// Counts come from the report the script just ran, never estimated, because
// the whole premise is that the thing described already exists.
function reportLine(report) {
  const comps = Array.isArray(report && report.comps) ? report.comps : [];
  const sales = comps.filter((c) => !/^lease/i.test(String((c && c.transaction) || ""))).length;
  const leases = comps.length - sales;
  const parts = [];
  if (sales) parts.push(sales + (sales === 1 ? " sale" : " sales"));
  if (leases) parts.push(leases + (leases === 1 ? " lease" : " leases"));
  return parts.join(" and ");
}

/**
 * One draft message. Returns { subject, body } as plain text.
 *
 * Written to be edited, not sent as-is. Three rules it keeps:
 *
 *   - It says what the link is before asking for anything. The link opens
 *     without a signup (a public share is exempt from the account wall), and
 *     saying so is the difference between a link people click and one they do
 *     not.
 *   - The ask is for a correction, not a meeting. "Tell me which comp is
 *     wrong" is answerable in one line by somebody who knows the market, and
 *     an answer is worth more than a yes right now.
 *   - It never claims a brokerage relationship or an appraisal. CompNinja
 *     connects owners with brokers and every figure is an automated estimate;
 *     that rule reaches outbound mail exactly as it reaches the site.
 */
function renderEmail({ address, city, type, url, report, from } = {}) {
  const what = reportLine(report);
  const kind = String(type || "").toLowerCase();
  const where = city ? `${city} ${kind}` : kind;
  const subject = `Comps for ${address}`;
  const body = [
    `Hi,`,
    ``,
    `I ran a comp report on ${address} and thought you might want it:`,
    url,
    ``,
    what
      ? `It is ${what} nearby, with the source cited on every one, and a value range built from them.`
      : `It is the recent ${where} activity nearby, with the source cited on every one.`,
    `The link opens without a signup.`,
    ``,
    `I build CompNinja and I would rather hear what is wrong with this than what is right.`,
    `If a comp does not belong, tell me which one.`,
    ``,
    from || `Owen`,
    ``,
    `Every figure is an automated estimate from public records and listings, not an appraisal.`,
  ].join("\n");
  return { subject, body };
}

module.exports = { unitDesignatorOf, UNIT_KEYWORDS, addressKeyOf, isTargetable, selectTargets, reportLine, renderEmail, dealDateValue };
