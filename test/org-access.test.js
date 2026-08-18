// Firm membership, exhaustively. Pure like report-access.test.js and
// hub-access.test.js: no server, no database, no clock.
//
// The rules worth breaking a build over are the three fail-closed ones in
// org-access.js's header — an unknown role is a member, removed_at beats
// everything, and an invite is not a membership — plus the last-owner rule,
// which is the only one that needs the whole list to answer.
const test = require("node:test");
const assert = require("node:assert");
const ORG = require("../org-access.js");

const OWNER_EMAIL = "brad@colliers.com";
const ADMIN_EMAIL = "spencer@colliers.com";
const MEMBER_EMAIL = "mike@colliers.com";
const STRANGER = "nobody@else.com";

const row = (over = {}) => ({
  id: over.id || "m1",
  org_id: "org1",
  email: OWNER_EMAIL,
  role: "owner",
  invited_at: "2026-08-16T00:00:00Z",
  joined_at: "2026-08-16T00:00:00Z",
  removed_at: null,
  ...over,
});

const OWNER = row({ id: "m1", email: OWNER_EMAIL, role: "owner" });
const ADMIN = row({ id: "m2", email: ADMIN_EMAIL, role: "admin" });
const MEMBER = row({ id: "m3", email: MEMBER_EMAIL, role: "member" });
const FIRM = [OWNER, ADMIN, MEMBER];

// --- the three fail-closed rules -------------------------------------------

test("an unrecognized role reads as member, never as something privileged", () => {
  for (const role of ["superuser", "OWNER", "", null, undefined, "principal"]) {
    const r = row({ role });
    assert.equal(ORG.roleOf(r), "member", `role ${JSON.stringify(role)}`);
    assert.equal(ORG.canManageMembers(r), false, `role ${JSON.stringify(role)}`);
  }
});

test("removed_at beats everything, ownership included", () => {
  const removedOwner = row({ removed_at: "2026-08-17T00:00:00Z" });
  assert.equal(ORG.isActive(removedOwner), false);
  assert.equal(ORG.canManageMembers(removedOwner), false);
  assert.equal(ORG.canPublishToOrg(removedOwner), false);
  assert.equal(ORG.membershipOf([removedOwner], OWNER_EMAIL), null);
  assert.deepEqual(ORG.activeOrgIds([removedOwner], OWNER_EMAIL), []);
});

test("an invite is not a membership: no joined_at means no access at all", () => {
  const invited = row({ email: MEMBER_EMAIL, role: "admin", joined_at: null });
  assert.equal(ORG.isActive(invited), false);
  assert.equal(ORG.isPending(invited), true);
  assert.equal(ORG.canPublishToOrg(invited), false);
  // The one that matters most: an unaccepted invite must not put a firm's
  // shared reports in front of somebody whose address a stranger typed in.
  assert.deepEqual(ORG.activeOrgIds([invited], MEMBER_EMAIL), []);
  assert.equal(ORG.membershipOf([invited], MEMBER_EMAIL), null);
  assert.equal(ORG.pendingInviteOf([invited], MEMBER_EMAIL).id, invited.id);
});

test("a removed row is neither active nor pending — removal is not a re-invite", () => {
  const r = row({ joined_at: null, removed_at: "2026-08-17T00:00:00Z" });
  assert.equal(ORG.isActive(r), false);
  assert.equal(ORG.isPending(r), false);
});

// --- identity ---------------------------------------------------------------

test("membership matches on email case-insensitively and ignores surrounding space", () => {
  const messy = row({ email: "  Brad@Colliers.COM " });
  assert.ok(ORG.membershipOf([messy], OWNER_EMAIL));
  assert.deepEqual(ORG.activeOrgIds([messy], "BRAD@COLLIERS.COM "), ["org1"]);
});

test("a caller with no readable email matches nothing", () => {
  for (const bad of ["", null, undefined, "not-an-email", "a@b"]) {
    assert.equal(ORG.membershipOf(FIRM, bad), null, String(bad));
    assert.deepEqual(ORG.activeOrgIds(FIRM, bad), [], String(bad));
  }
});

test("a stranger's rows are never returned from another person's list", () => {
  assert.equal(ORG.membershipOf(FIRM, STRANGER), null);
  assert.deepEqual(ORG.activeOrgIds(FIRM, STRANGER), []);
});

test("activeOrgIds dedupes and drops rows with no org", () => {
  const rows = [
    row({ id: "a", org_id: "org1" }),
    row({ id: "b", org_id: "org1" }),
    row({ id: "c", org_id: "org2" }),
    row({ id: "d", org_id: null }),
  ];
  assert.deepEqual(ORG.activeOrgIds(rows, OWNER_EMAIL).sort(), ["org1", "org2"]);
});

test("nothing throws on junk input", () => {
  for (const junk of [null, undefined, "rows", 7, {}]) {
    assert.deepEqual(ORG.activeOrgIds(junk, OWNER_EMAIL), []);
    assert.equal(ORG.membershipOf(junk, OWNER_EMAIL), null);
  }
  assert.equal(ORG.isActive(null), false);
  assert.equal(ORG.roleOf(null), "member");
});

// --- who may manage ---------------------------------------------------------

test("owners and admins manage; a plain member does not", () => {
  assert.equal(ORG.canManageMembers(OWNER), true);
  assert.equal(ORG.canManageMembers(ADMIN), true);
  assert.equal(ORG.canManageMembers(MEMBER), false);
});

test("every active member may publish to the firm, whatever their role", () => {
  for (const m of FIRM) assert.equal(ORG.canPublishToOrg(m), true);
});

// --- removal ----------------------------------------------------------------

test("an admin removes a member", () => {
  const d = ORG.canRemoveMember({ members: FIRM, actorEmail: ADMIN_EMAIL, targetId: "m3" });
  assert.deepEqual(d, { ok: true, reason: "removed" });
});

test("an admin may NOT remove an owner — admin is not a way to take a firm", () => {
  const two = [OWNER, row({ id: "m4", email: "second@colliers.com", role: "owner" }), ADMIN];
  const d = ORG.canRemoveMember({ members: two, actorEmail: ADMIN_EMAIL, targetId: "m1" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "forbidden");
});

test("an owner may remove another owner, but never the last one", () => {
  const two = [OWNER, row({ id: "m4", email: "second@colliers.com", role: "owner" })];
  assert.equal(ORG.canRemoveMember({ members: two, actorEmail: OWNER_EMAIL, targetId: "m4" }).ok, true);
  const d = ORG.canRemoveMember({ members: [OWNER], actorEmail: OWNER_EMAIL, targetId: "m1" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "last_owner");
});

test("the last owner cannot leave either — the rule is about the firm, not the actor", () => {
  // Checked BEFORE the self case on purpose: a firm with no owner has nobody
  // who can invite, remove, or hand the role on, and no route repairs one.
  const d = ORG.canRemoveMember({ members: FIRM, actorEmail: OWNER_EMAIL, targetId: "m1" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "last_owner");
});

test("anyone may leave on their own", () => {
  assert.deepEqual(
    ORG.canRemoveMember({ members: FIRM, actorEmail: MEMBER_EMAIL, targetId: "m3" }),
    { ok: true, reason: "left" });
});

test("a plain member cannot remove anybody else", () => {
  const d = ORG.canRemoveMember({ members: FIRM, actorEmail: MEMBER_EMAIL, targetId: "m2" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "forbidden");
});

test("a non-member cannot remove anybody, whatever id they name", () => {
  const d = ORG.canRemoveMember({ members: FIRM, actorEmail: STRANGER, targetId: "m3" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_a_member");
});

test("a removed row cannot be removed again, and an unknown id is not_found", () => {
  const gone = [OWNER, ADMIN, row({ id: "m3", email: MEMBER_EMAIL, role: "member", removed_at: "2026-08-17T00:00:00Z" })];
  assert.equal(ORG.canRemoveMember({ members: gone, actorEmail: ADMIN_EMAIL, targetId: "m3" }).reason, "not_found");
  assert.equal(ORG.canRemoveMember({ members: FIRM, actorEmail: ADMIN_EMAIL, targetId: "nope" }).reason, "not_found");
});

test("a removed owner does not count toward the owner tally", () => {
  // Otherwise a firm whose only owner was removed would refuse to let the
  // remaining admin remove anybody, on the strength of a person who is gone.
  const members = [
    row({ id: "m1", email: OWNER_EMAIL, role: "owner", removed_at: "2026-08-17T00:00:00Z" }),
    ADMIN, MEMBER,
  ];
  assert.equal(ORG.canRemoveMember({ members, actorEmail: ADMIN_EMAIL, targetId: "m3" }).ok, true);
});

// --- the firm name ----------------------------------------------------------

test("a firm name is trimmed and collapsed, never truncated", () => {
  assert.deepEqual(ORG.validateOrgName("  Colliers   Boise  "), { ok: true, name: "Colliers Boise" });
  const long = "x".repeat(ORG.MAX_NAME_LEN + 1);
  const d = ORG.validateOrgName(long);
  assert.equal(d.ok, false);
  assert.match(d.error, /can be up to/);
});

test("a firm name too short to be one is refused", () => {
  for (const bad of ["", " ", "a", null, undefined]) {
    assert.equal(ORG.validateOrgName(bad).ok, false, JSON.stringify(bad));
  }
});

test("control characters are stripped from a firm name — it reaches other screens", () => {
  const sneaky = "Coll" + String.fromCharCode(0) + "iersBoise";
  const d = ORG.validateOrgName(sneaky);
  assert.equal(d.ok, true);
  assert.equal(d.name, "Coll iers Boise");
  assert.ok(![...d.name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127));
});

test("a formula-shaped firm name keeps its name — guardFormula owns that at export", () => {
  assert.deepEqual(ORG.validateOrgName("+Plus Realty"), { ok: true, name: "+Plus Realty" });
});

// --- invite lists -----------------------------------------------------------

test("invite lists are normalized, deduped, and drop the sender and existing members", () => {
  const d = ORG.normalizeInviteEmails(
    ["  Mike@Colliers.com ", "mike@colliers.com", "new@colliers.com", OWNER_EMAIL, "junk"],
    { self: OWNER_EMAIL, existing: [MEMBER_EMAIL] });
  assert.deepEqual(d, { ok: true, emails: ["new@colliers.com"] });
});

test("a list that parsed to nothing is an error, not a silent no-op", () => {
  const d = ORG.normalizeInviteEmails(["junk", "also junk"], { self: OWNER_EMAIL });
  assert.equal(d.ok, false);
  assert.match(d.error, /Check the list/);
});

test("an empty list is allowed through as nothing to do", () => {
  assert.deepEqual(ORG.normalizeInviteEmails([], {}), { ok: true, emails: [] });
  assert.deepEqual(ORG.normalizeInviteEmails(null, {}), { ok: true, emails: [] });
});

test("an over-long paste is refused rather than half-applied", () => {
  const many = Array.from({ length: ORG.MAX_INVITES_PER_CALL + 1 }, (_, i) => `p${i}@firm.com`);
  const d = ORG.normalizeInviteEmails(many, {});
  assert.equal(d.ok, false);
  assert.match(d.error, /at a time/);
});

// --- the module's own shape -------------------------------------------------

test("org-access.js is pure: no requires, no I/O, no clock reads", () => {
  // The same guard hub-access.test.js and entitlements.test.js carry. A
  // Date.now() in here would make the rules untestable without a clock, and a
  // require() would let a database read sneak into a decision function.
  const src = require("fs").readFileSync(require.resolve("../org-access.js"), "utf8");
  assert.equal(/\brequire\s*\(/.test(src), false, "org-access.js must not require anything");
  assert.equal(/\bDate\.now\b|new Date\(/.test(src), false, "org-access.js must not read the clock");
  assert.equal(/\bfetch\s*\(|require\(["']fs["']\)/.test(src), false, "org-access.js must not do I/O");
});

// ---------------------------------------------------------------------------
// Auto-share (migration 029) — the firm default, and the member's veto.
//
// This is the rule the spec would not let be built without a safeguard, so
// the safeguard is what most of these pin: an admin's decision about other
// people's work must be overridable by the person whose work it is.
// ---------------------------------------------------------------------------

const FIRM_ON = { share_default: "reports" };
const FIRM_OFF = { share_default: "none" };

test("an unrecognized share_default reads as 'none' — never as publishing", () => {
  // The failure that matters is publishing work somebody did not mean to
  // publish, and unlike a missing share it is not undoable by trying again.
  for (const v of ["REPORTS", "all", "", null, undefined, "reportss", true]) {
    assert.equal(ORG.shareDefaultOf({ share_default: v }), "none", JSON.stringify(v));
    assert.equal(ORG.autoShareFor({ org: { share_default: v }, membership: MEMBER }), false);
  }
  assert.equal(ORG.shareDefaultOf(null), "none");
  assert.equal(ORG.shareDefaultOf("reports"), "none", "a string is not an org row");
});

test("a member who has not chosen follows the firm", () => {
  const undecided = row({ auto_share: null });
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: undecided }), true);
  assert.equal(ORG.autoShareFor({ org: FIRM_OFF, membership: undecided }), false);
  // undefined is the same state: the column may simply not be read back, and
  // "has not chosen" must not depend on which of the two the caller passes.
  const missing = row({});
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: missing }), true);
  assert.equal(ORG.autoShareFor({ org: FIRM_OFF, membership: missing }), false);
});

test("a member's NO beats the firm's yes, and keeps beating it", () => {
  // The safeguard. Read the other way round, a broker who said "not my client
  // work" starts publishing again the next time an admin changes their mind,
  // with nothing telling them.
  const refused = row({ auto_share: false });
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: refused }), false);
  assert.equal(ORG.autoShareFor({ org: FIRM_OFF, membership: refused }), false);
});

test("a member's YES stands even when the firm's default is off", () => {
  // Publishing your OWN report to your OWN firm is a decision you may make for
  // yourself; it exposes nobody else's work.
  const keen = row({ auto_share: true });
  assert.equal(ORG.autoShareFor({ org: FIRM_OFF, membership: keen }), true);
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: keen }), true);
});

test("no membership, a pending invite, or a removed colleague never auto-shares", () => {
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: null }), false);
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: row({ joined_at: null, auto_share: true }) }), false);
  assert.equal(ORG.autoShareFor({ org: FIRM_ON, membership: row({ removed_at: "2026-08-17T00:00:00Z", auto_share: true }) }), false);
  assert.equal(ORG.autoShareFor({}), false);
  assert.equal(ORG.autoShareFor(), false);
});

test("autoShareValue maps the three named choices, and refuses anything else", () => {
  assert.equal(ORG.autoShareValue("always"), true);
  assert.equal(ORG.autoShareValue("never"), false);
  assert.equal(ORG.autoShareValue("follow"), null);
  // undefined, not null: null IS a value here ("follow"), so a refusal has to
  // be distinguishable from it or a junk choice would silently mean follow.
  for (const junk of ["", "yes", "true", null, undefined, true, 1]) {
    assert.equal(ORG.autoShareValue(junk), undefined, JSON.stringify(junk));
  }
});
