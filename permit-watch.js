"use strict";
// permit-watch.js — the rules for a member tracking their OWN permit on the
// Permit tracker (2026-09-27, owner's call: "add a way to add your own permit
// into the tracker and have custom notifications that would notify you by
// email, and on CompNinja once that step in the permit is complete").
//
// Pure: no I/O, no clock reads (the caller passes `now`), no requires.
// server.js owns the portal lookup (permit-portals.js's lookupPermit), the
// tables (migration 054) and the sends; this file decides what a status
// MEANS, what changed, and who is told what.
//
// FIVE STEPS, READ FROM WHATEVER THE CITY PRINTS. A portal status is free
// text ("Applicant Upload", "Prep for Issuance", "Finaled"), different per
// city and never promised to stay put. classifyStatus maps it onto one of five
// plain steps a person recognises — Submitted, In review, Approved, Issued,
// Finaled — and a status it cannot place maps to NO step rather than a guess.
// The rule is the badge rule's: under-claim, never over-claim. Telling
// somebody "your permit is issued" when it is not is the one mistake this
// feature cannot make; missing a step is recoverable, because the raw status
// is always shown beside the steps and "every status change" still fires.
//
// A STEP IS COMPLETE ONCE, EVER. `passed_steps` on the watch is the ledger of
// steps this permit has been seen at or past. A status that jumps two steps
// ("In Review" straight to "Issued") completes both, and a permit that drops
// back ("Issued" to "Returned to Applicant") does not un-complete anything, so
// a step's notice is never sent twice. When a permit is first read (the
// moment it is added) every step up to its current one is marked passed
// WITHOUT a notice: a member adding an issued permit is not told it was just
// approved.
//
// MARKED ONLY AFTER THE SEND (CLAUDE.md rule 12). The decision below writes
// an EVENT row carrying `email_due`; the sweep sends and then stamps
// `emailed_at`. A failed or skipped send leaves the event due, and the next
// run retries it inside EMAIL_WINDOW_DAYS — the digest's "a duplicate is
// annoying, a lost notice is invisible" argument, applied per permit.

const STEPS = Object.freeze([
  Object.freeze({ key: "submitted", label: "Submitted" }),
  Object.freeze({ key: "review", label: "In review" }),
  Object.freeze({ key: "approved", label: "Approved" }),
  Object.freeze({ key: "issued", label: "Issued" }),
  Object.freeze({ key: "final", label: "Finaled" }),
]);
const STEP_KEYS = Object.freeze(STEPS.map((s) => s.key));
// The steps a member can ask to hear about. "Submitted" is not one: a permit
// has a number to track only once it has been submitted.
const NOTIFY_STEP_KEYS = Object.freeze(["review", "approved", "issued", "final"]);
const DEFAULT_NOTIFY = Object.freeze({
  steps: Object.freeze(["approved", "issued", "final"]),
  any: false,      // every status change, step or not
  alerts: true,    // returned for corrections, on hold, denied, expired, withdrawn
  email: true,
  app: true,       // the unread count on the Permit tracker, and the page's "New"
});

const MAX_WATCHES_PER_USER = 25;
const LABEL_MAX = 80;
// A due email older than this is not sent at all: a week-old "your permit was
// approved" arriving the day mail is switched on is news to nobody.
const EMAIL_WINDOW_DAYS = 7;
// Unique permits one sweep re-checks, stalest first. Each is two portal
// requests and a politeness pause, and the sweep runs inside a scheduled job
// with a timeout, so the cap keeps a large watch list from starving the city
// sweep that shares the run.
const SWEEP_CHECK_CAP = 200;

function stepIndex(key) {
  return STEP_KEYS.indexOf(key);
}
function stepLabel(key) {
  const s = STEPS.find((x) => x.key === key);
  return s ? s.label : "";
}

function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}
function nonEmpty(v) {
  const s = clean(v);
  return s || null;
}

// A portal status -> { step, flag }. `step` is a STEP_KEYS entry or null (no
// step claimed); `flag` is "attention" (the city wants something, or stopped),
// "ended" (it will not complete), or null. Order matters and is the point:
// "Ready to Issue" is approved, not issued; "Final Inspection Scheduled" is
// issued, not finaled; "Review Complete" is approved, not finaled;
// "Incomplete" is attention, not complete.
function classifyStatus(status) {
  const s = clean(status).toLowerCase();
  if (!s || s === "(blank)") return { step: null, flag: null };
  if (/\b(expired|withdrawn|withdrew|void(ed)?|cancell?ed|denied|revoked|rejected|abandoned|disapproved|not approved)\b/.test(s)) {
    return { step: null, flag: "ended" };
  }
  if (/\b(on hold|hold|suspended|stop work)\b/.test(s)) return { step: null, flag: "attention" };
  if (/returned|correction|resubmi|incomplete|deficien|additional info|revisions? (required|requested)/.test(s)) {
    return { step: "review", flag: "attention" };
  }
  if (/\bfinal/.test(s) && /(schedul|request|pending|ready for|awaiting|failed)/.test(s)) {
    return { step: "issued", flag: null };
  }
  if (/\bfinal(ed|ized)?\b|\bclosed\b|certificate of occupancy|\bc\.? ?of ?o\b|\bco issued\b|^(work |project |permit )?complet(e|ed)$/.test(s)) {
    return { step: "final", flag: null };
  }
  if (/approv|ready to issue|ready for issu|prep(are|aration)? for issu|pending issu|awaiting issu|to be issued|payment|fees? due|reviews? complete/.test(s)) {
    return { step: "approved", flag: null };
  }
  if (/\bissued\b|\bactive\b|inspection|under construction/.test(s)) return { step: "issued", flag: null };
  if (/review|in progress|routing|routed|plan check|processing|screening complete/.test(s)) {
    return { step: "review", flag: null };
  }
  if (/submitted|applied|application|received|upload|pre-?screen|intake|accepted|pending|filed|\bnew\b|\bopen\b/.test(s)) {
    return { step: "submitted", flag: null };
  }
  return { step: null, flag: null };
}

// Every step up to and including `key`, in order.
function stepsThrough(key) {
  const i = stepIndex(key);
  return i < 0 ? [] : STEP_KEYS.slice(0, i + 1);
}

// The furthest step a ledger has reached, or null.
function furthestStep(passed) {
  let best = -1;
  for (const k of Array.isArray(passed) ? passed : []) best = Math.max(best, stepIndex(k));
  return best < 0 ? null : STEP_KEYS[best];
}

function inStepOrder(keys) {
  const set = new Set(Array.isArray(keys) ? keys : []);
  return STEP_KEYS.filter((k) => set.has(k));
}

// "BLD26-02789", "c-new-2026-0052 " -> upper-cased, single-spaced. Portal
// numbers are letters, digits and a few separators; anything else is a typo or
// something that is not a permit number, refused before it reaches a portal.
function normalizePermitNumber(v) {
  const s = clean(v).toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-_./ ]{1,39}$/.test(s) ? s : null;
}

// Notification settings from a request body, over `base`. Unknown steps are
// dropped, booleans must BE booleans (a string "false" is truthy, and a
// setting that silently inverts is worse than one that is ignored).
function normalizeNotify(input, base) {
  const b = base || DEFAULT_NOTIFY;
  const n = input && typeof input === "object" ? input : {};
  const out = {
    steps: Array.isArray(n.steps)
      ? NOTIFY_STEP_KEYS.filter((k) => n.steps.includes(k))
      : NOTIFY_STEP_KEYS.filter((k) => (b.steps || []).includes(k)),
    any: typeof n.any === "boolean" ? n.any : Boolean(b.any),
    alerts: typeof n.alerts === "boolean" ? n.alerts : Boolean(b.alerts),
    email: typeof n.email === "boolean" ? n.email : Boolean(b.email),
    app: typeof n.app === "boolean" ? n.app : Boolean(b.app),
  };
  return out;
}

function notifyColumns(notify) {
  return {
    notify_steps: notify.steps.slice(),
    notify_any: notify.any,
    notify_alerts: notify.alerts,
    notify_email: notify.email,
    notify_app: notify.app,
  };
}

function notifyOfRow(row) {
  const r = row || {};
  return {
    steps: NOTIFY_STEP_KEYS.filter((k) => (Array.isArray(r.notify_steps) ? r.notify_steps : []).includes(k)),
    any: r.notify_any === true,
    alerts: r.notify_alerts === true,
    email: r.notify_email === true,
    app: r.notify_app === true,
  };
}

function cleanLabel(v) {
  return clean(v).slice(0, LABEL_MAX);
}

// POST /api/permits/watch's body -> { ok, value } | { ok: false, error }.
// `cities` is the list of jurisdiction keys the sweep reads: a permit in a
// city we do not read would sit in the list never checked, which is the page
// claiming to watch something it cannot see (spec §7's rule, per permit).
function validateWatchInput(body, { cities, cityLabels } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const keys = Array.isArray(cities) ? cities : [];
  const jurisdiction = clean(b.jurisdiction).toLowerCase();
  if (!keys.includes(jurisdiction)) {
    const names = Array.isArray(cityLabels) && cityLabels.length ? cityLabels.join(" or ") : "a city we read";
    return { ok: false, error: `Pick the city that issued the permit: ${names}.` };
  }
  const permitNumber = normalizePermitNumber(b.permitNumber);
  if (!permitNumber) {
    return { ok: false, error: "Enter the permit number exactly as the city prints it, for example BLD26-02789." };
  }
  return {
    ok: true,
    value: { jurisdiction, permit_number: permitNumber, label: cleanLabel(b.label) || null, notify: normalizeNotify(b.notify) },
  };
}

// PATCH /api/permits/watch's body -> the columns to write. Only a nickname and
// the notification settings are editable: the city and number ARE the permit,
// and a different one is a different watch.
function validateWatchPatch(body, row) {
  const b = body && typeof body === "object" ? body : {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(b, "label")) patch.label = cleanLabel(b.label) || null;
  if (b.notify && typeof b.notify === "object") Object.assign(patch, notifyColumns(normalizeNotify(b.notify, notifyOfRow(row))));
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to change." };
  return { ok: true, patch };
}

// The watch row written when a member adds a permit, from the add-time lookup
// (null when the portal could not be reached — the sweep reads it next).
function newWatchRow(userId, value, lookup, now) {
  const found = lookup && lookup.found ? lookup : null;
  const status = found ? nonEmpty(found.status) : null;
  const cls = classifyStatus(status);
  return {
    user_id: userId,
    jurisdiction: value.jurisdiction,
    permit_number: value.permit_number,
    label: value.label,
    address: found ? nonEmpty(found.address) : null,
    description: found ? nonEmpty(found.project_name) || nonEmpty(found.description) : null,
    source_url: found && /^https?:\/\//i.test(String(found.source_url || "")) ? found.source_url : null,
    status,
    status_changed_at: null,
    last_checked_at: found ? new Date(now).toISOString() : null,
    check_error: found ? null : "Not checked yet — the city's portal did not answer. We'll read it on the next weekday sweep.",
    passed_steps: cls.step ? stepsThrough(cls.step) : [],
    ...notifyColumns(value.notify),
  };
}

// The name a person knows a permit by, for a notice: their nickname, else the
// street line the portal printed, else nothing (the number always rides too).
function displayName(watch) {
  return nonEmpty(watch && watch.label) || nonEmpty(String((watch && watch.address) || "").split(",")[0]) || "";
}

function joinWords(list) {
  const l = list.filter(Boolean);
  if (l.length <= 1) return l[0] || "";
  return l.slice(0, -1).join(", ") + " and " + l[l.length - 1];
}

// The one-line headline a notice leads with.
function headlineFor(kind, steps) {
  if (kind === "step") return `${steps.length > 1 ? "Steps" : "Step"} complete: ${joinWords(steps.map(stepLabel))}`;
  if (kind === "ended") return "Permit ended";
  if (kind === "attention") return "Needs attention";
  if (kind === "change") return "Status changed";
  return "";
}

// One re-read of a watched permit -> what to write. `lookup` is lookupPermit's
// answer. Returns { watchPatch, event } where event is null when nothing
// happened worth recording. The caller stamps last_checked_at itself.
function decideCheck(watch, lookup, now) {
  const w = watch || {};
  const stamp = new Date(now).toISOString();
  if (!lookup || !lookup.found) {
    return { watchPatch: { check_error: "The city's portal no longer finds this permit number." }, event: null };
  }
  const neu = nonEmpty(lookup.status);
  const old = nonEmpty(w.status);
  const fill = {};
  // The portal's own facts fill blanks only — a nickname or an address the
  // first read got is never overwritten by a later, emptier page.
  if (!nonEmpty(w.address) && nonEmpty(lookup.address)) fill.address = nonEmpty(lookup.address);
  if (!nonEmpty(w.source_url) && /^https?:\/\//i.test(String(lookup.source_url || ""))) fill.source_url = lookup.source_url;
  if (!nonEmpty(w.description) && (nonEmpty(lookup.project_name) || nonEmpty(lookup.description))) {
    fill.description = nonEmpty(lookup.project_name) || nonEmpty(lookup.description);
  }
  if (!neu || neu === old || (neu === "(blank)")) return { watchPatch: { ...fill, check_error: null }, event: null };

  const cls = classifyStatus(neu);
  const passed = inStepOrder(w.passed_steps);
  const nowPassed = cls.step ? inStepOrder([...passed, ...stepsThrough(cls.step)]) : passed;
  const watchPatch = { ...fill, check_error: null, status: neu, status_changed_at: stamp, passed_steps: nowPassed };

  if (!old) {
    // The first status we have ever read (the add-time lookup could not reach
    // the portal). Nothing CHANGED as far as we know, so nothing is announced.
    return {
      watchPatch,
      event: { kind: "first", old_status: null, new_status: neu, steps: [], notice: null, app: false, email_due: false, detected_at: stamp },
    };
  }

  const notify = notifyOfRow(w);
  const gained = nowPassed.filter((k) => !passed.includes(k));
  const wanted = gained.filter((k) => notify.steps.includes(k));
  let kind = null;
  if (wanted.length) kind = "step";
  else if (cls.flag === "ended" && notify.alerts) kind = "ended";
  else if (cls.flag === "attention" && notify.alerts) kind = "attention";
  else if (notify.any) kind = "change";
  const notice = kind ? headlineFor(kind, wanted) : null;
  return {
    watchPatch,
    event: {
      kind: kind || "quiet",
      old_status: old,
      new_status: neu,
      steps: wanted,
      notice,
      app: Boolean(notice && notify.app),
      email_due: Boolean(notice && notify.email),
      detected_at: stamp,
    },
  };
}

// The permits one sweep re-checks: one lookup per (city, number) however many
// members watch it, stalest first, capped. Only cities the sweep reads.
function dueChecks(watches, { cities, cap } = {}) {
  const keys = Array.isArray(cities) ? cities : [];
  const byKey = new Map();
  for (const w of watches || []) {
    if (!w || !keys.includes(w.jurisdiction) || !w.permit_number) continue;
    const k = `${w.jurisdiction} ${String(w.permit_number).toUpperCase()}`;
    if (!byKey.has(k)) byKey.set(k, { jurisdiction: w.jurisdiction, permit_number: String(w.permit_number).toUpperCase(), watches: [], checked: "" });
    const g = byKey.get(k);
    g.watches.push(w);
    const c = String(w.last_checked_at || "");
    // The group's age is its STALEST member's: a permit one member added
    // today and another has had for a month is overdue for the second.
    if (g.watches.length === 1 || c < g.checked) g.checked = c;
  }
  const n = Number.isFinite(cap) ? cap : SWEEP_CHECK_CAP;
  return [...byKey.values()]
    .sort((a, b) => a.checked.localeCompare(b.checked) || a.permit_number.localeCompare(b.permit_number))
    .slice(0, n);
}

function shortDate(iso) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// One member's due notices -> { subject, text }, or null with nothing to say
// (a caller cannot mail a blank email by forgetting to check — the digest's
// rule). `items` are { watch, event } pairs; `cityOf` names a jurisdiction.
function buildNoticeEmail({ items, siteUrl, cityOf } = {}) {
  const list = (items || []).filter((x) => x && x.watch && x.event && x.event.notice);
  if (!list.length) return null;
  const city = (w) => (typeof cityOf === "function" ? cityOf(w.jurisdiction) : "") || "";
  const subject = list.length === 1
    ? `${list[0].event.notice} · ${[city(list[0].watch), "permit", list[0].watch.permit_number].filter(Boolean).join(" ")}`
    : `${list.length} permit updates`;
  const blocks = list.map(({ watch: w, event: e }) => {
    const name = displayName(w);
    const lines = [
      `${[city(w), "permit", w.permit_number].filter(Boolean).join(" ")}${name ? ` — ${name}` : ""}`,
      e.notice,
      `The city's portal now reads “${e.new_status}”${e.old_status ? ` (it read “${e.old_status}”)` : ""}. Seen ${shortDate(e.detected_at)}.`,
    ];
    if (w.source_url) lines.push(`Portal record: ${w.source_url}`);
    return lines.join("\n");
  });
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const text = [
    list.length === 1 ? "An update on a permit you're tracking on CompNinja." : "Updates on permits you're tracking on CompNinja.",
    "",
    blocks.join("\n\n"),
    "",
    `See each permit's history, or change which steps notify you: ${base}/permits`,
    "",
    "CompNinja reads each city's public permit portal on weekday mornings, so a status can change on the portal a day before we see it. " +
      "You're getting this because you asked for email updates when you started tracking the permit; switch them off per permit on the Permit tracker.",
  ].join("\n");
  return { subject, text };
}

// One stored watch + its events -> what the page draws. camelCase, nothing
// the page does not use.
function watchView(row, events, { cityOf } = {}) {
  const r = row || {};
  const cls = classifyStatus(r.status);
  const passed = inStepOrder(r.passed_steps);
  const mine = (events || [])
    .filter((e) => e && String(e.watch_id) === String(r.id))
    .sort((a, b) => String(b.detected_at || "").localeCompare(String(a.detected_at || "")));
  return {
    id: r.id,
    jurisdiction: String(r.jurisdiction || ""),
    city: typeof cityOf === "function" ? String(cityOf(r.jurisdiction) || "") : "",
    permitNumber: String(r.permit_number || ""),
    label: String(r.label || ""),
    address: String(r.address || ""),
    description: String(r.description || ""),
    sourceUrl: /^https?:\/\//i.test(String(r.source_url || "")) ? String(r.source_url) : "",
    status: String(r.status || ""),
    flag: cls.flag,
    // The step the page lights is the LEDGER's furthest, not the current
    // status's: a permit returned for corrections after approval has still
    // been approved.
    step: furthestStep(passed),
    steps: STEPS.map((s) => ({ key: s.key, label: s.label, done: passed.includes(s.key) })),
    statusChangedAt: r.status_changed_at || null,
    lastCheckedAt: r.last_checked_at || null,
    checkError: String(r.check_error || ""),
    notify: notifyOfRow(r),
    history: mine.map((e) => ({
      id: e.id,
      from: String(e.old_status || ""),
      to: String(e.new_status || ""),
      notice: String(e.notice || ""),
      kind: String(e.kind || ""),
      at: e.detected_at || null,
      unread: e.app === true && !e.seen_at,
    })),
    unread: mine.filter((e) => e.app === true && !e.seen_at).length,
  };
}

function unreadCount(events) {
  return (events || []).filter((e) => e && e.app === true && !e.seen_at).length;
}

module.exports = {
  STEPS, STEP_KEYS, NOTIFY_STEP_KEYS, DEFAULT_NOTIFY,
  MAX_WATCHES_PER_USER, LABEL_MAX, EMAIL_WINDOW_DAYS, SWEEP_CHECK_CAP,
  stepIndex, stepLabel, classifyStatus, stepsThrough, furthestStep,
  normalizePermitNumber, normalizeNotify, notifyColumns, notifyOfRow,
  validateWatchInput, validateWatchPatch, newWatchRow, displayName, headlineFor,
  decideCheck, dueChecks, buildNoticeEmail, watchView, unreadCount,
};
