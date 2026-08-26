// google-auth.js — the rules for "Continue with Google", pure and tested.
//
// The decision half of Google sign-in: the URL that sends a visitor to
// Google's consent screen, reading the claims out of the id_token the code
// exchange returns, and deciding whether those claims are good enough to
// open an account with. server.js owns every side effect — the state cookie,
// the token exchange itself, the user lookup/creation, the session — so
// `npm test` can exercise the whole decision table with no network and no
// clock (the caller passes `now`, entitlements.js's rule).
//
// WHY THE TOKEN'S SIGNATURE IS NOT VERIFIED HERE. The id_token reaches
// server.js straight from Google's own token endpoint, over TLS, on a
// request authenticated with the client secret — Google's documentation says
// signature validation is unnecessary on exactly that path, because nothing
// untrusted ever carried the token. The claims are still validated (issuer,
// audience, expiry, verified email): those guard against OUR mistakes — a
// token minted for a different client id, a stale token replayed through a
// stuck callback — not against forgery. If a token ever arrives any other
// way (from a browser, from a header), signature verification against
// Google's JWKS becomes mandatory; do not reuse this module for that.
//
// IDENTITY IS THE EMAIL, deliberately. That is this product's standing
// decision (migration 018's, restated by 024 and the firms work), so Google
// sign-in keys on the VERIFIED email and needs no migration — a Google
// sign-in lands on the same `users` row a password sign-in does. `sub` is
// the more stable key in principle (a Workspace admin can reassign an
// address), and if that ever bites, a `users.google_sub` column is the
// upgrade path; until then a second identity key would be a second answer
// to "whose account is this".

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Mirrors the signup route's own email test byte for byte, so an address
// Google verifies but signup would refuse cannot enter through the side door.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The consent-screen redirect. `scope` asks for nothing beyond identity
// (openid email profile are Google's non-sensitive scopes, so the consent
// screen needs no review), and `prompt=select_account` gives a visitor with
// two Google accounts the chooser rather than a silent sign-in with
// whichever one Google considers active.
function authUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: String(clientId || ""),
    redirect_uri: String(redirectUri || ""),
    response_type: "code",
    scope: "openid email profile",
    state: String(state || ""),
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${q}`;
}

// The claims out of a JWT, or null. No signature check — see the header for
// why that is safe on the one path this module serves. Anything that is not
// three dot-joined segments with a JSON object in the middle is null, never
// a guess: base64url decoding is forgiving of garbage, JSON.parse is not,
// and a claims object that is really an array or a string must not reach
// the validator looking plausible.
function parseIdTokenClaims(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch (_) { return null; }
  return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
}

// Is this token good enough to open an account whose whole identity is the
// email? Every refusal fails toward less access — the visitor sees "didn't
// complete" and still has the password door.
function validateGoogleClaims(claims, { clientId, now }) {
  if (!claims || typeof claims !== "object") return { ok: false, reason: "no_claims" };
  // Google documents both spellings of its issuer.
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    return { ok: false, reason: "issuer" };
  }
  // aud is checked against OUR client id, and an empty configured id refuses
  // rather than matching a token whose aud is also empty-ish.
  if (!clientId || claims.aud !== clientId) return { ok: false, reason: "audience" };
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return { ok: false, reason: "expired" };
  // Strict boolean, not truthy: OIDC says email_verified is a JSON boolean,
  // and an unverified email must never open an account it does not own. A
  // string "true" is a malformed token and refuses like everything else
  // malformed.
  if (claims.email_verified !== true) return { ok: false, reason: "unverified_email" };
  const email = String(claims.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "email" };
  // Same 120-char cap the signup route puts on a typed name.
  const name = String(claims.name || "").trim().slice(0, 120);
  return { ok: true, email, name };
}

module.exports = { AUTH_ENDPOINT, TOKEN_ENDPOINT, authUrl, parseIdTokenClaims, validateGoogleClaims };
