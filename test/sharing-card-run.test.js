// What the Sharing card on Home reads (2026-10-06; Draft C of the sharing
// drafts), driven through a real server.js against the stand-in database.
//
// The card's "Sent to you" names who sent each report and each deal room, and
// turns its count red for a report not yet opened. Until this change both
// rows said only "With you": GET /api/shares never said who shared a report,
// and GET /api/hubs never said whose room it was. Three rules, proved here:
//
//   1. A sender is a DISPLAY NAME and nothing more. The sharer's user id and
//      the room owner's id stay on the server, the rule the shelf already
//      follows for its "shared by" line.
//   2. viewedAt is THIS member's own first view, and null when they have not
//      opened it — the one signal that turns the tab red.
//   3. Your own shares carry their firm's id, so the page can list a share on
//      the shelf it shows once (there) and not twice.
//
// The stand-in database does not resolve PostgREST's embedded rows (the
// `shared_reports(...)` and `hubs(...)` in a select), so the rows below carry
// them pre-joined, in the shape the real database returns them. Everything
// else (the email filters, the revoked-share filter, the users read) runs
// through the route as written.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const AGO = (d) => new Date(Date.now() - d * 864e5).toISOString();

const BRAD = { id: "u-brad", email: "brad@foothillcre.com", name: "Brad Keller" };
const ERIN = { id: "u-erin", email: "erin@basinpartners.com", name: "" };
const JORDAN = { id: "u-jordan", email: "jordan@acmelogistics.com", name: "Jordan Lee" };
const PEOPLE = [BRAD, ERIN, JORDAN];

const payload = (address, type) => ({ data: { comps: [] }, meta: { address, type } });

function seedTables() {
  const shares = [
    { id: "share-17th", user_id: BRAD.id, visibility: "invited", org_id: null, include_private: false,
      revoked_at: null, created_at: AGO(4), payload: payload("1210 N 17th St, Boise, ID", "Industrial") },
    { id: "share-overland", user_id: ERIN.id, visibility: "invited", org_id: null, include_private: false,
      revoked_at: null, created_at: AGO(3), payload: payload("9 Overland Rd, Boise, ID", "Industrial") },
    { id: "share-dead", user_id: BRAD.id, visibility: "invited", org_id: null, include_private: false,
      revoked_at: AGO(1), created_at: AGO(9), payload: payload("6200 W Emerald St, Boise, ID", "Office") },
    { id: "share-shelf", user_id: BRAD.id, visibility: "org", org_id: "org-foothill", include_private: false,
      revoked_at: null, created_at: AGO(2), payload: payload("500 Warehouse Way, Boise, ID", "Industrial") },
  ];
  const viewers = [
    { share_id: "share-17th", email: JORDAN.email, invited_at: AGO(4), first_viewed_at: AGO(3), last_viewed_at: AGO(3) },
    { share_id: "share-overland", email: JORDAN.email, invited_at: AGO(3), first_viewed_at: null, last_viewed_at: null },
    { share_id: "share-dead", email: JORDAN.email, invited_at: AGO(9), first_viewed_at: null, last_viewed_at: null },
  ];
  const strip = (row, key) => { const c = { ...row }; delete c[key]; return c; };
  // Pre-joined both ways, as copies (the stand-in serializes rows).
  for (const v of viewers) v.shared_reports = strip(shares.find((s) => s.id === v.share_id), "report_viewers");
  for (const s of shares) s.report_viewers = viewers.filter((v) => v.share_id === s.id).map((v) => strip(v, "shared_reports"));

  const hub = { id: "hub-17th", owner_user_id: BRAD.id, title: "1210 N 17th St, Boise, ID", market: "Boise, ID",
    property_type: "Industrial", subject_address: "1210 N 17th St, Boise, ID", status: "open",
    created_at: AGO(2), updated_at: AGO(1), closed_at: null };
  return {
    users: PEOPLE.map((u) => ({ ...u, pro_tester: false, vault_beta: false, digest_optout: false })),
    sessions: PEOPLE.map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    shared_reports: shares,
    report_viewers: viewers,
    orgs: [{ id: "org-foothill", name: "Foothill Commercial" }],
    hubs: [hub],
    hub_participants: [{ id: "hp-1", hub_id: hub.id, email: JORDAN.email, role: "tenant", token_hash: "x",
      invited_at: AGO(2), first_viewed_at: null, last_seen_at: null, removed_at: null, hubs: { ...hub } }],
    analytics_events: [], subscriptions: [], report_purchases: [], export_usage: [],
  };
}

const asUser = (user) => ({ headers: { cookie: `cn_session=tok-${user.id}` } });

test("Sent to you is told who sent each report and room, and nothing more", async (t) => {
  const db = await fake.start({ tables: seedTables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  await t.test("a report shared with you names its sender, and says whether you opened it", async () => {
    const res = await fetch(srv.base + "/api/shares", asUser(JORDAN));
    assert.equal(res.status, 200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    const byId = Object.fromEntries(body.sharedWithMe.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(byId).sort(), ["share-17th", "share-overland"], "a turned-off link is not listed");
    assert.equal(byId["share-17th"].from, "Brad Keller");
    assert.ok(byId["share-17th"].viewedAt, "opened, so it carries when");
    assert.equal(byId["share-overland"].viewedAt, null, "not opened yet is null, the signal for the red count");
    assert.equal(byId["share-overland"].from, "erin", "no name on the account: the address's local part, never the whole address");
    assert.ok(!raw.includes(BRAD.id) && !raw.includes(ERIN.id), "a sharer's user id left the server");
    assert.ok(!raw.includes(ERIN.email), "a sharer's full address left the server");
  });

  await t.test("a deal room you were invited into names the broker who opened it", async () => {
    const res = await fetch(srv.base + "/api/hubs", asUser(JORDAN));
    assert.equal(res.status, 200);
    const raw = await res.text();
    const body = JSON.parse(raw);
    assert.equal(body.theirs.length, 1);
    assert.equal(body.theirs[0].from, "Brad Keller");
    assert.equal(body.theirs[0].lastSeenAt, null);
    assert.ok(!raw.includes("owner_user_id") && !raw.includes(BRAD.id), "the room owner's id left the server");
  });

  await t.test("your own shares carry their firm's id, so the shelf can list a firm share once", async () => {
    const res = await fetch(srv.base + "/api/shares", asUser(BRAD));
    assert.equal(res.status, 200);
    const body = await res.json();
    const byId = Object.fromEntries(body.mine.map((r) => [r.id, r]));
    assert.equal(byId["share-shelf"].orgId, "org-foothill");
    assert.equal(byId["share-shelf"].firm, "Foothill Commercial");
    assert.equal(byId["share-17th"].orgId, "", "not a firm share");
  });

  assert.deepEqual(db.unparsed || [], [], "the stand-in refused a filter server.js really sends");
});
