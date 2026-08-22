"use strict";
// ---------------------------------------------------------------------------
// The deal board: who shared what to the firm, by market and by month.
//
// Plan:   docs/superpowers/plans/2026-08-21-divide-and-conquer-to-aug-27.md §4 (O3)
// Schema: nothing new. migrations/018-report-sharing.sql (shared_reports) and
//         migrations/032-org-shared-comps.sql (org_comps), both already
//         attributed at write time.
//
// PURE, like org-access.js, entitlements.js and hub-access.js: no I/O, no
// requires, no clock read — `now` is handed in. server.js owns the two reads
// and normalizes their rows; this file only counts. That is what lets
// `npm test` prove every judgment below with no database.
//
// WHAT THIS COUNTS, AND WHY IT CANNOT COUNT THE OTHER THING.
//
// The wishlist item behind this board is "see who is closing what". This board
// does NOT answer that, and the gap is deliberate rather than a v1 shortcut.
// A member's own book (broker_comps) and their BOV log's won/lost record are
// vault-class private — separate tables, `user_id=eq.` reads, the wall the
// whole broker product rests on. The only firm-visible signal that exists is
// what a member CHOSE to share: shelf reports (`visibility='org'`) and comps
// opted in to the firm (`org_comps`). So this counts **contribution to the
// firm**, and index.html must say so on the panel.
//
// That is also the better incentive. A leaderboard of closings rewards the
// quarter someone happened to have; a leaderboard of contribution rewards
// filling the shelf every colleague reads, which is the thing the firm bought.
// Real closing stats, if a firm wants them later, are a per-member opt-in in
// the shape of 031's `auto_share` — a nullable three-state, disclosed before
// accept — and NOT a widened read from here.
//
// THREE THINGS THIS FILE FAILS CLOSED ON:
//
//   1. **Attribution never guesses.** `org_comps.shared_by_user_id` is SET
//      NULL on account deletion (032's rule: the firm keeps the comp and
//      loses the name), and the shelf route already falls back to "a
//      colleague" when the user read fails. Rows with no id AND no name go to
//      ONE clearly-unattributed bucket rather than being folded into whoever
//      sorts next to them. Merging two departed colleagues into one row would
//      be a wrong number that looks exactly like a right one.
//      **KNOWN GAP, deferred deliberately (Owen, 2026-08-22).** The two
//      sources lose a departed member's name DIFFERENTLY, so one person who
//      deletes their account currently shows up as two rows: their comps keep
//      the `shared_by_name` 032 denormalizes at share time, while their shelf
//      reports carry no name column at all (018 adds `user_id` with `on delete
//      set null`, and the name is only ever joined from `users`). The totals
//      stay right; the identity splits. The fix is to snapshot the sharer's
//      name onto `shared_reports` at share time, the way 032 already does and
//      the way `meta.branding` already snapshots a mark — a migration, so it
//      rides with O4's lease fields rather than buying Jacob a second trip.
//      Until then the anonymous bucket is labelled honestly, which is the
//      cheap half of the fix and the half that matters.
//   2. **An unreadable date is counted but not placed.** It still lands in
//      the totals and in its member's and market's row — dropping it would
//      quietly under-report someone's contribution — but it is absent from
//      `months` and declared in `totals.undated`, so the month breakdown never
//      silently disagrees with the total beside it.
//   3. **Truncation travels.** Both source reads are capped. The cap is
//      passed in and re-emitted rather than inferred here, because a board
//      that says "12 this month" off a truncated read is the shelf's own
//      lesson (a short list is the wrong way to learn you needed paging).
//
// THE MONTH IS THE SHARE DATE, NOT THE DEAL DATE. `org_comps` carries both:
// `deal_date` (when the deal happened, what the blend read filters on) and
// `created_at` (when it was put on the firm's shelf). A board about
// contribution has to bucket by the second — otherwise a member who imports a
// decade of old deals in one afternoon appears to have contributed nothing
// this month, and a firm reading "August: 40" would be reading August's
// closings, which is the number this board specifically cannot know.
// ---------------------------------------------------------------------------

// The unattributed bucket. A key that no user id and no name can collide with:
// ids are prefixed "u:" and names "n:" below.
const ANON_KEY = "?";

// Twelve months of history and ten leaderboard rows. Both are display caps on
// a panel, not limits on the count: `totals` is always the whole set, and a
// firm past ten sharers still sees every one of them in `members`. Twelve
// because a year is the window a firm compares against; ten because the
// transition plan's own target is 5–40-person shops.
const MAX_MONTHS = 12;
const MAX_LEADERS = 10;

function str(v) { return v == null ? "" : String(v); }
function trimmed(v) { return str(v).trim(); }

// One person, across both sources. The id wins when it exists because a member
// can change their display name and both tables snapshot it at write time
// (032 denormalizes `shared_by_name` on purpose); keying on the name would
// split one colleague into two rows the day they fix a typo in their profile.
function sharerKey(row) {
  const id = trimmed(row && row.sharedById);
  if (id) return "u:" + id;
  const name = trimmed(row && row.sharedBy).toLowerCase();
  if (name) return "n:" + name;
  return ANON_KEY;
}

// "2026-08" in UTC, or "" when there is no usable date.
//
// UTC rather than local time, matching every other date this repo groups by:
// the timestamps arrive as ISO strings from PostgREST, and a board bucketed in
// the reader's timezone would move a share across a month boundary depending
// on who opened the page.
function monthKey(iso) {
  const s = trimmed(iso);
  if (!s) return "";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// The first instant of the calendar month / quarter containing `now`, as an
// epoch ms. Calendar-aligned, not rolling-30-day: a firm comparing "this
// month" against last month means the month on the wall, and a rolling window
// makes yesterday's number unreproducible today.
function startOfMonth(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function startOfQuarter(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

// Sort by count, then by name, then by key. Two members tied on a small board
// is the common case, not the edge case, so the tiebreak has to be stable —
// otherwise the leaderboard reorders itself on every render and reads like
// something changed.
function byTotalThenName(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// Count one row into a member bucket, creating it on first sight.
function bump(map, row, kind) {
  const key = sharerKey(row);
  let m = map.get(key);
  if (!m) {
    m = {
      key,
      // "" for the unattributed bucket: index.html holds the nouns (the same
      // rule /api/org sends `kind` rather than the shop words), so the wire
      // carries the absence and the page chooses how to say it.
      name: key === ANON_KEY ? "" : trimmed(row.sharedBy),
      reports: 0, comps: 0, total: 0, mine: false,
      markets: new Set(), lastAt: "",
    };
    map.set(key, m);
  }
  m[kind] += 1;
  m.total += 1;
  if (row.mine === true) m.mine = true;
  const market = trimmed(row.market);
  if (market) m.markets.add(market);
  const at = trimmed(row.at);
  if (at && (!m.lastAt || at > m.lastAt)) m.lastAt = at;
  return m;
}

// Build the board. Returns null when the firm has shared nothing at all —
// watchlist-digest.js's shape, and for its reason: a panel with nothing to say
// should not be rendered saying it. The desk's existing empty state for
// "nothing shared with your firm yet" already covers that case and says it
// better, because it says what to do about it.
//
//   reports: [{ id, market, at, sharedBy, sharedById, mine }]
//   comps:   [{ id, market, at, sharedBy, sharedById, mine }]
//   now:     ms or Date, handed in (this file reads no clock)
//   truncated: true when EITHER source read hit its cap
function build({ reports = [], comps = [], now = 0, truncated = false } = {}) {
  const reportRows = Array.isArray(reports) ? reports : [];
  const compRows = Array.isArray(comps) ? comps : [];
  if (!reportRows.length && !compRows.length) return null;

  const members = new Map();
  const markets = new Map();
  const months = new Map();
  let undated = 0;

  const count = (rows, kind) => {
    for (const row of rows) {
      if (!row) continue;
      bump(members, row, kind);

      const market = trimmed(row.market);
      if (market) {
        let mk = markets.get(market);
        if (!mk) { mk = { market, reports: 0, comps: 0, total: 0 }; markets.set(market, mk); }
        mk[kind] += 1; mk.total += 1;
      }

      const mo = monthKey(row.at);
      if (!mo) { undated += 1; continue; }
      let mm = months.get(mo);
      if (!mm) { mm = { month: mo, reports: 0, comps: 0, total: 0 }; months.set(mo, mm); }
      mm[kind] += 1; mm.total += 1;
    }
  };
  count(reportRows, "reports");
  count(compRows, "comps");

  // The leaderboard is the same data windowed — the plan's "v1 is the same
  // data sorted". A second pass rather than a second source, so the board and
  // the leaderboard can never disagree about who shared what.
  const monthFrom = startOfMonth(now);
  const quarterFrom = startOfQuarter(now);
  const window = (from) => {
    const m = new Map();
    const take = (rows, kind) => {
      for (const row of rows) {
        if (!row) continue;
        const t = Date.parse(trimmed(row.at));
        // An undated row is not counted in a window. Elsewhere it is counted
        // and simply not placed; here there is no honest way to place it,
        // and guessing "recent" would inflate whoever has the messiest data.
        if (!Number.isFinite(t) || t < from) continue;
        bump(m, row, kind);
      }
    };
    take(reportRows, "reports");
    take(compRows, "comps");
    return [...m.values()]
      .map((x) => ({ key: x.key, name: x.name, reports: x.reports, comps: x.comps, total: x.total, mine: x.mine }))
      .sort(byTotalThenName)
      .slice(0, MAX_LEADERS);
  };

  const memberRows = [...members.values()]
    .map((m) => ({
      key: m.key, name: m.name, reports: m.reports, comps: m.comps,
      total: m.total, mine: m.mine, markets: m.markets.size, lastAt: m.lastAt,
    }))
    .sort(byTotalThenName);

  return {
    totals: {
      reports: reportRows.length,
      comps: compRows.length,
      total: reportRows.length + compRows.length,
      members: memberRows.length,
      markets: markets.size,
      // Declared, never hidden. See failure mode 2 in the header.
      undated,
    },
    truncated: truncated === true,
    members: memberRows,
    markets: [...markets.values()].sort((a, b) =>
      b.total !== a.total ? b.total - a.total : (a.market < b.market ? -1 : a.market > b.market ? 1 : 0)),
    // Recent first, and capped. `monthsTruncated` rather than a silent slice,
    // the shelf's rule again.
    months: [...months.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)).slice(0, MAX_MONTHS),
    monthsTruncated: months.size > MAX_MONTHS,
    leaderboard: {
      month: { since: new Date(monthFrom).toISOString(), rows: window(monthFrom) },
      quarter: { since: new Date(quarterFrom).toISOString(), rows: window(quarterFrom) },
    },
  };
}

module.exports = {
  build,
  // Exported for the tests, which pin the bucketing rules by name rather than
  // through build()'s whole shape — the org-access.js precedent.
  sharerKey, monthKey, startOfMonth, startOfQuarter,
  ANON_KEY, MAX_MONTHS, MAX_LEADERS,
};
