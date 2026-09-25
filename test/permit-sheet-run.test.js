// Permit signals, slices 3 and 4, actually served (spec §2, §4, §7, §8).
// Against the stand-in PostgREST, because every read here is DB-only.
//
// The case the spec made a condition of slice 3: TWO firms with the same
// building on their boards. Both see the filing on that building (filings
// are public record, §5); neither can open the other's building, and the
// /buildings strip of one never names the other's board. Then the honesty
// rules — a building outside the swept cities gets NO Permits section, not
// an empty one — and the Workspace's Your permits (2026-09-24, which replaced
// slice 4's development-shop feed): every firm, whatever its kind, gets the
// filings at its OWN buildings and nobody else's; a firm with no building in
// a swept city gets `permits: null`; and an outsider gets nothing.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");
const PF = require("../permit-filings");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const dayAgo = (n) => daysAgo(n).slice(0, 10);

const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const DANA = { id: "u-dana", email: "dana@buildco.com", name: "Dana" };
const OUT = { id: "u-out", email: "out@nowhere.com", name: "Out" };
const CARL = { id: "u-carl", email: "carl@texasfirm.com", name: "Carl" };
const BROKER_ORG = "7a1e9a1e-0000-4000-8000-000000000001";
const DEV_ORG = "7a1e9a1e-0000-4000-8000-000000000002";
const DALLAS_ORG = "7a1e9a1e-0000-4000-8000-000000000003";
const ADDRESS = "8000 S Federal Way, Boise, ID 83716";
const B_BROKER = "7a1e9a1e-0000-4000-8000-0000000000b1";
const B_DEV = "7a1e9a1e-0000-4000-8000-0000000000b2";
const B_DALLAS = "7a1e9a1e-0000-4000-8000-0000000000b3";
const B_TEXAS = "7a1e9a1e-0000-4000-8000-0000000000b4";
const F_HIT = "7a1e9a1e-0000-4000-8000-0000000000f1";

const member = (u, org) => ({ id: crypto.randomUUID(), org_id: org, email: u.email, user_id: u.id, role: "owner",
  invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null });
const building = (id, org, address, market, by) => ({ id, org_id: org, address, address_key: VAULT.addressKey(address),
  verified_key: null, market, property_type: "Industrial", size_sqft: null, year_built: null, lat: null, lng: null,
  added_by_user_id: by.id, added_by_name: by.name, created_at: NOW, updated_at: NOW });
const filing = (over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: "BLD" + crypto.randomUUID().slice(0, 6).toUpperCase(),
  permit_type: "Tenant Improvement", description: "Warehouse racking", project_name: null,
  address: "123 W SOMEWHERE ST", street_key: VAULT.addressKey("123 W SOMEWHERE ST"), market: "Boise, ID",
  parcel_number: null, zoning: "I-1", is_industrial: true, applicant_company: "Acme Dev LLC", contractor_company: null,
  applied_date: dayAgo(3), status: "In Review", status_changed_at: null,
  source_url: "https://aca-prod.accela.com/BOISE/Cap/CapDetail.aspx?x=1",
  first_seen_at: daysAgo(3), last_seen_at: NOW, ...over,
});

function tables() {
  return {
    users: [BRAD, DANA, OUT, CARL].map((u) => ({ ...u, pro_tester: false, vault_beta: true })),
    sessions: [BRAD, DANA, OUT, CARL].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [BRAD, DANA, CARL].map((u) => ({ user_id: u.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [{ id: BROKER_ORG, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" },
           { id: DEV_ORG, name: "BuildCo", share_default: "none", seats: 5, kind: "development" },
           { id: DALLAS_ORG, name: "Texas Only", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [member(BRAD, BROKER_ORG), member(DANA, DEV_ORG), member(CARL, DALLAS_ORG)],
    org_buildings: [
      building(B_BROKER, BROKER_ORG, ADDRESS, "Boise, ID", BRAD),
      building(B_DALLAS, BROKER_ORG, "100 Main St, Dallas, TX 75201", "Dallas, TX", BRAD),
      building(B_DEV, DEV_ORG, "8000 S. Federal Way, Boise, ID", "Boise, ID", DANA),
      // A firm whose whole board is outside the swept cities.
      building(B_TEXAS, DALLAS_ORG, "200 Elm St, Dallas, TX 75201", "Dallas, TX", CARL),
    ],
    permit_filings: [
      // On the Federal Way building: the portal prints the bare street line.
      filing({ id: F_HIT, permit_number: "BLD26-01234", address: "8000 S FEDERAL WAY",
        street_key: PF.streetKey("8000 S FEDERAL WAY", VAULT.addressKey), applied_date: dayAgo(9),
        status: "Prep for Issuance", status_changed_at: daysAgo(2), applicant_company: "Federal Way Partners" }),
      // Same street line in MERIDIAN: must never land on a Boise building.
      filing({ jurisdiction: "meridian", market: "Meridian, ID", address: "8000 S FEDERAL WAY",
        street_key: PF.streetKey("8000 S FEDERAL WAY", VAULT.addressKey), permit_number: "MER-SAME-STREET",
        applied_date: dayAgo(5), applicant_company: "Meridian Twin LLC" }),
      filing({ permit_number: "BLD-OLD", applied_date: dayAgo(60), applicant_company: "Too Old Co" }),
      filing({ permit_number: "BLD-OFFICE", is_industrial: false, zoning: "C-2", applied_date: dayAgo(1), applicant_company: "Office Only Inc" }),
    ],
    permit_filing_events: [
      { id: crypto.randomUUID(), filing_id: F_HIT, old_status: "In Review", new_status: "Prep for Issuance", detected_at: daysAgo(2) },
    ],
    org_comps: [], broker_comps: [], broker_properties: [], portfolio_items: [], shared_reports: [],
    org_contacts: [], org_building_notes: [], org_leases: [], analytics_events: [],
  };
}
const as = (user) => ({ headers: { "content-type": "application/json", cookie: `cn_session=tok-${user.id}` } });
async function getJson(url, user) {
  const r = await fetch(url, as(user));
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: r.status, text, j };
}

test("permit signals on the building sheet, the buildings strip and the Workspace's Your permits", async (t) => {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const sheet = (org, b) => `${srv.base}/api/org/buildings/sheet?id=${org}&building=${b}`;

  await t.test("both firms see the filing on their own copy of the building, with its status history", async () => {
    for (const [user, org, b] of [[BRAD, BROKER_ORG, B_BROKER], [DANA, DEV_ORG, B_DEV]]) {
      const r = await getJson(sheet(org, b), user);
      assert.equal(r.status, 200, r.text);
      const p = r.j.permits;
      assert.ok(p && Array.isArray(p.filings), "a Boise building carries a Permits section");
      assert.deepEqual(p.filings.map((f) => f.permitNumber), ["BLD26-01234"],
        "the Federal Way filing, and not the Meridian one on the same street line");
      assert.equal(p.filings[0].applicant, "Federal Way Partners");
      assert.equal(p.filings[0].city, "Boise");
      assert.deepEqual(p.filings[0].history.map((h) => [h.from, h.to]), [["In Review", "Prep for Issuance"]]);
      assert.equal(p.stale, false, "a sweep that touched the table today is not stale");
      assert.equal(p.never, false);
    }
  });

  await t.test("neither firm can open the other's building", async () => {
    assert.equal((await getJson(sheet(BROKER_ORG, B_DEV), BRAD)).status, 404);
    assert.equal((await getJson(sheet(DEV_ORG, B_BROKER), BRAD)).status, 403, "and not the other firm's gate either");
  });

  await t.test("a building outside the swept cities gets NO Permits section, not an empty one", async () => {
    const r = await getJson(sheet(BROKER_ORG, B_DALLAS), BRAD);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.j.permits, null);
  });

  await t.test("the /buildings strip names the firm's own buildings only", async () => {
    const r = await fetch(`${srv.base}/buildings`, as(BRAD));
    const html = await r.text();
    assert.equal(r.status, 200);
    const boot = JSON.parse(html.match(/var BOOT = (.*);\n/)[1]);
    assert.equal(boot.s, 200);
    assert.deepEqual(boot.j.permits.map((p) => [p.permitNumber, p.buildingId, p.kind]),
      [["BLD26-01234", B_BROKER, "status"]], "the status move two days ago is the row, on this firm's building");
    assert.equal(html.includes(B_DEV), false, "the other firm's building is never named");
    assert.ok(html.includes('id="blPermits"'), "the strip is on the page");
  });

  await t.test("Your permits: every firm, whatever its kind, gets the filings at its OWN buildings", async () => {
    for (const [user, org, b, other] of [[BRAD, BROKER_ORG, B_BROKER, B_DEV], [DANA, DEV_ORG, B_DEV, B_BROKER]]) {
      const r = await getJson(`${srv.base}/api/org/permits?id=${org}`, user);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.j.cities, "Boise and Meridian", "Nampa is switched off, so it is not named as lit");
      assert.equal(r.j.windowDays, PF.ACTIVITY_WINDOW_DAYS);
      assert.equal(r.j.buildings, 1, "the board in a swept city — Brad's Dallas building is not counted as looked at");
      assert.deepEqual(r.j.permits.map((p) => [p.permitNumber, p.buildingId, p.kind, p.status]),
        [["BLD26-01234", b, "status", "Prep for Issuance"]],
        "the Federal Way filing on this firm's copy of the building, as its status move two days ago");
      assert.equal(r.j.permits[0].applicant, "Federal Way Partners");
      assert.equal(r.j.stale, false);
      // Not the Meridian filing on the same street line, not a filing at an
      // address nobody's board holds, and not the other firm's building.
      for (const absent of ["MER-SAME-STREET", "Meridian Twin LLC", "BLD-OFFICE", "Office Only Inc", "Too Old Co", other]) {
        assert.equal(r.text.includes(absent), false, `${absent} must not appear`);
      }
      assert.equal("feed" in r.j, false, "the market-wide feed is gone from this route");
    }
  });

  await t.test("a board with no building in a swept city gets permits: null, and an outsider gets nothing", async () => {
    const r = await getJson(`${srv.base}/api/org/permits?id=${DALLAS_ORG}`, CARL);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.j.permits, null, "no section — an empty one would claim we looked");
    assert.equal(r.j.buildings, 0);
    assert.equal(r.j.cities, "Boise and Meridian");
    const out = await getJson(`${srv.base}/api/org/permits?id=${DEV_ORG}`, OUT);
    assert.ok(out.status === 403 || out.status === 404, `an outsider is refused (${out.status})`);
    assert.equal(out.text.includes("BLD26-01234"), false);
    const cross = await getJson(`${srv.base}/api/org/permits?id=${DEV_ORG}`, BRAD);
    assert.ok(cross.status === 403 || cross.status === 404, `another firm's member is refused (${cross.status})`);
    assert.equal(cross.text.includes(B_DEV), false);
  });
});

test("an unswept table reads as 'not checked yet', never as a quiet fortnight", async (t) => {
  const tbl = tables();
  tbl.permit_filings = [];
  tbl.permit_filing_events = [];
  const db = await fake.start({ tables: tbl });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const r = await getJson(`${srv.base}/api/org/buildings/sheet?id=${BROKER_ORG}&building=${B_BROKER}`, BRAD);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.j.permits.filings, []);
  assert.equal(r.j.permits.never, true);
  assert.equal(r.j.permits.stale, true);
  const f = await getJson(`${srv.base}/api/org/permits?id=${DEV_ORG}`, DANA);
  assert.equal(f.status, 200, f.text);
  assert.equal(f.j.never, true);
  assert.deepEqual(f.j.permits, [], "a swept board with nothing in the table is an empty list, said with 'not checked yet'");
});
