// Hub note emails, actually running — a real note posted into a real hub
// against a stand-in PostgREST and Resend, asserting who was mailed, what the
// mail said, and who was deliberately left alone.
//
// Why this exists: the notifier (migration 040) is the one part of the hub
// nobody can see working. Every hub route has NO file fallback, so
// hub-routes.test.js can only prove the refusals, and the rule itself is a
// pure function proved in hub-access.test.js with no server anywhere near it.
// Between those two sat the whole feature: whether a note actually reaches the
// mail provider, whether the audience is the right people, whether `seen_at`
// and `notified_at` are really written and really read back.
//
// It matters more here than usual, because too many emails is a failure that
// never throws. A broken one-nudge rule does not error, does not 500, does not
// show up in any log — it just quietly makes somebody stop reading them. Same
// reason test/watchlist-digest-run.test.js exists, and it uses the same fake.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

// A broker, their client, a second person in the hub, and somebody who was
// taken out of it.
const BROKER = { id: "u-broker", email: "broker@firm.com", name: "Owen Barnes" };
const TENANT = { id: "u-tenant", email: "tenant@acme.com", name: "Dana" };
const COLLEAGUE = { id: "u-colleague", email: "cfo@acme.com", name: "Sam" };
const REMOVED = { id: "u-removed", email: "gone@acme.com", name: "Gone" };

const HUB = "hubABC123";

function seedTables(over = {}) {
  return {
    users: [BROKER, TENANT, COLLEAGUE, REMOVED].map((u) => ({
      ...u, pro_tester: false, vault_beta: true, digest_optout: false,
    })),
    sessions: [BROKER, TENANT, COLLEAGUE, REMOVED].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    hubs: [{
      id: HUB, owner_user_id: BROKER.id, title: "1210 N 17th St",
      market: "Boise, ID", property_type: "Industrial",
      subject_address: "1210 N 17th St, Boise, ID", status: "active",
      created_at: ago(2000), updated_at: ago(2000), closed_at: null,
    }],
    hub_participants: [
      {
        id: "p-tenant", hub_id: HUB, email: TENANT.email, role: "tenant",
        user_id: null, token_hash: sha256("t-tenant"), invited_at: ago(1000),
        first_viewed_at: ago(900), last_seen_at: ago(900), removed_at: null,
      },
      {
        id: "p-colleague", hub_id: HUB, email: COLLEAGUE.email, role: "tenant",
        user_id: null, token_hash: sha256("t-colleague"), invited_at: ago(1000),
        first_viewed_at: null, last_seen_at: null, removed_at: null,
      },
      {
        id: "p-removed", hub_id: HUB, email: REMOVED.email, role: "tenant",
        user_id: null, token_hash: sha256("t-removed"), invited_at: ago(1000),
        first_viewed_at: null, last_seen_at: null, removed_at: ago(500),
      },
    ],
    hub_items: [], hub_messages: [], hub_notify: [], hub_email_prefs: [],
    analytics_events: [], subscriptions: [], report_purchases: [], export_usage: [],
    ...over,
  };
}

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables, ...(extraEnv || {}).fakeOpts });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_URL: db.resendUrl,
    ...(extraEnv || {}).env,
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

// Every note in this suite is a note that POSTS, so the status is checked here
// rather than at the call sites — and it is checked at all of them, which it
// was not.
//
// The failure this ends: anything that stops the request succeeding — a 503, a
// session that did not resolve, a child server that died mid-run — arrived as
// an empty recipient list, which reads as a broken notifier. Reproduced
// 2026-08-31 in a loop of this file: a test server exited on its own (boot.js
// documents that death and prints a ⛔ naming it), and the test that noticed
// said "the broker had the hub open and was mailed anyway" — blaming the one
// rule it was actually proving, in the direction that trains somebody to
// re-run a red build instead of reading it.
//
// `why` is the sentence the call site would have written; the server's own
// answer is appended, because a status alone does not say what it objected to.
async function postNote(srv, user, body, why) {
  const r = await fetch(srv.base + "/api/hub/message", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}` },
    body: JSON.stringify({ id: HUB, ...body }),
  });
  const answer = (await r.text()).slice(0, 300);
  assert.equal(r.status, 201,
    `${why ? why + " — " : ""}POST /api/hub/message answered ${r.status}: ${answer}`);
  return r;
}

const readHub = (srv, user) => fetch(
  `${srv.base}/api/hub?id=${HUB}`,
  { headers: { cookie: `cn_session=tok-${user.id}` } },
);

// The mail send is fire-and-forget by design — the note is already saved and
// answered before the notifier runs, so the 201 can land before the mail does.
// Waits for `want` messages, then a beat longer, so "nobody else was mailed"
// is a real assertion rather than a race the test happens to win.
//
// The loop itself lives in the fake, beside the `sent` array it waits on; see
// its header for why there is one of these rather than four. The budget and
// the tail are unchanged from what this file proved it needed.
//
// What is added here is the SERVER. Mail that never arrives has two
// explanations and they are not the same bug: the notifier decided not to
// send, or the process that would have sent it is gone. Reproduced 2026-08-31
// in a loop of this file — a child answered 201 and then exited on its own
// (boot.js prints a ⛔ naming that death, Windows code 3221226505), so the
// note was saved, nothing was mailed, and the test said "the broker read it
// since we last wrote, so they are reachable again" over an empty list. That
// sentence is about the one rule the run never got to test.
//
// It cuts the other way too, and that half is the quieter hole: this file's
// "a chatty thread mailed once per note" and "nothing is sent" both assert
// that mail did NOT arrive, and a dead server satisfies those for the wrong
// reason. Asking on every call, including the ones expecting silence, is what
// stops a death from reading as a pass.
async function settle(db, want, srv) {
  const sent = await fake.waitForMail(db, want);
  if (srv) {
    assert.ok(await srv.alive(),
      "the test server exited on its own mid-run (see the ⛔ above) — nothing below " +
      "this line is a verdict on the notifier; re-read, do not re-run");
  }
  return sent;
}

const to = (db) => db.sent.map((m) => m.to[0]).sort();
// A filter this fake refused would 400, and every read in the notifier is
// wrapped, so an unparsed filter degrades to "mail everybody" instead of
// failing. That is right in production and would make a green test here a lie.
const assertNoUnparsed = (db) =>
  assert.deepEqual(db.unparsed, [], "the fake refused a filter server.js really sends");

// Each subtest takes its OWN `t`, and the shadowing is the point: `t.after`
// inside a subtest whose callback takes no argument registers on the PARENT,
// so all twelve servers and all twelve stand-in databases stayed up for the
// whole run and were torn down in one burst at the end. Measured 2026-09-01:
// twelve live server.js children at peak, against the one this suite ever
// needs at a time.
//
// It is not only tidiness. `db.stop()` is `server.close()`, which waits on its
// connections, and a twelve-way close of servers whose children were killed a
// moment earlier is the state a hung runner was observed in: `node --test` sat
// for five hours after printing its last test line, which in CI is a job that
// never ends rather than a build that goes red.
test("a note in a hub reaches the other people in it", async (t) => {
  await t.test("mails the broker and the other participant, never the author or a removed person", async (t) => {
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Can we tour the second one?" });
    await settle(db, 2, srv);
    assertNoUnparsed(db);

    assert.deepEqual(to(db), [COLLEAGUE.email, BROKER.email].sort());
    assert.ok(!to(db).includes(TENANT.email), "the author must never be mailed their own note");
    assert.ok(!to(db).includes(REMOVED.email),
      "a removed participant keeps getting the mail if removal is not honoured");

    const mail = db.sent.find((m) => m.to[0] === BROKER.email);
    // The note travels, because people reply to what they can read.
    assert.match(mail.text, /Can we tour the second one\?/);
    // Named, so the mail is not "somebody said something somewhere".
    assert.match(mail.subject, /Dana/);
    assert.match(mail.subject, /1210 N 17th St/);
    assert.match(mail.text, new RegExp(`/hub/${HUB}`), "no way back to the hub");
    // The off switch rides on every one of these.
    assert.match(mail.text, /\/hub\/notes\/unsubscribe\?e=/);
    assert.match(mail.text, /Turn these emails off/);
    // Reply goes to the person who wrote it, not to the site owner. Before
    // this shipped, hitting Reply on somebody's deal mailed a third party.
    assert.equal(mail.reply_to, TENANT.email);
  });

  await t.test("the owner is reached even though they have no participant row", async (t) => {
    // 024 never writes the owner a hub_participants row, so before 040 there
    // was nowhere to keep the broker's state at all — and the broker is the
    // paying half of this relationship. This is the direction most likely to
    // be silently dropped by a refactor.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, BROKER, { body: "Sending three more over." });
    await settle(db, 2, srv);
    assertNoUnparsed(db);

    assert.deepEqual(to(db), [COLLEAGUE.email, TENANT.email].sort());
    assert.ok(!to(db).includes(BROKER.email), "the broker was mailed their own note");
    assert.ok(tables.hub_participants.every((p) => p.email !== BROKER.email),
      "this test is meaningless if something started writing the owner a participant row");
  });

  await t.test("a second note while everyone is still away mails nobody", async (t) => {
    // THE RULE. Ten notes posted while a client is away is one email, not ten.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "First." });
    await settle(db, 2, srv);
    assert.equal(db.sent.length, 2);

    await postNote(srv, TENANT, { body: "Second." });
    await postNote(srv, TENANT, { body: "Third." });
    await settle(db, 3, srv);
    assert.equal(db.sent.length, 2, "a chatty thread mailed once per note");
  });

  await t.test("somebody who came back since being mailed is mailed again", async (t) => {
    // The other half of the same rule: opening the hub re-arms you. Seeded
    // rather than driven, because a real visit is also RECENT, and a recent
    // visit is suppressed by the presence window tested below.
    const tables = seedTables({
      hub_notify: [
        { hub_id: HUB, email: BROKER.email, seen_at: ago(10), notified_at: ago(30) },
        { hub_id: HUB, email: COLLEAGUE.email, seen_at: ago(90), notified_at: ago(30) },
      ],
    });
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Any thoughts?" });
    await settle(db, 1, srv);
    assertNoUnparsed(db);

    assert.deepEqual(to(db), [BROKER.email],
      "the broker read it since we last wrote, so they are reachable again; the colleague is not");
  });

  await t.test("somebody looking at the hub right now is not mailed about it", async (t) => {
    // Proves stampHubSeen is really wired to the read. A visible tab polls
    // every 15 seconds, so telling that person about a note they are watching
    // arrive is the fastest way to get the feature switched off.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    const opened = await readHub(srv, BROKER);
    assert.equal(opened.status, 200);
    // Nothing is worth asserting downstream if the read never stamped.
    await new Promise((r) => setTimeout(r, 120));
    const seen = tables.hub_notify.find((n) => n.email === BROKER.email);
    assert.ok(seen && seen.seen_at, "a hub read did not stamp the broker as present");

    await postNote(srv, TENANT, { body: "Just sent it." });
    await settle(db, 1, srv);

    assert.deepEqual(to(db), [COLLEAGUE.email],
      "the broker had the hub open and was mailed anyway");
  });

  await t.test("an address that turned these off is not mailed", async (t) => {
    const tables = seedTables({
      hub_email_prefs: [{ email: COLLEAGUE.email, notify: false, updated_at: ago(60) }],
    });
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Third one is under contract." });
    await settle(db, 1, srv);
    // If the opt-out read had 400'd, this would still pass with 2 recipients
    // and look like a working feature, which is what assertNoUnparsed catches.
    assertNoUnparsed(db);

    assert.deepEqual(to(db), [BROKER.email], "an address that opted out was mailed anyway");
  });

  await t.test("a note on one comp names that building", async (t) => {
    const tables = seedTables({
      hub_items: [{
        id: "11111111-2222-3333-4444-555555555555", hub_id: HUB, kind: "comp",
        source: "vault", source_ref: "c1", private: false, status: "new",
        snapshot: { address: "455 S Capitol Blvd", price: 2400000 },
        added_by_email: BROKER.email, added_at: ago(400), removed_at: null,
      }],
    });
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, {
      body: "Too close to the freeway.",
      itemId: "11111111-2222-3333-4444-555555555555",
    });
    await settle(db, 2, srv);

    const mail = db.sent[0];
    // "Somebody left a note" with no building attached is the version of this
    // email that gets ignored.
    assert.match(mail.subject, /455 S Capitol Blvd/);
    assert.match(mail.text, /on 455 S Capitol Blvd/);
  });

  await t.test("the notify cursor is written for everybody mailed, and nobody else", async (t) => {
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Noted." });
    await settle(db, 2, srv);

    const notified = tables.hub_notify.filter((n) => n.notified_at).map((n) => n.email).sort();
    assert.deepEqual(notified, [COLLEAGUE.email, BROKER.email].sort());
    // The author was stamped present by their own post (so they do not go on
    // collecting mail for replies to themselves) but was never notified.
    const author = tables.hub_notify.find((n) => n.email === TENANT.email);
    assert.ok(author && author.seen_at, "posting did not stamp the author as present");
    assert.ok(!author.notified_at, "the author was recorded as having been mailed");
  });

  await t.test("a mail provider having a bad afternoon does not cost the note", async (t) => {
    // Fire and forget, deliberately: the row is already written and the author
    // is about to be told it saved.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables, { fakeOpts: { resendStatus: 500 } });
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Still saved." },
      "a refused send turned a posted note into an error");
    await settle(db, 2, srv);

    assert.equal(tables.hub_messages.length, 1, "the note itself was lost");
    // Stamped anyway, on purpose: a permanently bad address is attempted once
    // per absence rather than re-attempted on every note.
    assert.equal(tables.hub_notify.filter((n) => n.notified_at).length, 2);
  });

  await t.test("with 040 unrun, the note still posts and the mail still goes out", async (t) => {
    // The promise 040 makes in its own header: every hub_notify read and write
    // is wrapped so a missing table costs the EMAIL and never the NOTE. That
    // is the opposite of 024's fail-closed stance, and it is only a comment
    // until something runs it — deploy-before-migrate is a real state in this
    // repo, which is why every migration doc says migrate first.
    //
    // Degraded, not broken: with no cursor to read, nobody can be shown to be
    // due, so everybody due-by-default is mailed once for this note. That is
    // the deliberate direction — the alternative is a database hiccup silently
    // reinstating the exact failure this feature exists to end.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables, {
      fakeOpts: { missingTables: ["hub_notify"] },
    });
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Still works." },
      "an unrun migration cost somebody their note");
    await settle(db, 2, srv);

    assert.equal(tables.hub_messages.length, 1);
    assert.deepEqual(to(db), [COLLEAGUE.email, BROKER.email].sort(),
      "a missing cursor table must degrade to mailing, not to silence");
  });

  await t.test("and even then the author is not mailed their own note", async (t) => {
    // THIS is where hubNoteAudience's author exclusion is the only thing
    // standing between somebody and their own words in their inbox.
    //
    // On every ordinary path it is masked: the route stamps the author present
    // before the notifier reads state, so the presence branch would refuse
    // them anyway and removing the exclusion changes nothing observable.
    // Verified by mutation — deleting the exclusion left all ten of the tests
    // above green. With hub_notify gone there is no presence stamp to hide
    // behind, so this is the case that keeps that guard honest.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables, {
      fakeOpts: { missingTables: ["hub_notify"] },
    });
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Talking to myself." });
    await settle(db, 2, srv);

    assert.ok(!to(db).includes(TENANT.email),
      "the author was mailed their own note once the cursor table was gone");
    assert.equal(db.sent.length, 2);
  });

  await t.test("with outbound mail switched off, nothing is sent and nothing is marked", async (t) => {
    // sendOutboundEmail is a SILENT no-op without EMAIL_FROM. Marking anyway
    // would burn everyone's one nudge on mail that never left the building.
    const tables = seedTables();
    const { db, srv, stop } = await bootWithDb(tables, { env: { EMAIL_FROM: "" } });
    t.after(() => stop());

    await postNote(srv, TENANT, { body: "Quiet." });
    await settle(db, 1, srv);

    assert.equal(db.sent.length, 0);
    assert.equal(tables.hub_notify.filter((n) => n.notified_at).length, 0,
      "a nudge was spent on an email that was never sent");
  });
});
