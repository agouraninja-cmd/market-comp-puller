// The share access decision, exhaustively. Pure like entitlements.test.js:
// no server, no database, no clock.
const test = require("node:test");
const assert = require("node:assert");
const { canReadShare, normalizeEmail } = require("../report-access.js");

const OWNER = { id: "u1", email: "broker@firm.com" };
const CLIENT = { id: "u2", email: "client@acme.com" };
const STRANGER = { id: "u3", email: "nobody@else.com" };

const pub = { id: "s1", user_id: "u1", visibility: "public", revoked_at: null };
const inv = { id: "s2", user_id: "u1", visibility: "invited", revoked_at: null };
const viewers = [{ email: "client@acme.com" }];

test("a public share is readable by anyone, signed in or not", () => {
  assert.deepEqual(canReadShare({ share: pub, viewers: [], user: null }), { ok: true, reason: "public" });
  assert.equal(canReadShare({ share: pub, viewers: [], user: STRANGER }).ok, true);
});

test("an invited share refuses an anonymous reader with signin_required", () => {
  const d = canReadShare({ share: inv, viewers, user: null });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "signin_required");
});

test("an invited share admits an invited email", () => {
  assert.deepEqual(canReadShare({ share: inv, viewers, user: CLIENT }), { ok: true, reason: "invited" });
});

test("the invite matches on email case-insensitively and ignores surrounding space", () => {
  const messy = [{ email: "  Client@Acme.COM " }];
  assert.equal(canReadShare({ share: inv, viewers: messy, user: CLIENT }).ok, true);
});

test("a signed-in stranger is refused with not_invited, not signin_required", () => {
  // signin_required would send them to a sign-in card they are already past.
  const d = canReadShare({ share: inv, viewers, user: STRANGER });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

test("the owner always reads their own invited share", () => {
  assert.deepEqual(canReadShare({ share: inv, viewers: [], user: OWNER }), { ok: true, reason: "owner" });
});

test("revocation beats everything, including the owner and a public link", () => {
  const dead = { ...pub, revoked_at: "2026-08-06T00:00:00Z" };
  assert.equal(canReadShare({ share: dead, viewers: [], user: OWNER }).reason, "revoked");
  assert.equal(canReadShare({ share: dead, viewers: [], user: null }).reason, "revoked");
  const deadInv = { ...inv, revoked_at: "2026-08-06T00:00:00Z" };
  assert.equal(canReadShare({ share: deadInv, viewers, user: CLIENT }).ok, false);
});

test("an unknown visibility is treated as invited, never as public", () => {
  // Fails closed: a typo in a column must not publish a report.
  const weird = { ...inv, visibility: "sort-of-public" };
  assert.equal(canReadShare({ share: weird, viewers, user: STRANGER }).ok, false);
  assert.equal(canReadShare({ share: weird, viewers, user: CLIENT }).ok, true);
});

test("a missing share is refused rather than thrown at", () => {
  assert.equal(canReadShare({ share: null, viewers: [], user: OWNER }).ok, false);
});

test("an ownerless legacy row is still public", () => {
  // Every row written before migration 018 has user_id null.
  const legacy = { id: "s0", user_id: null, visibility: "public", revoked_at: null };
  assert.equal(canReadShare({ share: legacy, viewers: [], user: null }).ok, true);
});

test("normalizeEmail lowercases and trims, and rejects junk to empty", () => {
  assert.equal(normalizeEmail("  Foo@Bar.com "), "foo@bar.com");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail("a@b.co"), "a@b.co");
});

// ---------------------------------------------------------------------------
// The firm audience (migration 030, enterprise accounts slice 1).
//
// The branch sits INSIDE the invited path, so every test above still describes
// it: revocation beats it, an anonymous reader is still signin_required, and
// the owner still reads their own. What these add is the one new question —
// does membership let somebody in — and the four ways it must fail closed.
// ---------------------------------------------------------------------------
const firmShare = { id: "s3", user_id: "u1", visibility: "org", org_id: "org1", revoked_at: null };
const COLLEAGUE = { id: "u4", email: "mike@colliers.com" };

test("a firm share admits an active member of that firm", () => {
  assert.deepEqual(
    canReadShare({ share: firmShare, viewers: [], user: COLLEAGUE, orgIds: ["org1"] }),
    { ok: true, reason: "firm" });
});

test("a firm share refuses somebody in a DIFFERENT firm", () => {
  const d = canReadShare({ share: firmShare, viewers: [], user: COLLEAGUE, orgIds: ["org2"] });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "not_invited");
});

test("a firm share refuses a reader in no firm, and never throws on a missing orgIds", () => {
  for (const orgIds of [[], null, undefined, "org1", 7]) {
    const d = canReadShare({ share: firmShare, viewers: [], user: COLLEAGUE, orgIds });
    assert.equal(d.ok, false, JSON.stringify(orgIds));
    assert.equal(d.reason, "not_invited", JSON.stringify(orgIds));
  }
});

test("a firm share still asks an anonymous reader to sign in", () => {
  // Membership is decided on an account, so there is nothing to check yet.
  const d = canReadShare({ share: firmShare, viewers: [], user: null, orgIds: ["org1"] });
  assert.equal(d.reason, "signin_required");
});

test("revocation beats firm membership too", () => {
  const dead = { ...firmShare, revoked_at: "2026-08-17T00:00:00Z" };
  assert.equal(canReadShare({ share: dead, viewers: [], user: COLLEAGUE, orgIds: ["org1"] }).reason, "revoked");
});

test("BOTH the visibility and the org_id are required — neither alone widens a share", () => {
  // A stray org_id on an INVITED share must not let a firm read it...
  const strayId = { ...firmShare, visibility: "invited" };
  assert.equal(canReadShare({ share: strayId, viewers: [], user: COLLEAGUE, orgIds: ["org1"] }).ok, false);
  // ...and visibility 'org' with no org_id must not fall through to anything
  // but the viewer list, which for a firm share is empty.
  const noId = { ...firmShare, org_id: null };
  assert.equal(canReadShare({ share: noId, viewers: [], user: COLLEAGUE, orgIds: ["org1"] }).ok, false);
});

test("a firm share may ALSO carry named viewers, and the firm branch never blocks them", () => {
  // The org check runs first and simply does not match; the viewer list is
  // still consulted below it.
  const outside = { id: "u5", email: "client@acme.com" };
  const d = canReadShare({
    share: firmShare, viewers: [{ email: "client@acme.com" }], user: outside, orgIds: [],
  });
  assert.deepEqual(d, { ok: true, reason: "invited" });
});

test("org ids compare as strings, so a numeric id from the database still matches", () => {
  const numeric = { ...firmShare, org_id: 42 };
  assert.equal(canReadShare({ share: numeric, viewers: [], user: COLLEAGUE, orgIds: ["42"] }).ok, true);
  assert.equal(canReadShare({ share: firmShare, viewers: [], user: COLLEAGUE, orgIds: [null] }).ok, false);
});
