const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// The tester feedback badge, actually run.
//
// This is the beta channel: the one route whose entire purpose is that a
// message leaves the building and reaches three people. Everything worth
// getting wrong here is invisible from inside the process -- who was mailed,
// whether the reply address points at the tester, and whether a deployment
// with no outbound mail configured says so or silently swallows a bug report.
// So it runs a real server against a stub Resend (RESEND_API_URL, the
// watchlist digest's precedent) and asserts on what was actually posted.
//
// No database: accounts fall back to account-store.json, which is what makes
// a real signup, a real passkey redemption and therefore a real tester
// account reachable here with nothing but the boot helper's temp dir.

const PASSKEY = "beta-please";
const JACOB = "jacob@example.test";
const CHUCK = "chuck@example.test";
const OWEN = "owen@example.test";
const TO = [JACOB, CHUCK, OWEN].join(",");

// PRO_ENABLED is load-bearing, not decoration: the tester grant rides on it
// exactly as the admin one does ("it cannot switch a dark deployment on"), so
// with the tier dark `ent.tester` is false and this route answers 403 to a
// real tester. That is deliberate upstream behaviour, and it is asserted
// below rather than merely worked around here.
async function bootFeedback(extra) {
  const db = await fake.start({});           // wanted only for its Resend stub
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    TESTER_PASSKEY: PASSKEY,
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_URL: db.resendUrl,
    TESTER_FEEDBACK_EMAIL: TO,
    ...extra,
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

async function signUp(srv, email) {
  const r = await fetch(srv.base + "/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });
  assert.equal(r.status, 200, "signup should succeed against the file store");
  const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("cn_session="), "expected a session cookie");
  return cookie;
}

async function makeTester(srv, email) {
  const cookie = await signUp(srv, email);
  const redeem = await fetch(srv.base + "/api/redeem-passkey", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ passkey: PASSKEY }),
  });
  assert.equal(redeem.status, 200, "the passkey should grant the tester flag");
  return cookie;
}

const report = (srv, cookie, body) => fetch(srv.base + "/api/tester-feedback", {
  method: "POST",
  headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
  body: JSON.stringify(body),
});

let seq = 0;
const uniqueEmail = (tag) => `${tag}-${Date.now()}-${seq++}@example.test`;

test("tester feedback", async (t) => {
  await t.test("the refusal ladder: anonymous, then a signed-in non-tester", async (t) => {
    const h = await bootFeedback();
    t.after(() => h.stop());

    const anon = await report(h.srv, null, { kind: "problem", message: "the map is blank" });
    assert.equal(anon.status, 401, "the grant lives on an account, so there is nothing to check signed out");

    // A perfectly ordinary signed-in member. Not a tester, so not this channel.
    const cookie = await signUp(h.srv, uniqueEmail("member"));
    const member = await report(h.srv, cookie, { kind: "problem", message: "the map is blank" });
    assert.equal(member.status, 403, "a feedback button everybody can see is a support inbox");

    assert.equal(h.db.sent.length, 0, "no refusal may reach the mail provider");
  });

  await t.test("a tester reaches all three inboxes, and a reply goes back to them", async (t) => {
    const h = await bootFeedback();
    t.after(() => h.stop());

    const email = uniqueEmail("tester");
    const cookie = await makeTester(h.srv, email);

    const r = await report(h.srv, cookie, {
      kind: "problem",
      message: "The comp table sorts $/SF as text, so 9 lands above 80.",
      context: { url: "https://compninja.co/desk", viewport: "1440x900", ua: "TestBrowser/1.0" },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.delivered, 3, "all three recipients, not one message with three names in it");

    // One message PER recipient: sendEmail wraps `to` in an array of its own,
    // so an array argument would post a nested one and reach nobody.
    assert.equal(h.db.sent.length, 3);
    assert.deepEqual(
      h.db.sent.map((m) => m.to[0]).sort(),
      [CHUCK, JACOB, OWEN].sort(),
      "every configured recipient gets their own copy"
    );
    for (const m of h.db.sent) {
      assert.equal(m.to.length, 1, "a nested `to` array would silently reach nobody");
      assert.equal(m.reply_to, email, "replying to the mail must answer the tester");
      assert.match(m.text, /sorts \$\/SF as text/, "the tester's own words must travel");
      assert.match(m.text, /compninja\.co\/desk/, "where they were");
      assert.match(m.text, /1440x900/, "how big their window was");
      assert.match(m.subject, new RegExp(email.replace(/[.@+]/g, "\\$&")), "the subject names who it is from");
    }
  });

  await t.test("what it refuses to send", async (t2) => {
    const h = await bootFeedback();
    t2.after(() => h.stop());
    const cookie = await makeTester(h.srv, uniqueEmail("picky"));

    const empty = await report(h.srv, cookie, { kind: "problem", message: "   " });
    assert.equal(empty.status, 400, "an empty report helps nobody");

    // An unknown kind is a 400 rather than a quiet relabel to "other": the
    // browser and the server list live in one repo, so a value that is not on
    // the list is a bug in one of them and should say so.
    const odd = await report(h.srv, cookie, { kind: "compliment", message: "nice" });
    assert.equal(odd.status, 400);

    const huge = await report(h.srv, cookie, { kind: "idea", message: "x".repeat(4001) });
    assert.equal(huge.status, 400, "longer than we can put in an email");

    assert.equal(h.db.sent.length, 0, "nothing refused may reach the mail provider");
  });

  await t.test("with outbound mail unconfigured it refuses instead of pretending", async (t) => {
    // sendOutboundEmail is a SILENT no-op without EMAIL_FROM, which is exactly
    // the failure this route cannot afford: the tester would be thanked and
    // nobody would ever read the report. The digest refuses to run blind for
    // the same reason; this one refuses to claim a send that did not happen.
    const h = await bootFeedback({ EMAIL_FROM: "" });
    t.after(() => h.stop());
    const cookie = await makeTester(h.srv, uniqueEmail("nomail"));

    const r = await report(h.srv, cookie, { kind: "problem", message: "still worth saying" });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.match(body.error, /did not go out/i, "say plainly that it did not send");
    assert.match(body.error, /@/, "and name an address the tester can use instead");
    assert.equal(h.db.sent.length, 0);
  });

  await t.test("a dark deployment has no tester grant, so no channel either", async (t) => {
    // PRO_ENABLED off is the pre-Pro app for everybody, staff included --
    // entitlements.js's rule, restated here because the badge and this route
    // both hang off `tester` and would otherwise look broken rather than off.
    const h = await bootFeedback({ PRO_ENABLED: "" });
    t.after(() => h.stop());
    const cookie = await makeTester(h.srv, uniqueEmail("dark"));

    const cfg = await (await fetch(h.srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.tester, false, "the grant is on the row, but the tier is dark");

    const r = await report(h.srv, cookie, { kind: "problem", message: "anyone home" });
    assert.equal(r.status, 403);
    assert.equal(h.db.sent.length, 0);
  });
});

let _session = null;
async function sessionFor(srv) {
  if (!_session) _session = await makeTester(srv, uniqueEmail("surface"));
  return _session;
}

// --- Where the badge actually renders ---------------------------------------
//
// The markup, CSS and handlers live in ONE constant that index.html receives
// through a marker and marketShell emits for the work surfaces. That is only
// worth anything if the bytes really arrive on each page, and the marker in
// particular fails SILENTLY: an unreplaced comment renders as nothing at all,
// so the app would simply have no badge and no error anywhere.

test("the badge block reaches every surface that asked for it", async (t) => {
  const h = await bootFeedback();
  t.after(() => h.stop());

  const get = async (path) => {
    const r = await fetch(h.srv.base + path, { headers: { cookie: await sessionFor(h.srv) } });
    return { status: r.status, html: await r.text() };
  };

  // The app. The marker must be REPLACED, never served as a comment.
  const app = await get("/");
  assert.equal(app.status, 200);
  assert.ok(!app.html.includes("<!--TESTER_BADGE-->"),
    "an unreplaced marker is invisible: no badge, no error, nothing to notice");
  assert.ok(app.html.includes('id="testerBadge"'), "the app must carry the badge");
  assert.ok(app.html.includes(".tninja{"), "and its CSS");
  assert.ok(app.html.includes("/api/tester-feedback"), "and its handler");

  // The two work surfaces, which emit the SAME block through marketShell.
  for (const path of ["/vault", "/bulk"]) {
    const page = await get(path);
    assert.equal(page.status, 200, path + " should render for a signed-in visitor");
    assert.ok(page.html.includes('id="testerBadge"'), path + " must carry the badge");
    assert.ok(page.html.includes('id="testerModal"'), path + " must carry the modal");
    assert.ok(page.html.includes(".tninja{"),
      path + " must carry the badge's own CSS — it never loads tailwind.css");
    assert.ok(page.html.includes("/api/tester-feedback"), path + " must carry the handler");
    // The reveal on these pages rides the nav script's existing config read.
    assert.ok(page.html.includes('$("testerBadge")'),
      path + " must reveal the badge from /api/config, not leave it hidden forever");
  }

  // Byte-for-byte the same block on both work surfaces: the whole point of
  // single-sourcing is that /vault and /bulk cannot drift apart.
  const vault = (await get("/vault")).html;
  const bulk = (await get("/bulk")).html;
  const grab = (html) => {
    const i = html.indexOf('<button id="testerBadge"');
    const j = html.indexOf("</div>", html.indexOf('id="testerModal"'));
    return html.slice(i, j);
  };
  assert.equal(grab(vault), grab(bulk), "one source, so these must be identical bytes");
});

test("a marketing page does not carry a work-surface affordance", async (t) => {
  const h = await bootFeedback();
  t.after(() => h.stop());
  // marketShell emits it only where a page opts in. /markets is a browse
  // surface a stranger reads; the badge ships hidden anyway, so this is about
  // which pages carry the markup at all, not about who can see it.
  const r = await fetch(h.srv.base + "/markets");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(!html.includes('id="testerBadge"'),
    "/markets did not opt in, so it must not carry the block");
});
