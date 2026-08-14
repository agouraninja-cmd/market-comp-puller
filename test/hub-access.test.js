// The messaging hub access decision, exhaustively. Pure like
// report-access.test.js: no server, no database, no clock, no hashing.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
const test = require("node:test");
const assert = require("node:assert");
const {
  canReadHub, canWriteHub, canAddItems, canSetStatus, isItemStatus, normalizeEmail, roleOf, ITEM_STATUSES,
} = require("../hub-access.js");

const BROKER = { id: "u1", email: "broker@firm.com" };
const TENANT = { id: "u2", email: "tenant@acme.com" };
const STRANGER = { id: "u3", email: "nobody@else.com" };

const hub = { id: "h1", owner_user_id: "u1", status: "active", closed_at: null };
const closed = { ...hub, status: "closed", closed_at: "2026-08-13T00:00:00Z" };
const ownerless = { ...hub, owner_user_id: null };

// A participant row as 024 writes it. user_id is null until the first
// authenticated read, which is the state that matters most: identity is the
// EMAIL, so the match has to work before user_id is ever stamped.
const tenantRow = { id: "p1", email: "tenant@acme.com", role: "tenant", user_id: null, removed_at: null };
const observerRow = { ...tenantRow, id: "p2", email: "watcher@firm.com", role: "observer" };
const removedRow = { ...tenantRow, id: "p3", removed_at: "2026-08-13T00:00:00Z" };

// --- reading -------------------------------------------------------------

test("the owner reads their own hub with no token and no participant row", () => {
  const d = canReadHub({ hub, participant: null, user: BROKER, tokenValid: false });
  assert.deepEqual(d, { ok: true, reason: "owner", role: "broker" });
});

test("a valid token reads with no account at all — the whole tenant-access decision", () => {
  const d = canReadHub({ hub, participant: tenantRow, user: null, tokenValid: true });
  assert.deepEqual(d, { ok: true, reason: "token", role: "tenant" });
});

test("a signed-in participant reads with no token — the same tenant on a second device", () => {
  const d = canReadHub({ hub, participant: tenantRow, user: TENANT, tokenValid: false });
  assert.deepEqual(d, { ok: true, reason: "participant", role: "tenant" });
});

test("the participant match is on email, case-insensitively, before user_id is ever stamped", () => {
  const messy = { ...tenantRow, email: "  Tenant@ACME.com " };
  assert.equal(canReadHub({ hub, participant: messy, user: TENANT, tokenValid: false }).ok, true);
});

test("a stamped user_id also matches, even if the account email later changes", () => {
  const stamped = { ...tenantRow, email: "old@acme.com", user_id: "u2" };
  assert.equal(canReadHub({ hub, participant: stamped, user: TENANT, tokenValid: false }).ok, true);
});

test("an anonymous caller with no token gets signin_required, which opens the account modal", () => {
  const d = canReadHub({ hub, participant: null, user: null, tokenValid: false });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "signin_required");
});

test("a signed-in stranger gets not_invited, never signin_required", () => {
  // signin_required would send them to a sign-in card they are already past.
  const d = canReadHub({ hub, participant: null, user: STRANGER, tokenValid: false });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

test("no hub is not_found, and never a crash", () => {
  assert.deepEqual(canReadHub({ hub: null, participant: tenantRow, user: TENANT, tokenValid: true }),
    { ok: false, reason: "not_found", role: "" });
  assert.equal(canReadHub().ok, false);
  assert.equal(canReadHub({ hub: "nonsense" }).ok, false);
});

test("removal beats everything, including a valid token and the owner", () => {
  assert.equal(canReadHub({ hub, participant: removedRow, user: TENANT, tokenValid: true }).reason, "removed");
  assert.equal(canReadHub({ hub, participant: removedRow, user: null, tokenValid: true }).reason, "removed");
  // Even a broker who put their own address in the hub and then removed it.
  assert.equal(canReadHub({ hub, participant: removedRow, user: BROKER, tokenValid: false }).reason, "removed");
});

test("a closed hub is still READABLE — closing is not revoking", () => {
  assert.equal(canReadHub({ hub: closed, participant: tenantRow, user: TENANT, tokenValid: false }).ok, true);
  assert.equal(canReadHub({ hub: closed, participant: null, user: BROKER, tokenValid: false }).ok, true);
});

test("an ownerless hub is still readable — the record survives the account", () => {
  assert.equal(canReadHub({ hub: ownerless, participant: tenantRow, user: null, tokenValid: true }).ok, true);
});

test("tokenValid is strictly boolean true — a truthy token string does not authenticate", () => {
  // server.js hands in a verdict, not a credential. Anything else fails closed.
  const d = canReadHub({ hub, participant: tenantRow, user: null, tokenValid: "sometoken" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "signin_required");
});

// --- writing -------------------------------------------------------------

test("writing always requires an account, even holding a valid token", () => {
  // The account ask, placed at the first write rather than at the door.
  const d = canWriteHub({ hub, participant: tenantRow, user: null, tokenValid: true });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "signin_required");
});

test("a signed-in participant writes", () => {
  assert.deepEqual(canWriteHub({ hub, participant: tenantRow, user: TENANT, tokenValid: true }),
    { ok: true, reason: "participant", role: "tenant" });
});

test("the owner writes", () => {
  assert.deepEqual(canWriteHub({ hub, participant: null, user: BROKER, tokenValid: false }),
    { ok: true, reason: "owner", role: "broker" });
});

test("a forwarded link plus any account is NOT a licence to post", () => {
  // The token got them in; the session is somebody else entirely.
  const d = canWriteHub({ hub, participant: tenantRow, user: STRANGER, tokenValid: true });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

test("an observer reads but never writes", () => {
  const watcher = { id: "u4", email: "watcher@firm.com" };
  assert.equal(canReadHub({ hub, participant: observerRow, user: watcher, tokenValid: true }).ok, true);
  const d = canWriteHub({ hub, participant: observerRow, user: watcher, tokenValid: true });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "read_only");
});

test("an unrecognized role fails closed to observer — read, never write", () => {
  const typo = { ...tenantRow, role: "Tenannt" };
  assert.equal(canReadHub({ hub, participant: typo, user: TENANT, tokenValid: true }).role, "observer");
  assert.equal(canWriteHub({ hub, participant: typo, user: TENANT, tokenValid: true }).reason, "read_only");
  // A missing role is the same answer, not a crash.
  assert.equal(roleOf({}), "observer");
  assert.equal(roleOf(null), "observer");
  // Case and surrounding space are tolerated; the value still has to be real.
  assert.equal(roleOf({ role: " Broker " }), "broker");
});

test("a closed hub refuses every write, the owner's included", () => {
  assert.equal(canWriteHub({ hub: closed, participant: null, user: BROKER, tokenValid: false }).reason, "closed");
  assert.equal(canWriteHub({ hub: closed, participant: tenantRow, user: TENANT, tokenValid: true }).reason, "closed");
});

test("status 'closed' alone closes it, even with no closed_at stamp", () => {
  const half = { ...hub, status: "closed" };
  assert.equal(canWriteHub({ hub: half, participant: tenantRow, user: TENANT, tokenValid: true }).reason, "closed");
});

test("an ownerless hub freezes: readable, never writable", () => {
  const d = canWriteHub({ hub: ownerless, participant: tenantRow, user: TENANT, tokenValid: true });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "ownerless");
});

test("a removed participant cannot write, and the refusal names removal", () => {
  assert.equal(canWriteHub({ hub, participant: removedRow, user: TENANT, tokenValid: true }).reason, "removed");
});

// --- adding comps (slice 1: owner only) ----------------------------------

test("only the owner adds comps in slice 1", () => {
  assert.deepEqual(canAddItems({ hub, participant: null, user: BROKER, tokenValid: false }),
    { ok: true, reason: "owner", role: "broker" });
  const d = canAddItems({ hub, participant: tenantRow, user: TENANT, tokenValid: true });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "owner_only");
});

test("adding inherits every write refusal rather than restating it", () => {
  assert.equal(canAddItems({ hub: closed, participant: null, user: BROKER, tokenValid: false }).reason, "closed");
  assert.equal(canAddItems({ hub: ownerless, participant: tenantRow, user: TENANT, tokenValid: true }).reason, "ownerless");
  assert.equal(canAddItems({ hub, participant: null, user: null, tokenValid: false }).reason, "signin_required");
  assert.equal(canAddItems({ hub: null, participant: null, user: BROKER, tokenValid: false }).reason, "not_found");
});

test("on an ownerless hub the former owner is nobody, and is refused at the READ", () => {
  // Not "ownerless": once 024's `on delete set null` fires there is no owner
  // to be, so an ex-owner with no participant row of their own is a stranger.
  // In production their account is gone and this session cannot exist, but
  // the ordering is worth pinning: ownership is checked against the ROW, never
  // against who created it.
  const d = canWriteHub({ hub: ownerless, participant: null, user: BROKER, tokenValid: false });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

// --- email normalization -------------------------------------------------

test("normalizeEmail agrees with report-access.js, because the two halves must", () => {
  assert.equal(normalizeEmail("  Client@Acme.COM "), "client@acme.com");
  assert.equal(normalizeEmail("not an email"), "");
  assert.equal(normalizeEmail("a@b"), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("two participants with unnormalizable emails are not the same person", () => {
  // "" === "" must never be a match, or every junk row would admit every
  // junk account. The user_id path is the only way such a row can match.
  const junk = { ...tenantRow, email: "not an email" };
  const junkUser = { id: "u9", email: "also not an email" };
  assert.equal(canReadHub({ hub, participant: junk, user: junkUser, tokenValid: false }).ok, false);
});

// --- the comp pipeline (slice 2) -----------------------------------------

test("a TENANT can set a status, which is the whole point of the pipeline", () => {
  // Deliberately not the owner-only answer canAddItems gives. A pipeline only
  // the broker can move says what the broker hopes, not what the client
  // decided, and the shortlist is the client's answer to "where are we".
  const d = canSetStatus({ hub, participant: tenantRow, user: TENANT, tokenValid: true });
  assert.equal(d.ok, true);
  assert.equal(d.role, "tenant");
});

test("setting a status still requires an account, and inherits every write refusal", () => {
  assert.equal(canSetStatus({ hub, participant: tenantRow, user: null, tokenValid: true }).reason, "signin_required");
  assert.equal(canSetStatus({ hub: closed, participant: tenantRow, user: TENANT, tokenValid: true }).reason, "closed");
  assert.equal(canSetStatus({ hub, participant: removedRow, user: TENANT, tokenValid: true }).reason, "removed");
  assert.equal(canSetStatus({ hub, participant: observerRow, user: { id: "u4", email: "watcher@firm.com" }, tokenValid: true }).reason, "read_only");
});

test("the owner can set a status too", () => {
  assert.equal(canSetStatus({ hub, participant: null, user: BROKER, tokenValid: false }).ok, true);
});

test("isItemStatus accepts the pipeline and nothing else", () => {
  for (const s of ["new", "shortlist", "toured", "passed"]) assert.equal(isItemStatus(s), true, s);
  assert.equal(isItemStatus(" Shortlist "), true, "case and space tolerated");
  for (const s of ["won", "lost", "", null, undefined, "drop table", "NEW;"]) {
    assert.equal(isItemStatus(s), false, String(s));
  }
});

test("ITEM_STATUSES agrees with migration 024's CHECK constraint", () => {
  // Three copies of this vocabulary exist by necessity: the module (requests),
  // the CHECK (rows), and the page's select (what a person can pick). This
  // pins the two that live in the repo; the page's copy is pinned in
  // test/hub-page.test.js.
  const fs = require("node:fs");
  const path = require("node:path");
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "024-messaging-hub.sql"), "utf8");
  const m = sql.match(/status text not null default 'new' check \(status in \(([^)]*)\)\)/);
  assert.ok(m, "024 must still constrain hub_items.status");
  const inSql = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(inSql, ITEM_STATUSES);
});
