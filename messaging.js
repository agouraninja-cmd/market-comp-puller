// ---------------------------------------------------------------------------
// Firm messaging — the rules.
//
// Spec: docs/superpowers/specs/2026-09-01-firm-messaging-design.md
// Schema: migrations/044-firm-messaging.sql
//
// PURE, like org-access.js, hub-access.js, entitlements.js and every other
// module `npm test` can exercise with no database: no I/O, no requires, no
// clock reads (the caller passes `now`). server.js owns every read and hands
// the rows in.
//
// WHAT THIS FILE IS FOR. Two questions live here and nowhere else:
//
//   1. May this person read or post in this thread? Answered ONLY by
//      canReadThread/canPostToThread, which require BOTH an active membership
//      row AND the thread belonging to the firm the caller was resolved into.
//      Either check alone would do. Two mean that a bug in one of them is not
//      a cross-firm leak — canReadShare's rule, and the reason a firm share
//      needs both visibility==='org' and a non-null org_id.
//
//   2. What may a comp become on its way into a message? compRowFrom, which
//      takes an ALREADY-allowlisted vault comp (VAULTAPI.toApiComp) and lifts
//      the few fields the Comps tab lists on. It deliberately does not build
//      its own allowlist: the vault's API contract already decides what a
//      stored row may become, it is schema-tested in both directions, and
//      hub_items already sends exactly that shape to a client. A colleague is
//      a narrower audience, so a second list would be a second thing to keep
//      in step for no gain.
//
// WHAT IS NOT HERE. Nothing about the comp hub (hub-access.js), nothing about
// firm membership itself (org-access.js). This file is handed the answer to
// "is this person in that firm" and never works it out.
// ---------------------------------------------------------------------------

// A thread is a direct message between two colleagues, or a named channel with
// any number of them. Mirrors the CHECK in 044.
const KINDS = ["dm", "channel"];

// The hub's own message cap (server.js caps a hub note at 4000), so the two
// messaging surfaces refuse the same length. A cap is a product decision, and
// two different ones would be an accident rather than a choice.
const MAX_BODY = 4000;

// ORG.MAX_NAME_LEN is 80 and a channel name sits in the same 224px rail a firm
// name does, so it gets the same ceiling.
const MAX_TITLE = 80;

// Per message, not per thread. Ten comps is already a long scroll inside one
// bubble, and the sender can send a second message. The real reason for a
// number at all is that each one is a row and a jsonb payload.
const MAX_COMPS_PER_MESSAGE = 10;

// A channel is a room, not a mailing list. Above this the firm wants the
// shelf, which is built for the whole firm and paginates.
const MAX_THREAD_MEMBERS = 50;

// How many messages one read returns. The poll asks with a cursor so the
// steady state is a handful; this bounds the FIRST read of a long thread.
const PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

// org-access.js's rule, restated rather than imported: this file requires
// nothing, and the check is deliberately loose because the strict one belongs
// at the point an address is written, not everywhere it is read.
function normalizeEmail(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  if (!v || v.includes(" ") || !/^[^@]+@[^@]+\.[^@]+$/.test(v)) return "";
  return v;
}

function str(v) {
  return String(v == null ? "" : v);
}

// Control characters are stripped, never rejected: these strings reach a page,
// and a broker who pasted a comp out of Excel should not be told their message
// is invalid because it carried a vertical tab. Newlines survive — a message
// with paragraphs in it is an ordinary message.
function cleanText(raw) {
  return str(raw).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// Presentation only. kind decides how a thread is DRAWN and never who may read
// it — that is membership, below — so an unrecognized value falling through to
// "dm" costs a title on screen and no access anywhere.
function kindOf(thread) {
  return thread && thread.kind === "channel" ? "channel" : "dm";
}

// What to call somebody. The firm roster route returns emails and no display
// name, so this is what every name on the page falls back through.
function displayName(person) {
  if (!person) return "A colleague";
  const name = str(person.name).trim();
  if (name) return name;
  const email = str(person.email).trim();
  if (!email) return "A colleague";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

// ---------------------------------------------------------------------------
// The DM identity
// ---------------------------------------------------------------------------

// The canonical key for the direct message between two people, so that two
// colleagues who both press "message" at the same moment end up in one thread
// rather than two.
//
// SORTED, because the key must not depend on who started it. Keyed on USER
// IDS, not emails, which is the one deliberate departure from 018's
// identity-is-the-email rule that org_members and hub_participants both
// follow. Those two have to name somebody who may not have an account yet — an
// invitation is addressed to an address. A thread member is always an ACCEPTED
// member of the firm, so the account exists, and a user id is what keeps this
// key stable when somebody changes the case or the plus-tag of their email.
//
// Returns "" for anything it cannot key — a missing id, or the same person
// twice. A caller must treat "" as a refusal and never as a value to store,
// because "" would collide with every other unkeyable pair under the unique
// index. There is no such thing as a DM with yourself here.
function dmKey(a, b) {
  const x = str(a).trim();
  const y = str(b).trim();
  if (!x || !y || x === y) return "";
  return [x, y].sort().join("|");
}

// ---------------------------------------------------------------------------
// Membership within a thread
// ---------------------------------------------------------------------------

// Leaving is soft (044), so "in the thread" is the absence of left_at — the
// single predicate, org-access.js's isActive shape. Everything below asks this
// and never re-derives it.
function inThread(row) {
  return Boolean(row) && !row.left_at;
}

function activeMembers(rows) {
  return (Array.isArray(rows) ? rows : []).filter(inThread);
}

// The caller's own row in a thread, by user id.
function memberRowOf(rows, userId) {
  const id = str(userId).trim();
  if (!id) return null;
  return (Array.isArray(rows) ? rows : []).find((r) => str(r && r.user_id) === id) || null;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

// May this person read this thread?
//
// TWO WALLS, and both are required. `orgId` is the firm the CALLER was
// resolved into from their own membership rows — never a value off the
// request — and the thread must belong to it. Then they must have a live
// member row. A thread id always arrives from the browser and proves nothing;
// this is what makes that harmless.
//
// The order matters the way canReadHub's does. `left` is reported separately
// from `not_a_member` because they are different sentences on screen: one
// person walked out of a room, the other was never in it.
function canReadThread({ thread, orgId, memberRow } = {}) {
  if (!thread) return { ok: false, reason: "not_found" };
  const firm = str(orgId).trim();
  // A caller with no resolved firm can read nothing, and a thread with no firm
  // is unreachable rather than public — the empty string must never match.
  if (!firm || str(thread.org_id) !== firm) return { ok: false, reason: "wrong_firm" };
  if (!memberRow) return { ok: false, reason: "not_a_member" };
  if (!inThread(memberRow)) return { ok: false, reason: "left" };
  return { ok: true, reason: "member" };
}

// May they post in it? Read plus nothing, today. It is its own function rather
// than an alias so that an archived or closed thread — the hub has one, and
// this will want one — has an obvious home, and so that every call site
// already asks the right question when it arrives.
function canPostToThread(ctx) {
  return canReadThread(ctx);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// A message must SAY something: text, or comps, or both. A message that is
// neither is a stray Enter keypress, and letting one through puts an empty
// bubble in a colleague's thread forever.
//
// Returns the cleaned body rather than the raw one, and the caller must store
// what comes back — the trim and the control-character strip are not advisory.
function validateMessage({ body, compIds } = {}) {
  const clean = cleanText(body).trim();
  const comps = Array.isArray(compIds)
    ? [...new Set(compIds.map((v) => str(v).trim()).filter(Boolean))]
    : [];
  if (!clean && !comps.length) {
    return { ok: false, error: "Write something, or attach a comp." };
  }
  if (clean.length > MAX_BODY) {
    return { ok: false, error: `A message is at most ${MAX_BODY} characters.` };
  }
  if (comps.length > MAX_COMPS_PER_MESSAGE) {
    return { ok: false, error: `Up to ${MAX_COMPS_PER_MESSAGE} comps in one message.` };
  }
  return { ok: true, body: clean, compIds: comps };
}

// A channel needs a name. A DM must not have one — its name is the other
// person, which is a thing the reader's own page decides and not a string
// somebody typed.
function validateThread({ kind, title, memberIds } = {}) {
  const k = KINDS.includes(kind) ? kind : "";
  if (!k) return { ok: false, error: "Pick a direct message or a channel." };
  const ids = Array.isArray(memberIds)
    ? [...new Set(memberIds.map((v) => str(v).trim()).filter(Boolean))]
    : [];
  if (k === "dm") {
    if (ids.length !== 1) return { ok: false, error: "Pick one colleague to message." };
    return { ok: true, kind: "dm", title: "", memberIds: ids };
  }
  const name = cleanText(title).trim();
  if (!name) return { ok: false, error: "Give the channel a name." };
  if (name.length > MAX_TITLE) {
    return { ok: false, error: `A channel name is at most ${MAX_TITLE} characters.` };
  }
  if (!ids.length) return { ok: false, error: "Add at least one colleague." };
  if (ids.length + 1 > MAX_THREAD_MEMBERS) {
    return { ok: false, error: `A channel holds up to ${MAX_THREAD_MEMBERS} people.` };
  }
  return { ok: true, kind: "channel", title: name, memberIds: ids };
}

// ---------------------------------------------------------------------------
// The comp on its way into a message
// ---------------------------------------------------------------------------

// The row that becomes msg_comps, built from a comp the VAULT has already
// allowlisted (VAULTAPI.toApiComp). This lifts out only the handful of fields
// the Comps tab lists and orders on; the rest stays in the snapshot.
//
// `addressKey` is passed in separately and on purpose: toApiComp strips it as
// plumbing (it is in INTERNAL_FIELDS), and this table wants it so a colleague
// saving the comp lands on the same key the vault's own dedupe uses.
//
// REFUSES a comp with no address. Everything downstream — the tab, the card,
// the save — reads the address as the comp's identity, and a row without one
// renders as a blank line that nobody can act on or explain.
function compRowFrom(snapshot, { addressKey } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const address = cleanText(snapshot.address).trim();
  if (!address) return null;
  return {
    address,
    address_key: str(addressKey).trim() || null,
    property_type: str(snapshot.property_type).trim() || null,
    // A vault comp may be deliberately undated (042's `undated` sentinel is
    // stored as SQL null), so this column is nullable and a missing date is
    // normal rather than an error.
    deal_date: snapshot.deal_date || null,
    snapshot,
  };
}

// ---------------------------------------------------------------------------
// What the list shows
// ---------------------------------------------------------------------------

// The unread count for one thread.
//
// THE AUTHOR IS EXCLUDED — your own message is not news, which is
// shouldNotifyByEmail's rule one surface over. A null last_read_at means
// "never opened", and everything counts: that is the honest answer for
// somebody just added to a channel with history behind it, and it is what
// makes the badge appear at all on a thread they have never seen.
function unreadCount(messages, { lastReadAt, userId } = {}) {
  const me = str(userId).trim();
  const at = Date.parse(str(lastReadAt));
  const since = Number.isFinite(at) ? at : 0;
  let n = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.deleted_at) continue;
    if (me && str(m.user_id) === me) continue;
    const t = Date.parse(str(m.created_at));
    if (!Number.isFinite(t)) continue;
    if (t > since) n += 1;
  }
  return n;
}

// The one line under a thread's name in the list.
//
// A comps-only message has no body, so it says what it actually is rather than
// showing an empty preview — which would read as a bug in the list rather than
// as a message somebody sent.
function previewOf(message) {
  if (!message) return "";
  const body = cleanText(message.body).replace(/\s+/g, " ").trim();
  const comps = Number(message.comp_count) || 0;
  if (body) return body.length > 120 ? body.slice(0, 119) + "…" : body;
  if (comps > 0) return comps === 1 ? "Sent a comp" : `Sent ${comps} comps`;
  return "";
}

// What a thread is CALLED for one particular reader. A channel is its title. A
// direct message is the other person — which is why this takes the reader:
// the same row is "Dana Reed" on one desk and "Owen Barnes" on the other.
//
// A DM whose other member has been removed from the firm still renders, as "A
// colleague". The correspondence outlives the employment, and a thread that
// suddenly had no name would read as data loss.
function threadLabel(thread, members, userId) {
  if (kindOf(thread) === "channel") {
    const t = cleanText(thread && thread.title).trim();
    return t || "Untitled channel";
  }
  const me = str(userId).trim();
  const other = activeMembers(members).find((m) => str(m.user_id) !== me);
  return displayName(other);
}

module.exports = {
  KINDS, MAX_BODY, MAX_TITLE, MAX_COMPS_PER_MESSAGE, MAX_THREAD_MEMBERS, PAGE_SIZE,
  normalizeEmail, cleanText, kindOf, displayName,
  dmKey,
  inThread, activeMembers, memberRowOf,
  canReadThread, canPostToThread,
  validateMessage, validateThread,
  compRowFrom,
  unreadCount, previewOf, threadLabel,
};
