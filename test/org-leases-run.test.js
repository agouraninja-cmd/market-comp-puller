// The firm's leases, actually written and read (Three Spaces, slice 6;
// migration 047), against the stand-in PostgREST. What is proved here and
// nowhere else: the notice-after-expiry refusal against a REAL server (the
// plan's named verify), that a lease needs a building on THIS firm's board,
// that edits and deletes are scoped by the firm, that the sheet carries the
// building's leases, that /buildings' boot carries the critical-dates strip
// computed with renewal-watch's own arithmetic — and that nothing in any of
// it mails anyone.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const NOBODY = { id: "u-out", email: "nobody@else.com", name: "Nobody" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-000000000001";
const OTHER_ORG = "9c1e9a1e-0000-4000-8000-000000000002";
const B1 = "9c1e9a1e-0000-4000-8000-0000000000b1";
const B_OTHER = "9c1e9a1e-0000-4000-8000-0000000000b9";
const ymd = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);

function tables() {
  const member = (u, org, role) => ({ id: crypto.randomUUID(), org_id: org, email: u.email, user_id: u.id, role,
    invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null });
  return {
    users: [BRAD, NOBODY].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [BRAD, NOBODY].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    orgs: [{ id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" },
           { id: OTHER_ORG, name: "Elsewhere LLC", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [member(BRAD, ORG_ID, "owner"), member(NOBODY, OTHER_ORG, "owner")],
    org_buildings: [
      { id: B1, org_id: ORG_ID, address: "1210 N 17th St, Boise, ID", address_key: "1210 n 17th st boise id", verified_key: null,
        market: "Boise, ID", property_type: "Industrial", size_sqft: 12500, year_built: 1994, lat: null, lng: null,
        added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: "2026-01-01T00:00:00Z" },
      { id: B_OTHER, org_id: OTHER_ORG, address: "1 Elsewhere Rd, Boise, ID", address_key: "1 elsewhere rd boise id", verified_key: null,
        market: "Boise, ID", property_type: "", size_sqft: null, year_built: null, lat: null, lng: null,
        added_by_user_id: NOBODY.id, added_by_name: "Nobody", created_at: NOW, updated_at: NOW },
    ],
    org_leases: [], org_comps: [], broker_comps: [], broker_properties: [], portfolio_items: [], shared_reports: [],
    org_contacts: [], org_building_notes: [], analytics_events: [],
  };
}
const as = (user, init = {}) => ({ ...init, headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}`, ...(init.headers || {}) } });

test("the firm's leases, end to end", async (t) => {
  const tbl = tables();
  const db = await fake.start({ tables: tbl });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    // Belt and braces: even if something tried to mail, there is nowhere for
    // it to go, and `sent` below proves nothing was posted anyway.
    RESEND_API_URL: db.resendUrl, RESEND_API_KEY: "test", EMAIL_FROM: "CompNinja <t@example.com>" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const url = (org, extra) => `${srv.base}/api/org/leases?id=${encodeURIComponent(org)}${extra || ""}`;
  let leaseId = null;

  await t.test("an option notice after the expiry is refused by name against the real server", async () => {
    const r = await fetch(url(ORG_ID, `&building=${B1}`), as(BRAD, { method: "POST",
      body: JSON.stringify({ tenant: "Acme Logistics", leaseExpiry: ymd(200), optionNoticeDate: ymd(260) }) }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /after the lease expiry .* look swapped/);
    assert.equal(tbl.org_leases.length, 0, "nothing written");
  });

  await t.test("a rent with no basis is refused, never guessed", async () => {
    const r = await fetch(url(ORG_ID, `&building=${B1}`), as(BRAD, { method: "POST",
      body: JSON.stringify({ tenant: "Acme Logistics", leaseExpiry: ymd(200), rentPsf: "1.35" }) }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /not guessed/);
  });

  await t.test("a lease is filed on a building of this firm, attributed, and counts as activity", async () => {
    const before = tbl.org_buildings.find((b) => b.id === B1).updated_at;
    const r = await fetch(url(ORG_ID, `&building=${B1}`), as(BRAD, { method: "POST",
      body: JSON.stringify({ tenant: "Acme Logistics", suite: "200", sizeSqft: "12,500", termStart: "2022-07-01",
        leaseExpiry: ymd(200), optionNoticeDate: ymd(110), rentPsf: "18.50", rentBasis: "annual", leaseType: "NNN" }) }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    leaseId = body.lease.id;
    assert.equal(body.lease.tenant, "Acme Logistics");
    assert.equal(body.lease.rentPsf, 18.5);
    assert.equal(body.lease.mine, true);
    const row = tbl.org_leases[0];
    assert.equal(row.org_id, ORG_ID);
    assert.equal(row.building_id, B1);
    assert.equal(row.added_by_name, "Brad");
    assert.equal(row.renewal_notified_at, undefined, "ships unwritten — nothing in this slice claims to have mailed");
    assert.notEqual(tbl.org_buildings.find((b) => b.id === B1).updated_at, before, "a lease moves the building up the desk");
  });

  await t.test("a lease cannot be filed on another firm's building, and an outsider cannot file one here", async () => {
    const wrongBoard = await fetch(url(ORG_ID, `&building=${B_OTHER}`), as(BRAD, { method: "POST",
      body: JSON.stringify({ tenant: "X", leaseExpiry: ymd(100) }) }));
    assert.equal(wrongBoard.status, 404);
    const outsider = await fetch(url(ORG_ID, `&building=${B1}`), as(NOBODY, { method: "POST",
      body: JSON.stringify({ tenant: "X", leaseExpiry: ymd(100) }) }));
    assert.equal(outsider.status, 403);
    assert.equal((await fetch(url(ORG_ID))).status, 401);
    assert.equal(tbl.org_leases.length, 1);
  });

  await t.test("the sheet carries the building's leases, and the list carries the critical dates", async () => {
    const sheet = await (await fetch(`${srv.base}/api/org/buildings/sheet?id=${ORG_ID}&building=${B1}`, as(BRAD))).json();
    assert.equal(sheet.leases.length, 1);
    assert.equal(sheet.leases[0].tenant, "Acme Logistics");
    assert.equal(sheet.leases[0].optionNoticeDate, ymd(110));

    const list = await (await fetch(url(ORG_ID), as(BRAD))).json();
    assert.equal(list.leases.length, 1);
    assert.equal(list.critical.length, 1, "the notice is inside the twelve-month window");
    assert.equal(list.critical[0].kind, "notice", "the earlier of notice and expiry");
    assert.equal(list.critical[0].days, 110);
    assert.equal(list.critical[0].address, "1210 N 17th St, Boise, ID");

    const page = await (await fetch(`${srv.base}/buildings`, as(BRAD))).text();
    assert.match(page, /"critical":\[\{/, "the /buildings boot carries the strip");
    assert.match(page, /"kind":"notice"/);
  });

  await t.test("an edit is validated as the whole row, and moving the expiry before the notice is the transposition again", async () => {
    const bad = await fetch(url(ORG_ID, `&lease=${leaseId}`), as(BRAD, { method: "PATCH", body: JSON.stringify({ leaseExpiry: ymd(50) }) }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /look swapped/);
    const ok = await fetch(url(ORG_ID, `&lease=${leaseId}`), as(BRAD, { method: "PATCH", body: JSON.stringify({ status: "renewed" }) }));
    const body = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.equal(body.lease.status, "renewed");
    assert.equal(tbl.org_leases[0].tenant, "Acme Logistics", "untouched fields kept");
    const elsewhere = await fetch(url(OTHER_ORG, `&lease=${leaseId}`), as(NOBODY, { method: "PATCH", body: JSON.stringify({ status: "vacated" }) }));
    assert.equal(elsewhere.status, 404, "scoped by the firm as well as the id");
    assert.equal(tbl.org_leases[0].status, "renewed");
  });

  await t.test("a vacated lease drops out of the critical dates, and a delete is scoped by the firm", async () => {
    await fetch(url(ORG_ID, `&lease=${leaseId}`), as(BRAD, { method: "PATCH", body: JSON.stringify({ status: "vacated" }) }));
    const list = await (await fetch(url(ORG_ID), as(BRAD))).json();
    assert.equal(list.critical.length, 0, "nothing left to act on");
    const wrongFirm = await fetch(url(OTHER_ORG, `&lease=${leaseId}`), as(NOBODY, { method: "DELETE" }));
    assert.equal(wrongFirm.status, 404);
    assert.equal(tbl.org_leases.length, 1);
    const r = await fetch(url(ORG_ID, `&lease=${leaseId}`), as(BRAD, { method: "DELETE" }));
    assert.equal(r.status, 200);
    assert.equal(tbl.org_leases.length, 0);
  });

  await t.test("nothing in this slice mails anyone, and the fake refused nothing", async () => {
    const sent = await fake.waitForMail(db, 0);
    assert.deepEqual(sent, [], "renewal-watch is display-only here; sending is the owner's decision");
    assert.deepEqual(db.unparsed, []);
  });
});
