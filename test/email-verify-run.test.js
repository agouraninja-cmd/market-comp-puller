// Confirming an email address, actually running: a real server.js against the
// stand-in PostgREST and Resend.
//
// WHY THIS EXISTS. Identity here is the email (migration 018): a report shared
// with an address, a firm invitation, a deal room and a broker profile are all
// handed to whichever account carries that address. Until 2026-11-10 sign-up
// never checked that the person typing an address could read its inbox, so
// anybody who knew client@acme.com had been sent something could sign up as
// client@acme.com first and read it. email-verify.test.js, report-access.test.js
// and hub-access.test.js prove the rules; what they cannot prove is that the
// rules are WIRED, and every one of these is a read that is arguable in a
// comment and only true if it executes. The same reason test/org-run.test.js
// exists, and it uses the same fake.
//
// The stand-in is told `columnDefaults: { users: { email_verified_at: null } }`
// because server.js reads meaning into the KEY being present: a users row with
// the key and a null is an account that has not confirmed, a row with no key
// is a database where migration 062 has not run. A real table returns the
// column on every row; the fake stores only what it was sent.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const DAY = 24 * 3600 * 1000;
const YEAR_OUT = new Date(Date.now() + 365 * DAY).toISOString();
const AGO = (days) => new Date(Date.now() - days * DAY).toISOString();

// Brad sent everything below. He proved his address long ago.
const BRAD = { id: "u-brad", email: "brad@foothill.com", name: "Brad Keller", email_verified_at: AGO(90) };
// The address Brad sent it all TO. Nobody has an account on it yet.
const CLIENT_EMAIL = "client@acme.com";

const SHARE_ID = "shrInvited01";
const ORG_ID = "org-foothill";
const HUB_ID = "hubAcme0001";

const REPORT = {
  data: { comps: [{ address: "100 Main St", price: 1000000 }] },
  meta: { address: "500 Warehouse Way, Boise, ID", type: "Industrial" },
};

function seedTables() {
  const share = {
    id: SHARE_ID, payload: REPORT, user_id: BRAD.id, visibility: "invited",
    include_private: false, revoked_at: null, created_at: AGO(3), org_id: null, shared_by_name: "Brad Keller",
  };
  const hub = {
    id: HUB_ID, owner_user_id: BRAD.id, title: "Warehouse requirement, Acme", market: "Boise, ID",
    property_type: "Industrial", subject_address: "500 Warehouse Way, Boise, ID", status: "open",
    created_at: AGO(3), updated_at: AGO(1), closed_at: null,
  };
  return {
    users: [{ ...BRAD, pro_tester: false, vault_beta: false, digest_optout: false, created_at: AGO(200) }],
    sessions: [{ token_hash: sha256("tok-" + BRAD.id), user_id: BRAD.id, expires_at: YEAR_OUT }],
    subscriptions: [{
      user_id: BRAD.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    // An invited report, sent to the client's address. The viewer row is
    // pre-joined (the stand-in does not resolve PostgREST embeds;
    // test/sharing-card-run.test.js does the same).
    shared_reports: [share],
    report_viewers: [{
      share_id: SHARE_ID, email: CLIENT_EMAIL, invited_at: AGO(3),
      first_viewed_at: null, last_viewed_at: null, shared_reports: { ...share },
    }],
    // A firm invitation to the same address, not yet accepted.
    orgs: [{ id: ORG_ID, name: "Foothill Commercial", kind: "broker", share_default: "none", seats: 5, created_at: AGO(30) }],
    org_members: [
      { id: "m-brad", org_id: ORG_ID, email: BRAD.email, user_id: BRAD.id, role: "owner",
        invited_at: AGO(30), joined_at: AGO(30), removed_at: null, auto_share: null },
      { id: "m-client", org_id: ORG_ID, email: CLIENT_EMAIL, user_id: null, role: "member",
        invited_at: AGO(2), joined_at: null, removed_at: null, auto_share: null },
    ],
    org_subscriptions: [], org_branding: [], org_contacts: [],
    // A deal room with the address in its guest list.
    hubs: [hub],
    hub_participants: [{
      id: "hp-client", hub_id: HUB_ID, email: CLIENT_EMAIL, role: "tenant", user_id: null,
      token_hash: sha256("a-token-nobody-here-holds"), invited_at: AGO(3),
      first_viewed_at: null, last_seen_at: null, removed_at: null, hubs: { ...hub },
    }],
    hub_items: [], hub_messages: [], hub_notify: [], hub_email_prefs: [],
    // And a comp the real person once submitted under that address, typed
    // into a public form.
    comp_submissions: [{
      id: "sub-1", ts: AGO(40), status: "approved", broker_email: CLIENT_EMAIL, broker_name: "Casey Client",
      broker_company: "Acme", address: "12 Dock Rd, Boise, ID", property_type: "Industrial",
      transaction: "sale", deal_date: "2026-05-01", price_or_rate: "$2,000,000", cited_count: 3,
    }],
    broker_profiles: [],
    analytics_events: [], export_usage: [], report_purchases: [], password_resets: [],
  };
}

async function bootWithDb(t, { tables = seedTables(), mail = true, env = {}, fakeOpts = {} } = {}) {
  const db = await fake.start({ tables, columnDefaults: { users: { email_verified_at: null } }, ...fakeOpts });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    ...(mail ? {
      RESEND_API_KEY: "resend-key",
      EMAIL_FROM: "CompNinja <reports@compninja.co>",
      RESEND_API_URL: db.resendUrl,
    } : {}),
    ...env,
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  return { db, srv, tables };
}

const json = { "content-type": "application/json" };
const withCookie = (cookie, init = {}) => ({ ...init, headers: { ...json, cookie, ...(init.headers || {}) } });
const asBrad = (init = {}) => withCookie(`cn_session=tok-${BRAD.id}`, init);

// Sign up through the real door and hand back the session cookie it set.
async function signUp(srv, email, extra = {}) {
  const r = await fetch(srv.base + "/api/account/signup", {
    method: "POST", headers: json,
    body: JSON.stringify({ email, password: "correct horse battery", name: "Somebody", ...extra }),
  });
  const body = await r.json();
  const set = (r.headers.getSetCookie() || []).find((c) => c.startsWith("cn_session="));
  return { status: r.status, body, cookie: set ? set.split(";")[0] : "" };
}

const mailTo = (m) => [].concat(m.to)[0];
const confirmTokenIn = (m) => (/#confirm=([0-9a-z]+\.[A-Za-z0-9_-]+)/.exec(String(m.text || "")) || [])[1] || "";
const confirmLinkIn = (m) => (/https?:\/\/\S+#confirm=\S+/.exec(String(m.text || "")) || [])[0] || "";

test("an address has to be proven before it opens anything sent to it", async (t) => {
  const { db, srv, tables } = await bootWithDb(t);
  let squatter = "";   // the session of whoever signed up as the client's address
  let token = "";      // the confirm token mailed to the client's INBOX

  const row = () => tables.users.find((u) => u.email === CLIENT_EMAIL);

  await t.test("signing up with somebody's address works as an account, and mails that address a link", async () => {
    const s = await signUp(srv, CLIENT_EMAIL);
    assert.equal(s.status, 200, "sign-up itself is not held up");
    assert.ok(s.cookie, "and it is signed in at once");
    assert.equal(s.body.emailVerified, false, "the page is told to show the confirm notice");
    squatter = s.cookie;
    assert.equal(row().email_verified_at, null, "nothing proved this address");

    const sent = await fake.waitForMail(db, 1);
    assert.equal(sent.length, 1);
    assert.equal(mailTo(sent[0]), CLIENT_EMAIL, "the link goes to the INBOX, which the person signing up may not hold");
    assert.match(sent[0].subject, /Confirm your email/);
    assert.match(confirmLinkIn(sent[0]), /^https:\/\/compninja\.co\/\?auth=signin#confirm=/,
      "the app's own sign-in door, with the token in the fragment");
    token = confirmTokenIn(sent[0]);
    assert.ok(token);
  });

  await t.test("the account is told it is unconfirmed, and is otherwise an ordinary account", async () => {
    const me = await (await fetch(srv.base + "/api/account/me", withCookie(squatter))).json();
    assert.equal(me.email, CLIENT_EMAIL);
    assert.equal(me.emailVerified, false);
    // Everything of its OWN works: a portfolio read, and a public share it makes.
    assert.equal((await fetch(srv.base + "/api/portfolio", withCookie(squatter))).status, 200);
    const mine = await fetch(srv.base + "/api/share", withCookie(squatter, { method: "POST", body: JSON.stringify(REPORT) }));
    assert.equal(mine.status, 200, "an unconfirmed account can still share its own report");
    const made = await mine.json();
    assert.equal((await fetch(`${srv.base}/api/shared?id=${made.id}`, withCookie(squatter))).status, 200);
  });

  await t.test("it is NOT listed the report sent to that address", async () => {
    const r = await fetch(srv.base + "/api/shares", withCookie(squatter));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.sharedWithMe, [],
      "this list hands out ids and links, so before the fix the link itself was not even needed");
    assert.equal(db.requests.filter((q) => q.table === "report_viewers" && q.method === "GET").length, 0,
      "and the viewer table is not even asked");
  });

  await t.test("and cannot open it holding the link", async () => {
    const r = await fetch(`${srv.base}/api/shared?id=${SHARE_ID}`, withCookie(squatter));
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.verify_required, true, "the page branches on the flag, never the prose");
    assert.equal(body.signin_required, undefined, "they ARE signed in; a sign-in card would loop them");
    assert.equal(body.data, undefined, "and nothing of the report rides the refusal");
    assert.equal(tables.report_viewers[0].first_viewed_at, null, "nor is it stamped as opened");
  });

  await t.test("it sees no firm invitation and cannot accept one", async () => {
    const list = await (await fetch(srv.base + "/api/org", withCookie(squatter))).json();
    assert.deepEqual(list.invites, [], "the invitation is addressed to an inbox it has not proven");
    assert.deepEqual(list.orgs, []);

    const r = await fetch(srv.base + "/api/org/accept",
      withCookie(squatter, { method: "POST", body: JSON.stringify({ orgId: ORG_ID }) }));
    assert.equal(r.status, 403);
    assert.equal((await r.json()).verify_required, true);
    const invite = tables.org_members.find((m) => m.id === "m-client");
    assert.equal(invite.joined_at, null, "nothing was accepted");
    assert.equal(invite.user_id, null, "and no account was written onto the seat");
  });

  await t.test("it is not let into the deal room, nor told one exists", async () => {
    const list = await (await fetch(srv.base + "/api/hubs", withCookie(squatter))).json();
    assert.deepEqual(list.theirs, []);
    const r = await fetch(`${srv.base}/api/hub?id=${HUB_ID}`, withCookie(squatter));
    assert.equal(r.status, 403);
    const refusal = await r.json();
    assert.equal(refusal.code, "not_invited", "already signed in, so never sent back to a sign-in card");
    assert.equal(refusal.verify_required, true, "and told the fix is in their inbox, not with the broker");
    assert.equal(tables.hub_participants[0].first_viewed_at, null);
  });

  await t.test("it is not shown the comps submitted under that address, and cannot claim the broker page", async () => {
    const me = await (await fetch(srv.base + "/api/broker/me", withCookie(squatter))).json();
    assert.equal(me.isBroker, false);
    assert.equal(me.verifyRequired, true);
    assert.equal(me.submissions, undefined);
    const claim = await fetch(srv.base + "/api/broker/profile",
      withCookie(squatter, { method: "POST", body: JSON.stringify({ public: true }) }));
    assert.equal(claim.status, 403);
    assert.equal((await claim.json()).verify_required, true);
    assert.equal(tables.broker_profiles.length, 0, "no public page was made in the real broker's name");
  });

  await t.test("the link ALONE confirms nothing: no session, and somebody else's session", async () => {
    // A mail scanner following the link, or the inbox's owner curious about it.
    const bare = await fetch(srv.base + "/api/account/confirm", { method: "POST", headers: json, body: JSON.stringify({ token }) });
    assert.equal(bare.status, 401);
    assert.equal((await bare.json()).signin_required, true);
    // Another unconfirmed account that somehow holds the link.
    const other = await signUp(srv, "other@else.com");
    const r = await fetch(srv.base + "/api/account/confirm",
      withCookie(other.cookie, { method: "POST", body: JSON.stringify({ token }) }));
    assert.equal(r.status, 400, "a token is a MAC over the session's own id and address");
    assert.equal(row().email_verified_at, null, "the client's address is still unproven");
    assert.equal(tables.users.find((u) => u.email === "other@else.com").email_verified_at, null,
      "and it did not confirm the other account either");
  });

  await t.test("a junk token is refused", async () => {
    for (const bad of ["", "nope", token.slice(0, -3) + "AAA", "zzzzzzzz." + token.split(".")[1]]) {
      const r = await fetch(srv.base + "/api/account/confirm",
        withCookie(squatter, { method: "POST", body: JSON.stringify({ token: bad }) }));
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(row().email_verified_at, null);
  });

  await t.test("signed in to the account AND holding the link from the inbox, it confirms", async () => {
    const r = await fetch(srv.base + "/api/account/confirm",
      withCookie(squatter, { method: "POST", body: JSON.stringify({ token }) }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).emailVerified, true);
    assert.ok(row().email_verified_at, "the column holds when");
    const me = await (await fetch(srv.base + "/api/account/me", withCookie(squatter))).json();
    assert.equal(me.emailVerified, true, "and the notice comes down");
    // A second click is a success, not an error.
    const again = await fetch(srv.base + "/api/account/confirm",
      withCookie(squatter, { method: "POST", body: JSON.stringify({ token }) }));
    assert.equal(again.status, 200);
    assert.equal((await again.json()).already, true);
  });

  await t.test("a CONFIRMED account is listed the report and opens it", async () => {
    const body = await (await fetch(srv.base + "/api/shares", withCookie(squatter))).json();
    assert.equal(body.sharedWithMe.length, 1);
    assert.equal(body.sharedWithMe[0].id, SHARE_ID);
    const r = await fetch(`${srv.base}/api/shared?id=${SHARE_ID}`, withCookie(squatter));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).meta.address, REPORT.meta.address);
  });

  await t.test("and sees the firm invitation, and accepts it", async () => {
    const list = await (await fetch(srv.base + "/api/org", withCookie(squatter))).json();
    assert.equal(list.invites.length, 1);
    assert.equal(list.invites[0].orgId, ORG_ID);
    const r = await fetch(srv.base + "/api/org/accept",
      withCookie(squatter, { method: "POST", body: JSON.stringify({ orgId: ORG_ID }) }));
    assert.equal(r.status, 200);
    const invite = tables.org_members.find((m) => m.id === "m-client");
    assert.ok(invite.joined_at);
    assert.equal(invite.user_id, row().id);
  });

  await t.test("and is let into the deal room, and shown their own submissions", async () => {
    const list = await (await fetch(srv.base + "/api/hubs", withCookie(squatter))).json();
    assert.equal(list.theirs.length, 1);
    assert.equal(list.theirs[0].id, HUB_ID);
    const r = await fetch(`${srv.base}/api/hub?id=${HUB_ID}`, withCookie(squatter));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).role, "tenant");
    const me = await (await fetch(srv.base + "/api/broker/me", withCookie(squatter))).json();
    assert.equal(me.isBroker, true);
    assert.equal(me.submissions.length, 1);
  });

  await t.test("an account that was confirmed all along was never held up", async () => {
    // Brad's row carries a date. His own share, his firm and his room all answer.
    const shares = await (await fetch(srv.base + "/api/shares", asBrad())).json();
    assert.equal(shares.mine.length, 1);
    const org = await (await fetch(srv.base + "/api/org", asBrad())).json();
    assert.equal(org.orgs.length, 1);
    assert.equal((await (await fetch(srv.base + "/api/account/me", asBrad())).json()).emailVerified, true);
  });

  assert.deepEqual(db.unparsed, [], "the fake refused a filter server.js really sends");
});

test("Send it again mails only the account's own address, and brings a shared report's reader back to it", async (t) => {
  const { db, srv } = await bootWithDb(t);
  const s = await signUp(srv, CLIENT_EMAIL, { next: `/r/${SHARE_ID}` });
  let sent = await fake.waitForMail(db, 1);
  assert.equal(confirmLinkIn(sent[0]).split("#")[0], `https://compninja.co/r/${SHARE_ID}`,
    "signed up while standing on a shared report: the link lands back on it");

  const again = await fetch(srv.base + "/api/account/confirm/send",
    withCookie(s.cookie, { method: "POST", body: JSON.stringify({ next: "https://evil.example/r/abcdefgh" }) }));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true, sent: true });
  sent = await fake.waitForMail(db, 2);
  assert.equal(sent.length, 2);
  assert.equal(mailTo(sent[1]), CLIENT_EMAIL, "nothing in the body can name a recipient");
  assert.equal(confirmLinkIn(sent[1]).split("#")[0], "https://compninja.co/?auth=signin",
    "and a `next` that is not a shared report falls back to the app's own door");

  // Signed out, it is refused; confirmed, it has nothing to send.
  assert.equal((await fetch(srv.base + "/api/account/confirm/send", { method: "POST", headers: json, body: "{}" })).status, 401);
  const brad = await fetch(srv.base + "/api/account/confirm/send", asBrad({ method: "POST", body: "{}" }));
  assert.deepEqual(await brad.json(), { ok: true, already: true });
  assert.equal((await fake.waitForMail(db, 2)).length, 2, "and nobody else was mailed");

  // Limited per ACCOUNT: the cost of abuse is somebody else's inbox.
  let last = 200;
  for (let i = 0; i < 6 && last === 200; i++) {
    last = (await fetch(srv.base + "/api/account/confirm/send", withCookie(s.cookie, { method: "POST", body: "{}" }))).status;
  }
  assert.equal(last, 429);
});

test("a completed password reset proves the address", async (t) => {
  const { db, srv, tables } = await bootWithDb(t);
  const s = await signUp(srv, "pat@acme.com");
  assert.equal(s.body.emailVerified, false);
  await fake.waitForMail(db, 1);

  const f = await fetch(srv.base + "/api/account/forgot", { method: "POST", headers: json, body: JSON.stringify({ email: "pat@acme.com" }) });
  assert.equal(f.status, 200);
  const sent = await fake.waitForMail(db, 2);
  const reset = sent.find((m) => /Reset your CompNinja password/.test(m.subject));
  assert.ok(reset, "the reset link was mailed to the inbox");
  const resetToken = (/#reset=([A-Za-z0-9_-]+)/.exec(reset.text) || [])[1];

  const r = await fetch(srv.base + "/api/account/reset", {
    method: "POST", headers: json, body: JSON.stringify({ token: resetToken, password: "a brand new password" }),
  });
  assert.equal(r.status, 200);
  assert.ok(tables.users.find((u) => u.email === "pat@acme.com").email_verified_at,
    "whoever held the link from the inbox just chose the password");
  // The session from before the reset is gone, and the new password signs in
  // to a confirmed account.
  assert.equal((await fetch(srv.base + "/api/account/me", withCookie(s.cookie))).status, 401);
  const login = await fetch(srv.base + "/api/account/login", {
    method: "POST", headers: json, body: JSON.stringify({ email: "pat@acme.com", password: "a brand new password" }),
  });
  assert.equal((await login.json()).emailVerified, true);
});

test("with outbound mail off the check stays ON: the account is unconfirmed and says the link was not sent", async (t) => {
  const { db, srv } = await bootWithDb(t, { mail: false });
  const s = await signUp(srv, CLIENT_EMAIL);
  assert.equal(s.status, 200);
  assert.equal(s.body.emailVerified, false, "mail being off must not quietly switch the check off");
  assert.deepEqual((await (await fetch(srv.base + "/api/shares", withCookie(s.cookie))).json()).sharedWithMe, []);
  assert.equal((await fetch(`${srv.base}/api/shared?id=${SHARE_ID}`, withCookie(s.cookie))).status, 403);
  const again = await fetch(srv.base + "/api/account/confirm/send", withCookie(s.cookie, { method: "POST", body: "{}" }));
  assert.deepEqual(await again.json(), { ok: true, sent: false }, "the page can say it could not send, rather than 'sent'");
  assert.equal((await fake.waitForMail(db, 0)).length, 0);
});

test("EMAIL_VERIFICATION=off is the rollback: everybody is recognized by address again, and no mail goes out", async (t) => {
  const { db, srv } = await bootWithDb(t, { env: { EMAIL_VERIFICATION: "off" } });
  const s = await signUp(srv, CLIENT_EMAIL);
  assert.equal(s.body.emailVerified, true, "no notice");
  const body = await (await fetch(srv.base + "/api/shares", withCookie(s.cookie))).json();
  assert.equal(body.sharedWithMe.length, 1);
  assert.equal((await fetch(`${srv.base}/api/shared?id=${SHARE_ID}`, withCookie(s.cookie))).status, 200);
  assert.equal((await fake.waitForMail(db, 0)).length, 0, "and no confirm mail");
});

test("before migration 062 the check is simply not on, and nothing breaks", async (t) => {
  // A deploy that lands ahead of the migration. The stand-in answers as
  // PostgREST does for a column that does not exist: a 400 on any request
  // naming it, and rows that carry no such key.
  const { db, srv, tables } = await bootWithDb(t, {
    fakeOpts: { columnDefaults: {}, missingColumns: { users: ["email_verified_at"] } },
    tables: (() => { const s = seedTables(); delete s.users[0].email_verified_at; return s; })(),
  });
  const s = await signUp(srv, CLIENT_EMAIL);
  assert.equal(s.status, 200, "sign-up must not name a column that is not there");
  assert.equal(s.body.emailVerified, true);
  // Exactly the app as it was: recognized by address.
  assert.equal((await (await fetch(srv.base + "/api/shares", withCookie(s.cookie))).json()).sharedWithMe.length, 1);
  const acc = await fetch(srv.base + "/api/org/accept",
    withCookie(s.cookie, { method: "POST", body: JSON.stringify({ orgId: ORG_ID }) }));
  assert.equal(acc.status, 200);
  // Existing members are untouched.
  assert.equal((await (await fetch(srv.base + "/api/org", asBrad())).json()).orgs.length, 1);
  // And a password reset still completes, though there is nothing to stamp.
  await fetch(srv.base + "/api/account/forgot", { method: "POST", headers: json, body: JSON.stringify({ email: CLIENT_EMAIL }) });
  const reset = (await fake.waitForMail(db, 1)).find((m) => /Reset your/.test(m.subject));
  const resetToken = (/#reset=([A-Za-z0-9_-]+)/.exec(reset.text) || [])[1];
  const r = await fetch(srv.base + "/api/account/reset", {
    method: "POST", headers: json, body: JSON.stringify({ token: resetToken, password: "a brand new password" }),
  });
  assert.equal(r.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(tables.users.find((u) => u.email === CLIENT_EMAIL), "email_verified_at"), false);
});

test("an unconfirmed account cannot start a firm, and is told why", async (t) => {
  // On a trial, so the refusal under test is the email one and not the paywall.
  const { srv, tables } = await bootWithDb(t, { env: { PRO_TRIAL_DAYS: "14" } });
  const s = await signUp(srv, "founder@newco.com");
  const make = await fetch(srv.base + "/api/org",
    withCookie(s.cookie, { method: "POST", body: JSON.stringify({ name: "NewCo Partners", kind: "broker" }) }));
  assert.equal(make.status, 403);
  const body = await make.json();
  assert.equal(body.verify_required, true,
    "a firm keeps its members by address, creator included, so this would make a firm its own creator could not see");
  assert.equal(body.upgrade, undefined, "it is not the paywall talking");
  assert.equal(tables.orgs.length, 1, "and no firm was written");
});

test("a member row left behind by a deleted account does not let its address back into the firm", async (t) => {
  // Why the gate is on every membership read and not only on Accept: a
  // member row outlives the account that accepted it. Somebody else signing
  // up with that address has nothing to accept, the row already says joined.
  const tables = seedTables();
  const gone = tables.org_members.find((m) => m.id === "m-client");
  gone.joined_at = AGO(20);
  gone.user_id = null;            // the account that joined was deleted
  const { srv } = await bootWithDb(t, { tables });
  const s = await signUp(srv, CLIENT_EMAIL);
  const org = await (await fetch(srv.base + "/api/org", withCookie(s.cookie))).json();
  assert.deepEqual(org.orgs, [], "no proven address, no membership");
  const roster = await fetch(`${srv.base}/api/org/members?id=${ORG_ID}`, withCookie(s.cookie));
  assert.equal(roster.status, 403, "so no roster, and with it no shelf, buildings, contacts or messages");
});

test("a run with no session still finds a confirmed member's firm seat, and not an unconfirmed one's", async (t) => {
  // The trial emails read accounts straight from the table (a narrowed
  // select, no session) and ask getEntitlements about each. A firm seat is
  // found by ADDRESS, so those rows must carry the proof too, or a firm
  // member is mailed about a trial they are not on.
  const tables = seedTables();
  const now = Date.now();
  const SEATED = { id: "11111111-1111-4111-8111-111111111111", email: "seated@foothill.com", name: "Seated",
    created_at: new Date(now - DAY).toISOString(), email_verified_at: new Date(now - DAY).toISOString() };
  const UNPROVEN = { id: "22222222-2222-4222-8222-222222222222", email: "unproven@foothill.com", name: "Unproven",
    created_at: new Date(now - DAY).toISOString(), email_verified_at: null };
  for (const u of [SEATED, UNPROVEN]) {
    tables.users.push({ ...u, pro_tester: false, vault_beta: false, digest_optout: false });
    tables.org_members.push({ id: "m-" + u.id, org_id: ORG_ID, email: u.email, user_id: u.id, role: "member",
      invited_at: AGO(5), joined_at: AGO(4), removed_at: null, auto_share: null });
  }
  tables.org_subscriptions.push({ org_id: ORG_ID, plan: "firm_monthly", status: "active",
    current_period_end: YEAR_OUT, cancel_at_period_end: false });
  tables.trial_notices = [];
  const { srv } = await bootWithDb(t, { tables, env: { PRO_TRIAL_DAYS: "14", ADMIN_KEY: "trial-key" } });

  const r = await fetch(srv.base + "/api/trial/notices", {
    method: "POST", headers: { ...json, "x-admin-key": "trial-key" }, body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(r.status, 200);
  const summary = await r.json();
  const to = summary.previews.map((p) => p.to);
  assert.ok(!to.includes(SEATED.email), "a confirmed colleague on the firm's plan is not on a trial");
  assert.ok(to.includes(UNPROVEN.email),
    "an account that never proved its address is not recognized as the firm's, here as everywhere");
});

// --- The Google door takes an unconfirmed account back ----------------------
// File store, like test/google-auth-routes.test.js: this is about the account
// row, its password and its sessions, none of which need a database.

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function tokenWith(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.unsigned`;
}
function tokenStub() {
  let nextToken = "";
  const srv = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id_token: nextToken, access_token: "unused" }));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, () => resolve({
      url: `http://localhost:${srv.address().port}/token`,
      queue: (tok) => { nextToken = tok; },
      close: () => srv.close(),
    }));
  });
}
async function googleSignIn(srv, stub, email) {
  const start = await fetch(srv.base + "/auth/google", { redirect: "manual" });
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const stateCookie = (start.headers.getSetCookie() || []).find((c) => c.startsWith("cn_gstate=")).split(";")[0];
  stub.queue(tokenWith({
    iss: "https://accounts.google.com", aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600, email, email_verified: true, name: "The Real Owner",
  }));
  const back = await fetch(`${srv.base}/auth/google/callback?code=abc&state=${state}`,
    { redirect: "manual", headers: { cookie: stateCookie } });
  const set = (back.headers.getSetCookie() || []).find((c) => c.startsWith("cn_session=") && !c.startsWith("cn_session=;"));
  return { status: back.status, location: back.headers.get("location"), cookie: set ? set.split(";")[0] : "" };
}

test("the real owner arriving through Google takes an unconfirmed account back", async (t) => {
  const stub = await tokenStub();
  t.after(() => stub.close());
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_TOKEN_URL: stub.url,
  });
  t.after(() => srv.stop());

  // Somebody parks a password account on an address that is not theirs.
  const parked = await signUp(srv, "owner@gmail.com");
  assert.equal(parked.body.emailVerified, false);
  assert.equal((await fetch(srv.base + "/api/account/me", withCookie(parked.cookie))).status, 200);

  await t.test("the owner is signed in to a confirmed account", async () => {
    const g = await googleSignIn(srv, stub, "owner@gmail.com");
    assert.equal(g.status, 302);
    assert.equal(g.location, "/", "not the failure exit");
    assert.ok(g.cookie, "with a session of their own");
    const me = await (await fetch(srv.base + "/api/account/me", withCookie(g.cookie))).json();
    assert.equal(me.email, "owner@gmail.com", "the same account, by 018's rule");
    assert.equal(me.emailVerified, true);
  });

  await t.test("the parked session is dead and the parked password no longer signs in", async () => {
    assert.equal((await fetch(srv.base + "/api/account/me", withCookie(parked.cookie))).status, 401,
      "a 90-day session must not outlive the owner's arrival");
    const login = await fetch(srv.base + "/api/account/login", {
      method: "POST", headers: json, body: JSON.stringify({ email: "owner@gmail.com", password: "correct horse battery" }),
    });
    assert.equal(login.status, 401, "nor the password the first person chose");
  });

  await t.test("it happens once: a later Google sign-in leaves the owner's other sessions alone", async () => {
    const first = await googleSignIn(srv, stub, "owner@gmail.com");
    const second = await googleSignIn(srv, stub, "owner@gmail.com");
    assert.equal((await fetch(srv.base + "/api/account/me", withCookie(first.cookie))).status, 200,
      "a confirmed account is its owner's; signing in on a second device signs nobody out");
    assert.equal((await fetch(srv.base + "/api/account/me", withCookie(second.cookie))).status, 200);
  });

  await t.test("an account MADE through Google is born confirmed", async () => {
    const g = await googleSignIn(srv, stub, "fresh@gmail.com");
    const me = await (await fetch(srv.base + "/api/account/me", withCookie(g.cookie))).json();
    assert.equal(me.emailVerified, true);
  });
});
