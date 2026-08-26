// "Continue with Google", actually running — the whole flow against a real
// child server and a stub token endpoint.
//
// WHY THIS EXISTS. google-auth.test.js proves the decision table; what it
// cannot prove is the wiring, and the wiring is where this feature's failure
// modes live: the state nonce has to make the round trip through a real
// cookie, the code exchange has to carry the right redirect_uri, a refused
// token has to leave the visitor with NO session, and a second sign-in with
// the same email has to land on the SAME account instead of minting a
// duplicate. GOOGLE_OAUTH_TOKEN_URL is the door (RESEND_API_URL's precedent,
// for its reason: without it the suite could reach the exchange and then had
// to stop and assume). Nothing here reaches Google — the stub answers every
// exchange, and the id_token it returns is unsigned, which is itself part of
// what is being pinned: the server trusts claims ONLY because they arrive
// over its own authenticated exchange, so the stub standing in for that
// exchange needs no signature either.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const shared = require("./helpers/boot");

const CLIENT = "test-client-id.apps.googleusercontent.com";
const SECRET = "test-client-secret";

function tokenWith(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.unsigned`;
}
function goodClaims(email, over) {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email,
    email_verified: true,
    name: "Pat Google",
    ...over,
  };
}

// The stub token endpoint: answers every POST with whatever id_token the
// test queued, and records the exchange bodies so "what did the server
// actually send Google" is read off the wire rather than inferred.
function tokenStub() {
  const seen = [];
  let nextToken = "";
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method, body: new URLSearchParams(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id_token: nextToken, access_token: "unused" }));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, () => resolve({
      url: `http://localhost:${srv.address().port}/token`,
      seen,
      queue: (t) => { nextToken = t; },
      close: () => srv.close(),
    }));
  });
}

const cookieOf = (r, name) =>
  (r.headers.getSetCookie() || []).find((c) => c.startsWith(name + "="));
const cookieVal = (c) => c.split(";")[0].split("=").slice(1).join("=");

// One consent redirect: returns { state, cookie } for the callback to use.
async function startFlow(base) {
  const r = await fetch(base + "/auth/google", { redirect: "manual" });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  const stateCookie = cookieOf(r, "cn_gstate");
  assert.ok(stateCookie, "the consent redirect must set the state cookie");
  return { state: loc.searchParams.get("state"), cookie: stateCookie.split(";")[0], location: loc };
}

test("dark deployment: the Google routes do not exist and config says so", async (t) => {
  const srv = await shared.boot({});
  t.after(() => srv.stop());
  for (const p of ["/auth/google", "/auth/google/callback?code=x&state=y"]) {
    assert.equal((await fetch(srv.base + p, { redirect: "manual" })).status, 404, p);
  }
  const cfg = await (await fetch(srv.base + "/api/config")).json();
  assert.equal(cfg.googleAuth, false, "/api/config must say the button cannot work here");
});

test("configured deployment", async (t) => {
  const stub = await tokenStub();
  t.after(() => stub.close());
  const srv = await shared.boot({
    GOOGLE_OAUTH_CLIENT_ID: CLIENT,
    GOOGLE_OAUTH_CLIENT_SECRET: SECRET,
    GOOGLE_OAUTH_TOKEN_URL: stub.url,
  });
  t.after(() => srv.stop());

  await t.test("/api/config offers the button", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.googleAuth, true);
  });

  await t.test("the consent redirect carries our client id, a nonce, and the localhost callback", async () => {
    const { state, location } = await startFlow(srv.base);
    assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(location.searchParams.get("client_id"), CLIENT);
    assert.match(state, /^[0-9a-f]{32}$/, "the state is a fresh random nonce");
    assert.equal(location.searchParams.get("redirect_uri"), srv.base + "/auth/google/callback",
      "dev must echo the localhost host — SITE_URL here is the Render default, which Google would refuse");
  });

  await t.test("a callback whose state does not match the cookie signs nobody in and never reaches the exchange", async () => {
    const { cookie } = await startFlow(srv.base);
    const before = stub.seen.length;
    const r = await fetch(srv.base + "/auth/google/callback?code=abc&state=wrong-nonce", {
      redirect: "manual", headers: { cookie },
    });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get("location"), srv.base).search, "?auth=signin&gerr=1");
    assert.equal(cookieOf(r, "cn_session"), undefined, "no session on a failed CSRF check");
    assert.equal(stub.seen.length, before, "the code must never be exchanged on a failed state check");
  });

  await t.test("a callback with no state cookie at all fails the same way", async () => {
    const r = await fetch(srv.base + "/auth/google/callback?code=abc&state=deadbeef", { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get("location"), srv.base).search, "?auth=signin&gerr=1");
    assert.equal(cookieOf(r, "cn_session"), undefined);
  });

  const email = `google-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  await t.test("the full flow: exchange, account creation, session", async () => {
    const { state, cookie } = await startFlow(srv.base);
    stub.queue(tokenWith(goodClaims(email)));
    const r = await fetch(`${srv.base}/auth/google/callback?code=auth-code-1&state=${state}`, {
      redirect: "manual", headers: { cookie },
    });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get("location"), srv.base).pathname, "/");
    // The exchange the server actually sent, read off the wire.
    const sent = stub.seen[stub.seen.length - 1].body;
    assert.equal(sent.get("code"), "auth-code-1");
    assert.equal(sent.get("client_id"), CLIENT);
    assert.equal(sent.get("client_secret"), SECRET);
    assert.equal(sent.get("grant_type"), "authorization_code");
    assert.equal(sent.get("redirect_uri"), srv.base + "/auth/google/callback");
    // The session is real: /me answers with the account it opened.
    const session = cookieOf(r, "cn_session");
    assert.ok(session, "success must set the session cookie");
    assert.ok(cookieVal(session).length > 20, "a real token, not a clear");
    const gstate = cookieOf(r, "cn_gstate");
    assert.ok(gstate && gstate.includes("Max-Age=0"), "the one-shot nonce is cleared on success too");
    const me = await (await fetch(srv.base + "/api/account/me", {
      headers: { cookie: session.split(";")[0] },
    })).json();
    assert.equal(me.email, email);
    assert.equal(me.name, "Pat Google");
  });

  await t.test("a second Google sign-in with the same email lands on the SAME account", async () => {
    const { state, cookie } = await startFlow(srv.base);
    // A different name in the second token: if this created a fresh account,
    // /me would echo "Renamed Person"; landing on the existing row keeps the
    // original name, which is what proves find-not-create.
    stub.queue(tokenWith(goodClaims(email, { name: "Renamed Person" })));
    const r = await fetch(`${srv.base}/auth/google/callback?code=auth-code-2&state=${state}`, {
      redirect: "manual", headers: { cookie },
    });
    const session = cookieOf(r, "cn_session");
    assert.ok(session, "the repeat sign-in still opens a session");
    const me = await (await fetch(srv.base + "/api/account/me", {
      headers: { cookie: session.split(";")[0] },
    })).json();
    assert.equal(me.email, email);
    assert.equal(me.name, "Pat Google", "the existing account, not a duplicate with the new token's name");
  });

  await t.test("an unverified email signs nobody in", async () => {
    const { state, cookie } = await startFlow(srv.base);
    stub.queue(tokenWith(goodClaims("unverified@example.com", { email_verified: false })));
    const r = await fetch(`${srv.base}/auth/google/callback?code=auth-code-3&state=${state}`, {
      redirect: "manual", headers: { cookie },
    });
    assert.equal(new URL(r.headers.get("location"), srv.base).search, "?auth=signin&gerr=1");
    assert.equal(cookieOf(r, "cn_session"), undefined);
  });

  await t.test("a token minted for someone else's client id signs nobody in", async () => {
    const { state, cookie } = await startFlow(srv.base);
    stub.queue(tokenWith(goodClaims("aud@example.com", { aud: "another-app.apps.googleusercontent.com" })));
    const r = await fetch(`${srv.base}/auth/google/callback?code=auth-code-4&state=${state}`, {
      redirect: "manual", headers: { cookie },
    });
    assert.equal(new URL(r.headers.get("location"), srv.base).search, "?auth=signin&gerr=1");
    assert.equal(cookieOf(r, "cn_session"), undefined);
  });

  await t.test("a Google-created account answers the password door like any wrong guess", async () => {
    const r = await fetch(srv.base + "/api/account/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "any-guess-at-all" }),
    });
    // 401, identical to a wrong password — the random hash behind a Google
    // account is a real hash, so nothing about the account leaks here.
    assert.equal(r.status, 401);
  });
});
