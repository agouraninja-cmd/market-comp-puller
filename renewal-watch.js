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
  const addr = trimmed(lease.address) || "One of your lease comps";
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
    "Your leases are with your comps: " + deskUrl,
    "",
    // Two separate facts, and the reader needs both: WHY this arrived (they
    // put the dates in themselves, which is not obvious months later) and HOW
    // to stop it. Never one sentence — "you subscribed, unsubscribe here"
    // reads as a marketing footer and gets skimmed past.
    "You are receiving this because you recorded these dates on lease comps in CompNinja.",
    "Turn these emails off: " + unsubscribeUrl,
    "",
    // The same disclaimer the digest carries, for the same reason: a rent
    // figure in this email is a median of public comps, and nothing here has
    // read the lease it is sitting beside.
    "Rent figures are automated estimates drawn from public records and listings, never an appraisal. Check your own lease for the dates that bind you.",
  ].join("\n");

  return { subject: subjectFor(due), text: body };
}

// ---------------------------------------------------------------------------
// THE FIRM'S LEASES (org_leases, migration 048), mailed since 2026-11-20.
//
// A different noun from everything above: a lease the FIRM manages, on a
// building on its list, with a tenant and a suite, where the lines above are
// about a lease COMP in one broker's own book. The copy says so, and the
// arithmetic is the same (`deadlineOf`, `daysUntil`, LEAD_DAYS), because
// "which date is the deadline" has one owner.
//
// Who is mailed is the caller's decision (server.js: the firm's owners and
// the member who filed the lease). Four rules live here:
//   - TWO emails per lease date at most: the first inside LEAD_DAYS, and a
//     last one inside FIRM_FINAL_DAYS (2026-11-21, the owner: "Build the not
//     built"). One column holds both (`renewal_notified_at`): the last one is
//     due only when the mark was set MORE than FIRM_FINAL_DAYS before the
//     date, so a first email that already went inside the last two weeks
//     (a lease filed late) is never followed by a second. The lease route
//     clears the mark when somebody changes a lease's dates.
//   - A LAPSED OPTION NOTICE HANDS OVER TO THE EXPIRY, org-leases.js's
//     criticalDates rule. A lease filed after its notice date went by still
//     ends on a day the firm can act on, and nobody has been told about it.
//   - Vacated and expired leases are skipped: nothing is left to act on.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2027-01-15" as "Jan 15, 2027", from its own three numbers. Never
// Date.parse: midnight UTC is the day before, west of Greenwich.
function prettyDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed(ymd));
  if (!m || !Number.isFinite(dayMs(ymd))) return trimmed(ymd);
  return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
}

// The date this firm lease is counting down to, or null.
function firmLeaseDeadline(lease, now) {
  let deadline = deadlineOf(lease);
  if (!deadline) return null;
  let days = daysUntil(deadline.date, now);
  if (deadline.kind === "notice" && Number.isFinite(days) && days < 0) {
    deadline = deadlineOf({ lease_expiry: lease.lease_expiry });
    if (!deadline) return null;
    days = daysUntil(deadline.date, now);
  }
  if (!Number.isFinite(days)) return null;
  return { date: deadline.date, kind: deadline.kind, days };
}

// Two weeks: long enough to send a notice that is still a decision, short
// enough that it reads as the last call rather than a second copy.
const FIRM_FINAL_DAYS = 14;

// Which email a firm lease is owed now: "first", "final", or null.
function firmLeaseStage(lease, now) {
  if (!lease) return null;
  const status = trimmed(lease.status).toLowerCase();
  if (status === "vacated" || status === "expired") return null;
  const d = firmLeaseDeadline(lease, now);
  if (!d || d.days < 0 || d.days > LEAD_DAYS) return null;
  const mark = trimmed(lease.renewal_notified_at);
  if (!mark) return "first";
  if (d.days > FIRM_FINAL_DAYS) return null;
  // The mark's own calendar day against the deadline's. Unreadable reads as
  // already told: under-send, never repeat.
  const markDay = dayMs(mark.slice(0, 10));
  if (!Number.isFinite(markDay)) return null;
  const gap = Math.round((dayMs(d.date) - markDay) / MS_PER_DAY);
  return gap > FIRM_FINAL_DAYS ? "final" : null;
}

function firmLeaseDue(lease, now) {
  return firmLeaseStage(lease, now) !== null;
}

function dueFirmLeases(leases, now) {
  return (Array.isArray(leases) ? leases : []).filter((l) => firmLeaseDue(l, now));
}

// The firm's own rent, in the basis the firm recorded. No basis, no figure
// (029's rule: never guess which half of 12x it is).
function firmRentText(lease) {
  const x = Number(lease.rent_psf);
  const basis = trimmed(lease.rent_basis);
  if (!Number.isFinite(x) || x <= 0 || (basis !== "annual" && basis !== "monthly")) return "";
  const figure = basis === "monthly" || !Number.isInteger(x) ? x.toFixed(2) : String(x);
  return "$" + figure + (basis === "monthly" ? "/SF/mo" : "/SF/yr");
}

function firmLeaseName(lease) {
  const tenant = trimmed(lease.tenant) || "A tenant";
  const suite = trimmed(lease.suite);
  // "Suite" only when the firm did not already write it.
  return tenant + (suite ? ", " + (/^(suite|ste|unit|#)/i.test(suite) ? suite : "Suite " + suite) : "");
}

function firmLeaseBlock(lease, now) {
  const d = firmLeaseDeadline(lease, now);
  const when = d.days === 0 ? "today" : d.days === 1 ? "tomorrow" : "in " + d.days + " days";
  const lines = [firmLeaseName(lease)];
  if (trimmed(lease.address)) lines.push(trimmed(lease.address));
  lines.push("  " + (d.kind === "notice" ? "Option notice due " : "Lease expires ") + prettyDay(d.date) + ", " + when);
  // The expiry too, when the countdown is to the notice: the two dates are
  // one decision.
  if (d.kind === "notice" && Number.isFinite(dayMs(lease.lease_expiry))) {
    lines.push("  Lease expires " + prettyDay(lease.lease_expiry));
  }
  const size = Number(lease.size_sqft);
  const rent = firmRentText(lease);
  const type = trimmed(lease.lease_type);
  const facts = [
    Number.isFinite(size) && size > 0 ? Math.round(size).toLocaleString("en-US") + " SF" : "",
    rent ? rent + (type ? " " + type : "") : "",
  ].filter(Boolean);
  if (facts.length) lines.push("  " + facts.join(" at "));
  if (trimmed(lease.added_by_name)) lines.push("  Filed by " + trimmed(lease.added_by_name));
  if (trimmed(lease.url)) lines.push("  " + trimmed(lease.url));
  return lines.join("\n");
}

function firmSubjectFor(due, firmName, now) {
  // "Reminder:" only when every lease in it has been mailed about before.
  const again = due.every((l) => firmLeaseStage(l, now) === "final") ? "Reminder: " : "";
  return again + firmSubjectCore(due, firmName, now);
}

function firmSubjectCore(due, firmName, now) {
  if (due.length === 1) {
    const d = firmLeaseDeadline(due[0], now);
    const what = d.kind === "notice" ? "Option notice" : "Lease expiry";
    const where = trimmed(due[0].address);
    return what + " coming up: " + (trimmed(due[0].tenant) || "a tenant") + (where ? " at " + where : "");
  }
  return due.length + " leases at " + (trimmed(firmName) || "your firm") + " have dates coming up";
}

// Builds one recipient's email for one firm, or returns null when nothing is
// due. `role` is why this person is being told: "owner" of the firm, or the
// "filer" of these leases. Each lease carries `address` (its building's) and
// `url` (the building's page), stitched on by the caller.
function buildFirmLeaseNotice({ leases, now, firmName, role, buildingsUrl, unsubscribeUrl }) {
  const due = dueFirmLeases(leases, now);
  if (!due.length) return null;
  due.sort((a, b) => firmLeaseDeadline(a, now).days - firmLeaseDeadline(b, now).days
    || trimmed(a.tenant).localeCompare(trimmed(b.tenant)));
  const firm = trimmed(firmName) || "your firm";

  const body = [
    due.length === 1
      ? "A lease at " + firm + " has a date coming up."
      : due.length + " leases at " + firm + " have dates coming up.",
    "",
    due.map((l) => firmLeaseBlock(l, now)).join("\n\n"),
    "",
    "Every date your firm is tracking: " + buildingsUrl,
    "",
    // WHY and HOW TO STOP, as two facts (the rule above).
    role === "owner"
      ? "You are receiving this because you are an owner of " + firm + " on CompNinja."
      : "You are receiving this because you filed " + (due.length === 1 ? "this lease" : "these leases") +
        " for " + firm + " on CompNinja.",
    "Each date is mailed about twice: " + LEAD_DAYS + " days and " + FIRM_FINAL_DAYS +
      " days before. An owner can turn these off for the firm in its settings on Home.",
    "Turn these emails off: " + unsubscribeUrl,
    "",
    "These dates are as your firm recorded them. Check the lease itself for the dates that bind you.",
  ].join("\n");

  return { subject: firmSubjectFor(due, firmName, now), text: body };
}

module.exports = {
  buildFirmLeaseNotice,
  firmLeaseDue,
  firmLeaseStage,
  dueFirmLeases,
  FIRM_FINAL_DAYS,
  firmLeaseDeadline,
  prettyDay,
  buildRenewalNotice,
  worthSending,
  isDue,
  dueLeases,
  deadlineOf,
  daysUntil,
  subjectFor,
  LEAD_DAYS,
};
