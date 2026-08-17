"use strict";
// ---------------------------------------------------------------------------
// Who is in a firm, and what their membership lets them do.
//
// Spec:   docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md
// Schema: migrations/028-enterprise-orgs.sql
//
// NAMING, one translation point and only one: **"org" is the internal noun**
// — these tables, their columns, the `/api/org*` routes and every identifier
// in this file say org — and **"firm" is the word on screen**. Brokers say
// firm; SQL and the repo's other multi-tenant nouns (broker_*, market) are
// single words with no ambiguity, and `firms`/`firm_id` reads like a domain
// table of brokerage records rather than an account relationship. Keep the
// split at the copy layer: if an identifier here ever says firm, or a string
// a person reads ever says org, the two have started to drift.
//
// PURE, like entitlements.js, report-access.js and hub-access.js: no I/O, no
// requires, no clock reads. server.js owns the reads (the membership rows, the
// session) and hands them in. That is what lets `npm test` prove the gate
// holds with no database.
//
// EVERYTHING FAILS CLOSED, in the three ways this file can be wrong:
//
//   1. An unrecognized role reads as 'member', the least privileged — the
//      same rule hub-access.js applies to an unknown participant role and
//      report-access.js to an unknown visibility. A typo in a column must
//      never hand someone the member list.
//   2. `removed_at` beats EVERYTHING, ownership included. Removal is the one
//      control a firm has after someone leaves, and it would mean nothing if
//      a role could outrank it.
//   3. An INVITE IS NOT A MEMBERSHIP. `joined_at` must be stamped by the
//      person themselves before they read anything or publish anything.
//      Identity here is the email (migration 018's decision, adopted by 024
//      and again here), which means anyone can write anyone's address into
//      their own org_members table; without the accept step, adding a
//      stranger's email would put a firm's shared reports on that stranger's
//      desk, and — worse — would offer their own next report a "share with my
//      firm" button pointing at a firm they have never heard of.
// ---------------------------------------------------------------------------

// 'owner' is the member who created the firm and the only role that can
// survive being the last one standing; 'admin' manages people; 'member'
// reads the firm's shares and publishes to them. Ordered most-privileged
// first, which is also the order the member list renders in.
const ROLES = ["owner", "admin", "member"];
const MANAGE_ROLES = ["owner", "admin"];

// A firm, not a directory. 200 matches broker_coverage's cap and is far past
// any real brokerage office; it exists so a bug cannot write ten thousand
// rows, not to price the product.
const MAX_MEMBERS = 200;
// Per call, not per firm — a paste of a whole address book should be told to
// slow down rather than half-succeed.
const MAX_INVITES_PER_CALL = 25;
const MAX_NAME_LEN = 80;

// Copied in shape from report-access.js and hub-access.js on purpose: an
// invite and an account must agree on what "the same person" means, and by
// now three files decide that for three halves of the same sharing story.
function normalizeEmail(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  // Deliberately loose: one @, something either side, no whitespace. Real
  // deliverability is Resend's problem; this only has to stop junk becoming a
  // member row that can never match.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

// Least privilege on anything unrecognized. The CHECK constraint in 028 and
// this function agree on purpose: the constraint stops a bad row, this stops a
// bad row that somehow exists from granting anything.
function roleOf(row) {
  const r = row && typeof row === "object" ? String(row.role || "") : "";
  return ROLES.includes(r) ? r : "member";
}

// The single predicate. Everything else in this file is expressed in terms of
// it, so there is exactly one place that can be wrong about who counts.
function isActive(row) {
  if (!row || typeof row !== "object") return false;
  if (row.removed_at) return false;          // beats ownership, beats joined_at
  return Boolean(row.joined_at);             // an invite is not a membership
}

function isPending(row) {
  if (!row || typeof row !== "object") return false;
  if (row.removed_at) return false;
  return !row.joined_at;
}

// A firm name reaches other people's screens (the member list, the desk
// section header, the share row), so it is cleaned the way the vault's credit
// identity is: control characters stripped rather than escaped downstream, no
// truncation of an over-long value into something the member did not type.
// Formula-shaped names are left alone — `guardFormula` at `csvCell` owns that,
// and a firm really called "+Plus Realty" keeps its name.
function validateOrgName(raw) {
  const name = String(raw == null ? "" : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2) return { ok: false, error: "Enter your firm's name." };
  if (name.length > MAX_NAME_LEN) {
    return { ok: false, error: `A firm name can be up to ${MAX_NAME_LEN} characters.` };
  }
  return { ok: true, name };
}

// The caller's active membership of one firm, or null. Rows may be that
// firm's whole member list or the caller's rows across every firm — both
// shapes are filtered by email, so neither can return someone else's row.
function membershipOf(rows, email) {
  const mine = normalizeEmail(email);
  if (!mine) return null;
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => isActive(r) && normalizeEmail(r && r.email) === mine) || null;
}

function pendingInviteOf(rows, email) {
  const mine = normalizeEmail(email);
  if (!mine) return null;
  const list = Array.isArray(rows) ? rows : [];
  return list.find((r) => isPending(r) && normalizeEmail(r && r.email) === mine) || null;
}

// The org ids this person may read a firm share of. Feeds report-access.js's
// firm branch, so this is the widest thing in the file and the one worth
// re-reading: an id that reaches this array is an id whose shared reports the
// caller can open.
function activeOrgIds(rows, email) {
  const mine = normalizeEmail(email);
  if (!mine) return [];
  const list = Array.isArray(rows) ? rows : [];
  const ids = list
    .filter((r) => isActive(r) && normalizeEmail(r && r.email) === mine)
    .map((r) => (r.org_id == null ? "" : String(r.org_id)))
    .filter(Boolean);
  return [...new Set(ids)];
}

function canManageMembers(membership) {
  return isActive(membership) && MANAGE_ROLES.includes(roleOf(membership));
}

// Every active member may publish to their firm, whatever their role. A firm
// where only admins can contribute is a filing cabinet with a gatekeeper,
// which is the shape of the problem this feature exists to remove.
function canPublishToOrg(membership) {
  return isActive(membership);
}

/**
 * May `actorEmail` remove the member row `targetId` from this firm?
 *
 * Takes the whole member list rather than two rows, because two of the four
 * rules are about the list: an owner may not be removed while they are the
 * last one, and self-removal ("leave this firm") is allowed to everyone under
 * the same condition. Answering that from a single row is impossible, and a
 * caller that counted owners itself would be a second opinion on the rule.
 *
 * @param {Array}  members    org_members rows for ONE org
 * @param {string} actorEmail the signed-in caller
 * @param {string} targetId   org_members.id being removed
 */
function canRemoveMember({ members, actorEmail, targetId }) {
  const list = Array.isArray(members) ? members : [];
  const actor = membershipOf(list, actorEmail);
  if (!actor) return { ok: false, reason: "not_a_member" };

  const target = list.find((r) => r && String(r.id) === String(targetId)) || null;
  if (!target || target.removed_at) return { ok: false, reason: "not_found" };

  const isSelf = String(target.id) === String(actor.id);
  const owners = list.filter((r) => isActive(r) && roleOf(r) === "owner");
  const lastOwner = roleOf(target) === "owner" && owners.length <= 1;

  // Checked before the permission rules, and before the self case: a firm
  // with no owner has nobody who can invite, remove, or hand the role on, and
  // there is no route in this design that repairs one. Refusing is the only
  // outcome that leaves a way forward (make someone else an owner first).
  if (lastOwner) return { ok: false, reason: "last_owner" };

  // Leaving is always yours to do. It is deliberately the same route as being
  // removed — one code path, one set of rules — rather than a second endpoint
  // where the checks could drift.
  if (isSelf) return { ok: true, reason: "left" };

  if (!canManageMembers(actor)) return { ok: false, reason: "forbidden" };
  // An admin may not remove an owner. Otherwise "admin" would be a way to
  // take a firm from the person who created it.
  if (roleOf(target) === "owner" && roleOf(actor) !== "owner") {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, reason: "removed" };
}

/**
 * Clean a pasted invite list.
 *
 * Drops the caller's own address silently (they are already in the firm, and
 * an error there reads as a bug), refuses a list that parsed to nothing so a
 * mistyped paste is loud rather than a no-op, and caps the batch.
 *
 * `existing` are the emails already on the firm — normalized here, not by the
 * caller — so re-inviting somebody is a no-op rather than a duplicate row.
 */
function normalizeInviteEmails(raw, { self = "", existing = [] } = {}) {
  const asked = Array.isArray(raw) ? raw : [];
  if (asked.length > MAX_INVITES_PER_CALL) {
    return { ok: false, error: `Up to ${MAX_INVITES_PER_CALL} people at a time.` };
  }
  const mine = normalizeEmail(self);
  const have = new Set((Array.isArray(existing) ? existing : []).map(normalizeEmail).filter(Boolean));
  const emails = [...new Set(asked.map(normalizeEmail).filter(Boolean))]
    .filter((e) => e !== mine && !have.has(e));
  if (asked.length && !emails.length) {
    // Deliberately one message for three causes (all junk / all already here /
    // only yourself): the fix is the same in each case — look at the box — and
    // three messages would need this function to rank which one mattered.
    return { ok: false, error: "No new email addresses to invite. Check the list and try again." };
  }
  return { ok: true, emails };
}

module.exports = {
  ROLES, MANAGE_ROLES, MAX_MEMBERS, MAX_INVITES_PER_CALL, MAX_NAME_LEN,
  normalizeEmail, roleOf, isActive, isPending,
  validateOrgName, membershipOf, pendingInviteOf, activeOrgIds,
  canManageMembers, canPublishToOrg, canRemoveMember, normalizeInviteEmails,
};
