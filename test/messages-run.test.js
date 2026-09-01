// Firm messaging, actually running — the whole loop against a stand-in
// PostgREST, from opening a direct message to a colleague saving the comp it
// carried into their own vault.
//
// Why this exists: messaging deliberately has NO file fallback (it is an
// access-control surface, 013's and 018's stance), so without a database every
// route answers 503 and messages-routes.test.js can only prove the refusals.
// Everything that actually matters here — that a comp sent between colleagues
// is KEPT, that deleting the sender's vault row does not rewrite what the
// recipient reads, that a stranger's thread id buys nothing — is arguable in a
// comment and only true if it executes. Same fake as org-run.test.js.
//
// Spec: docs/superpowers/specs/2026-09-01-firm-messaging-design.md

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// Three colleagues at one firm, and one broker at another shop.
//
// Brad and Mike pay, so they have vaults. DANA IS ON A FREE SEAT, which is the
// case the entitlement split exists for: she can read and write messages and
// cannot attach or save comps.
//
// Dana is a separate person rather than Mike-before-he-subscribes on purpose.
// entitlementsFor caches its subscription answer for 60 seconds (deliberately
// — a failed read must not flicker a paying member to free), so upgrading
// somebody mid-run reads the stale answer and the test proves nothing about
// the rule it names. Two people, two entitlements, no clock to fight.
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const MIKE = { id: "u-mike", email: "mike@colliers.com", name: "Mike" };
const DANA = { id: "u-dana", email: "dana@colliers.com", name: "Dana" };
const RIVAL = { id: "u-rival", email: "rival@other.com", name: "Rival" };

const OURS = "org-colliers";
const THEIRS = "org-other";

const BRADS_COMP = {
  id: "comp-1",
  user_id: BRAD.id,
  address: "5142 Kanan Rd, Agoura Hills, CA",
  address_key: "5142 kanan rd agoura hills ca",
  market: "Agoura Hills, CA",
  property_type: "Retail",
  transaction: "sale",
  deal_date: "2026-03-04",
  price: 2500000,
  size_sqft: 8000,
  price_per_sqft: 312.5,
  dedupe_key: "brad|kanan|2026-03-04|2500000",
  notes: "Off market, seller was motivated",
};

function seedTables() {
  return {
    users: [BRAD, MIKE, DANA, RIVAL].map((u) => ({
      ...u, pro_tester: false, vault_beta: false, digest_optout: false,
    })),
    sessions: [BRAD, MIKE, DANA, RIVAL].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    // Brad and Mike pay, so canUseVault is true for them and false for Dana.
    // Rival pays too, at his own shop.
    subscriptions: [BRAD, MIKE, RIVAL].map((u) => ({
      user_id: u.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    })),
    orgs: [
      { id: OURS, name: "Colliers Boise", kind: "broker", share_default: "none", seats: 10 },
      { id: THEIRS, name: "Other Shop", kind: "broker", share_default: "none", seats: 10 },
    ],
    org_members: [
      { id: "m-brad", org_id: OURS, email: BRAD.email, user_id: BRAD.id, role: "owner",
        invited_at: "2026-08-01T00:00:00.000Z", joined_at: "2026-08-01T00:00:00.000Z", removed_at: null },
      { id: "m-mike", org_id: OURS, email: MIKE.email, user_id: MIKE.id, role: "member",
        invited_at: "2026-08-02T00:00:00.000Z", joined_at: "2026-08-02T00:00:00.000Z", removed_at: null },
      { id: "m-dana", org_id: OURS, email: DANA.email, user_id: DANA.id, role: "member",
        invited_at: "2026-08-03T00:00:00.000Z", joined_at: "2026-08-03T00:00:00.000Z", removed_at: null },
      { id: "m-rival", org_id: THEIRS, email: RIVAL.email, user_id: RIVAL.id, role: "owner",
        invited_at: "2026-08-01T00:00:00.000Z", joined_at: "2026-08-01T00:00:00.000Z", removed_at: null },
    ],
    broker_comps: [{ ...BRADS_COMP }],
    broker_properties: [],
    msg_threads: [], msg_thread_members: [], msg_messages: [],
    msg_comps: [], msg_comp_saves: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

async function bootWithDb(tables) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  return { db, srv, tables, stop: async () => { srv.stop(); await db.stop(); } };
}

const as = (user, init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_session=tok-${user.id}`,
    ...(init.headers || {}),
  },
});

test("firm messaging, end to end", async (t) => {
  const ctx = await bootWithDb(seedTables());
  t.after(() => ctx.stop());
  const B = ctx.srv.base;
  const get = async (user, url) => {
    const r = await fetch(B + url, as(user));
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  const post = async (user, url, body) => {
    const r = await fetch(B + url, as(user, { method: "POST", body: JSON.stringify(body || {}) }));
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };

  let threadId = "";

  await t.test("the list opens with the firm's people and no conversations", async () => {
    const o = await get(BRAD, "/api/messages");
    assert.equal(o.s, 200);
    assert.equal(o.j.firm.name, "Colliers Boise");
    assert.deepEqual(o.j.threads, []);
    // The WHOLE firm, the caller included: this list is where every name on
    // the page comes from, so dropping the reader would leave their own
    // messages unattributable. Excluding yourself from the people you can
    // MESSAGE is the picker's job, in the browser, where the answer is known.
    assert.deepEqual(o.j.people.map((p) => p.email).sort(),
      [BRAD.email, DANA.email, MIKE.email].sort());
    assert.equal(o.j.canAttachComps, true, "Brad pays, so he has a vault to send from");
  });

  await t.test("a colleague on a free seat gets messaging and not the vault", async () => {
    // canUseOrg's rule one surface over: reading and taking part needs no
    // entitlement at all. A firm whose junior broker cannot be messaged does
    // not solve the problem this exists for.
    const o = await get(DANA, "/api/messages");
    assert.equal(o.s, 200);
    assert.equal(o.j.canAttachComps, false);
  });

  await t.test("somebody in no firm is refused by name, not by 404", async () => {
    const tables = seedTables();
    tables.org_members = tables.org_members.filter((m) => m.email !== BRAD.email);
    const solo = await bootWithDb(tables);
    try {
      const r = await fetch(solo.srv.base + "/api/messages", as(BRAD));
      assert.equal(r.status, 403);
      assert.equal((await r.json()).code, "no_firm");
    } finally { await solo.stop(); }
  });

  await t.test("Brad opens a direct message with Mike", async () => {
    const o = await post(BRAD, "/api/messages/thread", { kind: "dm", memberIds: [MIKE.id] });
    assert.equal(o.s, 201);
    assert.equal(o.j.thread.kind, "dm");
    threadId = o.j.thread.id;
    assert.ok(threadId, "a thread id came back");
    assert.equal(ctx.tables.msg_thread_members.filter((m) => m.thread_id === threadId).length, 2);
  });

  await t.test("opening it again returns the SAME thread, never a second one", async () => {
    // The whole reason dmKey is sorted and stored under a unique index. Asked
    // from the OTHER side, because the failure this prevents is each colleague
    // typing into a room the other cannot see.
    const o = await post(MIKE, "/api/messages/thread", { kind: "dm", memberIds: [BRAD.id] });
    assert.equal(o.s, 201);
    assert.equal(o.j.thread.id, threadId);
    assert.equal(ctx.tables.msg_threads.length, 1, "a second DM row was created");
  });

  await t.test("a rival at another shop cannot open a thread with our people", async () => {
    const o = await post(RIVAL, "/api/messages/thread", { kind: "dm", memberIds: [BRAD.id] });
    assert.equal(o.s, 400, "the ids came from the browser and prove nothing");
    assert.equal(ctx.tables.msg_threads.length, 1);
  });

  await t.test("a rival cannot read our thread even holding its id", async () => {
    // The second wall. He has a perfectly good session and a real thread id;
    // what he does not have is our firm.
    const o = await get(RIVAL, "/api/messages/thread?id=" + encodeURIComponent(threadId));
    assert.equal(o.s, 404, "which conversations exist is not an answer he has earned");
  });

  await t.test("Brad sends a message carrying a comp out of his vault", async () => {
    const o = await post(BRAD, "/api/messages/send", {
      threadId, body: "What do you make of this one?", compIds: [BRADS_COMP.id],
    });
    assert.equal(o.s, 201);
    assert.equal(o.j.message.comps, 1);
    assert.equal(ctx.tables.msg_comps.length, 1);
    const row = ctx.tables.msg_comps[0];
    // The record is a SNAPSHOT, and it carries the vault's own API shape.
    assert.equal(row.address, BRADS_COMP.address);
    assert.equal(row.snapshot.price, 2500000);
    assert.equal(row.org_id, OURS, "the second wall is written at insert time");
    // Plumbing must not travel. toApiComp's INTERNAL_FIELDS are stripped by
    // construction; this is the assertion that says so out loud.
    assert.equal(row.snapshot.user_id, undefined, "a vault comp's owner id left the vault");
    assert.equal(row.snapshot.dedupe_key, undefined);
  });

  await t.test("a comp id that is not the sender's own buys nothing", async () => {
    // The hub's vault-send rule: ids are read back scoped by user_id, so
    // naming somebody else's comp cannot put their private deal in a thread.
    ctx.tables.broker_comps.push({
      ...BRADS_COMP, id: "comp-rival", user_id: RIVAL.id,
      address: "999 Secret Way, Boise, ID", dedupe_key: "rival|secret",
    });
    const o = await post(BRAD, "/api/messages/send", { threadId, body: "and this", compIds: ["comp-rival"] });
    assert.equal(o.s, 201, "the message itself is fine");
    assert.equal(o.j.message.comps, 0, "the comp was silently not his to send");
    assert.ok(!ctx.tables.msg_comps.some((c) => /Secret Way/.test(c.address)),
      "another broker's comp reached a thread");
  });

  await t.test("Mike reads the thread and sees the comp", async () => {
    const o = await get(MIKE, "/api/messages/thread?id=" + encodeURIComponent(threadId));
    assert.equal(o.s, 200);
    const withComp = o.j.messages.filter((m) => m.comps.length)[0];
    assert.ok(withComp, "the comp did not reach the reader");
    assert.equal(withComp.comps[0].address, BRADS_COMP.address);
    assert.equal(withComp.comps[0].savedByMe, false);
    assert.equal(withComp.mine, false, "authorship is decided by the session, not the body");
    assert.ok(o.j.cursor, "a server-issued cursor came back");
  });

  await t.test("Mike's unread count clears when he reads, and Brad's never counted", async () => {
    const mine = await get(BRAD, "/api/messages");
    assert.equal(mine.j.threads[0].unread, 0, "your own messages are not news");
    const his = await get(MIKE, "/api/messages");
    assert.equal(his.j.threads[0].unread, 0, "reading the thread stamped last_read_at");
  });

  await t.test("an empty message is refused", async () => {
    const o = await post(BRAD, "/api/messages/send", { threadId, body: "   " });
    assert.equal(o.s, 400);
  });

  await t.test("a colleague on a free seat cannot save the comp, because saving needs a vault", async () => {
    const id = ctx.tables.msg_comps[0].id;
    const o = await post(DANA, "/api/messages/comp/save", { compId: id });
    assert.equal(o.s, 403);
    assert.equal(o.j.code, "vault_required");
  });

  await t.test("a colleague WITH a vault saves it, through the vault's own validator", async () => {
    const id = ctx.tables.msg_comps[0].id;
    const o = await post(MIKE, "/api/messages/comp/save", { compId: id });
    assert.equal(o.s, 200);
    const his = ctx.tables.broker_comps.filter((c) => c.user_id === MIKE.id);
    assert.equal(his.length, 1, "the comp did not land in his vault");
    assert.equal(his[0].address, BRADS_COMP.address);
    assert.equal(his[0].upload_id, undefined, "a saved comp belongs to no import");
    // The receipt, which is what lets the button say so rather than silently
    // making a second copy.
    assert.equal(ctx.tables.msg_comp_saves.length, 1);
  });

  await t.test("saving twice is a success and does not duplicate the comp", async () => {
    const id = ctx.tables.msg_comps[0].id;
    const o = await post(MIKE, "/api/messages/comp/save", { compId: id });
    assert.equal(o.s, 200);
    assert.equal(o.j.already, true);
    assert.equal(ctx.tables.broker_comps.filter((c) => c.user_id === MIKE.id).length, 1);
  });

  await t.test("the thread now reports the comp as already in his vault", async () => {
    const o = await get(MIKE, "/api/messages/thread?id=" + encodeURIComponent(threadId));
    const c = o.j.messages.filter((m) => m.comps.length)[0].comps[0];
    assert.equal(c.savedByMe, true);
  });

  await t.test("the Comps tab lists every comp ever sent in the thread", async () => {
    const o = await get(MIKE, "/api/messages/comps?thread=" + encodeURIComponent(threadId));
    assert.equal(o.s, 200);
    assert.equal(o.j.comps.length, 1);
    assert.equal(o.j.comps[0].sharedBy, "Brad");
  });

  await t.test("DELETING THE SENDER'S VAULT COMP DOES NOT REWRITE THE THREAD", async () => {
    // The decision the whole feature rests on. org_comps cascades because it
    // is a live copy of a row in a broker's book; a message is a record of
    // what was SAID, and rewriting it later — or emptying it out from under
    // the colleague it was said to — would be rewriting history.
    ctx.tables.broker_comps = ctx.tables.broker_comps.filter((c) => c.id !== BRADS_COMP.id);
    const o = await get(MIKE, "/api/messages/comps?thread=" + encodeURIComponent(threadId));
    assert.equal(o.s, 200);
    assert.equal(o.j.comps.length, 1, "the record of what was sent vanished with the original");
    assert.equal(o.j.comps[0].address, BRADS_COMP.address);
    assert.equal(o.j.comps[0].snapshot.price, 2500000);
  });

  await t.test("a channel carries a name and everybody who was named", async () => {
    const o = await post(BRAD, "/api/messages/thread", {
      kind: "channel", title: "Boise industrial", memberIds: [MIKE.id],
    });
    assert.equal(o.s, 201);
    assert.equal(o.j.thread.kind, "channel");
    assert.equal(o.j.thread.label, "Boise industrial");
    const seen = await get(MIKE, "/api/messages");
    assert.ok(seen.j.threads.some((th) => th.label === "Boise industrial"),
      "the colleague named in a channel cannot see it");
  });

  await t.test("an unnamed channel is refused rather than stored nameless", async () => {
    const o = await post(BRAD, "/api/messages/thread", { kind: "channel", memberIds: [MIKE.id] });
    assert.equal(o.s, 400);
  });

  await t.test("the poll's cursor returns only what is new", async () => {
    const first = await get(BRAD, "/api/messages/thread?id=" + encodeURIComponent(threadId));
    const cursor = first.j.cursor;
    const quiet = await get(BRAD,
      "/api/messages/thread?id=" + encodeURIComponent(threadId) + "&since=" + encodeURIComponent(cursor));
    assert.deepEqual(quiet.j.messages, [], "a quiet poll replayed the conversation");
    assert.equal(quiet.j.cursor, cursor, "a quiet poll rewound the cursor");

    await post(BRAD, "/api/messages/send", { threadId, body: "still there?" });
    const after = await get(BRAD,
      "/api/messages/thread?id=" + encodeURIComponent(threadId) + "&since=" + encodeURIComponent(cursor));
    assert.equal(after.j.messages.length, 1);
    assert.equal(after.j.messages[0].body, "still there?");
  });

  await t.test("nothing messaging-shaped reached the corpus or the public record", async () => {
    // 013's separate-tables rule, asserted against what was actually written
    // rather than against the source. A vault comp travelling into a message
    // must never become a public comp.
    assert.equal((ctx.tables.comp_corpus || []).length, 0);
    assert.equal((ctx.tables.comp_submissions || []).length, 0);
    assert.equal((ctx.tables.org_comps || []).length, 0);
  });
});
