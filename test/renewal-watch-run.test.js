const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// The renewal watch, actually run.
//
// renewal-watch.test.js proves what the email says and when it is worth
// sending. This proves the half that only exists with a database and a mail
// provider: the two reads that find a due lease, the market figure stitched on
// from the standing market page, the mail that leaves, the high-water mark
// that stops it leaving twice, and the fact that all of it rides the SAME
// admin-triggered run as the watchlist digest rather than a second schedule.
//
// Same shape and same reasoning as watchlist-digest-run.test.js, which is the
// file this feature was told to inherit from rather than fork. The fake
// understands only the query shapes server.js sends and 400s on anything else,
// so a filter that stops being understood fails a test instead of quietly
// returning the whole table — which matters more here than almost anywhere,
// because a widened window means mailing real people about leases that are not
// due.

const ISO = (d) => new Date(d).toISOString();
const DAY = 86400000;
const now = Date.now();
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

// A market nobody else uses, so a stale comp-corpus.jsonl on this machine
// cannot leak into these assertions.
const MARKET = "Renewtown, ZZ";

function lease(over) {
  return {
    id: "c1",
    user_id: "u1",
    upload_id: null,
    market: MARKET,
    property_type: "Office",
    address: "400 Main St, Renewtown, ZZ",
    address_key: "400 main st",
    dedupe_key: "k1",
    deal_date: "2026-01-15",
    transaction: "lease",
    price: null,
    size_sqft: 5000,
    price_per_sqft: null,
    rent_psf: 2.1,
    rent_basis: "monthly",
    lease_type: "NNN",
    rent_psf_yr: 25.2,
    lease_expiry: ymd(now + 300 * DAY),
    option_notice_date: ymd(now + 60 * DAY),
    renewal_notified_at: null,
    published: false,
    created_at: ISO(now - 100 * DAY),
    ...over,
  };
}

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    ADMIN_KEY: "renewal-key",
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

// The renewal watch rides the digest's route — that is the point, not an
// implementation detail, so the test drives the same URL a cron would.
const runDigest = (srv, body) => fetch(srv.base + "/api/watchlist/digest", {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-key": "renewal-key" },
  body: JSON.stringify(body || {}),
});

// Fire-and-forget, like the digest it rides — see the helper's header in the
// fake. This copy budgeted 1.5 seconds with no settling beat, which is the
// same too-short loop watchlist-digest-run.test.js carried.
const settle = fake.waitForMail;

const BROKER = { id: "u1", email: "broker@example.com", digest_optout: false };

// Each subtest takes its OWN `t`. `t.after` inside a callback that takes no
// argument registers on the PARENT, so every server this file booted stayed
// up until the whole test finished and they were all closed in one burst —
// and `db.stop()` is `server.close()`, which waits on its connections. That
// is the state a hung `node --test` was observed in on 2026-09-01: it sat for
// five hours after printing its last test line, which in CI is a job that
// never ends rather than a build that goes red. Each subtest here boots and
// uses exactly one server, so each should close its own.
test("the renewal watch actually runs", async (t) => {
  await t.test("mails a broker about a due lease, then never again", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.brokers, 1, "one broker had a lease in the window");
    assert.equal(summary.renewals.sent, 1);
    assert.equal(summary.renewals.leases, 1);
    assert.equal(summary.renewals.failed, 0, "a failure here means the run threw");

    const [mail] = await settle(db, 1);
    assert.ok(mail, "an email should have reached the provider");
    assert.deepEqual(mail.to, ["broker@example.com"]);
    assert.match(mail.subject, /Option notice coming up/);
    assert.match(mail.subject, /400 Main St/);
    assert.match(mail.text, /Option notice due/);
    assert.match(mail.text, /in 60 days/);
    // Their own rate, in their own basis, exactly as recorded.
    assert.match(mail.text, /Paying \$2\.10\/SF\/mo/);
    assert.match(mail.text, /Check your own lease/);

    // The marker is what makes it once-per-lease, and it is written to the
    // row rather than remembered.
    const row = tables.broker_comps.find((c) => c.id === "c1");
    assert.ok(row.renewal_notified_at, "the lease is marked as told");

    // A second run is the real test of the marker: same window, same lease,
    // and nobody is mailed twice.
    const again = await (await runDigest(srv)).json();
    assert.equal(again.renewals.sent, 0, "the second run mails nobody");
    assert.equal(db.sent.length, 1, "and posts no second email");
  });

  await t.test("a deadline further out than the window is left alone", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease({ option_notice_date: ymd(now + 200 * DAY) })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.sent, 0);
    assert.equal(db.sent.length, 0);
    assert.equal(tables.broker_comps[0].renewal_notified_at, null,
      "and is NOT marked — it must still fire when it comes round");
  });

  await t.test("a deadline that has already passed is never mailed about", async (t) => {
    // The rule that keeps this feature from becoming something people turn
    // off: a message about a date that went by is a notification of a loss.
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease({ option_notice_date: ymd(now - 5 * DAY) })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.sent, 0);
    assert.equal(db.sent.length, 0);
  });

  await t.test("a lease with no dates is not a watched lease", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease({ option_notice_date: null, lease_expiry: null })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.brokers, 0, "the read does not even return it");
    assert.equal(db.sent.length, 0);
  });

  await t.test("an expiry-only lease is found by the second read and worded honestly", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease({ option_notice_date: null, lease_expiry: ymd(now + 45 * DAY) })],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.sent, 1);
    const [mail] = await settle(db, 1);
    assert.match(mail.text, /Lease expires/);
    assert.equal(/Option notice/.test(mail.text), false,
      "never claims notice is owed on a lease that records none");
  });

  await t.test("a dry run builds the copy, sends nothing, and marks nothing", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv, { dryRun: true })).json();
    assert.equal(summary.renewals.sent, 0);
    assert.equal(db.sent.length, 0, "nothing left the building");
    assert.equal(tables.broker_comps[0].renewal_notified_at, null,
      "and nothing was marked, so a real run still has it to send");
    const preview = summary.previews.find((p) => /Option notice/.test(p.subject));
    assert.ok(preview, "the copy is returned for inspection");
    assert.deepEqual(preview.to, "broker@example.com");
  });

  await t.test("an opted-out broker is not mailed, and their lease is not marked", async (t) => {
    // One opt-out governs both self-initiated emails. Honouring it for the
    // digest and not for this would make an unsubscribe mean nothing.
    const tables = {
      users: [{ ...BROKER, digest_optout: true }],
      watchlist_items: [],
      broker_comps: [lease()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.sent, 0);
    assert.equal(db.sent.length, 0);
    assert.equal(tables.broker_comps[0].renewal_notified_at, null,
      "an opt-out must not silently consume the one reminder they would get back");
  });

  await t.test("two brokers are mailed separately, each about only their own lease", async (t) => {
    // The read is not user-scoped — it sweeps every broker at once — so this
    // is the assertion that the grouping actually holds. A bug here mails one
    // broker another broker's addresses, which is a vault-class leak.
    const tables = {
      users: [BROKER, { id: "u2", email: "other@example.com", digest_optout: false }],
      watchlist_items: [],
      broker_comps: [
        lease({ id: "c1", user_id: "u1", address: "400 Main St, Renewtown, ZZ" }),
        lease({ id: "c2", user_id: "u2", address: "900 Private Way, Renewtown, ZZ", dedupe_key: "k2" }),
      ],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.brokers, 2);
    assert.equal(summary.renewals.sent, 2);

    const sent = await settle(db, 2);
    const mine = sent.find((m) => m.to[0] === "broker@example.com");
    const theirs = sent.find((m) => m.to[0] === "other@example.com");
    assert.ok(mine && theirs);
    assert.match(mine.text, /400 Main St/);
    assert.equal(/900 Private Way/.test(mine.text), false,
      "one broker must never read another broker's address");
    assert.match(theirs.text, /900 Private Way/);
    assert.equal(/400 Main St/.test(theirs.text), false);
  });

  await t.test("the digest and the renewal watch ride one run without disturbing each other", async (t) => {
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease()],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    const summary = await (await runDigest(srv)).json();
    // The digest half found nobody to mail, and that did not stop the renewal
    // half — the two populations are different and neither gates the other.
    assert.equal(summary.watchers, 0);
    assert.equal(summary.sent, 0);
    assert.equal(summary.renewals.sent, 1);
  });

  await t.test("it refuses without outbound mail rather than marking everyone as told", async (t) => {
    // The digest's own rule, and it matters more here: sendOutboundEmail is a
    // silent no-op with no EMAIL_FROM, so running blind would stamp
    // renewal_notified_at on every lease and delete a reminder nobody got.
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease()],
    };
    const { db, srv, stop } = await bootWithDb(tables, { EMAIL_FROM: "", RESEND_API_KEY: "" });
    t.after(stop);

    const res = await runDigest(srv);
    assert.equal(res.status, 503);
    assert.equal(tables.broker_comps[0].renewal_notified_at, null,
      "nothing was marked, so the reminder survives to be sent once mail works");
  });

  await t.test("the market figure comes from the standing market page, in the broker's basis", async (t) => {
    // The one path the tests above cannot reach: every other case has no
    // market page for Renewtown, so the email correctly drops the comparison
    // line. This seeds the page the way the Explorer publishes one and proves
    // the figure that arrives is the one /market/<slug> itself would show.
    const tables = {
      users: [BROKER],
      watchlist_items: [],
      broker_comps: [lease()],
      market_pages: [{
        slug: "office-renewtown-zz",
        payload: {
          market: MARKET,
          property_type: "Office",
          // validDynamicMarket requires a median $/SF before it will load the
          // page at all — the sale figure, unrelated to the rent band below.
          ppsf: { median: 210 },
          // rentFromComps' own shape: one canonical ANNUAL figure.
          rent: { count: 7, median: 30, low: 26, high: 34 },
        },
      }],
    };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);

    const summary = await (await runDigest(srv)).json();
    assert.equal(summary.renewals.sent, 1);
    const [mail] = await settle(db, 1);
    // Stored annual, quoted MONTHLY because that is how this broker records
    // this lease. $30/yr is $2.50/mo, and the unit is always printed.
    assert.match(mail.text, /Comparable space in Renewtown, ZZ: \$2\.50\/SF\/mo \(median of 7 leases\)/);
    // Their own rate sits beside it in the same unit, so the two are readable
    // against each other.
    assert.match(mail.text, /Paying \$2\.10\/SF\/mo/);
    // And no verdict is drawn between them.
    assert.equal(/below market|above market|overpay|%/i.test(mail.text), false);
  });

  await t.test("the fake understood every filter the run sent", async (t) => {
    // The guarantee the whole file rests on. A window filter the fake could
    // not parse would return the WHOLE table, which is how a test proves a
    // narrow read works while the real one mails everybody.
    const tables = { users: [BROKER], watchlist_items: [], broker_comps: [lease()] };
    const { db, srv, stop } = await bootWithDb(tables);
    t.after(stop);
    await (await runDigest(srv)).json();
    assert.deepEqual(db.unparsed, [],
      `fake-supabase refused a filter: ${db.unparsed.join(", ")}`);
  });
});
