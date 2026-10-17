const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// The feedback badge (the ninja), actually run.
//
// Where members leave recommendations, ideas and problems: the one route
// whose entire purpose is that a message leaves the building and reaches
// three people. It was the beta channel, open only to accounts on the tester
// code, until 2026-10-17, when the code was retired for a month-long trial
// and the badge went to every signed-in member. Everything worth getting
// wrong here is invisible from inside the process -- who was mailed, whether
// the reply address points at the member, and whether a deployment with no
// outbound mail configured says so or silently swallows a report. So it runs
// a real server against a stub Resend (RESEND_API_URL, the watchlist digest's
// precedent) and asserts on what was actually posted.
//
// No database: accounts fall back to account-store.json, which is what makes
// a real signup reachable here with nothing but the boot helper's temp dir.

const JACOB = "jacob@example.test";
const CHUCK = "chuck@example.test";
const OWEN = "owen@example.test";
const TO = [JACOB, CHUCK, OWEN].join(",");

// PRO_ENABLED is on because that is production's shape; the route no longer
// reads any plan, and the dark-deployment case below proves it.
async function bootFeedback(extra) {
  const db = await fake.start({});           // wanted only for its Resend stub
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
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

const report = (srv, cookie, body) => fetch(srv.base + "/api/tester-feedback", {
  method: "POST",
  headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
  body: JSON.stringify(body),
});

let seq = 0;
const uniqueEmail = (tag) => `${tag}-${Date.now()}-${seq++}@example.test`;

test("feedback", async (t) => {
  await t.test("signed out is refused; any signed-in member gets through", async (t) => {
    const h = await bootFeedback();
    t.after(() => h.stop());

    const anon = await report(h.srv, null, { kind: "idea", message: "the map is blank" });
    assert.equal(anon.status, 401, "the reply goes to an account's address, so there must be one");
    assert.equal(h.db.sent.length, 0, "no refusal may reach the mail provider");

    // A perfectly ordinary signed-in member, on no code and no paid plan
    // (PRO_TRIAL_DAYS is 0 in the test servers, so not on a trial either).
    // Until 2026-10-17 this was a 403; the badge is every member's now.
    const cookie = await signUp(h.srv, uniqueEmail("member"));
    const cfg = await (await fetch(h.srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.isPro, false, "the point of this case is a member on the free plan");
    const member = await report(h.srv, cookie, { kind: "idea", message: "Could the map remember my zoom?" });
    assert.equal(member.status, 200, "every signed-in member can leave a recommendation");
  });

  await t.test("a member reaches all three inboxes, and a reply goes back to them", async (t) => {
    const h = await bootFeedback();
    t.after(() => h.stop());

    const email = uniqueEmail("member");
    const cookie = await signUp(h.srv, email);

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
      assert.equal(m.reply_to, email, "replying to the mail must answer the member");
      assert.match(m.text, /sorts \$\/SF as text/, "the member's own words must travel");
      assert.match(m.text, /compninja\.co\/desk/, "where they were");
      assert.match(m.text, /1440x900/, "how big their window was");
      assert.match(m.subject, new RegExp(email.replace(/[.@+]/g, "\\$&")), "the subject names who it is from");
    }
  });

  await t.test("what it refuses to send", async (t2) => {
    const h = await bootFeedback();
    t2.after(() => h.stop());
    const cookie = await signUp(h.srv, uniqueEmail("picky"));

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
    // the failure this route cannot afford: the member would be thanked and
    // nobody would ever read the report. The digest refuses to run blind for
    // the same reason; this one refuses to claim a send that did not happen.
    const h = await bootFeedback({ EMAIL_FROM: "" });
    t.after(() => h.stop());
    const cookie = await signUp(h.srv, uniqueEmail("nomail"));

    const r = await report(h.srv, cookie, { kind: "problem", message: "still worth saying" });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.match(body.error, /did not go out/i, "say plainly that it did not send");
    assert.match(body.error, /@/, "and name an address the member can use instead");
    assert.equal(h.db.sent.length, 0);
  });

  await t.test("a dark deployment still hears from its members", async (t) => {
    // Until 2026-10-17 the route hung off the tester grant, which a dark
    // deployment (PRO_ENABLED off) never reports, so it answered 403 there.
    // It reads no plan now: whether the paid tier is switched on has nothing
    // to do with whether a member can send an idea.
    const h = await bootFeedback({ PRO_ENABLED: "" });
    t.after(() => h.stop());
    const cookie = await signUp(h.srv, uniqueEmail("dark"));

    const r = await report(h.srv, cookie, { kind: "problem", message: "anyone home" });
    assert.equal(r.status, 200);
    await fake.waitForMail(h.db, 3);
    assert.equal(h.db.sent.length, 3);
  });

  await t.test("the tester code is retired, and a leftover one opens nothing", async (t) => {
    // The route that redeemed it 404s when only TESTER_PASSKEY is set: the
    // vault code is the only one it compares now.
    const h = await bootFeedback({ TESTER_PASSKEY: "beta-please" });
    t.after(() => h.stop());
    const cookie = await signUp(h.srv, uniqueEmail("late"));
    const r = await fetch(h.srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passkey: "beta-please" }),
    });
    assert.equal(r.status, 404, "with no vault code set, the redeem route does not exist");
    const cfg = await (await fetch(h.srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.tester, false, "nothing was granted");
    assert.equal(cfg.pro.isPro, false);
    assert.ok(!("testerPasskey" in cfg.pro), "the door's flag went with the door");
  });
});

const _sessions = new Map();
async function sessionFor(srv) {
  if (!_sessions.has(srv.base)) {
    _sessions.set(srv.base, await signUp(srv, uniqueEmail("surface")));
  }
  return _sessions.get(srv.base);
}

// --- Where the badge actually renders ---------------------------------------
//
// The markup, CSS and handlers live in ONE constant that index.html receives
// through a marker and marketShell emits for every page a member reads. That is only
// worth anything if the bytes really arrive on each page, and the marker in
// particular fails SILENTLY: an unreplaced comment renders as nothing at all,
// so the app would simply have no badge and no error anywhere.

test("the badge block reaches every page a member reads", async (t) => {
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
  assert.ok(app.html.includes('<span class="tninja-l">Feedback</span>'),
    "and the word under the ninja, so the rail says what it is for");

  // The server-rendered pages, which emit the SAME block through marketShell.
  // /markets joined on 2026-10-17: the rail's Feedback row has to be on every
  // page that has the rail, or it is not a place, just a thing that comes and
  // goes.
  for (const path of ["/comps", "/bulk", "/markets", "/permits"]) {
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
  const vault = (await get("/comps")).html;
  const bulk = (await get("/bulk")).html;
  const grab = (html) => {
    const i = html.indexOf('<button id="testerBadge"');
    const j = html.indexOf("</div>", html.indexOf('id="testerModal"'));
    return html.slice(i, j);
  };
  assert.equal(grab(vault), grab(bulk), "one source, so these must be identical bytes");
});

test("a stranger's copy of a page carries no badge", async (t) => {
  const h = await bootFeedback();
  t.after(() => h.stop());
  // marketShell emits it for a member (cookie presence, like the rail) and on
  // the pages that opt in. /markets is a browse surface a stranger reads, and
  // signed out the route would 401 them, so their copy carries no block.
  const r = await fetch(h.srv.base + "/markets");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(!html.includes('id="testerBadge"'),
    "a signed-out /markets must not carry the block");
});

test("in the rail it is a row over the account circle, and floats everywhere else", async (t) => {
  const h = await bootFeedback();
  t.after(() => h.stop());
  const html = await (await fetch(h.srv.base + "/comps", {
    headers: { cookie: await sessionFor(h.srv) },
  })).text();
  const css = html.match(/\.tninja\{[\s\S]*?\.tfm\{/);
  assert.ok(css, "the badge's CSS is gone");
  // The default is the floating round ninja, bottom-right: a phone, the bar
  // shell and a short window all get it.
  assert.match(css[0], /\.tninja\{position:fixed;bottom:16px;right:16px;/);
  // The rail placement is guarded on the rail existing (900px and the class)
  // and on the window being tall enough to hold it under Permits.
  const rail = css[0].match(/@media \(min-width:900px\) and \(min-height:620px\)\{([\s\S]*?)\n    \}/);
  assert.ok(rail, "the rail placement must sit behind the rail's own width guard and a height guard");
  assert.match(rail[1], /html\.nav-rail \.tninja\{left:8px;right:auto;bottom:65px;width:68px;/,
    "inset like the rail's rows (84px rail, 8px each side) and standing over the 57px account cluster");
  assert.match(rail[1], /html\.nav-rail \.tninja-l\{display:block\}/, "the word shows only in the rail");
  assert.match(rail[1], /html\.nav-rail \.tninja\.hidden\{display:none\}/,
    "the rail's display:flex must not out-rank hidden for a signed-out visitor");
  assert.match(css[0], /\.tninja-l\{display:none\}/, "and is hidden on the floating ninja");
});

test("the form opens on a recommendation, not on a fault", async (t) => {
  // Owner's call: opening on "something is broken" primes a member to go
  // looking for faults, and since 2026-10-17 the badge exists for
  // recommendations above all. The default is carried by ORDER -- a select
  // with nothing marked selected takes its first option -- so this asserts
  // the order rather than a selected attribute, which is what actually
  // decides what a member sends without touching the control.
  const h = await bootFeedback();
  t.after(() => h.stop());

  const html = await (await fetch(h.srv.base + "/comps", {
    headers: { cookie: await sessionFor(h.srv) },
  })).text();

  const select = html.match(/<select id="testerKind"[\s\S]*?<\/select>/);
  assert.ok(select, "the kind selector is gone");
  const values = [...select[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ["idea", "problem", "other"],
    "idea must lead: the first option is what a member sends without touching the control");
  assert.match(select[0], /<option value="idea">A recommendation or idea<\/option>/,
    "and it is worded as the recommendation the badge is for");
  assert.ok(!/selected/.test(select[0]),
    "the default rides on order alone; a stray selected= would be a second rule to keep in step");

  // And the value that default sends must still be one the route accepts, or
  // the commonest submission of all would 400.
  const r = await report(h.srv, await sessionFor(h.srv), {
    kind: values[0],
    message: "Could the comp table remember my sort?",
  });
  assert.equal(r.status, 200, "the default kind must be accepted by the route");
});
