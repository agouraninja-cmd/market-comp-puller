"use strict";
// ---------------------------------------------------------------------------
// BOV tracker rules -- PURE. No I/O, no clock reads (rollup takes `now`), no
// requires, the same contract as broker-leads.js and entitlements.js, which
// is what lets `npm test` cover the practice log with no database.
//
// server.js owns every read and write. It computes `market` with marketOf()
// and validates it with LEADSVC.isCanonicalMarket, and validates property
// type against VAULT.PROPERTY_TYPES, before calling in -- neither vocabulary
// grows a second copy here (broker-leads.js's rule).
//
// Spec: docs/superpowers/specs/2026-08-08-bov-tracking-design.md
// ---------------------------------------------------------------------------

// The check constraints in migrations/019-broker-bovs.sql restate both of
// these lists; keep the three in step.
const SOURCES = ["compninja", "referral", "repeat_client", "other"];
const STATUSES = ["open", "delivered", "won", "lost"];

// Decided (won or lost) BOVs before a win rate is shown at all. A 100% win
// rate over one data point reads as a joke.
const WIN_RATE_FLOOR = 3;

// GET cap, newest first. Matches the coverage read's order of magnitude; a
// broker with 500 tracked BOVs in 90 days is not a real inbox problem yet.
const MAX_ROWS = 500;

function isSource(v) { return SOURCES.includes(v); }
function isStatus(v) { return STATUSES.includes(v); }

function cleanText(v, max) {
  const s = String(v == null ? "" : v).trim();
  return s ? s.slice(0, max) : null;
}
function cleanNotes(v) { return cleanText(v, 500); }
function cleanAddress(v) { return cleanText(v, 300); }

// ISO ("YYYY-MM-DD") only. The form's <input type=date> emits exactly this;
// anything else (US order, Excel serials) is refused rather than guessed,
// the vault importer's rule. Empty is fine: received_on is optional.
function cleanReceivedOn(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return { ok: true, value: raw };
    }
  }
  return { ok: false, error: `"${raw}" is not a date we can read: use YYYY-MM-DD` };
}

// The tiles. thisYear keys on received_on when present, created_at
// otherwise, compared as UTC years against the caller's `now`. A row with a
// status outside the vocabulary still counts in `total` (it exists) but in
// no status bucket -- the check constraint makes that unreachable from our
// own writes, and inventing a bucket for it would hide a corrupt row.
function rollup(rows, now) {
  const year = new Date(now).getUTCFullYear();
  const out = { total: 0, thisYear: 0, open: 0, delivered: 0, won: 0, lost: 0,
    decided: 0, winRate: null };
  for (const r of rows || []) {
    if (!r) continue;
    out.total++;
    if (isStatus(r.status)) out[r.status]++;
    const basis = String(r.received_on || r.created_at || "");
    if (/^\d{4}/.test(basis) && Number(basis.slice(0, 4)) === year) out.thisYear++;
  }
  out.decided = out.won + out.lost;
  if (out.decided >= WIN_RATE_FLOOR) out.winRate = out.won / out.decided;
  return out;
}

// First tracker open: rows derived from the broker's existing intro
// requests (the coverage-seeding pattern; a SQL backfill cannot write
// canonical markets because marketOf lives in JS). The caller supplies each
// request joined to its lead with `market` already computed, and passes the
// canonical-market predicate in rather than this file copying the regex.
// Non-canonical markets are dropped, not seeded. The caller adds user_id
// and inserts with on_conflict=user_id,lead_id, so this list need not know
// what already exists.
function seedFromIntroRequests(joined, isCanonicalMarket) {
  const out = [];
  const seen = new Set();
  for (const r of joined || []) {
    if (!r || r.lead_id == null) continue;
    const k = String(r.lead_id);
    if (seen.has(k)) continue;
    if (typeof isCanonicalMarket !== "function" || !isCanonicalMarket(r.market)) continue;
    if (!String(r.property_type || "").trim()) continue;
    seen.add(k);
    const ts = String(r.ts || "");
    out.push({
      lead_id: r.lead_id,
      market: String(r.market).trim(),
      property_type: String(r.property_type).trim(),
      size_sqft: r.size_sqft == null ? null : r.size_sqft,
      received_on: /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null,
      source: "compninja",
      status: "open",
    });
  }
  return out;
}

module.exports = {
  SOURCES, STATUSES, WIN_RATE_FLOOR, MAX_ROWS,
  isSource, isStatus,
  cleanNotes, cleanAddress, cleanReceivedOn,
  rollup, seedFromIntroRequests,
};
