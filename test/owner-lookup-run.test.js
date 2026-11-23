// test/owner-lookup-run.test.js
// A member's own contacts and the owner lookup, actually run: a real
// server.js against the stand-in PostgREST and a stand-in search provider.
//
// owner-lookup.test.js proves what of an answer is believed. This proves who
// may ask, what it costs them, and whose it is, which only a boot can:
//   - contacts are no longer a firm's alone: any signed-in account keeps a
//     list of its own, and nobody else can read, edit or delete a row of it;
//   - the lookup is part of Pro, runs one billed search per press, stores the
//     answer on the account that asked, and never reads it for another;
//   - reopening a building is free, a failed search costs nothing, and the
//     month's allowance and the day's cap both refuse before any search;
//   - reading the page (GET) runs no search and writes nothing;
//   - an unrun migration 066 costs these two features and nothing else.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const DAY = 86400000;
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const ADDRESS = "1450 S Eagle Rd, Meridian, ID 83642";

const FOUND = {
  owner: { name: "EAGLE ROAD HOLDINGS LLC", kind: "company", mailing_address: "PO Box 100, Boise, ID 83701",
    record_source: "Ada County Assessor", record_url: "https://adacounty.test/parcel/R123" },
  entity: { state: "Idaho", status: "Active", registered_agent: "Summit Registered Agents Inc",
    filing_url: "https://sos.test/business/456" },
  people: [
    // Shown on its own page: both details check out.
    { name: "Dana Wu", role: "Manager of the owning LLC", company: "Eagle Road Holdings LLC",
      phone: "208-555-2142", email: "dana@eagleroad.test", source_url: "https://eagleroad.test/contact" },
    // The page exists and does not show this number: built, not copied.
    { name: "Lee Park", role: "Asset manager", company: "Eagle Road Holdings LLC",
      phone: "208-555-2177", email: "", source_url: "https://eagleroad.test/team" },
    // The page cannot be read at all.
    { name: "", role: "Property manager", company: "Ridgeline Management",
      phone: "208-555-2199", email: "", source_url: "https://ridgeline.test/gone" },
    // Read off a people-search site: never offered.
    { name: "Dana Wu", phone: "208-555-2888", source_url: "https://www.spokeo.com/Dana-Wu" },
  ],
  note: "The county lists the LLC; its manager is named on the state filing.",
};
const PAGES = {
  "eagleroad.test/contact": "<h1>Contact</h1><p>Dana Wu, Manager. (208) 555-2142 · <a href='mailto:dana@eagleroad.test'>Email</a></p>",
  "eagleroad.test/team": "<p>Lee Park, Asset manager. Reach the office on 208.555.2000.</p>",
};

function baseTables() {
  const session = (id, user) => ({ id, user_id: user, token_hash: hash("tok-" + user),
    expires_at: new Date(Date.now() + 30 * DAY).toISOString() });
  return {
    users: [
      { id: "u-maya", email: "maya@ridgeline.example", name: "Maya", vault_beta: true },
      { id: "u-sam", email: "sam@other.example", name: "Sam", vault_beta: true },
      { id: "u-free", email: "jo@free.example", name: "Jo", vault_beta: false },
    ],
    sessions: [session("s1", "u-maya"), session("s2", "u-sam"), session("s3", "u-free")],
    user_contacts: [], owner_lookups: [], org_contacts: [],
  };
}

// Answers as Anthropic does (the suite boots SEARCH_PROVIDER=anthropic, the
// BOV desk run test's choice): one text block holding the JSON.
async function startProvider() {
  const calls = [];
  const state = { answer: FOUND, status: 200 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) { /* recorded as empty */ }
      calls.push({ prompt: JSON.stringify(sent.messages || ""), url: req.url });
      res.writeHead(state.status, { "content-type": "application/json" });
      if (state.status !== 200) return res.end(JSON.stringify({ error: { message: "nope" } }));
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 400 },
        content: [{ type: "text", text: typeof state.answer === "string" ? state.answer : JSON.stringify(state.answer) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls, state,
    stop: () => new Promise((r) => server.close(r)) };
}
async function startPages() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(req.url.slice(1));
    hits.push(key);
    if (PAGES[key] == null) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body>${PAGES[key]}</body></html>`);
  });
  await new Promise((r) => server.listen(0, r));
  return { origin: `http://localhost:${server.address().port}`, hits, stop: () => new Promise((r) => server.close(r)) };
}

async function bootWith(t, { env = {}, fakeOpts = {}, tables = baseTables() } = {}) {
  const db = await fake.start({ tables, ...fakeOpts });
  const provider = await startProvider();
  const site = await startPages();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off", SEARCH_API_URL: provider.url,
    BOV_PAGE_ORIGIN: site.origin, LOGO_IMPORT_ALLOW_PRIVATE: "on",
    ...env,
  });
  t.after(async () => { srv.stop(); await provider.stop(); await site.stop(); await db.stop(); });
  return { tables, db, provider, site, srv };
}

const as = (user, init = {}) => ({
  ...init,
  headers: { "content-type": "application/json", cookie: `cn_session=tok-${user}`, ...(init.headers || {}) },
});
const post = (srv, path, user, body) => fetch(srv.base + path, as(user, { method: "POST", body: JSON.stringify(body) }));
const lookup = async (srv, user, body) => {
  const r = await post(srv, "/api/owner-lookup", user, body);
  return { status: r.status, body: await r.json() };
};

// ---------------------------------------------------------------------------
test("a member's own contacts", async (t) => {
  const { tables, db, srv } = await bootWith(t);
  let id = "";

  await t.test("signed out is refused; a free account in no firm keeps a list", async () => {
    assert.equal((await fetch(srv.base + "/api/account/contacts")).status, 401);
    const add = await post(srv, "/api/account/contacts", "u-free", {
      name: "Dana Wu", email: "Dana@EagleRoad.test", phone: "(208) 555-2142", company: "Eagle Road Holdings LLC" });
    assert.equal(add.status, 200);
    assert.equal((await add.json()).imported, 1);
    const row = tables.user_contacts[0];
    assert.equal(row.user_id, "u-free");
    assert.equal(row.email, "dana@eagleroad.test", "stored lowercased");
    assert.equal(row.phone, "(208) 555-2142");
    const list = await (await fetch(srv.base + "/api/account/contacts", as("u-free"))).json();
    assert.equal(list.contacts.length, 1);
    assert.deepEqual(list.fields, { phone: true });
    assert.equal(list.contacts[0].mine, true);
    id = list.contacts[0].id;
  });

  await t.test("the same email twice is one contact, and a bad phone is refused", async () => {
    const again = await (await post(srv, "/api/account/contacts", "u-free", { name: "Dana W.", email: "dana@eagleroad.test" })).json();
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 1);
    const bad = await post(srv, "/api/account/contacts", "u-free", { name: "No Number", phone: "soon" });
    assert.equal(bad.status, 400);
    assert.equal(tables.user_contacts.length, 1);
  });

  await t.test("nobody else can read, edit or delete it", async () => {
    const theirs = await (await fetch(srv.base + "/api/account/contacts", as("u-maya"))).json();
    assert.deepEqual(theirs.contacts, [], "another member read a private contact");
    const url = `/api/account/contacts?contact=${encodeURIComponent(id)}`;
    const edit = await fetch(srv.base + url, as("u-maya", { method: "PATCH", body: JSON.stringify({ name: "Taken" }) }));
    assert.equal(edit.status, 404);
    const del = await fetch(srv.base + url, as("u-maya", { method: "DELETE" }));
    assert.equal(del.status, 404);
    assert.equal(tables.user_contacts[0].name, "Dana Wu");
  });

  await t.test("its owner edits it, imports a sheet, and removes it", async () => {
    const url = `/api/account/contacts?contact=${encodeURIComponent(id)}`;
    const edit = await fetch(srv.base + url, as("u-free", { method: "PATCH", body: JSON.stringify({ phone: "208-555-2143" }) }));
    assert.equal(edit.status, 200);
    assert.equal(tables.user_contacts[0].phone, "208-555-2143");
    const csv = await (await post(srv, "/api/account/contacts", "u-free",
      { csv: "Name,Cell,Company\nSam Ito,208-555-2177,Ito Properties\nNo Phone,,Nowhere LLC\n" })).json();
    assert.equal(csv.imported, 2);
    assert.equal(tables.user_contacts.every((c) => c.user_id === "u-free"), true);
    const del = await fetch(srv.base + url, as("u-free", { method: "DELETE" }));
    assert.equal(del.status, 200);
    assert.equal(tables.user_contacts.some((c) => c.id === id), false);
    assert.deepEqual(db.unparsed, [], JSON.stringify(db.unparsed));
  });
});

// ---------------------------------------------------------------------------
test("the owner lookup, end to end", async (t) => {
  const { tables, db, provider, site, srv } = await bootWith(t);

  await t.test("the gate refuses in order: no session, then no Pro, and no search runs", async () => {
    assert.equal((await fetch(srv.base + "/api/owner-lookup")).status, 401);
    const anon = await fetch(srv.base + "/api/owner-lookup", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: ADDRESS }) });
    assert.equal(anon.status, 401);
    const free = await lookup(srv, "u-free", { address: ADDRESS });
    assert.equal(free.status, 403);
    assert.match(free.body.error, /part of Pro/);
    assert.equal(provider.calls.length, 0);
  });

  await t.test("opening the page reads the allowance and searches nothing", async () => {
    const r = await (await fetch(srv.base + "/api/owner-lookup", as("u-maya"))).json();
    assert.deepEqual(r.allowance, { used: 0, perMonth: 100, left: 100 });
    assert.deepEqual(r.recent, []);
    assert.match(r.useNote, /Do Not Call Registry/);
    assert.equal(provider.calls.length, 0, "a GET ran a billed search");
    assert.equal(tables.owner_lookups.length, 0, "a GET wrote a row");
  });

  await t.test("an address that cannot be looked up is refused before any search", async () => {
    for (const body of [{ address: "" }, { address: "Eagle Rd, Meridian, ID" }, { address: ADDRESS, type: "Residential" }]) {
      const r = await lookup(srv, "u-maya", body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(provider.calls.length, 0);
  });

  await t.test("one press is one search, and the answer is stored on the account that asked", async () => {
    const r = await lookup(srv, "u-maya", { address: ADDRESS, type: "Industrial" });
    assert.equal(r.status, 200);
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0].prompt, /1450 S Eagle Rd, Meridian, ID 83642/);
    assert.match(provider.calls[0].prompt, /NEVER use, cite or copy from a people-search/);
    assert.equal(r.body.cached, false);
    assert.equal(r.body.found, true);
    assert.equal(r.body.result.owner.name, "EAGLE ROAD HOLDINGS LLC");
    assert.deepEqual(r.body.allowance, { used: 1, perMonth: 100, left: 99 });
    assert.match(r.body.useNote, /Not for tenant screening/);

    const people = r.body.result.people;
    assert.equal(people.length, 3, "the person read off a people-search site is not offered");
    assert.equal(JSON.stringify(r.body).includes("spokeo"), false);
    const by = Object.fromEntries(people.map((p) => [p.name || p.company, p]));
    assert.deepEqual([by["Dana Wu"].phone_check, by["Dana Wu"].email_check], ["on_page", "on_page"],
      "the page was read and shows both");
    assert.equal(by["Lee Park"].phone_check, "not_on_page", "the page was read and does not show that number");
    assert.equal(by["Ridgeline Management"].phone_check, "unchecked", "a page that cannot be read is never a pass");
    assert.ok(site.hits.includes("eagleroad.test/contact"));
    assert.equal(site.hits.some((h) => /spokeo/.test(h)), false, "a people-search site is not even fetched");

    assert.equal(tables.owner_lookups.length, 1);
    const row = tables.owner_lookups[0];
    assert.equal(row.user_id, "u-maya");
    assert.equal(row.address, ADDRESS);
    assert.equal(row.found, true);
    assert.equal(row.result.people.length, 3);
  });

  await t.test("the same building again is free, however it is typed", async () => {
    const r = await lookup(srv, "u-maya", { address: "1450 s. eagle rd., meridian id 83642" });
    assert.equal(r.status, 200);
    assert.equal(r.body.cached, true);
    assert.equal(r.body.result.owner.name, "EAGLE ROAD HOLDINGS LLC");
    assert.deepEqual(r.body.allowance, { used: 1, perMonth: 100, left: 99 }, "nothing more was used");
    assert.equal(provider.calls.length, 1, "no second search");
    assert.equal(tables.owner_lookups.length, 1);
    const list = await (await fetch(srv.base + "/api/owner-lookup", as("u-maya"))).json();
    assert.equal(list.recent.length, 1);
    assert.equal(list.recent[0].owner, "EAGLE ROAD HOLDINGS LLC");
    assert.equal("result" in list.recent[0], false, "the history is a door, never the answer");
  });

  await t.test("another member's lookup of that building is their own search, never Maya's answer", async () => {
    const before = provider.calls.length;
    const mine = await (await fetch(srv.base + "/api/owner-lookup", as("u-sam"))).json();
    assert.deepEqual(mine.recent, [], "Sam was shown a building Maya is chasing");
    const r = await lookup(srv, "u-sam", { address: ADDRESS });
    assert.equal(r.status, 200);
    assert.equal(r.body.cached, false, "Maya's stored answer was served to Sam");
    assert.equal(provider.calls.length, before + 1);
    assert.deepEqual(r.body.allowance, { used: 1, perMonth: 100, left: 99 });
  });

  await t.test("Look again runs a new search and uses a lookup", async () => {
    const before = provider.calls.length;
    const r = await lookup(srv, "u-maya", { address: ADDRESS, fresh: true });
    assert.equal(r.body.cached, false);
    assert.equal(provider.calls.length, before + 1);
    assert.equal(r.body.allowance.used, 2);
  });

  await t.test("a search that fails, or answers nothing readable, stores nothing and costs nothing", async () => {
    const rows = tables.owner_lookups.length;
    provider.state.status = 500;
    let r = await lookup(srv, "u-maya", { address: "900 W Main St, Boise, ID" });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /did not count against your lookups/);
    provider.state.status = 200;
    provider.state.answer = "I was unable to complete this request.";
    r = await lookup(srv, "u-maya", { address: "900 W Main St, Boise, ID" });
    assert.equal(r.status, 502);
    assert.equal(tables.owner_lookups.length, rows);
    const list = await (await fetch(srv.base + "/api/owner-lookup", as("u-maya"))).json();
    assert.equal(list.allowance.used, 2);
  });

  await t.test("a home is answered as a home, with nothing else kept", async () => {
    provider.state.answer = { residential: true, owner: { name: "Pat Homeowner" },
      people: [{ name: "Pat Homeowner", phone: "208-555-2188", source_url: "https://x.test/p" }] };
    const r = await lookup(srv, "u-maya", { address: "12 Quiet Ct, Boise, ID" });
    assert.equal(r.status, 200);
    assert.equal(r.body.found, false);
    assert.deepEqual(r.body.result, { residential: true, owner: null, entity: null, people: [], note: "" });
    assert.equal(JSON.stringify(tables.owner_lookups).includes("Homeowner"), false, "a homeowner's name was stored");
  });

  await t.test("nothing found is an answer, and it counts: the search ran", async () => {
    provider.state.answer = { owner: { name: "" }, people: [], note: "The county has no record at that address." };
    const before = (await (await fetch(srv.base + "/api/owner-lookup", as("u-maya"))).json()).allowance.used;
    const r = await lookup(srv, "u-maya", { address: "77 Nowhere Rd, Boise, ID" });
    assert.equal(r.status, 200);
    assert.equal(r.body.found, false);
    assert.equal(r.body.result.note, "The county has no record at that address.");
    assert.equal(r.body.allowance.used, before + 1);
  });

  await t.test("a found person becomes a contact only when the member saves them", async () => {
    assert.equal(tables.user_contacts.length, 0, "a lookup wrote a contact on its own");
    assert.equal(tables.org_contacts.length, 0);
    const add = await post(srv, "/api/account/contacts", "u-maya", { name: "Dana Wu", phone: "(208) 555-2142",
      email: "dana@eagleroad.test", company: "Eagle Road Holdings LLC", notes: "Manager of the owning LLC · " + ADDRESS,
      source: "lookup", source_url: "https://eagleroad.test/contact" });
    assert.equal(add.status, 200);
    const list = await (await fetch(srv.base + "/api/account/contacts", as("u-maya"))).json();
    assert.equal(list.contacts[0].source, "lookup");
    assert.equal(list.contacts[0].sourceUrl, "https://eagleroad.test/contact");
  });

  await t.test("the fake understood every filter these routes sent, and no log line carried an address", async () => {
    assert.deepEqual(db.unparsed, [], JSON.stringify(db.unparsed));
  });
});

// ---------------------------------------------------------------------------
test("the allowance and the day's cap refuse before any search", async (t) => {
  await t.test("a month's lookups used up", async (t) => {
    const tables = baseTables();
    const now = new Date().toISOString();
    tables.owner_lookups = [1, 2].map((i) => ({ id: "00000000-0000-4000-8000-00000000000" + i, user_id: "u-maya",
      address: i + " Main St, Boise, ID", address_key: i + " main st boise id", property_type: null, found: false,
      result: {}, created_at: now }));
    const { provider, srv } = await bootWith(t, { tables, env: { OWNER_LOOKUPS_PER_MONTH: "2" } });
    const r = await lookup(srv, "u-maya", { address: ADDRESS });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "allowance_used");
    assert.match(r.body.error, /used all 2 owner lookups for this month/);
    assert.equal(provider.calls.length, 0);
    // A building already looked up this quarter still opens.
    const kept = await lookup(srv, "u-maya", { address: "1 Main St, Boise, ID" });
    assert.equal(kept.status, 200);
    assert.equal(kept.body.cached, true);
    // And another member's month is their own.
    const sam = await lookup(srv, "u-sam", { address: ADDRESS });
    assert.equal(sam.status, 200);
  });

  await t.test("last month's lookups do not count against this one", async (t) => {
    const tables = baseTables();
    tables.owner_lookups = [{ id: "00000000-0000-4000-8000-000000000009", user_id: "u-maya",
      address: "9 Old St, Boise, ID", address_key: "9 old st boise id", property_type: null, found: false,
      result: {}, created_at: new Date(Date.now() - 40 * DAY).toISOString() }];
    const { srv } = await bootWith(t, { tables, env: { OWNER_LOOKUPS_PER_MONTH: "1" } });
    const r = await (await fetch(srv.base + "/api/owner-lookup", as("u-maya"))).json();
    assert.equal(r.allowance.left, 1);
  });

  await t.test("the whole site's day is capped", async (t) => {
    const { provider, srv } = await bootWith(t, { env: { OWNER_DAILY_SEARCHES: "1" } });
    assert.equal((await lookup(srv, "u-maya", { address: ADDRESS })).status, 200);
    const r = await lookup(srv, "u-sam", { address: "900 W Main St, Boise, ID" });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /busy today/);
    assert.equal(provider.calls.length, 1);
  });

  await t.test("OWNER_LOOKUPS_PER_MONTH=0 switches it off", async (t) => {
    const { provider, srv } = await bootWith(t, { env: { OWNER_LOOKUPS_PER_MONTH: "0" } });
    const r = await lookup(srv, "u-maya", { address: ADDRESS });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "off");
    assert.equal(provider.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
test("before migration 066 the two new features wait, and say so", async (t) => {
  const { provider, srv } = await bootWith(t, { fakeOpts: {
    missingColumns: { org_contacts: ["phone", "source", "source_url"] },
    missingTables: ["user_contacts", "owner_lookups"],
  } });
  const own = await fetch(srv.base + "/api/account/contacts", as("u-maya"));
  assert.equal(own.status, 503);
  assert.equal((await own.json()).code, "not_ready");
  const r = await lookup(srv, "u-maya", { address: ADDRESS });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "not_ready");
  assert.equal(provider.calls.length, 0, "a search ran with nowhere to store its answer");
  // And nothing else is touched: the account still reads.
  assert.equal((await fetch(srv.base + "/api/account/me", as("u-maya"))).status, 200);
});
