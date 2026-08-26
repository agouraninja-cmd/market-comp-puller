"use strict";
// ---------------------------------------------------------------------------
// Who may read, write, and add to a messaging hub.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
// Schema: migrations/024-messaging-hub.sql
//
// NOT the connection hub (/brokers), not the Dev hub (/dev). See the spec's
// naming warning; ROADMAP's "Hub ratings" and "Hub monetization" lines are
// about the broker directory and predate this file.
//
// PURE, like report-access.js, entitlements.js and comp-gate.js: no I/O, no
// requires, no clock reads. server.js owns the reads (the hub row, the
// participant row, the session) and hands them in. That is what lets
// `npm test` prove the gate holds with no database.
//
// Three functions answer the three questions, and nothing else in the
// codebase may answer them. Scattered checks are how a paywall grows holes,
// and this guards something worse than a comp count: a broker's private deals
// sitting in front of a named third party.
//
// `tokenValid` is a BOOLEAN, not a token. server.js does the sha256 and the
// constant-time compare and hands in the verdict. Keeping the crypto out is
// what keeps this file pure, and it lets the tests express "a valid token"
// without a hash or a database.
//
// EVERYTHING FAILS CLOSED. An unrecognized role is an observer (read, never
// write), never a broker: a typo in a column must never grant a write, the
// same way report-access.js treats an unrecognized visibility as invited and
// never as public.
// ---------------------------------------------------------------------------

// Roles that may post. 'observer' is deliberately absent: it exists so a
// broker can put a colleague or a principal in a hub to watch without the
// tenant seeing two people typing.
const ROLES = ["broker", "tenant", "observer"];
const WRITE_ROLES = ["broker", "tenant"];

// The comp pipeline, in the order it is shown. This list is the vocabulary,
// and it must agree with the CHECK constraint in migration 024 — the
// constraint stops a bad row, this stops the request before it becomes one,
// with copy a person can read instead of a PostgREST 400.
//
// 'new' is where every comp lands and is deliberately not a verdict: a comp
// nobody has ruled on yet is not the same as one that was passed on.
const ITEM_STATUSES = ["new", "shortlist", "toured", "passed"];

// Copied in shape from report-access.js on purpose: an invite and an account
// must agree on what "the same person" means, and these two files decide that
// for the two halves of the same sharing story.
function normalizeEmail(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  // Deliberately loose: one @, something either side, no whitespace. Real
  // deliverability is Resend's problem; this only has to stop junk becoming a
  // participant row that can never match.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

// An unrecognized or missing role reads as the least-privileged one. The
// check constraint in 024 and this function agree on purpose: the constraint
// stops the row being written, this stops the write if the row exists anyway
// (a hand-run UPDATE in the SQL editor, a future migration typo).
function roleOf(participant) {
  const r = participant && typeof participant.role === "string"
    ? participant.role.trim().toLowerCase()
    : "";
  return ROLES.includes(r) ? r : "observer";
}

function sameUser(a, b) {
  return a != null && b != null && String(a) === String(b);
}

// Is this session the person named on this participant row? Two ways to be,
// and the email is the authoritative one (migration 018's rule: identity is
// the email, so a tenant invited before they had an account matches the
// moment they sign up with that address).
function isParticipantUser(participant, user) {
  if (!participant || !user) return false;
  if (sameUser(participant.user_id, user.id)) return true;
  const mine = normalizeEmail(user.email);
  return !!mine && normalizeEmail(participant.email) === mine;
}

/**
 * May this caller READ the hub?
 *
 * @param {object|null}  o.hub          a hubs row: { id, owner_user_id, status, closed_at }
 * @param {object|null}  o.participant  the hub_participants row this caller resolved to, or null
 * @param {object|null}  o.user         from getSessionUser(): { id, email } or null
 * @param {boolean}      o.tokenValid   did a presented invite token hash-match `participant`?
 * @returns {{ok: boolean, reason: string, role: string}}
 */
function canReadHub({ hub, participant, user, tokenValid } = {}) {
  if (!hub || typeof hub !== "object") {
    return { ok: false, reason: "not_found", role: "" };
  }

  // Checked before ownership, deliberately. Removal is the one control that
  // has to beat everything, or "removed" would mean "removed for other
  // people" — the same argument report-access.js makes for revocation
  // beating the owner. The owner is normally not a participant row at all;
  // when they are (a broker who added their own address), removing it removes
  // them from the reading side too, which is the honest reading of the act.
  if (participant && participant.removed_at) {
    return { ok: false, reason: "removed", role: "" };
  }

  // An owner reads their own hub with no token and no participant row.
  if (user && hub.owner_user_id && sameUser(hub.owner_user_id, user.id)) {
    return { ok: true, reason: "owner", role: "broker" };
  }

  // Either credential is enough ON ITS OWN, and that is the point: a tenant
  // opens the emailed link on their phone with no account (token), and later
  // signs in on a laptop with no link to hand (session). Requiring both would
  // strand them on whichever device lacked the other.
  if (participant && tokenValid === true) {
    return { ok: true, reason: "token", role: roleOf(participant) };
  }
  if (participant && isParticipantUser(participant, user)) {
    return { ok: true, reason: "participant", role: roleOf(participant) };
  }

  // Nothing matched. WHICH refusal matters for the UI: signin_required opens
  // the account modal, not_invited must not, because sending a signed-in
  // stranger to a sign-in card they are already past is a dead end. Same
  // distinction, same reason, as report-access.js.
  if (!user) return { ok: false, reason: "signin_required", role: "" };
  return { ok: false, reason: "not_invited", role: "" };
}

/**
 * May this caller POST (a message today, a status change in slice 2)?
 * Read first, then the three things that make a readable hub read-only.
 */
function canWriteHub({ hub, participant, user, tokenValid } = {}) {
  const read = canReadHub({ hub, participant, user, tokenValid });
  if (!read.ok) return read;

  // Closed is READ-ONLY FOR EVERYONE, owner included. Closing is not
  // revoking: the copy promises "everyone keeps their access to what is
  // already here", so this refuses the write and never the read.
  if (hub.closed_at || hub.status === "closed") {
    return { ok: false, reason: "closed", role: read.role };
  }

  // An ownerless hub (the broker deleted their account; 024 sets the column
  // null rather than cascading) has nobody left to moderate it, so it freezes
  // as a record instead of continuing as a conversation.
  if (!hub.owner_user_id) {
    return { ok: false, reason: "ownerless", role: read.role };
  }

  // THE ACCOUNT ASK. A token proves someone opened a link; only a session
  // proves who is typing, and a message with no provable author is worse than
  // no message. This is deliberately placed at the first WRITE rather than at
  // the door: the tenant reads the comps first, and is asked to sign up only
  // once they have something to say. That ordering is the acquisition loop.
  if (!user) return { ok: false, reason: "signin_required", role: read.role };

  // An owner who is signed in is past every check above.
  if (read.reason === "owner") return { ok: true, reason: "owner", role: "broker" };

  // A token got them in, but the session has to be the invited person before
  // they can post as them. Otherwise anyone a link was forwarded to could
  // sign up with any address and post under the hub's roof.
  if (!isParticipantUser(participant, user)) {
    return { ok: false, reason: "not_invited", role: read.role };
  }

  if (!WRITE_ROLES.includes(read.role)) {
    return { ok: false, reason: "read_only", role: read.role };
  }
  return { ok: true, reason: read.role === "broker" ? "broker" : "participant", role: read.role };
}

/**
 * May this caller set a comp's STATUS?
 *
 * Any participant who can write, which deliberately includes the TENANT and
 * is not the owner-only answer `canAddItems` gives. The shortlist is the
 * tenant's answer to "where are we", and a pipeline only the broker can move
 * is a report, not a shared workspace — it would also make the status say
 * what the broker hopes rather than what the client decided.
 *
 * It is its own function rather than a bare canWriteHub call at the route,
 * because that reasoning is a decision this module owns, and a call site
 * cannot state it.
 */
function canSetStatus(ctx) {
  return canWriteHub(ctx);
}

/** Is this a status the pipeline actually has? Mirrors 024's CHECK. */
function isItemStatus(s) {
  return ITEM_STATUSES.includes(String(s == null ? "" : s).trim().toLowerCase());
}

/**
 * May this caller ADD comps to the hub?
 *
 * Slice 1: the owner, and nobody else. A tenant adding a comp they found is a
 * real workflow and it is slice 2 (the owner deferred it 2026-08-13); it
 * needs an untrusted-comp path with no vault row to validate against, which
 * is a different problem from this one.
 */
function canAddItems({ hub, participant, user, tokenValid } = {}) {
  const write = canWriteHub({ hub, participant, user, tokenValid });
  if (!write.ok) return write;
  if (write.reason !== "owner") {
    return { ok: false, reason: "owner_only", role: write.role };
  }
  return { ok: true, reason: "owner", role: "broker" };
}

/**
 * Should this person get an email about a new note? (migration 040)
 *
 * The rule is ONE NUDGE PER ABSENCE, and it lives here rather than in the
 * route for the same reason every other answer in this file does: it decides
 * whether a real person's inbox gets used, server.js owns the reads that feed
 * it, and `npm test` can prove it with no database.
 *
 * Four answers, in the order they are asked, because each `false` means
 * something different:
 *
 *   muted     they asked us not to. Beats everything, including never having
 *             been mailed before.
 *   present   they are looking at the hub right now (a visible tab polls every
 *             15 seconds), so they will watch the note arrive. Telling
 *             somebody what they are in the middle of reading is the fastest
 *             way to get the whole feature switched off.
 *   fresh     nobody has ever mailed them about this hub. Send.
 *   re-armed  they have opened it since the last time we wrote to them.
 *
 * A person who was mailed and has not come back is NOT mailed again, however
 * chatty the thread gets. Ten notes posted while a tenant is away is one
 * email, not ten.
 *
 * Every timestamp is optional and an unparseable one reads as absent, which
 * lands on "send". That is the deliberate direction: this guards a courtesy
 * email, so a missing row costs somebody a duplicate rather than costing them
 * the notification the feature exists to deliver. Contrast the access rules
 * above, which fail closed for the opposite reason.
 */
function shouldNotifyByEmail({ muted, seenAt, notifiedAt, now, presentMs } = {}) {
  if (muted) return false;
  const at = (v) => {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? t : 0;
  };
  const seen = at(seenAt);
  const notified = at(notifiedAt);
  const clock = at(now) || Date.now();
  const window = Number.isFinite(presentMs) ? presentMs : 0;
  if (seen && window > 0 && clock - seen < window) return false;
  if (!notified) return true;
  return Boolean(seen) && seen > notified;
}

module.exports = {
  canReadHub,
  shouldNotifyByEmail,
  canWriteHub,
  canAddItems,
  canSetStatus,
  isItemStatus,
  normalizeEmail,
  roleOf,
  ROLES,
  WRITE_ROLES,
  ITEM_STATUSES,
};
