// /bov, the BOV builder, against a real server and the stand-in database
// (2026-11-27). What only a running server can prove: the page is behind the
// comps' own gate (signed in, Pro, a database), it boots with the member's
// OWN comps and nobody else's, each account gets its own draft tag, and the
// two scripts it runs are served as JavaScript.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PEOPLE = [
  { id: "u-pro", email: "pro@summit.example", name: "Pro Member" },
  { id: "u-two", email: "two@other.example", name: "Second Member" },
  { id: "u-free", email: "free@solo.example", name: "Free Member" },
];

test("/bov boots with the member's own comps behind the comps' gate, and serves its scripts", async (t) => {
  const tables = {
    users: PEOPLE.map((p) => ({ ...p, email_verified: true, pro_tester: false, vault_beta: false, digest_optout: false, created_at: "2025-01-01T00:00:00Z" })),
    sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
    subscriptions: PEOPLE.filter((p) => p.id !== "u-free").map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [], org_members: [], org_subscriptions: [], analytics_events: [],
    broker_comps: [], broker_uploads: [], broker_properties: [], broker_profiles: [], broker_bovs: [],
    branding_profiles: [], comp_submissions: [], broker_csv_mappings: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const as = (id, init = {}) => ({ ...init, headers: { "content-type": "application/json", cookie: `cn_session=tok-${id}` } });
  const csv = (street) => [
    "address,property_type,transaction,deal_date,size_sqft,price",
    `"${street}, Boise, ID 83704",Industrial,sale,2026-08-14,42000,3696000`,
  ].join("\n");
  for (const [id, street] of [["u-pro", "8120 W Fairview Ave"], ["u-two", "77 Secret Way"]]) {
    const r = await fetch(srv.base + "/api/vault/upload", as(id, { method: "POST", body: JSON.stringify({ filename: "book.csv", csv: csv(street) }) }));
    assert.equal(r.status, 200, await r.text());
  }
  const page = async (id) => {
    const r = await fetch(srv.base + "/bov", id ? as(id) : {});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    return r.text();
  };
  const bootOf = (html) => {
    const m = /<script>window\.__BOV_BOOT__=(.*?);<\/script>/.exec(html);
    return m ? JSON.parse(m[1]) : null;
  };

  // A Pro member: the form, their own comp, their own tag.
  const pro = await page("u-pro");
  const boot = bootOf(pro);
  assert.ok(boot, "a Pro member's page shipped no boot");
  assert.deepEqual(boot.j.comps.map((c) => c.address), ["8120 W Fairview Ave, Boise, ID 83704"]);
  assert.equal(boot.j.comps[0].price_per_sqft, 88);
  assert.match(boot.tag, /^[0-9a-f]{16}$/);
  assert.ok(!pro.includes("77 Secret Way"), "another member's comp is in this member's page");
  assert.ok(!pro.includes("u-pro") && !pro.includes("pro@summit.example"), "the page names the account");
  assert.match(pro, /<title>BOV builder · CompNinja<\/title>/);
  assert.match(pro, /<script src="\/bov-doc\.js"><\/script>\s*<script src="\/bov-builder\.js"><\/script>/);

  // Another member: their own comp, and a different tag, so two people on
  // one browser never read each other's drafts.
  const two = bootOf(await page("u-two"));
  assert.deepEqual(two.j.comps.map((c) => c.address), ["77 Secret Way, Boise, ID 83704"]);
  assert.notEqual(two.tag, boot.tag);
  assert.equal(bootOf(await page("u-pro")).tag, boot.tag, "one account's tag changed between visits");

  // The comps' own gate, said as walls: no form, no comps, no script.
  const free = await page("u-free");
  assert.match(free, /The BOV builder is part of Pro\./);
  const anon = await page(null);
  assert.match(anon, /Please <a href="\/desk">sign in<\/a> to write a BOV\./);
  for (const html of [free, anon]) {
    assert.equal(bootOf(html), null);
    assert.ok(!html.includes('id="bbApp"') && !html.includes("/bov-builder.js"));
    assert.ok(!html.includes("Fairview") && !html.includes("Secret Way"), "a refused page carries a comp");
  }

  // The page with a tag on its address is still the page (rule 14).
  const tagged = await fetch(srv.base + "/bov?from=75fecf88-d150-44d8-bc61-3946177cbb3a", as("u-pro"));
  assert.equal(tagged.status, 200);
  assert.ok(bootOf(await tagged.text()));

  // Both scripts: JavaScript, never cached (the page and its scripts must
  // never be a deploy apart), and nosniff would refuse anything else.
  for (const f of ["/bov-doc.js", "/bov-builder.js"]) {
    const r = await fetch(srv.base + f);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get("content-type"), /^text\/javascript/, f);
    assert.match(r.headers.get("cache-control") || "", /max-age=0|no-cache|no-store/, f + " is cached");
    assert.ok((await r.text()).length > 2000, f);
  }

  // Opening the page wrote nothing but its visit: no BOV row, no profile.
  assert.equal(tables.broker_bovs.length, 0);
  assert.equal(tables.broker_profiles.length, 0);
  assert.ok(tables.analytics_events.some((e) => e.kind === "bov_visit" || e.event === "bov_visit" || JSON.stringify(e).includes("bov_visit")), "the visit was not logged");
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});

// Saved BOVs (2026-11-27; migration 067). A broker keeps a BOV on their
// account: their own row, behind the comps' gate, holding what cleanDraft
// allows and nothing else.
const seed = () => ({
  users: PEOPLE.map((p) => ({ ...p, email_verified: true, pro_tester: false, vault_beta: false, digest_optout: false, created_at: "2025-01-01T00:00:00Z" })),
  sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
  subscriptions: PEOPLE.filter((p) => p.id !== "u-free").map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
  orgs: [], org_members: [], org_subscriptions: [], analytics_events: [], broker_bov_docs: [],
});
const DRAFT = () => ({
  from: "75fecf88-d150-44d8-bc61-3946177cbb3a", sneaky: "x",
  subject: { address: "8400 W Fairview Ave, Boise, ID 83704", type: "Industrial", size: "45,000", evil: 1 },
  client: { name: "The Owner LLC" }, value: { low: "3,800,000", high: "4,200,000", list: "" }, income: { noi: "262,000", cap: "6.5" },
  photo: "https://elsewhere.example/x.jpg",
});

test("a BOV is saved to its broker's own account, opened, updated and removed, and nobody else can reach it", async (t) => {
  const tables = seed();
  const db = await fake.start({ tables });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const call = async (id, method, url, body) => {
    const r = await fetch(srv.base + url, { method, headers: { "content-type": "application/json", ...(id ? { cookie: `cn_session=tok-${id}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { s: r.status, j: await r.json() };
  };
  const API = "/api/broker/bov-docs";

  // The gate, in the comps' order: signed in, then Pro.
  assert.equal((await call(null, "GET", API)).s, 401);
  assert.equal((await call(null, "POST", API, { draft: DRAFT() })).s, 401);
  const free = await call("u-free", "POST", API, { draft: DRAFT() });
  assert.equal(free.s, 403);
  assert.match(free.j.error, /part of Pro/);
  assert.equal(tables.broker_bov_docs.length, 0, "a refused save stored a row");

  // Nothing saved yet.
  assert.deepEqual((await call("u-pro", "GET", API)).j, { docs: [] });
  // A BOV with no address is not one.
  assert.equal((await call("u-pro", "POST", API, { draft: { subject: { address: "  " } } })).s, 400);

  const saved = await call("u-pro", "POST", API, { draft: DRAFT() });
  assert.equal(saved.s, 200, JSON.stringify(saved.j));
  assert.match(saved.j.id, /^[0-9a-f-]{36}$/);
  const row = tables.broker_bov_docs[0];
  assert.equal(row.user_id, "u-pro");
  assert.equal(row.bov_id, "75fecf88-d150-44d8-bc61-3946177cbb3a");
  assert.equal(row.address, "8400 W Fairview Ave, Boise, ID 83704");
  // What is stored is cleanDraft's answer, never the body as sent.
  assert.equal(row.draft.sneaky, undefined);
  assert.equal(row.draft.subject.evil, undefined);
  assert.equal(row.draft.photo, "", "a cover photo from another site was stored");
  assert.equal(row.draft.income.noi, "262,000");

  // The list names it without its contents; opening it returns the draft.
  const list = await call("u-pro", "GET", API);
  assert.deepEqual(Object.keys(list.j.docs[0]).sort(), ["address", "bov_id", "id", "property_type", "updated_at"]);
  const got = await call("u-pro", "GET", API + "?id=" + saved.j.id);
  assert.equal(got.s, 200);
  assert.equal(got.j.doc.draft.client.name, "The Owner LLC");
  assert.equal(got.j.doc.user_id, undefined, "the account's id is in the answer");

  // Another member sees none of it and can neither open, change nor remove it.
  assert.deepEqual((await call("u-two", "GET", API)).j, { docs: [] });
  assert.equal((await call("u-two", "GET", API + "?id=" + saved.j.id)).s, 404);
  const theirs = DRAFT(); theirs.client.name = "Changed by a stranger";
  assert.equal((await call("u-two", "POST", API, { id: saved.j.id, draft: theirs })).s, 404);
  assert.equal((await call("u-two", "DELETE", API + "?id=" + saved.j.id)).s, 200, "a delete is no existence oracle");
  assert.equal(tables.broker_bov_docs.length, 1, "another member removed it");
  assert.equal(tables.broker_bov_docs[0].draft.client.name, "The Owner LLC", "another member changed it");

  // Saving again with its id updates the one row.
  const next = DRAFT(); next.value.list = "4,050,000";
  const again = await call("u-pro", "POST", API, { id: saved.j.id, draft: next });
  assert.equal(again.s, 200);
  assert.equal(again.j.id, saved.j.id);
  assert.equal(tables.broker_bov_docs.length, 1);
  assert.equal(tables.broker_bov_docs[0].draft.value.list, "4,050,000");

  // Malformed ids are refused before the database is asked.
  assert.equal((await call("u-pro", "GET", API + "?id=nope")).s, 400);
  assert.equal((await call("u-pro", "POST", API, { id: "nope", draft: DRAFT() })).s, 400);
  assert.equal((await call("u-pro", "DELETE", API)).s, 400);

  // Removed, and then saving with the old id says it is gone.
  assert.equal((await call("u-pro", "DELETE", API + "?id=" + saved.j.id)).s, 200);
  assert.equal(tables.broker_bov_docs.length, 0);
  const gone = await call("u-pro", "POST", API, { id: saved.j.id, draft: DRAFT() });
  assert.equal(gone.s, 404);
  assert.equal(gone.j.code, "gone");
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});

test("before migration 067 runs, saving answers not_ready and the builder page still opens", async (t) => {
  const tables = seed();
  delete tables.broker_bov_docs;
  Object.assign(tables, { broker_comps: [], broker_uploads: [], broker_properties: [], broker_profiles: [], branding_profiles: [], comp_submissions: [] });
  const db = await fake.start({ tables, missingTables: ["broker_bov_docs"] });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const headers = { "content-type": "application/json", cookie: "cn_session=tok-u-pro" };
  for (const [method, url, body] of [["GET", "/api/broker/bov-docs"], ["POST", "/api/broker/bov-docs", { draft: DRAFT() }]]) {
    const r = await fetch(srv.base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    assert.equal(r.status, 503, method);
    assert.equal((await r.json()).code, "not_ready", method);
  }
  const page = await (await fetch(srv.base + "/bov", { headers })).text();
  assert.ok(page.includes('id="bbApp"'), "the builder did not open without the table");
});
