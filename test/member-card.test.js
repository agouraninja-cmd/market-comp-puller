// member-card.js — what a colleague's profile card may say (2026-09-29).
const test = require("node:test");
const assert = require("node:assert");
const MC = require("../member-card");

const OWNER = { id: "m1", role: "owner", joined_at: "2026-01-05", user_id: "u1", email: "brad@x.com" };
const MEMBER = { id: "m2", role: "member", joined_at: "2026-06-10", user_id: "u2", email: "mike@x.com" };
const ADMIN = { id: "m3", role: "admin", joined_at: "2026-03-02", user_id: "u3", email: "ann@x.com" };

test("a title is cleaned, capped by refusal, and empty clears it", () => {
  assert.deepEqual(MC.validateTitle("  Associate ·  Retail "), { ok: true, value: "Associate · Retail" });
  assert.deepEqual(MC.validateTitle("a\u0007b\nc"), { ok: true, value: "a b c" });
  assert.deepEqual(MC.validateTitle(""), { ok: true, value: "" });
  assert.deepEqual(MC.validateTitle(null), { ok: true, value: "" });
  assert.equal(MC.validateTitle("x".repeat(81)).ok, false, "too long is refused, never truncated");
  assert.equal(MC.validateTitle(42).ok, false);
});

test("the seat line is for an owner looking at somebody else, and nobody else", () => {
  const seat = { pro: false, viaFirm: false };
  assert.deepEqual(MC.cardView({ member: MEMBER, viewer: OWNER, seat }).seat, { pro: false, viaFirm: false });
  assert.equal(MC.cardView({ member: OWNER, viewer: MEMBER, seat }).seat, null, "a member is not told the owner's plan");
  assert.equal(MC.cardView({ member: MEMBER, viewer: ADMIN, seat }).seat, null, "nor is an admin");
  assert.equal(MC.cardView({ member: OWNER, viewer: OWNER, seat }).seat, null, "nor is anybody shown their own here");
  assert.equal(MC.cardView({ member: MEMBER, viewer: { ...OWNER, removed_at: "x" }, seat }).seat, null);
});

test("a failed read is left out, never drawn as nothing", () => {
  const v = MC.cardView({ member: MEMBER, viewer: OWNER, coverage: null, shared: { reports: 3, comps: null, buildings: 0 } });
  assert.equal(v.covers, null, "coverage that could not be read says nothing");
  assert.deepEqual(v.shared, { reports: 3, buildings: 0 }, "a failed count is absent; a real zero stays");
  assert.deepEqual(MC.cardView({ member: MEMBER, viewer: OWNER, coverage: [] }).covers, [], "no coverage at all is an empty list");
});

test("coverage is sorted and stripped to market and type", () => {
  const v = MC.cardView({ member: MEMBER, viewer: OWNER, coverage: [
    { market: "Meridian, ID", property_type: "Industrial", id: "x", user_id: "u2" },
    { market: "Boise, ID", property_type: "Office" },
    { market: "", property_type: "Retail" },
  ] });
  assert.deepEqual(v.covers, [{ market: "Boise, ID", type: "Office" }, { market: "Meridian, ID", type: "Industrial" }]);
});

test("the view carries who, not how: no account internals reach it", () => {
  const v = MC.cardView({
    member: MEMBER, viewer: OWNER,
    person: { id: "u2", name: " Mike Chen ", email: "mike@x.com", title: "Associate", avatar_rev: "abc", password_hash: "nope", pro_tester: true },
  });
  assert.equal(v.name, "Mike Chen");
  assert.equal(v.self, false);
  assert.equal(v.hasPhoto, true);
  assert.deepEqual(Object.keys(v).sort(), ["covers", "email", "hasPhoto", "id", "joinedAt", "name", "photoRev", "role", "seat", "self", "shared", "title", "userId"]);
  assert.equal(MC.cardView({ member: { ...MEMBER, role: "superuser" }, viewer: OWNER }).role, "member", "an unknown role reads as member");
  assert.equal(MC.cardView({ member: OWNER, viewer: OWNER }).self, true);
});
