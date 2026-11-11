// email-verify.js: has an account proven it owns its email address?
//
// The module's header states the rules; this holds each one. The route half
// (that the rules are actually wired to shares, firms, deal rooms and the
// broker profile) is test/email-verify-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const EV = require("../email-verify");

const SECRET = "service-key";
const NOW = Date.UTC(2026, 10, 10);

test("verifiedOf: a stored row is proven only by a date in the column", () => {
  assert.equal(EV.verifiedOf({ email_verified_at: "2026-11-10T00:00:00Z" }, true), true);
  assert.equal(EV.verifiedOf({ email_verified_at: null }, true), false,
    "the column exists and is empty: this account never proved its address");
  assert.equal(EV.verifiedOf({ email_verified_at: "" }, true), false);
  assert.equal(EV.verifiedOf(null, true), false, "no row is nobody");
  assert.equal(EV.verifiedOf("brad@x.com", true), false, "an address is not a row");
});

test("verifiedOf: a row with no key at all is a database before migration 062", () => {
  // Rule 5, the one deliberate fail-open: PostgREST returns every column,
  // nulls included, so a missing KEY means a missing COLUMN. There the check
  // is not on, which is how the app behaved before this existed. Without it
  // a deploy ahead of the migration locks every member out of their firm.
  assert.equal(EV.verifiedOf({ id: "u1", email: "brad@x.com" }, true), true);
});

test("verifiedOf: EMAIL_VERIFICATION=off reads everybody as proven", () => {
  assert.equal(EV.verifiedOf({ email_verified_at: null }, false), true);
  assert.equal(EV.verifiedOf(null, false), true);
});

test("needsProof: only a row that has the column and has it empty", () => {
  assert.equal(EV.needsProof({ email_verified_at: null }), true);
  assert.equal(EV.needsProof({ email_verified_at: "2026-11-10T00:00:00Z" }), false);
  assert.equal(EV.needsProof({ id: "u1" }), false,
    "no column: there is nothing to stamp, so the Google door must not rotate a password over it");
  assert.equal(EV.needsProof(null), false);
});

test("provenEmail: a literal true and nothing else", () => {
  assert.equal(EV.provenEmail({ email: " Client@Acme.COM ", email_verified: true }), "client@acme.com");
  assert.equal(EV.provenEmail({ email: "client@acme.com", email_verified: false }), "");
  // Fails closed for a caller that forgot the flag, or sent something truthy.
  assert.equal(EV.provenEmail({ email: "client@acme.com" }), "");
  assert.equal(EV.provenEmail({ email: "client@acme.com", email_verified: "yes" }), "");
  assert.equal(EV.provenEmail({ email: "client@acme.com", email_verified: 1 }), "");
  // A stored row is not a session user: it carries the column, not the flag.
  assert.equal(EV.provenEmail({ email: "client@acme.com", email_verified_at: "2026-11-10T00:00:00Z" }), "");
  assert.equal(EV.provenEmail("client@acme.com"), "", "an address handed in directly is refused");
  assert.equal(EV.provenEmail(null), "");
});

test("a token confirms the account and address it was minted for, and no other", () => {
  const token = EV.mintToken({ userId: "u1", email: "client@acme.com", secret: SECRET, now: NOW });
  assert.match(token, /^[0-9a-z]+\.[A-Za-z0-9_-]{20,}$/);
  const ok = (over) => EV.checkToken(token, { userId: "u1", email: "client@acme.com", secret: SECRET, now: NOW, ...over });
  assert.equal(ok({}), true);
  assert.equal(ok({ email: "Client@ACME.com " }), true, "the address is compared normalized");
  assert.equal(ok({ userId: "u2" }), false, "another account holding the link confirms nothing");
  assert.equal(ok({ email: "other@acme.com" }), false);
  assert.equal(ok({ secret: "another-key" }), false);
});

test("a token expires, and its expiry cannot be edited", () => {
  const token = EV.mintToken({ userId: "u1", email: "c@acme.com", secret: SECRET, now: NOW });
  const at = (now) => EV.checkToken(token, { userId: "u1", email: "c@acme.com", secret: SECRET, now });
  assert.equal(at(NOW + EV.TOKEN_TTL_MS - 1000), true);
  assert.equal(at(NOW + EV.TOKEN_TTL_MS + 1000), false);
  // Push the expiry out by rewriting the first half: the MAC covers it.
  const [, mac] = token.split(".");
  const later = (NOW + 10 * EV.TOKEN_TTL_MS).toString(36) + "." + mac;
  assert.equal(EV.checkToken(later, { userId: "u1", email: "c@acme.com", secret: SECRET, now: NOW + 2 * EV.TOKEN_TTL_MS }), false);
});

test("junk is never a token, and nothing is minted without its three inputs", () => {
  const ctx = { userId: "u1", email: "c@acme.com", secret: SECRET, now: NOW };
  for (const junk of ["", null, undefined, "abc", "abc.", ".abc", "a.b.c", "zz.short", 42, {}]) {
    assert.equal(EV.checkToken(junk, ctx), false, String(junk));
  }
  assert.equal(EV.mintToken({ userId: "", email: "c@acme.com", secret: SECRET, now: NOW }), "");
  assert.equal(EV.mintToken({ userId: "u1", email: "", secret: SECRET, now: NOW }), "");
  assert.equal(EV.mintToken({ userId: "u1", email: "c@acme.com", secret: "", now: NOW }), "");
  const good = EV.mintToken(ctx);
  assert.equal(EV.checkToken(good, { ...ctx, secret: "" }), false);
  assert.equal(EV.checkToken(good, { ...ctx, userId: "" }), false);
});

test("the link lands on a shared report's page or the sign-in door, nowhere else", () => {
  assert.equal(EV.safeNext("/r/AbC123_-xyz"), "/r/AbC123_-xyz");
  for (const bad of ["/desk", "/r/", "/r/short", "/r/abcdef/extra", "//evil.com/r/abcdefgh",
    "https://evil.com/r/abcdefgh", "/r/abcdefgh?x=1", "/r/abcdefgh#x", "", null, undefined, 7]) {
    assert.equal(EV.safeNext(bad), "", String(bad));
  }
  assert.equal(EV.confirmUrl({ siteUrl: "https://compninja.co/", token: "t.k", next: "/r/AbC123_-xyz" }),
    "https://compninja.co/r/AbC123_-xyz#confirm=t.k");
  assert.equal(EV.confirmUrl({ siteUrl: "https://compninja.co", token: "t.k", next: "https://evil.com" }),
    "https://compninja.co/?auth=signin#confirm=t.k",
    "anything that is not a shared report falls back to the app's own door");
  // The token rides the fragment, which a browser never sends to a server.
  assert.ok(EV.confirmUrl({ siteUrl: "https://compninja.co", token: "t.k" }).indexOf("#confirm=") > 0);
});

test("the mail says what it is for, how to ignore it, and never says 'verified'", () => {
  const mail = EV.confirmMail("https://compninja.co/?auth=signin#confirm=t.k");
  assert.match(mail.subject, /Confirm your email/);
  assert.ok(mail.text.includes("https://compninja.co/?auth=signin#confirm=t.k"));
  assert.match(mail.text, /did not create a CompNinja account, ignore this email/);
  // CLAUDE.md rule 8: that word is the badge the server awards a comp.
  assert.doesNotMatch(mail.subject + mail.text, /verif/i);
});

test("server.js recognizes nobody by a bare address", () => {
  // The three reads that used to take an address now take the session user,
  // and decide inside whether that user has proven the address. A call that
  // hands one of them `something.email` is the old by-address door coming
  // back: it would compile, pass every test of a confirmed account, and let
  // an unconfirmed sign-up read what was sent to the address it typed.
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const fn of ["orgMembershipsFor", "findBrokerProfile", "listSharesForViewer"]) {
    // Code lines only: the comments above each function quote the old shape.
    const calls = server.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && l.includes(fn + "("));
    assert.ok(calls.length > 1, fn + " should be called somewhere");
    for (const line of calls) {
      assert.ok(!line.includes(fn + "(user.email") && !/\(\s*[\w.]+\.email\s*[,)]/.test(line.slice(line.indexOf(fn + "("))),
        fn + " must be handed the user, not an address: " + line.trim());
    }
    assert.ok(server.includes("async function " + fn + "(user)"), fn + " takes the user");
  }
  // And the session user is where the answer is put, from the whole row.
  assert.match(server, /email_verified: EMAILVERIFY\.verifiedOf\(user, EMAIL_VERIFICATION\)/);
});
