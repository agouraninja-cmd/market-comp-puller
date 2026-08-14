const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// The digest, actually run.
//
// watchlist-digest.test.js proves what the email says; routes.test.js proves
// the refusals. Neither can reach the part that matters most — the run itself
// — because the digest deliberately has no file fallback, so with no database
// it stops at a 503. Everything past that point was argued in comments and had
// never executed: the cutoff arithmetic, which markets get marked, the opt-out,
// and the rule that a second run mails nobody twice.
//
// The fake understands only the query shapes server.js sends and 400s on
// anything else (see its header) rather than matching everything, so a filter
// that stops being understood fails a test instead of quietly returning the
// whole table — which is how a fake reports that a user-scoped read works
// while it hands back another account's rows.

const ISO = (d) => new Date(d).toISOString();
const DAY = 86400000;
const now = Date.now();

// A market nobody else uses, so a stale comp-corpus.jsonl on this machine
// cannot leak rows into these assertions — corpusRowsForMarket merges the
// file fallback with the database on every call.
const MARKET = "Digesttown, ZZ";
const QUIET = "Quiettown, ZZ";

function corpusRow(over) {
  return {
    ts: ISO(now - DAY),
    market: MARKET,
    property_type: "Industrial",
    address: "100 Test Way",
    transaction: "Sale",
    deal_date: "2026-07-01",
    price_or_rate: 1000000,
    price_per_sqft: 80,
    ...over,
  };
}

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    ADMIN_KEY: "digest-key",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

const runDigest = (srv, body) => fetch(srv.base + "/api/watchlist/digest", {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-key": "digest-key" },
  body: JSON.stringify(body || {}),
});

// The Resend post is fire-and-forget by design (analytics and mail must never
// delay a response), so the summary can return before the mail lands.
async function settle(db, want) {
  for (let i = 0; i < 60 && db.sent.length < want; i++) await new Promise((r) => setTimeout(r, 25));
  return db.sent;
}

test("the digest actually runs", async (t) => {
  await t.test("mails a watcher with news, skips one without, and marks only what it sent", async () => {
    const tables = {
      users: [
        { id: "u1", email: "watcher@example.com", digest_optout: false },
      ],
      watchlist_items: [
        // Has new comps.
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
        // Watched, but the corpus has nothing for it.
        { id: "w2", user_id: "u1", market: QUIET, property_type: "Office",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow(), corpusRow({ ts: ISO(now - 2 * DAY), address: "200 Test Way" })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.sent, 1, "one watcher had news");
    assert.equal(summary.optedOut, 0);
    assert.equal(summary.failed, 0, "a failure here means the run threw, not that nobody had news");

    const [mail] = await settle(db, 1);
    assert.ok(mail, "an email should have reached the provider");
    assert.deepEqual(mail.to, ["watcher@example.com"]);
    assert.match(mail.subject, /2 new comps in Digesttown, ZZ/);
    assert.match(mail.text, /100 Test Way/);
    assert.equal(/Quiettown/.test(mail.text), false, "a market with no news must not appear");
    // The letterhead rides along, and the text is the source of truth for both
    // parts — email-shell never rewrites a word of it.
    assert.ok(mail.html && mail.html.includes("100 Test Way"), "the HTML part carries the same comps");

    // Only the market that carried news is marked. w2 keeping its null is the
    // rule that lets a market which goes quiet for months still reach back to
    // when the watch started on the day it finally gets a comp.
    const rows = db.tables.watchlist_items;
    assert.ok(rows.find((r) => r.id === "w1").last_digest_at, "w1 should be marked");
    assert.equal(rows.find((r) => r.id === "w2").last_digest_at, null, "w2 had no news and must keep its mark");
  });

  await t.test("a second run mails nobody twice", async () => {
    // The single most expensive mistake this feature could make.
    const tables = {
      users: [{ id: "u1", email: "watcher@example.com", digest_optout: false }],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    assert.equal((await (await runDigest(srv)).json()).sent, 1);
    await settle(db, 1);

    const second = await (await runDigest(srv)).json();
    assert.equal(second.sent, 0, "nothing new since the first run");
    assert.equal(second.nothingNew, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(db.sent.length, 1, "the same comps must never be mailed twice");
  });

  await t.test("two watchers both get mail", async () => {
    // findUsersByIds and markWatchlistDigested build PostgREST `in.(...)`
    // lists, and a list is the one shape that works for a sample of one and
    // then does not. A run that mails nobody looks identical to a quiet week
    // from the outside, so the two-element case needs its own test rather
    // than being assumed from the one-element case above.
    const tables = {
      users: [
        { id: "u1", email: "one@example.com", digest_optout: false },
        { id: "u2", email: "two@example.com", digest_optout: false },
      ],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
        { id: "w2", user_id: "u2", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.watchers, 2);
    assert.equal(summary.sent, 2);
    const sent = await settle(db, 2);
    assert.deepEqual(sent.map((m) => m.to[0]).sort(), ["one@example.com", "two@example.com"]);
    assert.deepEqual(db.unparsed, [], "the fake refused a filter it could not parse: " + JSON.stringify(db.unparsed));
  });

  await t.test("an opted-out account is skipped before anything is built", async () => {
    const tables = {
      users: [
        { id: "u1", email: "yes@example.com", digest_optout: false },
        { id: "u2", email: "no@example.com", digest_optout: true },
      ],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
        { id: "w2", user_id: "u2", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.optedOut, 1);
    assert.equal(summary.sent, 1);
    const sent = await settle(db, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(sent.map((m) => m.to[0]), ["yes@example.com"]);
    // An opt-out must not have its markers advanced either: if they turn the
    // digest back on, they should get what they missed, not a silent gap.
    assert.equal(db.tables.watchlist_items.find((r) => r.id === "w2").last_digest_at, null);
  });
});

test("the digest's send cutoff", async (t) => {
  await t.test("is the LATER of last_seen_at and last_digest_at", async () => {
    // The rule that stops the email telling somebody what they already saw on
    // screen. This account was mailed a month ago but opened the app
    // yesterday, so a comp from three days ago is old news.
    const tables = {
      users: [{ id: "u1", email: "active@example.com", digest_optout: false }],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 60 * DAY),
          last_digest_at: ISO(now - 30 * DAY),
          last_seen_at: ISO(now - 1 * DAY) },
      ],
      comp_corpus: [corpusRow({ ts: ISO(now - 3 * DAY), address: "300 Seen Already" })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.sent, 0, "the reader already saw this comp in the app");
    assert.equal(summary.nothingNew, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(db.sent.length, 0);
  });

  await t.test("a never-mailed watch reaches back to when it was created, not to the epoch", async () => {
    // Otherwise a brand new watch mails a year of backlog on day one.
    const tables = {
      users: [{ id: "u1", email: "new@example.com", digest_optout: false }],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 2 * DAY), last_seen_at: ISO(now - 2 * DAY), last_digest_at: null },
      ],
      comp_corpus: [
        corpusRow({ ts: ISO(now - 300 * DAY), address: "900 Ancient Rd" }),
        corpusRow({ ts: ISO(now - 1 * DAY), address: "100 Fresh St" }),
      ],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    assert.equal((await (await runDigest(srv)).json()).sent, 1);
    const [mail] = await settle(db, 1);
    assert.match(mail.text, /1 new comp/);
    assert.match(mail.text, /100 Fresh St/);
    assert.equal(/900 Ancient Rd/.test(mail.text), false, "a new watch must not mail the backlog");
  });
});

test("a dry run changes nothing", async (t) => {
  await t.test("returns the copy, sends no mail, and advances no marker", async () => {
    const tables = {
      users: [{ id: "u1", email: "watcher@example.com", digest_optout: false }],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv, { dryRun: true })).json();
    assert.equal(summary.sent, 0);
    assert.equal(summary.previews.length, 1, "a dry run returns what WOULD have been sent");
    assert.equal(summary.previews[0].to, "watcher@example.com");
    assert.match(summary.previews[0].text, /100 Test Way/);

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(db.sent.length, 0, "a dry run must never reach the mail provider");
    assert.equal(db.tables.watchlist_items[0].last_digest_at, null,
      "a dry run that marked anything would silently delete the real digest");

    // ...and the real run afterwards still has everything to say.
    assert.equal((await (await runDigest(srv)).json()).sent, 1);
    assert.equal((await settle(db, 1)).length, 1);
  });
});

test("the outbound-mail guard", async (t) => {
  // The subtlest refusal in the feature, and until this suite existed it was
  // untestable: routes.test.js has no database, so its digest calls 503 on the
  // database check and never reach this one. Verified by mutation — deleting
  // the guard leaves every DB-less test green.
  //
  // What it prevents: sendOutboundEmail is a SILENT no-op when EMAIL_FROM or
  // RESEND_API_KEY is unset (it logs a skip line and returns). Every other
  // caller can live with that. This one cannot, because the run would go on to
  // advance every high-water mark — so the comps would be marked as mailed,
  // nobody would have received them, and the next run would correctly report
  // nothing new. That does not delay a digest, it deletes one, and leaves no
  // trace that says so.
  const tables = () => ({
    users: [{ id: "u1", email: "watcher@example.com", digest_optout: false }],
    watchlist_items: [
      { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
        created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
    ],
    comp_corpus: [corpusRow()],
  });

  await t.test("a real run refuses when mail is unconfigured, and marks nothing", async () => {
    const { db, srv, stop } = await bootWithDb(tables(), { EMAIL_FROM: "", RESEND_API_KEY: "" });
    t.after(stop);

    const r = await runDigest(srv);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /EMAIL_FROM/,
      "the refusal must name what is missing, or it reads as the database refusal");

    await new Promise((res) => setTimeout(res, 150));
    assert.equal(db.sent.length, 0);
    assert.equal(db.tables.watchlist_items[0].last_digest_at, null,
      "refusing is only safe if it also leaves the high-water mark alone");
  });

  await t.test("a dry run still works without mail configured", async () => {
    // The deliberate exemption: looking at the copy must not require a
    // verified sending domain, which is the state this deployment is actually
    // in today.
    const { db, srv, stop } = await bootWithDb(tables(), { EMAIL_FROM: "", RESEND_API_KEY: "" });
    t.after(stop);

    const r = await runDigest(srv, { dryRun: true });
    assert.equal(r.status, 200);
    const summary = await r.json();
    assert.equal(summary.previews.length, 1);
    assert.match(summary.previews[0].text, /100 Test Way/);
    assert.equal(db.tables.watchlist_items[0].last_digest_at, null);
  });
});

test("one broken account does not stop the run", async (t) => {
  await t.test("the rest of the list is still mailed", async () => {
    // A watcher row with no market at all: corpusRowsForMarket refuses it and
    // the account throws. The next account is still owed its mail.
    const tables = {
      users: [
        { id: "u1", email: "broken@example.com", digest_optout: false },
        { id: "u2", email: "fine@example.com", digest_optout: false },
      ],
      watchlist_items: [
        { id: "w1", user_id: "u1", market: null, property_type: null,
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
        { id: "w2", user_id: "u2", market: MARKET, property_type: "Industrial",
          created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
      ],
      comp_corpus: [corpusRow()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.sent, 1, "the healthy account still got its digest");
    const sent = await settle(db, 1);
    assert.deepEqual(sent.map((m) => m.to[0]), ["fine@example.com"]);
  });
});

test("unsubscribing actually stops the mail", async (t) => {
  // routes.test.js proves the link authenticates and that the GET only offers
  // a form. What it cannot reach is the other end of the loop: that the POST
  // writes the flag, and that the flag then stops a real run. An unsubscribe
  // that renders "that's done" and mails the person again next week is worse
  // than no unsubscribe at all, because they have already been told it worked.
  const crypto = require("node:crypto");
  const SERVICE = "service-key";
  const macFor = (id) => crypto.createHmac("sha256", SERVICE)
    .update(`watchlist-digest-unsubscribe:${id}`).digest("hex").slice(0, 32);

  const tables = () => ({
    users: [{ id: "u1", email: "leaving@example.com", digest_optout: false }],
    watchlist_items: [
      { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
        created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
    ],
    comp_corpus: [corpusRow()],
  });

  await t.test("the POST writes the flag and the next run skips them", async () => {
    const { db, srv, stop } = await bootWithDb(tables());
    t.after(stop);

    const off = await fetch(srv.base + `/watchlist/unsubscribe?u=u1&t=${macFor("u1")}`, { method: "POST" });
    assert.equal(off.status, 200);
    assert.match(await off.text(), /That&rsquo;s done|That's done/);
    assert.equal(db.tables.users[0].digest_optout, true, "the POST must actually write the flag");

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.optedOut, 1);
    assert.equal(summary.sent, 0);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(db.sent.length, 0, "an unsubscribed account must not be mailed");
  });

  await t.test("the same link turns them back on, and the backlog is still waiting", async () => {
    // The markers were never advanced while they were opted out, so coming
    // back gets what they missed rather than a silent gap.
    const { db, srv, stop } = await bootWithDb(tables());
    t.after(stop);

    await fetch(srv.base + `/watchlist/unsubscribe?u=u1&t=${macFor("u1")}`, { method: "POST" });
    assert.equal(db.tables.users[0].digest_optout, true);

    const on = await fetch(srv.base + `/watchlist/unsubscribe?u=u1&t=${macFor("u1")}&on=1`, { method: "POST" });
    assert.equal(on.status, 200);
    assert.equal(db.tables.users[0].digest_optout, false);

    assert.equal((await (await runDigest(srv)).json()).sent, 1);
    const [mail] = await settle(db, 1);
    assert.deepEqual(mail.to, ["leaving@example.com"]);
    assert.match(mail.text, /100 Test Way/, "the comps they missed are still owed to them");
  });

  await t.test("a forged token writes nothing", async () => {
    const { db, srv, stop } = await bootWithDb(tables());
    t.after(stop);
    const r = await fetch(srv.base + "/watchlist/unsubscribe?u=u1&t=deadbeef", { method: "POST" });
    assert.equal(r.status, 400);
    assert.equal(db.tables.users[0].digest_optout, false,
      "a refused token must not have reached the write");
  });
});

test("the run log distinguishes a preview from a send", async (t) => {
  // /admin's card reports when the digest last MAILED anybody, because the
  // schedule lives outside this process and an external cron that quietly
  // dies looks exactly like a quiet few weeks. That only works if a preview
  // is not counted as a run: a card reading "last sent 2 days ago" off
  // somebody clicking Preview would report a healthy schedule while nobody
  // had been mailed in a month, which is worse than reporting nothing.
  const tables = {
    users: [{ id: "u1", email: "watcher@example.com", digest_optout: false }],
    watchlist_items: [
      { id: "w1", user_id: "u1", market: MARKET, property_type: "Industrial",
        created_at: ISO(now - 30 * DAY), last_seen_at: ISO(now - 30 * DAY), last_digest_at: null },
    ],
    comp_corpus: [corpusRow()],
  };
  const { db, srv, stop } = await bootWithDb(tables, { ADMIN_KEY: "digest-key" });
  t.after(stop);
  const stats = async () => (await (await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": "digest-key" } })).json()).digestRuns;

  await t.test("nothing run yet reads as never", async () => {
    const d = await stats();
    assert.equal(d.runs, 0);
    assert.equal(d.previews, 0);
    assert.equal(d.lastAt, null, "never run must be null, not a zero date");
  });

  await t.test("a preview counts as a preview and never as a send", async () => {
    await runDigest(srv, { dryRun: true });
    await new Promise((r) => setTimeout(r, 200));
    const d = await stats();
    assert.equal(d.previews, 1);
    assert.equal(d.runs, 0, "a preview is not a run");
    assert.equal(d.lastAt, null, "a preview must not set the last-SENT stamp");
    assert.ok(d.lastAnyAt, "but it is still visible, so the card can say previews-only");
  });

  await t.test("a real send stamps it, with the outcome", async () => {
    await runDigest(srv);
    await settle(db, 1);
    await new Promise((r) => setTimeout(r, 200));
    const d = await stats();
    assert.equal(d.runs, 1);
    assert.ok(d.lastAt, "a real send must stamp the last-sent time");
    assert.equal(d.lastOutcome, "sent:1", "the card reads the count off this");
  });
});
