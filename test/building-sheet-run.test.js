// The building sheet, actually served and actually written to (Three Spaces,
// slice 5; migration 046). Against the stand-in PostgREST, because every read
// here is DB-only.
//
// The case the plan made a condition of shipping: TWO accounts in one firm,
// each with a private vault comp on the same building, one of them shared.
// Account A's sheet must show A's own comps and only B's SHARED comp — B's
// unshared vault comp must be absent, and B's portfolio snapshot must never
// appear in A's valuations. Then the notes and the identity edit, the
// author-only note delete, the 404 for a building on another firm's board,
// and the shelf projection's fallback.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const MIKE = { id: "u-mike", email: "mike@colliers.com", name: "Mike" };
const NOBODY = { id: "u-out", email: "nobody@else.com", name: "Nobody" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-000000000001";
const OTHER_ORG = "9c1e9a1e-0000-4000-8000-000000000002";
const ADDRESS = "1210 N 17th St, Boise, ID";
const KEY = VAULT.addressKey(ADDRESS);
const B1 = "9c1e9a1e-0000-4000-8000-0000000000b1";
const B_OTHER = "9c1e9a1e-0000-4000-8000-0000000000b9";

const member = (u, org, role) => ({ id: crypto.randomUUID(), org_id: org, email: u.email, user_id: u.id, role,
  invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null });
const comp = (user, over) => ({
  id: crypto.randomUUID(), user_id: user.id, upload_id: null, property_id: null,
  address: ADDRESS, address_key: KEY, market: "Boise, ID", property_type: "Industrial", transaction: "sale",
  deal_date: "2026-01-09", price: 1250000, size_sqft: 12500, price_per_sqft: 100, published: false,
  dedupe_key: KEY + "|2026-01-09|1250000", ...over,
});

function tables() {
  const bradComp = comp(BRAD, { deal_date: "2025-11-20", price: 1100000, dedupe_key: KEY + "|2025-11-20|1100000" });
  const mikeShared = comp(MIKE, {});
  const mikePrivate = comp(MIKE, { deal_date: "2024-06-01", price: 990000, dedupe_key: KEY + "|2024-06-01|990000" });
  return {
    users: [BRAD, MIKE, NOBODY].map((u) => ({ ...u, pro_tester: false, vault_beta: true })),
    sessions: [BRAD, MIKE, NOBODY].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [BRAD, MIKE].map((u) => ({ user_id: u.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [{ id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" },
           { id: OTHER_ORG, name: "Elsewhere LLC", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [member(BRAD, ORG_ID, "owner"), member(MIKE, ORG_ID, "member"), member(NOBODY, OTHER_ORG, "owner")],
    org_buildings: [
      { id: B1, org_id: ORG_ID, address: ADDRESS, address_key: KEY, verified_key: "1210 n 17th st boise id 83702",
        market: "Boise, ID", property_type: "Industrial", size_sqft: 12500, year_built: 1994, lat: null, lng: null,
        added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: NOW },
      { id: B_OTHER, org_id: OTHER_ORG, address: "1 Elsewhere Rd, Boise, ID", address_key: VAULT.addressKey("1 Elsewhere Rd, Boise, ID"),
        verified_key: null, market: "Boise, ID", property_type: "", size_sqft: null, year_built: null, lat: null, lng: null,
        added_by_user_id: NOBODY.id, added_by_name: "Nobody", created_at: NOW, updated_at: NOW },
    ],
    broker_comps: [bradComp, mikeShared, mikePrivate],
    broker_properties: [],
    org_comps: [{ id: crypto.randomUUID(), org_id: ORG_ID, shared_by_user_id: MIKE.id, shared_by_name: "Mike",
      source_comp_id: mikeShared.id, market: "Boise, ID", property_type: "Industrial", deal_date: "2026-01-09",
      comp: { address: ADDRESS, transaction: "sale", price_or_rate: 1250000, size_sqft: 12500, price_per_sqft: 100 }, updated_at: NOW }],
    portfolio_items: [
      { id: crypto.randomUUID(), user_id: BRAD.id, address: ADDRESS, property_type: "Industrial", verified_key: "1210 n 17th st boise id 83702",
        snapshots: [{ ts: "2026-03-01T00:00:00Z", low: 1100000, likely: 1250000, high: 1400000 }], created_at: NOW, updated_at: NOW },
      { id: crypto.randomUUID(), user_id: MIKE.id, address: ADDRESS, property_type: "Industrial", verified_key: "1210 n 17th st boise id 83702",
        snapshots: [{ ts: "2026-05-01T00:00:00Z", low: 8000000, likely: 9000000, high: 9900000 }], created_at: NOW, updated_at: NOW },
    ],
    shared_reports: [{ id: "9c1e9a1e-0000-4000-8000-0000000000e1", user_id: MIKE.id, org_id: ORG_ID, visibility: "org", revoked_at: null,
      created_at: "2026-02-01T00:00:00Z", shared_by_name: "Mike",
      payload: { meta: { address: "1210 N. 17th St, Boise, ID", type: "Industrial", subject: { sizeMin: 12500 } },
        data: { comps: [
          { address: "1 A St, Boise, ID", transaction: "sale", price: 1200000, size_sqft: 12000, price_per_sqft: 100, date: "2026-01-01", source_type: "public_record" },
          { address: "2 B St, Boise, ID", transaction: "sale", price: 1300000, size_sqft: 13000, price_per_sqft: 100, date: "2026-01-02", source_type: "public_record" },
          { address: "3 C St, Boise, ID", transaction: "sale", price: 1100000, size_sqft: 11000, price_per_sqft: 100, date: "2026-01-03", source_type: "listing" },
        ] } } }],
    org_contacts: [{ id: crypto.randomUUID(), org_id: ORG_ID, name: "Dana Wu", email: null, company: "Acme", notes: null,
      building_id: B1, added_by_user_id: MIKE.id, added_by_name: "Mike", created_at: NOW }],
    org_building_notes: [],
    analytics_events: [],
  };
}
const as = (user, init = {}) => ({ ...init, headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}`, ...(init.headers || {}) } });

test("the building sheet, end to end", async (t) => {
  const tbl = tables();
  const db = await fake.start({ tables: tbl });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const api = (org, extra) => `${srv.base}/api/org/buildings/sheet?id=${encodeURIComponent(org)}&building=${extra || B1}`;

  await t.test("account A sees its own comps, B's SHARED comp, and never B's private one or B's portfolio", async () => {
    const r = await fetch(api(ORG_ID), as(BRAD));
    const text = await r.text();
    assert.equal(r.status, 200, text);
    const s = JSON.parse(text);
    assert.equal(s.org.name, "Colliers Boise");
    assert.equal(s.building.address, ADDRESS);
    assert.deepEqual(s.mineComps.map((c) => c.price), [1100000], "A's own vault comp, and only A's");
    assert.deepEqual(s.firmComps.map((c) => [c.price, c.sharedBy]), [[1250000, "Mike"]], "B's shared comp, attributed");
    assert.equal(text.includes("990000"), false, "B's UNSHARED vault comp is absent from A's sheet");
    assert.equal(text.includes("9000000"), false, "B's portfolio snapshot is absent from A's valuations");
    assert.deepEqual(s.valuations.map((v) => v.source), ["yours", "report"], "A's own snapshot, then the value of B's shared report");
    assert.equal(s.valuations[0].likely, 1250000);
    assert.ok(s.valuations[1].likely > 0, "the shared report was priced with valuation.js");
    assert.equal(s.valuations[1].sharedBy, "Mike");
    assert.deepEqual(s.reports.map((x) => x.url), ["/r/9c1e9a1e-0000-4000-8000-0000000000e1"]);
    assert.equal(s.contacts[0].name, "Dana Wu");
    assert.deepEqual(s.notes, []);
  });

  await t.test("account B's sheet is the mirror: its own two comps, nothing of A's private book", async () => {
    const s = await (await fetch(api(ORG_ID), as(MIKE))).json();
    assert.deepEqual(s.mineComps.map((c) => c.price).sort((a, b) => a - b), [990000, 1250000]);
    assert.equal(s.mineComps.find((c) => c.price === 1250000).shared, true, "B's shared comp carries the toggle state");
    assert.deepEqual(s.firmComps, [], "B's own shared comp is not listed twice under the firm; A shared nothing");
    assert.equal(JSON.stringify(s).includes("1100000"), false, "A's private comp is absent from B's sheet");
    assert.equal(s.valuations[0].likely, 9000000, "B's own snapshot");
  });

  await t.test("a building on another firm's board is a 404, never a leak", async () => {
    assert.equal((await fetch(api(ORG_ID, B_OTHER), as(BRAD))).status, 404);
    assert.equal((await fetch(api(OTHER_ORG, B1), as(NOBODY))).status, 404, "scoped by the firm as well as the id");
    assert.equal((await fetch(api(ORG_ID), as(NOBODY))).status, 403, "an outsider is not a member of this firm");
    assert.equal((await fetch(api(ORG_ID))).status, 401);
  });

  await t.test("the page serves the same sheet, no-store and noindex, in every state", async () => {
    const r = await fetch(`${srv.base}/building/${B1}`, as(BRAD));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    const html = await r.text();
    assert.match(html, /"s":200/);
    assert.match(html, /<title>1210 N 17th St, Boise, ID/);
    assert.equal(html.includes("990000"), false, "the page's boot carries no private comp of B's either");
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    assert.doesNotMatch(nav, /Run a report/, "/building is a page a member works in");
    assert.match(await (await fetch(`${srv.base}/building/${B_OTHER}`, as(BRAD))).text(), /"s":404/);
    assert.match(await (await fetch(`${srv.base}/building/${B1}`, as(NOBODY))).text(), /"s":404/, "a member of ANOTHER firm gets the 404, never the sheet");
    assert.match(await (await fetch(`${srv.base}/building/${B1}`)).text(), /"s":401/);
    assert.match(await (await fetch(`${srv.base}/building/${B1}?fbclid=x`, as(BRAD))).text(), /"s":200/, "pagePath, never req.url");
  });

  await t.test("notes: appended and attributed, deleted only by their author, and they count as activity", async () => {
    const before = tbl.org_buildings.find((b) => b.id === B1).updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const add = await fetch(`${srv.base}/api/org/buildings/notes?id=${ORG_ID}&building=${B1}`, as(MIKE, {
      method: "POST", body: JSON.stringify({ body: "  Owner says he'll consider offers after Q3  " }) }));
    const body = await add.json();
    assert.equal(add.status, 200, JSON.stringify(body));
    assert.equal(body.note.body, "Owner says he'll consider offers after Q3");
    assert.equal(tbl.org_building_notes.length, 1);
    assert.equal(tbl.org_building_notes[0].added_by_name, "Mike");
    assert.equal(tbl.org_building_notes[0].org_id, ORG_ID);
    assert.notEqual(tbl.org_buildings.find((b) => b.id === B1).updated_at, before, "a note moves the building up the desk");

    const empty = await fetch(`${srv.base}/api/org/buildings/notes?id=${ORG_ID}&building=${B1}`, as(MIKE, { method: "POST", body: JSON.stringify({ body: "   " }) }));
    assert.equal(empty.status, 400);

    const s = await (await fetch(api(ORG_ID), as(BRAD))).json();
    assert.equal(s.notes[0].addedBy, "Mike");
    assert.equal(s.notes[0].mine, false);

    const noteId = tbl.org_building_notes[0].id;
    const notMine = await fetch(`${srv.base}/api/org/buildings/notes?id=${ORG_ID}&building=${B1}&note=${noteId}`, as(BRAD, { method: "DELETE" }));
    assert.equal(notMine.status, 404, "only the author may remove a note");
    assert.equal(tbl.org_building_notes.length, 1);
    const mine = await fetch(`${srv.base}/api/org/buildings/notes?id=${ORG_ID}&building=${B1}&note=${noteId}`, as(MIKE, { method: "DELETE" }));
    assert.equal(mine.status, 200);
    assert.equal(tbl.org_building_notes.length, 0);
  });

  await t.test("the identity edit changes the three fields, never the address, and refuses what an add refuses", async () => {
    const r = await fetch(`${srv.base}/api/org/buildings?id=${ORG_ID}&building=${B1}`, as(BRAD, {
      method: "PATCH", body: JSON.stringify({ sizeSqft: "14,000 SF", propertyType: "retail" }) }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.building.sizeSqft, 14000);
    assert.equal(body.building.type, "Retail");
    const row = tbl.org_buildings.find((b) => b.id === B1);
    assert.equal(row.size_sqft, 14000);
    assert.equal(row.year_built, 1994, "an untouched field keeps its value");
    assert.equal(row.address, ADDRESS);
    const bad = await fetch(`${srv.base}/api/org/buildings?id=${ORG_ID}&building=${B1}`, as(BRAD, { method: "PATCH", body: JSON.stringify({ address: "2 Moved St, Boise, ID" }) }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /address is the building's identity/);
    const elsewhere = await fetch(`${srv.base}/api/org/buildings?id=${OTHER_ORG}&building=${B1}`, as(NOBODY, { method: "PATCH", body: JSON.stringify({ sizeSqft: "1" }) }));
    assert.equal(elsewhere.status, 404, "scoped by the firm");
    assert.equal(tbl.org_buildings.find((b) => b.id === B1).size_sqft, 14000);
  });

  await t.test("the fake refused nothing — the shelf's meta projection is a shape it accepts", () => {
    assert.deepEqual(db.unparsed, []);
  });
});

test("the shelf's meta projection falls back to whole payloads when PostgREST refuses it", async (t) => {
  // The stand-in cannot model a projection PostgREST rejects, so the
  // fallback is proved by making the projected read fail outright: a
  // shared_reports table the fake answers 404 for... would fail both paths.
  // Instead, prove the fail-open SHAPE by inspection — the try/catch around
  // the projected read and the orgShelfRows call inside the catch — the
  // precedent cachedAddressKeys sets and the plan asked for.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const fn = src.match(/async function orgShelfMetaRows\([\s\S]*?\n\}\n/);
  assert.ok(fn, "orgShelfMetaRows is gone");
  assert.match(fn[0], /meta:payload->meta/, "the projection is what keeps a sheet open from costing a thousand payloads");
  assert.match(fn[0], /catch \(err\) \{[\s\S]*orgShelfRows\(orgId\)/, "and a refused projection falls back to the full read, never to an empty sheet");
  t.diagnostic("the projection itself still needs one curl against the live PostgREST before merging — see the plan");
});
