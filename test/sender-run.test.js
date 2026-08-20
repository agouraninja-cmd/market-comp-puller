// Changing the From address, actually done.
//
// sender-email.test.js proves the rules and sender-routes.test.js proves the
// refusals. Neither can reach the part that matters most — the round trip —
// because the write deliberately has no file fallback, so with no database it
// stops at a 503. Everything past that point was argued in comments and had
// never executed: that a saved address is really stored, that the next send
// really uses it, that clearing it really reverts to EMAIL_FROM, and that a
// second save updates the row instead of leaving a rival one behind.
//
// The fake understands only the query shapes server.js sends and 400s on
// anything else (see its header) rather than matching everything.

const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const KEY = "sender-key";
const ENV_FROM = "CompNinja <reports@compninja.co>";

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables: tables || {} });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    ADMIN_KEY: KEY,
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key",
    RESEND_API_URL: db.resendUrl,
    EMAIL_FROM: ENV_FROM,
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

const admin = (extra) => ({ "x-admin-key": KEY, "content-type": "application/json", ...(extra || {}) });

test("a saved address is stored, served back, and used by the next send", async (t) => {
  const { db, srv, stop } = await bootWithDb({ app_settings: [] });
  t.after(stop);

  const put = await fetch(srv.base + "/api/admin/sender", {
    method: "PUT", headers: admin(), body: JSON.stringify({ from: "Owen at CompNinja <owen@compninja.co>" }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.equal(saved.effective, "Owen at CompNinja <owen@compninja.co>");
  assert.equal(saved.source, "override", "the saved value must be the one in use");

  // In the table, normalized, under the one key.
  assert.equal(db.tables.app_settings.length, 1);
  assert.equal(db.tables.app_settings[0].key, "email_from");
  assert.equal(db.tables.app_settings[0].value, "Owen at CompNinja <owen@compninja.co>");

  // And read back by a fresh request rather than only from the writer's memo.
  const got = await (await fetch(srv.base + "/api/admin/sender", { headers: admin() })).json();
  assert.equal(got.effective, "Owen at CompNinja <owen@compninja.co>");
  assert.equal(got.envFrom, ENV_FROM, "the environment variable is still reported, as the fallback");

  // THE POINT OF THE WHOLE FEATURE: the mail actually goes out as it. The
  // test send is the one path that can be driven from here without a
  // session, and it uses the same senderFrom() every other send does.
  const test1 = await (await fetch(srv.base + "/api/admin/sender/test", {
    method: "POST", headers: admin(), body: "{}",
  })).json();
  assert.equal(test1.ok, true, "the provider stand-in should have accepted it");
  assert.equal(db.sent.length, 1);
  assert.equal(db.sent[0].from, "Owen at CompNinja <owen@compninja.co>",
    "mail must leave as the saved address, not EMAIL_FROM");
  // Replies still route to the owner, as they do for every outbound send.
  assert.equal(db.sent[0].reply_to, "agouraninja@gmail.com");
});

test("a second save updates the row rather than leaving a rival one", async (t) => {
  // The failure this prevents is a stale row winning a later read, which is
  // the same reason subscriptions is keyed on user_id: two rows for one fact
  // is a coin toss about which address customers see.
  const { db, srv, stop } = await bootWithDb({ app_settings: [] });
  t.after(stop);

  for (const from of ["a@compninja.co", "b@compninja.co", "c@compninja.co"]) {
    const r = await fetch(srv.base + "/api/admin/sender", {
      method: "PUT", headers: admin(), body: JSON.stringify({ from }),
    });
    assert.equal(r.status, 200);
  }
  assert.equal(db.tables.app_settings.length, 1, "one key, one row");
  assert.equal(db.tables.app_settings[0].value, "c@compninja.co");
});

test("clearing it reverts to EMAIL_FROM, and mail keeps flowing", async (t) => {
  const { db, srv, stop } = await bootWithDb({ app_settings: [] });
  t.after(stop);

  await fetch(srv.base + "/api/admin/sender", {
    method: "PUT", headers: admin(), body: JSON.stringify({ from: "owen@compninja.co" }),
  });
  const cleared = await (await fetch(srv.base + "/api/admin/sender", { method: "DELETE", headers: admin() })).json();
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.effective, ENV_FROM);
  assert.equal(cleared.source, "env");
  assert.equal(db.tables.app_settings.length, 0);

  await fetch(srv.base + "/api/admin/sender/test", { method: "POST", headers: admin(), body: "{}" });
  assert.equal(db.sent[db.sent.length - 1].from, ENV_FROM);
});

test("a stored address that does not parse is ignored, and mail falls back", async (t) => {
  // Rule 1 of sender-email.js, end to end. A bad row must cost the override
  // and never the mail — password resets ride this path — and the card must
  // SAY it is being ignored, which is otherwise indistinguishable from never
  // having set one.
  const { db, srv, stop } = await bootWithDb({
    app_settings: [{ key: "email_from", value: "not an address", updated_at: "2026-08-20T00:00:00Z", updated_by: "" }],
  });
  t.after(stop);

  const got = await (await fetch(srv.base + "/api/admin/sender", { headers: admin() })).json();
  assert.equal(got.source, "invalid");
  assert.equal(got.effective, ENV_FROM);
  assert.equal(got.override, "", "an unusable value is never offered back as the current one");

  await fetch(srv.base + "/api/admin/sender/test", { method: "POST", headers: admin(), body: "{}" });
  assert.equal(db.sent[0].from, ENV_FROM, "mail must not stop, and must not send as junk");
});

test("an override works with EMAIL_FROM unset — it can switch outbound mail ON", async (t) => {
  // The case a deployment is actually in today: no verified domain, so
  // EMAIL_FROM was never set and every outbound send no-ops. Saving an
  // address here is enough, with no redeploy.
  const { db, srv, stop } = await bootWithDb({ app_settings: [] }, { EMAIL_FROM: "" });
  t.after(stop);

  const before = await (await fetch(srv.base + "/api/admin/sender", { headers: admin() })).json();
  assert.equal(before.source, "none");
  assert.equal(before.live, false, "nothing to send as");

  const after = await (await fetch(srv.base + "/api/admin/sender", {
    method: "PUT", headers: admin(), body: JSON.stringify({ from: "CompNinja <hello@compninja.co>" }),
  })).json();
  assert.equal(after.live, true, "an address plus a key is live mail");

  const sent = await (await fetch(srv.base + "/api/admin/sender/test", {
    method: "POST", headers: admin(), body: "{}",
  })).json();
  assert.equal(sent.ok, true);
  assert.equal(db.sent[0].from, "CompNinja <hello@compninja.co>");
});

test("the provider's refusal is reported, not swallowed", async (t) => {
  // The whole reason the test send exists: every other send here is
  // fire-and-forget, so an unverified domain fails into a log nobody tails.
  const db = await fake.start({ tables: { app_settings: [] }, resendStatus: 403 });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", ADMIN_KEY: KEY,
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", RESEND_API_URL: db.resendUrl,
    EMAIL_FROM: ENV_FROM, SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  const r = await fetch(srv.base + "/api/admin/sender/test", { method: "POST", headers: admin(), body: "{}" });
  // 200: the provider's verdict is the ANSWER to this request, not a failure
  // of it, and the card branches on the body.
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.equal(j.status, 403);
  assert.match(j.error, /nope/, "the provider's own words must survive to the page");
});

test("saving is refused before it is stored, and the bad value never reaches the table", async (t) => {
  const { db, srv, stop } = await bootWithDb({ app_settings: [] });
  t.after(stop);
  for (const bad of ["", "nope", "a@b.com, c@d.com"]) {
    const r = await fetch(srv.base + "/api/admin/sender", {
      method: "PUT", headers: admin(), body: JSON.stringify({ from: bad }),
    });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(db.tables.app_settings.length, 0, "a refused save must write nothing");
});

test("the fake was never asked a query shape it could not parse", async (t) => {
  // The suite's own guard: a filter this fake does not understand answers 400
  // rather than matching everything, and a silently-400ing read here would
  // make every assertion above pass for the wrong reason.
  const { db, srv, stop } = await bootWithDb({ app_settings: [] });
  t.after(stop);
  await fetch(srv.base + "/api/admin/sender", { headers: admin() });
  await fetch(srv.base + "/api/admin/sender", {
    method: "PUT", headers: admin(), body: JSON.stringify({ from: "owen@compninja.co" }),
  });
  await fetch(srv.base + "/api/admin/sender", { method: "DELETE", headers: admin() });
  assert.deepEqual(db.unparsed, []);
});
