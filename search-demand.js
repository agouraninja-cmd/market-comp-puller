"use strict";
// ---------------------------------------------------------------------------
// Search demand — how many people looked at a market, and what counts as
// "looked".
//
// PURE, like entitlements.js, comp-gate.js and broker-leads.js: no I/O, no
// requires, no clock reads (the caller passes `now`). server.js owns the read
// of `analytics_events` and hands the rows in; this file owns every judgment
// about what those rows mean. That is what lets `npm test` pin the counting
// rules with no database and no traffic.
//
// The figure is shown to a paying broker beside a market they watch, so the
// bar is the same one the comp badges are held to: UNDER-CLAIM, NEVER OVER-.
// A number that flatters the site would be caught the first time a broker
// compared it against their own sense of their market, and the product's whole
// pitch is that its numbers can be checked.
//
// Four rules follow from that, each one a way this count could lie:
//
//   1. THE BROKER'S OWN SEARCHES DO NOT COUNT. Without this, the first thing a
//      broker sees on the market they work every day is a reflection of
//      themselves, reported as interest from other people. `excludeUserId`
//      is not optional politeness; it is the difference between a signal and
//      a mirror.
//
//   2. EXPLORER SWEEPS DO NOT COUNT. The Address Explorer is a Pro discovery
//      tool: one subscriber walks a market listing address after address, and
//      every one of those is logged with `source: "explore"`. Counting them
//      turns one person's afternoon into a demand spike. A demand row has to
//      be somebody asking about A BUILDING, so the sweep is excluded by source.
//
//   3. A BLOCKED SEARCH IS STILL DEMAND. An anonymous visitor who hits the
//      sign-in wall wanted the same answer as the person who got one, and
//      `signup_gate` is the only trace they leave. Dropping those would hide
//      most of the interest in every market. But the same visitor usually
//      signs up and searches seconds later, which writes a second row for one
//      attempt, so a gate row is discarded when that visitor already has a
//      completed search in the same market on the same UTC day.
//
//   4. PEOPLE AND SEARCHES ARE DIFFERENT NUMBERS AND ARE BOTH REPORTED. One
//      person running six searches is not six people, and a caller given only
//      the larger number would inevitably say "people". Both ship, and the
//      UI leads with the smaller one. Where a row cannot be attributed to
//      anyone, the people count rounds DOWN (see viewerKey): this figure is
//      allowed to understate the audience and is never allowed to inflate it.
//
// Aggregate only. Nothing here returns, or can return, an address, an email,
// a visitor id or a user id — the output is counts, and the inputs are dropped
// at the door. A broker learns that their market was searched, never by whom.
// ---------------------------------------------------------------------------

// The window. 30 days is long enough that a quiet market is not reported as
// dead on a slow week, and short enough that the number describes now.
// Restated in prose on the desk card; change both together.
const DEMAND_WINDOW_DAYS = 30;

// The kinds that mean "somebody asked about this market". Deliberately short,
// and deliberately not `portfolio_add` / `portfolio_refresh`: those ride along
// with a signed-in search that is ALREADY counted here (server.js logs both on
// one request), so including them would double every subscriber's search. Nor
// `watchlist_add`, which is a broker following a market rather than demand for
// property in it, and nor `bov` / `lead` — a named owner asking for a
// valuation is a stronger thing that already has its own home in the broker
// lead inbox, and folding it into a count would bury it.
const DEMAND_KINDS = ["search", "signup_gate"];

// Rows whose `source` is one of these never count. See rule 2.
const EXCLUDED_SOURCES = ["explore"];

const DAY_MS = 24 * 60 * 60 * 1000;

function str(v) {
  return String(v == null ? "" : v).trim();
}

// The ISO instant a row must be at or after to be inside the window. Exported
// so server.js can push the same cutoff into its database query rather than
// reading a month of rows and discarding most of them.
function demandCutoff(now, windowDays) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const days = Number.isFinite(Number(windowDays)) ? Number(windowDays) : DEMAND_WINDOW_DAYS;
  return new Date(at - days * DAY_MS).toISOString();
}

// A market key is "City, ST" or it is nothing. server.js's marketForLog()
// already blanks anything else before the row is written, so this is a second
// wall rather than the only one — but it is cheap, and the column has held a
// street address in production before (2026-07-31), which is exactly the row
// that must never be reported back as a market.
const MARKET_SHAPE = /^[^,]+,\s[A-Z]{2}$/;

function isCountable(row, cutoff, excludeUserId) {
  if (!row) return false;
  if (DEMAND_KINDS.indexOf(str(row.kind)) < 0) return false;
  if (EXCLUDED_SOURCES.indexOf(str(row.source)) >= 0) return false;
  if (!MARKET_SHAPE.test(str(row.market))) return false;
  const ts = str(row.ts);
  if (!ts || ts < cutoff) return false;
  // Rule 1. Compared as strings because a user id is a uuid in the database
  // and a plain string in the file store, and `==` across those two is how a
  // broker's own searches would leak back in on one deployment only.
  if (excludeUserId && str(row.user_id) === str(excludeUserId)) return false;
  return true;
}

// Who a row is attributed to, for the distinct-people count. `visitor_id` is
// the right key: it survives sign-out and it predates the account. `user_id`
// is the fallback for rows written before migration 026 added the visitor
// column, and rows carrying NEITHER all collapse into one "somebody" per
// market.
//
// That collapse is the whole point, and it is the house rule applied to our
// own metric. Counting each unattributed row as its own person is the
// alternative, and it would report 700 log lines from a handful of visits as
// 700 people — the exact direction this file exists to refuse. One shared
// bucket is certainly an undercount, and an undercount is the error a broker
// can forgive. Note it only reaches rows older than migration 026; everything
// written since carries a visitor id.
function viewerKey(row) {
  const visitor = str(row.visitor_id);
  if (visitor) return "v:" + visitor;
  const user = str(row.user_id);
  if (user) return "u:" + user;
  return "unattributed";
}

// Rule 3's dedupe key: one visitor, one market, one UTC day. Unattributed
// rows share a key here too, so a gate row is dropped whenever ANY
// unattributed search landed in that market that day. Same trade as above:
// it can discard a second person's real attempt, and it errs low.
function attemptKey(row) {
  return `${viewerKey(row)}|${str(row.market)}|${str(row.ts).slice(0, 10)}`;
}

// rows -> { "Boise, ID": { searches, viewers, by_type: { Industrial: 6 } } }
//
// One pass over everything the caller read, rather than one pass per watched
// market: My Desk renders every watched market at once, and a per-market scan
// would re-walk the same rows five times to answer five cards.
function aggregateDemand(rows, options) {
  const opts = options || {};
  const cutoff = demandCutoff(opts.now, opts.windowDays);
  const excludeUserId = str(opts.excludeUserId);
  const list = Array.isArray(rows) ? rows : [];

  // Pass 1: which visitor+market+day attempts ended in a completed search, so
  // pass 2 can drop the gate row that same attempt also wrote.
  const completed = new Set();
  list.forEach((row) => {
    if (!isCountable(row, cutoff, excludeUserId)) return;
    if (str(row.kind) === "search") completed.add(attemptKey(row));
  });

  const out = {};
  list.forEach((row) => {
    if (!isCountable(row, cutoff, excludeUserId)) return;
    if (str(row.kind) === "signup_gate" && completed.has(attemptKey(row))) return;
    const market = str(row.market);
    const bucket = out[market] || (out[market] = { searches: 0, viewers: 0, by_type: {}, _seen: new Set() });
    bucket.searches += 1;
    bucket._seen.add(viewerKey(row));
    const type = str(row.prop_type);
    if (type) bucket.by_type[type] = (bucket.by_type[type] || 0) + 1;
  });

  for (const market of Object.keys(out)) {
    out[market].viewers = out[market]._seen.size;
    delete out[market]._seen;
  }
  return out;
}

// The wire shape for one watched market. Always returns an object, including
// for a market with no rows at all: "no searches in the last 30 days" is a
// true and useful answer, and a missing field would render as a broken card
// on exactly the quiet markets a broker most wants to know about.
//
// `in_type` is the slice matching the card's own property type. It is a
// subset of `searches`, never a second total.
function demandPayload(bucket, propertyType, windowDays) {
  const b = bucket || { searches: 0, viewers: 0, by_type: {} };
  const type = str(propertyType);
  return {
    window_days: Number.isFinite(Number(windowDays)) ? Number(windowDays) : DEMAND_WINDOW_DAYS,
    searches: Number(b.searches) || 0,
    viewers: Number(b.viewers) || 0,
    in_type: type ? (Number(b.by_type && b.by_type[type]) || 0) : 0,
  };
}

module.exports = {
  DEMAND_WINDOW_DAYS,
  DEMAND_KINDS,
  demandCutoff,
  aggregateDemand,
  demandPayload,
};
