// The renewal watch's copy and its "is this worth sending?" rule.
//
// Plan:   docs/superpowers/plans/2026-08-21-divide-and-conquer-to-aug-27.md (O4)
// Schema: migrations/038-lease-renewal-watch.sql
//
// THE SECOND THING THIS PRODUCT SENDS ON ITS OWN INITIATIVE, and the first one
// in a year. watchlist-digest.js is the other, and this file inherits its bar
// rather than forking it: when in doubt, send nothing. An empty inbox costs
// nothing; one boring email teaches somebody to ignore the next one, and there
// is no second chance at that.
//
// It differs from the digest in one way that matters, and the difference cuts
// toward sending rather than away from it. A digest is news a reader can
// catch up on later — the comps stay in their desk. A missed option-notice
// deadline cannot be caught up on at all: the right to renew simply lapses,
// on a date, and the tenant finds out by being told to leave. So where the
// digest withholds a market with nothing new, this withholds only a lease
// with nothing DUE, and it sends a lease's line even when the market figure
// that would have decorated it is missing (Owen, 2026-08-22).
//
// Pure: no I/O, no requires, no clock — the caller passes `now`, exactly as
// watchlist-digest.js does. Covered by npm test.

"use strict";

// How far ahead to mail, in days. Ninety because that is roughly the shortest
// runway on which a tenant can actually act: tour alternatives, get proposals
// back, and still give notice on time. Sixty was considered and rejected as
// too tight to do anything but renew.
//
// ONE email per lease, ever, and this is the number that makes that safe. A
// window rather than a drip: the second reminder is what turns a useful
// interruption into mail somebody filters, and the high-water mark
// (`renewal_notified_at`) is what enforces it.
const LEAD_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function str(v) { return v == null ? "" : String(v); }
function trimmed(v) { return str(v).trim(); }

// Midnight UTC for a "YYYY-MM-DD", or NaN. Date-only on purpose: a lease
// deadline is a calendar date in the world, not an instant, so it must not
// shift by a timezone. The dates arrive from a Postgres `date` column and are
// already in this shape; anything else is refused rather than coerced.
function dayMs(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed(ymd));
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // Rejects 2026-02-31, which Date.UTC would roll forward into March.
  return (d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1
    && d.getUTCDate() === Number(m[3])) ? t : NaN;
}

// Which date this lease is actually counting down to, and what to call it.
//
// The option notice wins whenever it exists, because it is the earlier and
// the harder deadline: the lease runs to its expiry either way, but the right
// to do anything about it dies at the notice date. A lease carrying only an
// expiry still has a decision point, so it falls back rather than being
// dropped — and the copy then says "expires" instead of "notice due", because
// telling somebody notice is due on a date when no notice is owed is a wrong
// statement about their own contract.
function deadlineOf(lease) {
  const notice = trimmed(lease && lease.option_notice_date);
  if (Number.isFinite(dayMs(notice))) return { date: notice, kind: "notice" };
  const expiry = trimmed(lease && lease.lease_expiry);
  if (Number.isFinite(dayMs(expiry))) return { date: expiry, kind: "expiry" };
  return null;
}

// Whole days from `now` to the deadline. Negative once it has passed.
function daysUntil(ymd, now) {
  const t = dayMs(ymd);
  if (!Number.isFinite(t)) return NaN;
  // `now` is floored to its own UTC day first, so "due today" is 0 rather
  // than -0.4 because the run happened after lunch.
  const n = new Date(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.round((t - today) / MS_PER_DAY);
}

// The send/skip decision for ONE lease, deliberately separate from the copy so
// a caller can ask "would this send?" without building an email — the dry-run
// path and the marker both need exactly that.
//
// Three ways a lease is not due, and the third is the one worth stating:
//   - it has already been mailed about (`renewal_notified_at` set). One email
//     per lease, ever.
//   - the deadline is further out than LEAD_DAYS. It will come round.
//   - **the deadline has PASSED.** Silence, permanently. A message saying a
//     deadline went by is not a reminder, it is a notification of a loss the
//     reader can do nothing about, and sending it would make this feature
//     something people turn off. If the watch was set up too late, the right
//     behaviour is to have said nothing.
function isDue(lease, now) {
  if (!lease) return false;
  if (trimmed(lease.renewal_notified_at)) return false;
  const deadline = deadlineOf(lease);
  if (!deadline) return false;
  const days = daysUntil(deadline.date, now);
  if (!Number.isFinite(days)) return false;
  return days >= 0 && days <= LEAD_DAYS;
}

function dueLeases(leases, now) {
  return (Array.isArray(leases) ? leases : []).filter((l) => isDue(l, now));
}

function worthSending(leases, now) {
  return dueLeases(leases, now).length > 0;
}

function plural(n, one, many) {
  return Number(n) === 1 ? one : (many || one + "s");
}

// A rent per square foot, on the basis the market actually quotes.
//
// 029's lesson, restated where it can do damage again: $1.35/SF is an ordinary
// MONTHLY industrial rent in California and an impossible annual one, so a
// figure without its basis is a number twelve times wrong half the time. The
// stored canonical is always annual (`rent_psf_yr`); this converts for display
// only, and always prints the unit.
// `exact` is the difference between the two figures this email prints, and it
// is not cosmetic. The market comparison is a MEDIAN over whatever leases that
// market has, where the cents are noise and a reader comparing two emails
// should see the figure move only when it really moved — the digest rounds its
// own median for exactly that reason. The lease's own rate is not a median: it
// is a number in a contract that the broker typed in themselves, and rounding
// $25.20 to $25 restates their own deal back at them slightly wrong. Print
// what they gave us.
function rentText(annualPsf, basis, exact) {
  const x = Number(annualPsf);
  if (!Number.isFinite(x) || x <= 0) return "";
  if (basis === "monthly") {
    // Two decimals monthly whichever it is, because a monthly rent lives in
    // the $1-$5 range where a rounded dollar throws away most of the signal.
    return "$" + (x / 12).toFixed(2) + "/SF/mo";
  }
  if (!exact) return "$" + Math.round(x) + "/SF/yr";
  // Trailing cents only when there are any: "$25.20" and "$25", never "$25.00".
  return "$" + (Number.isInteger(x) ? String(x) : x.toFixed(2)) + "/SF/yr";
}

// One lease, as a block. Address first because it is what the reader
// recognizes; the deadline second because it is why the email exists.
function leaseBlock(lease, now) {
  const deadline = deadlineOf(lease);
  const days = daysUntil(deadline.date, now);
  const addr = trimmed(lease.address) || "A lease in your vault";
  const lines = [addr];

  const what = deadline.kind === "notice"
    ? "Option notice due " + deadline.date
    : "Lease expires " + deadline.date;
  const when = days === 0 ? "today"
    : days === 1 ? "tomorrow"
    : "in " + days + " days";
  lines.push("  " + what + " — " + when);

  // What they pay against what comparable space is quoting. Both figures or
  // neither: one alone invites the reader to supply the other from memory,
  // which is the same as us guessing it for them.
  //
  // Deliberately NO verdict — no "you are overpaying", no percentage. The
  // comparison is a median over whatever comps that market has, the lease's
  // own rate carries a structure (NNN against full service) this figure does
  // not, and a confident-sounding gap between two numbers that are not
  // strictly comparable is exactly the kind of wrong-but-plausible statement
  // this codebase refuses elsewhere. Two figures, side by side, and the
  // broker draws their own conclusion — they are better placed to.
  const basis = lease.quote_basis === "monthly" ? "monthly" : "annual";
  const theirs = rentText(lease.rent_psf_yr, basis, true);   // their contract, exact
  const market = rentText(lease.market_rent_psf_yr, basis, false); // a median, rounded
  if (theirs) lines.push("  Paying " + theirs);
  if (market) {
    const n = Number(lease.market_rent_comps) || 0;
    lines.push("  Comparable space in " + (trimmed(lease.market) || "this market") +
      ": " + market + (n ? " (median of " + n + " " + plural(n, "lease") + ")" : ""));
  }
  return lines.join("\n");
}

// The subject line. One lease gets named by its address, because a named
// building is the difference between a subject somebody opens and one they
// archive. Several get a count — a subject line listing four addresses is a
// wall, and the addresses are the first thing in the body anyway.
function subjectFor(due) {
  if (due.length === 1) {
    const d = deadlineOf(due[0]);
    const what = d.kind === "notice" ? "Option notice" : "Lease expiry";
    return what + " coming up: " + (trimmed(due[0].address) || "a lease you track");
  }
  return due.length + " leases you track have deadlines coming up";
}

// Builds the whole email, or returns null when nothing is due.
//
// Null rather than an empty string, watchlist-digest.js's rule and its reason:
// the caller must not be able to send a blank reminder by forgetting to check.
//
// `deskUrl` and `unsubscribeUrl` are passed in so this module never has to
// know about SITE_URL, tokens, or how an unsubscribe authenticates itself.
function buildRenewalNotice({ leases, now, deskUrl, unsubscribeUrl }) {
  const due = dueLeases(leases, now);
  if (!due.length) return null;

  // Soonest first. A list ordered by anything else buries the one the reader
  // has least time to act on.
  due.sort((a, b) => dayMs(deadlineOf(a).date) - dayMs(deadlineOf(b).date));

  const body = [
    due.length === 1
      ? "A lease you track has a deadline coming up."
      : due.length + " leases you track have deadlines coming up.",
    "",
    due.map((l) => leaseBlock(l, now)).join("\n\n"),
    "",
    "Your leases are in your vault: " + deskUrl,
    "",
    // Two separate facts, and the reader needs both: WHY this arrived (they
    // put the dates in themselves, which is not obvious months later) and HOW
    // to stop it. Never one sentence — "you subscribed, unsubscribe here"
    // reads as a marketing footer and gets skimmed past.
    "You are receiving this because you recorded these dates on leases in your CompNinja vault.",
    "Turn these emails off: " + unsubscribeUrl,
    "",
    // The same disclaimer the digest carries, for the same reason: a rent
    // figure in this email is a median of public comps, and nothing here has
    // read the lease it is sitting beside.
    "Rent figures are automated estimates drawn from public records and listings, never an appraisal. Check your own lease for the dates that bind you.",
  ].join("\n");

  return { subject: subjectFor(due), text: body };
}

module.exports = {
  buildRenewalNotice,
  worthSending,
  isDue,
  dueLeases,
  deadlineOf,
  daysUntil,
  subjectFor,
  LEAD_DAYS,
};
