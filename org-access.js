"use strict";
// ---------------------------------------------------------------------------
// Who is in a firm, and what their membership lets them do.
//
// Spec:   docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md
// Schema: migrations/030-enterprise-orgs.sql
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

// The smallest firm subscription that may be BOUGHT. Unlike MAX_MEMBERS this
// one really is about price, and it closes a hole rather than expressing a
// preference: `canUseOrg` gates CREATING a firm on already holding Pro, but
// getEntitlements grants Pro from a firm SEAT as a fallback once a personal
// subscription lapses. So without a minimum one person could create a firm,
// buy a single seat, cancel their own plan, and keep everything for the seat
// price — which is below the individual price by construction, because a team
// discount is the whole point of the plan.
//
// Two is the least that means "a firm", and it is enough: two seats bill above
// the individual price, so the cheap way back to Pro is closed without
// refusing genuinely small shops. Keep that relation true if either price
// moves — a seat price above half the individual price is what makes 2 work.
//
// It bounds the PURCHASE, never the membership: a two-seat firm with one
// member is fine, and a hand-granted firm has no subscription at all.
const MIN_SEATS = 2;

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

// Least privilege on anything unrecognized. The CHECK constraint in 030 and
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

// ---------------------------------------------------------------------------
// What kind of shop a firm is.
//
// Plan:   Business Model Transition Plan v2 §6, Chuck Dickinson, 2026-08-17.
// Schema: migrations/036-org-shop-kind.sql
//
// §6's claim, and the reason this is one column rather than a second product:
// a broker shop and a development shop are "the same architecture and
// different saved views". Both lose the same work the same way. Only the
// nouns change, so only the nouns are stored.
//
// TWO KINDS, NOT THREE. The same section rules enterprise out as a target and
// names its entry point as someone who used CompNinja at their last shop, so
// there is no third value to select and nothing here pretends there is.
//
// Fails closed the way this file's other readers do, with one difference
// worth stating: 'broker' is not the safe answer in an access sense, because
// nothing here grants anything. It is the INCUMBENT answer. Every firm that
// existed before 036 has only ever been shown broker-shop words, so an
// unrecognized kind renders what its members have already been reading rather
// than switching a firm's vocabulary on the strength of a typo.
// ---------------------------------------------------------------------------
const SHOP_KINDS = ["broker", "development", "tenant_rep"];

// The nouns, in one place, because two of them are read by a server that
// writes an email and a browser that writes a page. index.html carries its
// own copy of this map (it cannot require a module) and test/index-html.test.js
// pins the two together, which is the repo's standing answer to a mirrored
// constant: mirror it deliberately, then make the suite refuse to let the
// mirror drift.
const SHOP_COPY = {
  broker: {
    label: "Broker shop",
    // What arrives, per §6's table. Used in the invite email and beside the
    // create box, where it is the one line that tells a stranger what this
    // shelf is going to hold. Lower case and no final stop: both callers drop
    // it mid-sentence, and a capital there reads as a heading that lost its
    // heading.
    arrivals: "comp sets, BOVs, market reports and lease abstracts",
    // What the shelf opens on. A broker shop's work spans every type, so it
    // opens on all of them; see shelfType's use in index.html.
    shelfType: "",
  },
  development: {
    label: "Development shop",
    arrivals: "land comps, rent comps, absorption studies and feasibility packets",
    // §6 again: the subject is a site or a project in the pipeline, and Land
    // is the only property type in VAULT.PROPERTY_TYPES that names one. This
    // is a DEFAULT and not a filter the firm is stuck behind.
    shelfType: "Land",
  },
  // The third kind (migration 037). Same architecture, third vocabulary: a
  // tenant rep's subject is a lease rather than a sale, so the sentence names
  // what they hand a tenant rather than what they hand an owner.
  tenant_rep: {
    label: "Tenant rep shop",
    arrivals: "lease abstracts, rent comps and market surveys",
    // EMPTY, unlike development, and this is the interesting one. Land earned
    // development its default because exactly one property type names that
    // shop's subject. Nothing in VAULT.PROPERTY_TYPES names a tenant rep's:
    // office, industrial and retail tenant reps all exist and are all normal,
    // so picking one would open two shops out of three on a filtered shelf.
    // No honest default is the honest default.
    shelfType: "",
  },
};

function kindOf(org) {
  const v = org && typeof org === "object" ? String(org.kind || "") : "";
  return SHOP_KINDS.includes(v) ? v : "broker";
}

function shopCopyOf(org) {
  return SHOP_COPY[kindOf(org)];
}

/**
 * The choice a firm's creator must make, validated.
 *
 * REQUIRED, unlike share_default, which ships off and is changed later. The
 * owner's decision here is about vocabulary they are about to read on every
 * screen, they are the only person who knows the answer, and the moment they
 * are naming the firm is the one moment they are certainly thinking about
 * what kind of firm it is. A default would be answered by silence and never
 * revisited.
 *
 * Missing and unrecognized are the SAME refusal on purpose: a browser that
 * sends nothing and a browser that sends "enterprise" are both a client this
 * route should not be guessing on behalf of.
 *
 * The sentence names every kind rather than saying "choose one", because it
 * is read under a select the reader may have scrolled past. It is mirrored in
 * index.html for the same reason SHOP_COPY is, and pinned by the same suite.
 */
function validateShopKind(raw) {
  const kind = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!SHOP_KINDS.includes(kind)) {
    return { ok: false, error: "Choose whether this is a broker shop, a development shop or a tenant rep shop." };
  }
  return { ok: true, kind };
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

// The firm's auto-share setting. 'reports' means a member's NEW reports go to
// the shelf as they are run; 'none' means nothing does. Anything
// unrecognized — a typo, a value added later without updating this — reads as
// 'none', because the failure that matters here is publishing somebody's work
// they did not mean to publish, and it is not undoable in the way a missing
// share is.
const SHARE_DEFAULTS = ["none", "reports"];
function shareDefaultOf(org) {
  const v = org && typeof org === "object" ? String(org.share_default || "") : "";
  return SHARE_DEFAULTS.includes(v) ? v : "none";
}

/**
 * Does THIS member's next report go to the firm's shelf automatically?
 *
 * The safeguard the spec attached to `orgs.share_default` before it could be
 * built at all: the firm default is an ADMIN's decision about other people's
 * work, so it must be overridable by the person whose work it is. Hence three
 * states on `org_members.auto_share` (migration 031) rather than a boolean:
 *
 *   null   has not chosen  -> follow the firm
 *   true   always, even if the firm's default is off — publishing your OWN
 *          report to your OWN firm is a thing you may decide for yourself
 *   false  never, and an admin turning the firm switch on cannot override it
 *
 * `false` beating the firm is the whole point. Read it the other way round and
 * a broker who has said "not my client work" starts publishing again the next
 * time an admin changes their mind, with nothing telling them.
 *
 * Inactive membership is always false: a pending invite and a removed
 * colleague have no shelf to publish to.
 */
function autoShareFor({ org, membership } = {}) {
  if (!isActive(membership)) return false;
  if (membership.auto_share === false) return false;
  if (membership.auto_share === true) return true;
  return shareDefaultOf(org) === "reports";
}

// What a member may set their own switch to. Deliberately accepts the three
// states by name rather than a boolean, so a caller cannot express "unset" by
// accident: "follow" is a real choice a member makes (back to the firm's
// decision), not the absence of one.
const AUTO_SHARE_CHOICES = ["follow", "always", "never"];
function autoShareValue(choice) {
  if (choice === "always") return true;
  if (choice === "never") return false;
  if (choice === "follow") return null;
  return undefined;            // not a choice — the caller refuses it
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
  ROLES, MANAGE_ROLES, MAX_MEMBERS, MIN_SEATS, MAX_INVITES_PER_CALL, MAX_NAME_LEN,
  SHARE_DEFAULTS, AUTO_SHARE_CHOICES, SHOP_KINDS, SHOP_COPY,
  normalizeEmail, roleOf, isActive, isPending,
  validateOrgName, membershipOf, pendingInviteOf, activeOrgIds,
  canManageMembers, canPublishToOrg, canRemoveMember, normalizeInviteEmails,
  shareDefaultOf, autoShareFor, autoShareValue,
  kindOf, shopCopyOf, validateShopKind,
};
