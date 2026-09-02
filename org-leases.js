"use strict";
// ---------------------------------------------------------------------------
// The firm's leases: what may be stored, and which dates matter next.
//
// Plan:   ~/.claude/plans/could-you-help-me-mighty-crane.md (Three Spaces, slice 6)
// Spec:   docs/superpowers/specs/2026-09-01-three-spaces-design.md
// Schema: migrations/048-org-leases.sql
//
// PURE, like org-buildings.js and org-access.js: no I/O, no requires, no
// clock. server.js owns the reads and writes and hands rows in, which is what
// lets `npm test` prove every refusal below with no database.
//
// ---------------------------------------------------------------------------
// RESTATED, NOT SHARED.
// ---------------------------------------------------------------------------
// broker-vault.js already refuses an option notice dated after the lease
// expiry (a transposition), requires a rent basis with a rent, and knows the
// NNN/FS/MG vocabulary. Those rules are restated here rather than required,
// because this is a DIFFERENT WRITER against a DIFFERENT TABLE: a lease the
// firm manages is not a lease comp in one broker's book, and a change to
// the vault's parsers must not silently change what a firm may file. What is
// NOT restated is the date arithmetic: `deadlineOf` and `daysUntil` are
// INJECTED from renewal-watch.js by the caller (broker-leads.js's
// `siblingsOf` shape), so "which date is the deadline" has one owner.
//
// ---------------------------------------------------------------------------
// IT REFUSES RATHER THAN GUESSES (broker-vault.js's rule).
// ---------------------------------------------------------------------------
// A lease row is what a colleague will act on months from now — a notice
// deadline stored the wrong way round schedules the decision for after it was
// due, which is the one outcome the critical-dates strip exists to prevent.
// So a transposed pair, a rent with no basis, an unknown status and a date in
// any shape but YYYY-MM-DD are refused by name, never stored as a best guess.
// ---------------------------------------------------------------------------

// The critical-dates window: the next twelve months. A deadline further out
// is not yet a thing to act on, and a strip that listed every lease the firm
// holds would be the leases table again with a different heading.
const WINDOW_DAYS = 365;

// Vocabulary validated, transitions deliberately unpoliced — bov-log.js's
// stance. `expired` is a status a person sets; nothing here sets it from the
// clock, because a lease that ran out may be month-to-month and still theirs.
const LEASE_STATUSES = ["active", "month-to-month", "renewed", "expired", "vacated"];
const RENT_BASES = ["annual", "monthly"];
const LEASE_TYPES = ["NNN", "FS", "MG"];

const MAX_TENANT = 120;
const MAX_SUITE = 40;
const MAX_NOTES = 2000;
const MAX_SIZE_SQFT = 50000000;

function str(v) { return v == null ? "" : String(v); }
function cleanText(v, max) {
  return str(v).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// YYYY-MM-DD and nothing else, checked against the calendar. The vault's
// parser accepts several shapes because it reads spreadsheets; this reads a
// form the page draws, and one shape means one meaning.
function parseDay(v) {
  const s = str(v).trim();
  if (!s) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return { ok: false };
  return { ok: true, value: s };
}

function parseSize(v) {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= MAX_SIZE_SQFT ? { ok: true, value: Math.round(v) } : { ok: false };
  const s = str(v).trim().toLowerCase().replace(/\s*(sq\.?\s*ft\.?|sf|square feet)$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const n = Number(s);
  return n > 0 && n <= MAX_SIZE_SQFT ? { ok: true, value: Math.round(n) } : { ok: false };
}

function parseRent(v) {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? { ok: true, value: Math.round(v * 100) / 100 } : { ok: false };
  const s = str(v).trim().replace(/^\$/, "").replace(/,/g, "").replace(/\s*(\/\s*sf.*|per\s+sf.*)$/i, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const n = Number(s);
  return n > 0 ? { ok: true, value: Math.round(n * 100) / 100 } : { ok: false };
}

function parseBasis(v) {
  const raw = str(v).trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return { ok: true, value: null };
  if (/^(annual|annually|annum|perannum|pa|year|yearly|yr|peryear)$/.test(raw)) return { ok: true, value: "annual" };
  if (/^(monthly|month|mo|permonth|pcm)$/.test(raw)) return { ok: true, value: "monthly" };
  return { ok: false };
}

function parseLeaseType(v) {
  const raw = str(v).trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return { ok: true, value: null };
  if (/^(nnn|triplenet|net|absolutenet|nn)$/.test(raw)) return { ok: true, value: "NNN" };
  if (/^(fs|fsg|fullservice|fullservicegross|gross)$/.test(raw)) return { ok: true, value: "FS" };
  if (/^(mg|modifiedgross|modified|ig|industrialgross)$/.test(raw)) return { ok: true, value: "MG" };
  return { ok: false };
}

/**
 * What one lease becomes before it is stored. `input` is the form as the
 * browser sent it (camelCase); `existing` is the stored row an edit is merged
 * over — an edit is validated as the WHOLE row it would become, so it cannot
 * accept what an add refuses.
 *
 * @returns {{ row: object|null, errors: string[] }}
 */
function validateLease(input, existing) {
  const p = input && typeof input === "object" ? input : {};
  const cur = existing && typeof existing === "object" ? existing : null;
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  const pick = (k, col) => (has(k) ? p[k] : (cur ? cur[col] : undefined));
  const errors = [];

  const tenant = cleanText(pick("tenant", "tenant"), MAX_TENANT);
  if (!tenant) errors.push("A tenant is required.");
  const suite = cleanText(pick("suite", "suite"), MAX_SUITE) || null;

  const size = parseSize(pick("sizeSqft", "size_sqft"));
  if (!size.ok) errors.push("Size must be a number of square feet, like 12,500.");

  const start = parseDay(pick("termStart", "term_start"));
  if (!start.ok) errors.push("Term start must be a date written YYYY-MM-DD.");
  const expiry = parseDay(pick("leaseExpiry", "lease_expiry"));
  if (!expiry.ok) errors.push("Lease expiry must be a date written YYYY-MM-DD.");
  else if (!expiry.value) errors.push("A lease expiry is required — it is the date the rest of this hangs off.");
  const notice = parseDay(pick("optionNoticeDate", "option_notice_date"));
  if (!notice.ok) errors.push("Option notice must be a date written YYYY-MM-DD.");

  // The transposition this pair invites, refused by name (broker-vault.js's
  // rule, restated): notice is given BEFORE a term ends, so the later date
  // is the expiry by definition. Only checked when both parsed.
  if (expiry.ok && notice.ok && expiry.value && notice.value && notice.value > expiry.value) {
    errors.push(`Option notice ${notice.value} is after the lease expiry ${expiry.value} — notice is given before a term ends, so these look swapped.`);
  }
  if (start.ok && expiry.ok && start.value && expiry.value && start.value > expiry.value) {
    errors.push(`Term start ${start.value} is after the lease expiry ${expiry.value}.`);
  }

  const rent = parseRent(pick("rentPsf", "rent_psf"));
  if (!rent.ok) errors.push("Rent must be a number per square foot, like 18.50.");
  const basis = parseBasis(pick("rentBasis", "rent_basis"));
  if (!basis.ok) errors.push("Rent basis must be annual or monthly.");
  // 029's rule, restated: a rent with no basis is a figure that is 12x wrong
  // half the time, and this module never guesses which half.
  if (rent.ok && rent.value && basis.ok && !basis.value) {
    errors.push("Say whether the rent is annual or monthly — it is not guessed.");
  }
  const type = parseLeaseType(pick("leaseType", "lease_type"));
  if (!type.ok) errors.push("Lease type must be NNN, FS or MG.");

  const statusRaw = str(pick("status", "status")).trim().toLowerCase() || "active";
  const status = LEASE_STATUSES.find((s) => s === statusRaw) || null;
  if (!status) errors.push(`Status must be one of: ${LEASE_STATUSES.join(", ")}.`);

  const notes = cleanText(pick("notes", "notes"), MAX_NOTES) || null;

  if (errors.length) return { row: null, errors };
  return {
    row: {
      tenant, suite, size_sqft: size.value,
      term_start: start.value, lease_expiry: expiry.value, option_notice_date: notice.value,
      rent_psf: rent.value, rent_basis: rent.value ? basis.value : (basis.value || null),
      lease_type: type.value, status, notes,
    },
    errors: [],
  };
}

// The wire shape, as an allowlist.
function toLease(row, viewerId) {
  if (!row || typeof row !== "object") return null;
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    id: row.id,
    buildingId: row.building_id,
    tenant: str(row.tenant),
    suite: str(row.suite),
    sizeSqft: num(row.size_sqft),
    termStart: row.term_start || null,
    leaseExpiry: row.lease_expiry || null,
    optionNoticeDate: row.option_notice_date || null,
    rentPsf: num(row.rent_psf),
    rentBasis: str(row.rent_basis),
    leaseType: str(row.lease_type),
    status: str(row.status) || "active",
    notes: str(row.notes),
    addedBy: str(row.added_by_name),
    mine: Boolean(row.added_by_user_id && viewerId && String(row.added_by_user_id) === String(viewerId)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// Which of a firm's leases have a date to act on in the next WINDOW_DAYS,
// soonest first. `deadlineOf` and `daysUntil` are renewal-watch.js's, passed
// in — never required — so this file does not decide what a deadline is.
// Vacated and expired leases are skipped: nothing is left to act on.
function criticalDates(leases, now, deadlineOf, daysUntil, buildings) {
  if (typeof deadlineOf !== "function" || typeof daysUntil !== "function") return [];
  const byBuilding = new Map((Array.isArray(buildings) ? buildings : []).map((b) => [String(b.id), b]));
  const out = [];
  for (const l of Array.isArray(leases) ? leases : []) {
    if (!l) continue;
    const status = str(l.status).toLowerCase();
    if (status === "vacated" || status === "expired") continue;
    const deadline = deadlineOf(l);
    if (!deadline) continue;
    const days = daysUntil(deadline.date, now);
    if (!Number.isFinite(days) || days < 0 || days > WINDOW_DAYS) continue;
    const b = byBuilding.get(String(l.building_id));
    out.push({
      leaseId: l.id, buildingId: l.building_id,
      address: b ? str(b.address) : "", tenant: str(l.tenant), suite: str(l.suite),
      kind: deadline.kind, date: deadline.date, days,
      leaseExpiry: l.lease_expiry || null, optionNoticeDate: l.option_notice_date || null,
    });
  }
  out.sort((a, b) => a.days - b.days || a.tenant.localeCompare(b.tenant));
  return out;
}

module.exports = {
  validateLease,
  toLease,
  criticalDates,
  LEASE_STATUSES,
  RENT_BASES,
  LEASE_TYPES,
  WINDOW_DAYS,
  MAX_TENANT,
  MAX_NOTES,
};
