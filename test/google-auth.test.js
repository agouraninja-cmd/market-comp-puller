// google-auth.js — the decision table for "Continue with Google".
//
// Everything here is the refusal side of a door that opens accounts: a token
// that fails any one check must sign nobody in, and the pure module is where
// that is provable without a network. The route-level half (the state nonce,
// the code exchange, find-or-create) lives in test/google-auth-routes.test.js
// against a real child server and a stub token endpoint.

const test = require("node:test");
const assert = require("node:assert");
const GAUTH = require("../google-auth");

const NOW = Date.parse("2026-08-25T12:00:00Z");
const CLIENT = "12345-abc.apps.googleusercontent.com";

function tokenWith(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature-not-checked-here`;
}
function goodClaims(over) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT,
    exp: Math.floor(NOW / 1000) + 3600,
    email: "pat@example.com",
    email_verified: true,
    name: "Pat Example",
    ...over,
  };
}
const validate = (claims) => GAUTH.validateGoogleClaims(claims, { clientId: CLIENT, now: NOW });

test("the consent URL carries exactly what Google's endpoint needs", () => {
  const url = GAUTH.authUrl({ clientId: CLIENT, redirectUri: "http://localhost:3000/auth/google/callback", state: "abc123" });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, GAUTH.AUTH_ENDPOINT);
  assert.equal(u.searchParams.get("client_id"), CLIENT);
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:3000/auth/google/callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("state"), "abc123");
  // Identity only — non-sensitive scopes, so the consent screen needs no
  // Google review and the product asks for nothing it does not use.
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  // A visitor with two Google accounts gets the chooser, not a silent pick.
  assert.equal(u.searchParams.get("prompt"), "select_account");
});

test("claims parse out of a well-formed JWT", () => {
  const claims = GAUTH.parseIdTokenClaims(tokenWith(goodClaims()));
  assert.equal(claims.email, "pat@example.com");
  assert.equal(claims.aud, CLIENT);
});

test("anything that is not a three-part JWT with an object payload is null, never a guess", () => {
  assert.equal(GAUTH.parseIdTokenClaims(""), null);
  assert.equal(GAUTH.parseIdTokenClaims(null), null);
  assert.equal(GAUTH.parseIdTokenClaims("just-one-part"), null);
  assert.equal(GAUTH.parseIdTokenClaims("two.parts"), null);
  assert.equal(GAUTH.parseIdTokenClaims("a.b.c.d"), null);
  assert.equal(GAUTH.parseIdTokenClaims("aaa.!!!not-base64-json!!!.ccc"), null);
  // A payload that parses but is not a claims OBJECT must not reach the
  // validator looking plausible.
  const arr = Buffer.from(JSON.stringify(["not", "claims"])).toString("base64url");
  assert.equal(GAUTH.parseIdTokenClaims(`h.${arr}.s`), null);
  const str = Buffer.from(JSON.stringify("a string")).toString("base64url");
  assert.equal(GAUTH.parseIdTokenClaims(`h.${str}.s`), null);
});

test("a good token yields the normalized identity", () => {
  const r = validate(goodClaims());
  assert.deepEqual(r, { ok: true, email: "pat@example.com", name: "Pat Example" });
});

test("the email is lowercased and trimmed on the way out", () => {
  const r = validate(goodClaims({ email: "  Pat@Example.COM " }));
  assert.equal(r.ok, true);
  assert.equal(r.email, "pat@example.com");
});

test("the name gets signup's own 120-char cap, and a missing one is empty", () => {
  assert.equal(validate(goodClaims({ name: "x".repeat(200) })).name.length, 120);
  assert.equal(validate(goodClaims({ name: undefined })).name, "");
});

test("both documented issuer spellings pass; anything else refuses", () => {
  assert.equal(validate(goodClaims({ iss: "accounts.google.com" })).ok, true);
  assert.equal(validate(goodClaims({ iss: "https://accounts.google.com" })).ok, true);
  assert.deepEqual(validate(goodClaims({ iss: "https://evil.example.com" })), { ok: false, reason: "issuer" });
  assert.deepEqual(validate(goodClaims({ iss: undefined })), { ok: false, reason: "issuer" });
});

test("a token minted for a different client id refuses — and so does an empty configured id", () => {
  assert.deepEqual(validate(goodClaims({ aud: "someone-else.apps.googleusercontent.com" })), { ok: false, reason: "audience" });
  // An empty clientId must never match a token whose aud is also empty-ish:
  // half-configured is dark, not permissive.
  assert.equal(GAUTH.validateGoogleClaims(goodClaims({ aud: "" }), { clientId: "", now: NOW }).ok, false);
});

test("an expired or dateless token refuses", () => {
  assert.deepEqual(validate(goodClaims({ exp: Math.floor(NOW / 1000) - 1 })), { ok: false, reason: "expired" });
  assert.deepEqual(validate(goodClaims({ exp: undefined })), { ok: false, reason: "expired" });
  assert.deepEqual(validate(goodClaims({ exp: "soon" })), { ok: false, reason: "expired" });
});

test("email_verified must be the boolean true — false, missing, and the string 'true' all refuse", () => {
  // The whole identity model is the email, so an unverified one must never
  // open an account it does not own. Strict boolean: OIDC says boolean, and
  // a string "true" is a malformed token, not a yes.
  assert.deepEqual(validate(goodClaims({ email_verified: false })), { ok: false, reason: "unverified_email" });
  assert.deepEqual(validate(goodClaims({ email_verified: undefined })), { ok: false, reason: "unverified_email" });
  assert.deepEqual(validate(goodClaims({ email_verified: "true" })), { ok: false, reason: "unverified_email" });
});

test("a missing or malformed email refuses even when verified", () => {
  assert.deepEqual(validate(goodClaims({ email: "" })), { ok: false, reason: "email" });
  assert.deepEqual(validate(goodClaims({ email: "not-an-email" })), { ok: false, reason: "email" });
  assert.deepEqual(validate(goodClaims({ email: "two words@example.com" })), { ok: false, reason: "email" });
});

test("null claims refuse rather than throw", () => {
  assert.deepEqual(validate(null), { ok: false, reason: "no_claims" });
});
