// The firm branding profile (migration 041), actually running against the
// stand-in PostgREST: who may save the firm's letterhead, who reads it, and —
// the part that reaches other people — that a share by a member with no
// profile of their own snapshots the FIRM's mark, while their own profile
// always wins. Same harness as org-run.test.js, for the same reason: the firm
// feature has no file fallback, so without a database these routes can only
// prove their refusals.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// Brad owns the firm and pays (canBrand); Mike is a free colleague.
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const MIKE = { id: "u-mike", email: "mike@colliers.com", name: "Mike" };
const OUTSIDER = { id: "u-out", email: "nobody@else.com", name: "Nobody" };

function seedTables() {
  return {
    users: [BRAD, MIKE, OUTSIDER].map((u) => ({
      ...u, pro_tester: false, vault_beta: false, digest_optout: false,
    })),
    sessions: [BRAD, MIKE, OUTSIDER].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    subscriptions: [{
      user_id: BRAD.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    orgs: [], org_members: [], org_branding: [], branding_profiles: [],
    shared_reports: [], report_viewers: [], org_contacts: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

const as = (user, init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_session=tok-${user.id}`,
    ...(init.headers || {}),
  },
});

const REPORT = {
  data: { comps: [{ address: "100 Main St", price: 1000000 }] },
  meta: { address: "500 Warehouse Way, Boise, ID", type: "Industrial" },
};

test("the firm branding profile, end to end", async (t) => {
  const tables = seedTables();
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  t.after(async () => { srv.stop(); await db.stop(); });

  let orgId = null;

  await t.test("setup: Brad creates the firm and invites Mike, who accepts", async () => {
    const r = await fetch(srv.base + "/api/org",
      as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }));
    assert.equal(r.status, 200);
    orgId = (await r.json()).id;
    const inv = await fetch(srv.base + "/api/org/invite",
      as(BRAD, { method: "POST", body: JSON.stringify({ orgId, emails: [MIKE.email] }) }));
    assert.equal(inv.status, 200);
    // Before accepting, the fallback must not exist for Mike — an invitation
    // is not a membership, and branding follows membership.
    await fetch(srv.base + "/api/org/branding",
      as(BRAD, { method: "PUT", body: JSON.stringify({ orgId, firmName: "Colliers Boise", licenseNumber: "FB-99" }) }));
    const before = await (await fetch(srv.base + "/api/branding", as(MIKE))).json();
    assert.equal(before.firm, null, "an unaccepted invite carries no firm brand");
    const acc = await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId }) }));
    assert.equal(acc.status, 200);
  });

  await t.test("saving the firm profile is owner/admin only", async () => {
    const r = await fetch(srv.base + "/api/org/branding",
      as(MIKE, { method: "PUT", body: JSON.stringify({ orgId, firmName: "Mike's Rewrite" }) }));
    assert.equal(r.status, 403);
    const out = await fetch(srv.base + "/api/org/branding",
      as(OUTSIDER, { method: "PUT", body: JSON.stringify({ orgId, firmName: "Stranger Co" }) }));
    assert.equal(out.status, 403, "a non-member is refused before the role is even asked");
    assert.equal(tables.org_branding.length, 1, "and nothing was written by either");
    assert.equal(tables.org_branding[0].firm_name, "Colliers Boise");
  });

  await t.test("validation is branding.js's own — rejects, never truncates", async () => {
    const r = await fetch(srv.base + "/api/org/branding",
      as(BRAD, { method: "PUT", body: JSON.stringify({ orgId, firmName: "x".repeat(200) }) }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /firm/i);
    assert.equal(tables.org_branding[0].firm_name, "Colliers Boise", "the stored row is untouched");
  });

  await t.test("any active member reads it; an outsider cannot", async () => {
    const r = await fetch(srv.base + `/api/org/branding?id=${orgId}`, as(MIKE));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).branding.firmName, "Colliers Boise");
    const out = await fetch(srv.base + `/api/org/branding?id=${orgId}`, as(OUTSIDER));
    assert.equal(out.status, 403);
  });

  await t.test("GET /api/branding carries the firm fallback for a member, and null outside one", async () => {
    const mine = await (await fetch(srv.base + "/api/branding", as(MIKE))).json();
    assert.deepEqual(mine.branding, {}, "his OWN profile is still empty — the two never merge");
    assert.equal(mine.firm.firmName, "Colliers Boise");
    const out = await (await fetch(srv.base + "/api/branding", as(OUTSIDER))).json();
    assert.equal(out.firm, null);
  });

  await t.test("a share by a member with no profile of their own snapshots the FIRM's mark", async () => {
    const r = await fetch(srv.base + "/api/share",
      as(BRAD, { method: "POST", body: JSON.stringify(REPORT) }));
    assert.equal(r.status, 200);
    const { id } = await r.json();
    const view = await (await fetch(srv.base + "/api/shared?id=" + id)).json();
    assert.equal(view.meta.branding.firmName, "Colliers Boise");
    assert.equal(view.meta.branding.licenseNumber, "FB-99");
  });

  await t.test("the member's own profile beats the firm's — fallback, never override", async () => {
    const save = await fetch(srv.base + "/api/branding",
      as(BRAD, { method: "PUT", body: JSON.stringify({ firmName: "Brad's Own Shop" }) }));
    assert.equal(save.status, 200);
    const r = await fetch(srv.base + "/api/share",
      as(BRAD, { method: "POST", body: JSON.stringify(REPORT) }));
    const { id } = await r.json();
    const view = await (await fetch(srv.base + "/api/shared?id=" + id)).json();
    assert.equal(view.meta.branding.firmName, "Brad's Own Shop");
  });

  await t.test("a free colleague's share carries no brand, firm profile or not", async () => {
    // canBrand still gates applying — a firm profile is not an entitlement.
    const r = await fetch(srv.base + "/api/share",
      as(MIKE, { method: "POST", body: JSON.stringify(REPORT) }));
    assert.equal(r.status, 200);
    const { id } = await r.json();
    const view = await (await fetch(srv.base + "/api/shared?id=" + id)).json();
    assert.equal(view.meta.branding, undefined);
  });

  await t.test("deleting the firm profile is owner/admin only, and then the fallback is gone", async () => {
    const no = await fetch(srv.base + `/api/org/branding?id=${orgId}`,
      as(MIKE, { method: "DELETE" }));
    assert.equal(no.status, 403);
    assert.equal(tables.org_branding.length, 1);
    const yes = await fetch(srv.base + `/api/org/branding?id=${orgId}`,
      as(BRAD, { method: "DELETE" }));
    assert.equal(yes.status, 200);
    assert.equal(tables.org_branding.length, 0);
    const mine = await (await fetch(srv.base + "/api/branding", as(MIKE))).json();
    assert.equal(mine.firm, null);
  });

  await t.test("every firm-branding route refuses the signed-out", async () => {
    for (const [method, path] of [
      ["GET", `/api/org/branding?id=${orgId}`],
      ["PUT", "/api/org/branding"],
      ["DELETE", `/api/org/branding?id=${orgId}`],
    ]) {
      const r = await fetch(srv.base + path, {
        method, headers: { "content-type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ orgId }) : undefined,
      });
      assert.equal(r.status, 401, `${method} ${path}`);
    }
  });
});
