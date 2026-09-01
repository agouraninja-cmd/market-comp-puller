// The messaging hub, driven end to end as two people — a broker and their
// client working one requirement through a real server, a stand-in PostgREST
// and a stand-in Resend.
//
// WHY THIS EXISTS. The hub's own spec says nobody has ever driven one as two
// people, and the test suite agreed with it. hub-access.js's rules are proved
// pure, with no server anywhere near them. hub-routes.test.js proves the
// refusals against a BARE server, where every route here 503s by design long
// before it reaches SQL. hub-note-email-run.test.js runs exactly one route,
// POST /api/hub/message, because a notification is what it is about. Between
// those sat the entire workspace: creating a hub, an invitation opening it,
// sending a comp out of the vault, the client's own status and their own find,
// taking somebody out, closing it.
//
// That gap has already cost this feature once, and the scar is in server.js:
// the vault send asked PostgREST to resolve ON CONFLICT against a PARTIAL
// index, which Postgres refuses, so EVERY send failed with the route's generic
// 503 — all of them, every time — and nothing here could see it, because the
// only server these routes were ever pointed at had no database. The comment
// above that fix says it was found by sending a real comp into a real hub.
// This is that, in software, so the next one is found before a broker meets it.
//
// It is deliberately ONE walkthrough in order, not a bag of independent cases:
// the failures this is hunting live in the seams between the steps — a token
// that stops working after a re-invite, a decision the other person cannot
// see, a closed hub that still takes a post.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const DAYS_AGO = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// A broker with a vault, their client, and the client's CFO, who is invited
// later. The client's ACCOUNT exists from the start but they are not in the
// hub until the broker invites them — an invitation is not a membership, the
// same rule firm invites follow.
const BROKER = { id: "u-broker", email: "broker@firm.com", name: "Dale Ross" };
const TENANT = { id: "u-tenant", email: "tenant@acme.com", name: "Priya" };
const CFO = { id: "u-cfo", email: "cfo@acme.com", name: "Sam" };
const STRANGER = { id: "u-stranger", email: "nobody@example.com", name: "Nobody" };

function vaultRow(n, price) {
  return {
    id: `vault-comp-${n}`,
    user_id: BROKER.id,
    market: "Boise, ID",
    property_type: "Industrial",
    address: `${n}00 Vault Ave, Boise, ID 83702`,
    address_key: `${n}00 vault ave boise id 83702`,
    deal_date: DAYS_AGO(40 + n),
    transaction: "sale",
    price,
    size_sqft: 10000,
    price_per_sqft: price / 10000,
    dedupe_key: `${n}00 vault ave|${DAYS_AGO(40 + n)}|${price}`,
    published: false,
  };
}

function seedTables() {
  return {
    users: [BROKER, TENANT, CFO, STRANGER].map((u) => ({
      // vault_beta on the BROKER only. Everyone else is an ordinary account
      // with no plan at all, which is the honest shape of a hub: the client is
      // not a customer, and a hub a client had to buy their way into would not
      // be a delivery channel.
      ...u, pro_tester: false, vault_beta: u.id === BROKER.id, digest_optout: false,
    })),
    sessions: [BROKER, TENANT, CFO, STRANGER].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    broker_comps: [vaultRow(1, 1250000), vaultRow(2, 1400000)],
    broker_properties: [],
    hubs: [], hub_participants: [], hub_items: [], hub_messages: [],
    hub_notify: [], hub_email_prefs: [],
    analytics_events: [], subscriptions: [], report_purchases: [], export_usage: [],
  };
}

async function bootWithDb({ mail = false, tables = seedTables() } = {}) {
  const db = await fake.start({ tables });
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
  });
  return { db, srv, tables, stop: async () => { srv.stop(); await db.stop(); } };
}

// Two ways to be somebody in a hub, and this suite needs both: a session
// cookie (an account) and a hub cookie (an invite link, no account at all).
const asUser = (user, init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_session=tok-${user.id}`,
    ...(init.headers || {}),
  },
});
const asToken = (hubId, token, init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_hub_${hubId}=${token}`,
    ...(init.headers || {}),
  },
});

// The token lives in the URL FRAGMENT, which is exactly how a tenant receives
// it and the reason the server never sees it on a page load.
const tokenFrom = (url) => String(url).split("#k=")[1] || "";

// Several reads behind these routes are wrapped, so a filter this fake refuses
// degrades to a silently wrong answer rather than an error. A green run with an
// unparsed filter in it is not a green run.
const assertNoUnparsed = (db) =>
  assert.deepEqual(db.unparsed, [], "the fake refused a filter server.js really sends");

test("a broker and a client work one requirement end to end", async (t) => {
  const { db, srv, tables, stop } = await bootWithDb();
  t.after(stop);

  let hubId = "";
  let tenantToken = "";
  let vaultItemId = "";
  let tenantCompId = "";
  let cursor = "";

  await t.test("the broker opens a hub and gets a link for the client", async () => {
    const r = await fetch(srv.base + "/api/hubs", asUser(BROKER, {
      method: "POST",
      body: JSON.stringify({
        title: "Warehouse requirement — Acme",
        subjectAddress: "1210 N 17th St, Boise, ID 83702",
        propertyType: "Industrial",
        participants: [TENANT.email],
      }),
    }));
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    hubId = j.id;
    assert.match(hubId, /^[A-Za-z0-9_-]{6,32}$/);

    // With no verified sending domain the invitation IS this response, and it
    // says so rather than claiming a send. A token cannot be shown twice, so a
    // route that guessed here would lose the invitation outright.
    assert.equal(j.emailed, false, "nothing was mailed, because outbound mail is off");
    assert.deepEqual(j.invites.map((i) => i.email), [TENANT.email]);
    tenantToken = tokenFrom(j.invites[0].url);
    assert.ok(tenantToken.length >= 16, "the link carries a real token in its fragment");
    assert.equal(j.invites[0].url, `https://compninja.co/hub/${hubId}#k=${tenantToken}`);

    // The raw token is never stored, only its hash — which is what makes a
    // leaked database row useless as a key to somebody's hub.
    const part = tables.hub_participants.find((p) => p.email === TENANT.email);
    assert.ok(part, "the invitation is a participant row");
    assert.equal(part.token_hash, sha256(tenantToken));
    assert.equal(part.role, "tenant");
    assert.equal(part.user_id, undefined, "an invitation is not a membership until they arrive");

    // marketOf() here and nowhere else, so a hub files under the same market
    // string the vault and the corpus use.
    assert.equal(tables.hubs[0].market, "Boise, ID");
  });

  await t.test("the client opens the link with no account and reads, but cannot post", async () => {
    const r = await fetch(srv.base + "/api/hub/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: hubId, token: tenantToken }),
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.role, "tenant");
    assert.equal(j.email, TENANT.email);
    assert.match(String(r.headers.get("set-cookie")), new RegExp(`^cn_hub_${hubId}=`),
      "the token becomes a cookie, so the fragment is needed once");

    const read = await fetch(`${srv.base}/api/hub?id=${hubId}`, asToken(hubId, tenantToken));
    const h = await read.json();
    assert.equal(read.status, 200);
    assert.equal(h.role, "tenant");
    // THE ACCOUNT ASK, and its placement is the acquisition loop: read first,
    // sign up only once you have something to say.
    assert.equal(h.canWrite, false, "a link proves someone opened it, not who is typing");
    assert.equal(h.canAdd, false);
    // The guest list is the broker's client relationships. A fellow guest never
    // sees who else is in the room.
    assert.equal(h.people, undefined, "the guest list is owner-only");

    // And the read is recorded, which is half of this feature's own score.
    await new Promise((done) => setTimeout(done, 80));
    const part = tables.hub_participants.find((p) => p.email === TENANT.email);
    assert.ok(part.first_viewed_at, "the first view is stamped");
  });

  await t.test("a stranger holding no link is refused without being sent back to a sign-in card", async () => {
    const r = await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(STRANGER));
    const j = await r.json();
    assert.equal(r.status, 403);
    assert.equal(j.code, "not_invited", "they are already past sign-in, so never sent back to it");
  });

  await t.test("the broker sends a comp out of their vault — the path that once failed every time", async () => {
    const r = await fetch(srv.base + "/api/hub/items", asUser(BROKER, {
      method: "POST",
      body: JSON.stringify({ id: hubId, items: [{ source: "vault", ref: "vault-comp-1" }] }),
    }));
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    assert.equal(j.added, 1);

    const stored = tables.hub_items.filter((i) => i.hub_id === hubId);
    assert.equal(stored.length, 1);
    vaultItemId = stored[0].id;
    assert.equal(stored[0].source, "vault");
    assert.equal(stored[0].private, true, "out of the vault, so it wears the badge that says so");
    assert.equal(stored[0].source_ref, "vault-comp-1");
    // Built from what the DATABASE returned, never from anything the browser
    // sent: a browser that could hand us a comp body could put any address and
    // any price in front of a client under the broker's name.
    assert.equal(stored[0].snapshot.address, "100 Vault Ave, Boise, ID 83702");
    assert.equal(stored[0].snapshot.price, 1250000);
    assert.equal(stored[0].snapshot.user_id, undefined, "the vault's own API allowlist decides the shape");
  });

  await t.test("sending the same comp again is a no-op, not an error and not a duplicate", async () => {
    const r = await fetch(srv.base + "/api/hub/items", asUser(BROKER, {
      method: "POST",
      body: JSON.stringify({ id: hubId, items: [{ source: "vault", ref: "vault-comp-1" }] }),
    }));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.added, 0);
    assert.equal(j.requested, 1);
    assert.equal(tables.hub_items.filter((i) => i.hub_id === hubId).length, 1);
  });

  await t.test("another broker's comp cannot be pulled into this hub by id", async () => {
    tables.broker_comps.push({ ...vaultRow(9, 999000), id: "vault-comp-9", user_id: "u-someone-else" });
    const r = await fetch(srv.base + "/api/hub/items", asUser(BROKER, {
      method: "POST",
      body: JSON.stringify({ id: hubId, items: [{ source: "vault", ref: "vault-comp-9" }] }),
    }));
    assert.equal(r.status, 404, "the vault read is user_id-scoped in the QUERY");
    assert.equal(tables.hub_items.filter((i) => i.hub_id === hubId).length, 1);
  });

  await t.test("the client signs in with the invited address and can now post", async () => {
    // No hub cookie in this request at all: the session alone is enough,
    // because identity is the EMAIL. This is the tenant on a second device with
    // no link to hand.
    const r = await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(TENANT));
    const h = await r.json();
    assert.equal(r.status, 200);
    assert.equal(h.role, "tenant");
    assert.equal(h.canWrite, true);
    assert.equal(h.canAdd, false, "only the broker sends comps out of a vault");
    assert.equal(h.items.length, 1);
    assert.equal(h.items[0].private, true);
  });

  await t.test("the client shortlists a building, and the decision is recorded as theirs", async () => {
    const r = await fetch(srv.base + "/api/hub/item", asUser(TENANT, {
      method: "PATCH",
      body: JSON.stringify({ id: hubId, itemId: vaultItemId, status: "shortlist" }),
    }));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.item.status, "shortlist");
    const row = tables.hub_items.find((i) => i.id === vaultItemId);
    assert.equal(row.status_by, TENANT.id, "an unattributable status is worth less than none");
    assert.ok(row.status_at);
  });

  await t.test("a status the pipeline does not have is a sentence, not a database error", async () => {
    const r = await fetch(srv.base + "/api/hub/item", asUser(TENANT, {
      method: "PATCH",
      body: JSON.stringify({ id: hubId, itemId: vaultItemId, status: "maybe" }),
    }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /not a status/i);
    assert.equal(tables.hub_items.find((i) => i.id === vaultItemId).status, "shortlist");
  });

  await t.test("the broker sees the client's decision without reloading", async () => {
    const r = await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(BROKER));
    const h = await r.json();
    assert.equal(h.items[0].status, "shortlist",
      "a poll carries the items, or a shortlist is invisible until somebody reloads");
    // The owner-only guest list, and what it is for: who has opened the link.
    assert.deepEqual(h.people, [{ email: TENANT.email, role: "tenant", opened: true }]);
  });

  await t.test("the client adds a building they found themselves", async () => {
    const r = await fetch(srv.base + "/api/hub/items", asUser(TENANT, {
      method: "POST",
      body: JSON.stringify({
        id: hubId,
        comp: {
          address: "77 Client Found Rd, Boise, ID",
          price: "$980,000",
          transaction: "sale",
          size_sqft: "8,000",
        },
      }),
    }));
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    tenantCompId = j.item.id;
    const row = tables.hub_items.find((i) => i.id === tenantCompId);
    assert.equal(row.source, "manual");
    assert.equal(row.private, false, "a client's own find is neither private data nor the broker's");
    assert.equal(row.source_ref, null);
    assert.equal(row.added_by_email, TENANT.email);
    assert.equal(row.snapshot.price, 980000, "the vault's own parsers decide what a number is");
  });

  await t.test("their typed comp is refused in the importer's own words", async () => {
    const r = await fetch(srv.base + "/api/hub/items", asUser(TENANT, {
      method: "POST",
      body: JSON.stringify({
        id: hubId,
        comp: { address: "9 Vague St, Boise, ID", price: "1.2M", transaction: "sale" },
      }),
    }));
    assert.equal(r.status, 400);
    assert.equal(tables.hub_items.filter((i) => i.hub_id === hubId && i.source === "manual").length, 1);
  });

  await t.test("the client may take back their own find, but never the broker's evidence", async () => {
    const mine = await fetch(srv.base + "/api/hub/item", asUser(TENANT, {
      method: "PATCH",
      body: JSON.stringify({ id: hubId, itemId: tenantCompId, removed: true }),
    }));
    assert.equal(mine.status, 200);
    assert.ok(tables.hub_items.find((i) => i.id === tenantCompId).removed_at);

    const theirs = await fetch(srv.base + "/api/hub/item", asUser(TENANT, {
      method: "PATCH",
      body: JSON.stringify({ id: hubId, itemId: vaultItemId, removed: true }),
    }));
    const j = await theirs.json();
    assert.equal(theirs.status, 403);
    assert.equal(j.code, "owner_only");
    assert.equal(tables.hub_items.find((i) => i.id === vaultItemId).removed_at, undefined);
  });

  await t.test("they trade messages, and each poll carries only what is new", async () => {
    const post = (user, body) => fetch(srv.base + "/api/hub/message", asUser(user, {
      method: "POST",
      body: JSON.stringify({ id: hubId, body }),
    }));

    assert.equal((await post(BROKER, "Sent the Vault Ave building over — worth a look.")).status, 201);
    const first = await (await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(TENANT))).json();
    assert.equal(first.messages.length, 1);
    assert.equal(first.messages[0].author, BROKER.email);
    cursor = first.cursor;
    assert.ok(cursor, "the SERVER hands back the cursor, so a clock skew in a browser cannot skip a message");

    assert.equal((await post(TENANT, "Shortlisted it. Can we tour Thursday?")).status, 201);
    const poll = await (await fetch(
      `${srv.base}/api/hub?id=${hubId}&since=${encodeURIComponent(cursor)}`, asUser(BROKER))).json();
    assert.equal(poll.messages.length, 1, "strictly after the cursor, or every poll replays the thread");
    assert.equal(poll.messages[0].body, "Shortlisted it. Can we tour Thursday?");
    // Items ride along on a poll even though messages are filtered, because a
    // status change IS an item change and two people move statuses at once.
    assert.equal(poll.items.length, 1);
  });

  await t.test("a note can hang off one comp, which is what makes this not a mail thread", async () => {
    const r = await fetch(srv.base + "/api/hub/message", asUser(TENANT, {
      method: "POST",
      body: JSON.stringify({ id: hubId, itemId: vaultItemId, body: "Clear height looks tight for our racking." }),
    }));
    assert.equal(r.status, 201);
    const h = await (await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(BROKER))).json();
    assert.ok(h.messages.find((m) => m.itemId === vaultItemId),
      "the note is filed under its building, not loose in the stream");
  });

  await t.test("the broker adds the client's CFO, and only the new person gets a link", async () => {
    const r = await fetch(srv.base + "/api/hub/participants", asUser(BROKER, {
      method: "PUT",
      body: JSON.stringify({ id: hubId, emails: [TENANT.email, CFO.email] }),
    }));
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(j.invites.map((i) => i.email), [CFO.email],
      "re-saving an unchanged list must not re-invite, and cannot: a token is shown once");

    const cfoToken = tokenFrom(j.invites[0].url);
    const read = await fetch(`${srv.base}/api/hub?id=${hubId}`, asToken(hubId, cfoToken));
    assert.equal(read.status, 200);
    assert.equal((await read.json()).role, "tenant");
    // And the first link still works — adding somebody is not re-issuing.
    assert.equal((await fetch(`${srv.base}/api/hub?id=${hubId}`, asToken(hubId, tenantToken))).status, 200);
  });

  await t.test("taking somebody out kills their link and their session, immediately", async () => {
    const r = await fetch(srv.base + "/api/hub/participants", asUser(BROKER, {
      method: "PUT",
      body: JSON.stringify({ id: hubId, emails: [TENANT.email] }),
    }));
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).invites, [], "removing people emails nobody");

    const byAccount = await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(CFO));
    assert.equal(byAccount.status, 403);
    assert.equal((await byAccount.json()).code, "removed",
      "a deliberate removal reads as one, not as a link that was never valid");

    // The ACL is never cached: this is the next request, not the next deploy.
    const write = await fetch(srv.base + "/api/hub/message", asUser(CFO, {
      method: "POST",
      body: JSON.stringify({ id: hubId, body: "still here?" }),
    }));
    assert.equal(write.status, 403);
  });

  await t.test("the broker closes it: everyone keeps what is there, nobody adds to it", async () => {
    const r = await fetch(srv.base + "/api/hub/close", asUser(BROKER, {
      method: "POST",
      body: JSON.stringify({ id: hubId }),
    }));
    assert.equal(r.status, 200);

    const read = await fetch(`${srv.base}/api/hub?id=${hubId}`, asUser(TENANT));
    const h = await read.json();
    assert.equal(read.status, 200, "closing is not revoking");
    assert.equal(h.canWrite, false);
    assert.equal(h.items.length, 1, "the record survives");

    const refusals = [
      ["a message", await fetch(srv.base + "/api/hub/message", asUser(TENANT, {
        method: "POST", body: JSON.stringify({ id: hubId, body: "one more thing" }),
      }))],
      ["a status", await fetch(srv.base + "/api/hub/item", asUser(TENANT, {
        method: "PATCH", body: JSON.stringify({ id: hubId, itemId: vaultItemId, status: "toured" }),
      }))],
      // The owner's own write too: closing binds the person who did it.
      ["a comp from the owner", await fetch(srv.base + "/api/hub/items", asUser(BROKER, {
        method: "POST", body: JSON.stringify({ id: hubId, items: [{ source: "vault", ref: "vault-comp-2" }] }),
      }))],
    ];
    for (const [label, res] of refusals) {
      assert.equal(res.status, 409, `${label} must be refused on a closed hub`);
      assert.equal((await res.json()).code, "closed");
    }
    assert.equal(tables.hub_items.filter((i) => i.hub_id === hubId && !i.removed_at).length, 1);
    assert.equal(tables.hub_items.find((i) => i.id === vaultItemId).status, "shortlist");
  });

  await t.test("a hub id alone never closes somebody else's hub", async () => {
    const r = await fetch(srv.base + "/api/hub/close", asUser(STRANGER, {
      method: "POST",
      body: JSON.stringify({ id: hubId }),
    }));
    assert.equal(r.status, 404, "scoped by owner in the query, so an id is never enough");
  });

  await t.test("nothing in the whole walkthrough asked a filter the fake could not parse", () => {
    assertNoUnparsed(db);
  });
});

// The other half of the invitation story, and the one a verified sending domain
// unblocks: the link LEAVES, and the panel stops showing it.
test("with outbound mail live, the invitation is emailed and carries the token", async (t) => {
  const { db, srv, stop } = await bootWithDb({ mail: true });
  t.after(stop);

  const r = await fetch(srv.base + "/api/hubs", asUser(BROKER, {
    method: "POST",
    body: JSON.stringify({ title: "Warehouse requirement", participants: [TENANT.email] }),
  }));
  const j = await r.json();
  assert.equal(r.status, 201, JSON.stringify(j));
  assert.equal(j.emailed, true, "the send's own answer, never a restatement of the configuration");
  assert.deepEqual(j.emailFailed, []);

  // Read with no wait, deliberately, and this is the one mail path in the app
  // where that is safe: sendHubInvites AWAITS its sends (`emailed` above is
  // their own answer, not a restatement of the configuration), so the response
  // cannot arrive before the post to the stub has. Every other suite on this
  // fake needs fake.waitForMail — see its header.
  assert.equal(db.sent.length, 1);
  assert.deepEqual(db.sent[0].to, [TENANT.email]);
  assert.match(JSON.stringify(db.sent[0]), new RegExp(`https://compninja\\.co/hub/${j.id}#k=`),
    "the emailed link carries the token in its fragment, like the copied one");
  assertNoUnparsed(db);
});

// The failure nobody sees: mail configured, provider having a bad afternoon. A
// hub token cannot be shown twice, so the invitation must survive as a
// copy-paste rather than be lost with the broker told it had gone.
test("a mail provider having a bad afternoon costs a copy-paste, never the invitation", async (t) => {
  const db = await fake.start({ tables: seedTables(), resendStatus: 500 });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_URL: db.resendUrl,
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  const r = await fetch(srv.base + "/api/hubs", asUser(BROKER, {
    method: "POST",
    body: JSON.stringify({ title: "Warehouse requirement", participants: [TENANT.email] }),
  }));
  const j = await r.json();
  assert.equal(r.status, 201, "a refused send must never turn a created hub into an error");
  assert.equal(j.emailed, false);
  assert.deepEqual(j.emailFailed, [TENANT.email], "names exactly who still needs a link");
  assert.ok(tokenFrom(j.invites[0].url), "and the link is still on screen to copy");

  // And it works: the hub the failed email pointed at really opens.
  const open = await fetch(srv.base + "/api/hub/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: j.id, token: tokenFrom(j.invites[0].url) }),
  });
  assert.equal(open.status, 200);
  assertNoUnparsed(db);
});

// A hub is a broker surface that travels with the vault, so the door is
// canUseVault — not a plan name, and not merely "signed in".
test("the door is the vault entitlement, not an account", async (t) => {
  const { srv, stop } = await bootWithDb();
  t.after(stop);

  const anon = await fetch(srv.base + "/api/hubs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "x" }),
  });
  assert.equal(anon.status, 401);

  const noVault = await fetch(srv.base + "/api/hubs", asUser(TENANT, {
    method: "POST",
    body: JSON.stringify({ title: "x" }),
  }));
  assert.equal(noVault.status, 403, "an account is not a vault");
});
