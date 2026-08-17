// Firms, actually running — the whole slice-1 flow against a stand-in
// PostgREST, from creating a firm to a colleague opening the report.
//
// Why this exists: the firm feature deliberately has NO file fallback (it is
// an access-control surface, 013's and 018's stance), so without a database
// every route answers 503 and org-routes.test.js can only prove the refusals.
// Everything that actually matters here — that an invite grants nothing until
// it is accepted, that a firm share reaches a colleague, that a REMOVED
// colleague stops reading it — is arguable in a comment and only true if it
// executes. This is the same reason test/watchlist-digest-run.test.js exists,
// and it uses the same fake.
//
// Spec: docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// Two colleagues and an outsider. Brad pays; Mike is on the free plan, which
// is the case the entitlement split exists for.
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
    // Brad alone is a paying member, so canUseOrg is true for him and false
    // for the other two.
    subscriptions: [{
      user_id: BRAD.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    orgs: [], org_members: [], shared_reports: [], report_viewers: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

async function bootWithDb(tables) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
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

test("firms, end to end", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv, db } = ctx;
  let orgId = null;
  let shareId = null;

  await t.test("a free account cannot create a firm, and is told it is Pro", async () => {
    const r = await fetch(srv.base + "/api/org",
      as(MIKE, { method: "POST", body: JSON.stringify({ name: "Colliers Boise" }) }));
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.upgrade, true, "the browser branches on the flag, never the prose");
    assert.equal(tables.orgs.length, 0, "and nothing was written");
  });

  await t.test("a Pro member creates a firm and is its owner", async () => {
    const r = await fetch(srv.base + "/api/org",
      as(BRAD, { method: "POST", body: JSON.stringify({ name: "  Colliers   Boise " }) }));
    assert.equal(r.status, 200);
    const body = await r.json();
    orgId = body.id;
    assert.equal(body.name, "Colliers Boise", "the name is collapsed, not stored raw");
    assert.equal(body.role, "owner");
    assert.equal(tables.org_members.length, 1);
    assert.ok(tables.org_members[0].joined_at,
      "the creator is the one member who needs no accept step");
  });

  await t.test("a second firm is refused rather than silently created", async () => {
    const r = await fetch(srv.base + "/api/org",
      as(BRAD, { method: "POST", body: JSON.stringify({ name: "Another Firm" }) }));
    assert.equal(r.status, 409);
    assert.equal(tables.orgs.length, 1);
  });

  await t.test("Brad invites Mike, and the invite is pending — not a membership", async () => {
    const r = await fetch(srv.base + "/api/org/invite", as(BRAD, {
      method: "POST",
      body: JSON.stringify({ orgId, emails: ["  Mike@Colliers.com ", "mike@colliers.com", "junk"] }),
    }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.invited, 1, "deduped and normalized server-side, junk dropped");
    const row = tables.org_members.find((m) => m.email === "mike@colliers.com");
    assert.ok(row, "the row exists");
    assert.equal(row.joined_at, undefined, "but it is an invitation, not a membership");
  });

  await t.test("Brad shares a report with the firm", async () => {
    const r = await fetch(srv.base + "/api/share", as(BRAD, {
      method: "POST",
      body: JSON.stringify({ ...REPORT, visibility: "org", orgId }),
    }));
    assert.equal(r.status, 200);
    const body = await r.json();
    shareId = body.id;
    assert.equal(body.visibility, "org");
    const row = tables.shared_reports.find((s) => s.id === shareId);
    assert.equal(row.visibility, "org");
    assert.equal(row.org_id, orgId, "the firm is recorded on the row, not just in the visibility");
  });

  await t.test("Brad cannot share with a firm he is not in, whatever id he posts", async () => {
    const r = await fetch(srv.base + "/api/share", as(BRAD, {
      method: "POST",
      body: JSON.stringify({ ...REPORT, visibility: "org", orgId: "some-other-firm" }),
    }));
    assert.equal(r.status, 403);
  });

  await t.test("an UNACCEPTED invite reads nothing — the rule that makes email identity safe", async () => {
    // The whole reason accept exists: anyone can type anyone's address into
    // their own firm, so an invitation must grant nothing on its own.
    const r = await fetch(srv.base + "/api/shared?id=" + shareId, as(MIKE));
    assert.equal(r.status, 403);
    const list = await (await fetch(srv.base + "/api/shares", as(MIKE))).json();
    assert.deepEqual(list.sharedWithFirm, [], "and it is not on his desk either");
    assert.deepEqual(list.firms, []);
  });

  await t.test("Mike sees the invitation on his desk and accepts it", async () => {
    const before = await (await fetch(srv.base + "/api/org", as(MIKE))).json();
    assert.equal(before.canCreate, false, "a free account is not offered a firm of its own");
    assert.equal(before.invites.length, 1);
    assert.equal(before.invites[0].name, "Colliers Boise");
    assert.deepEqual(before.orgs, [], "an invitation is not a firm yet");

    const r = await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId }) }));
    assert.equal(r.status, 200);
    const after = await (await fetch(srv.base + "/api/org", as(MIKE))).json();
    assert.equal(after.orgs.length, 1);
    assert.equal(after.orgs[0].canManage, false, "he joined as a member, not an admin");
  });

  await t.test("now the report opens for him, with no plan of his own", async () => {
    const r = await fetch(srv.base + "/api/shared?id=" + shareId, as(MIKE));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.meta.address, REPORT.meta.address);
  });

  await t.test("and it is on his desk, named after the firm", async () => {
    const list = await (await fetch(srv.base + "/api/shares", as(MIKE))).json();
    assert.equal(list.firms.length, 1);
    assert.equal(list.firms[0].name, "Colliers Boise");
    assert.equal(list.sharedWithFirm.length, 1);
    assert.equal(list.sharedWithFirm[0].id, shareId);
    assert.equal(list.sharedWithFirm[0].address, REPORT.meta.address);
  });

  await t.test("Brad's own share is NOT listed back to him as something his firm shared", async () => {
    const list = await (await fetch(srv.base + "/api/shares", as(BRAD))).json();
    assert.deepEqual(list.sharedWithFirm, [], "it is already in `mine`");
    const mine = list.mine.find((s) => s.id === shareId);
    assert.equal(mine.visibility, "org");
    assert.equal(mine.firm, "Colliers Boise",
      "and it must never read as 'Anyone with the link'");
  });

  await t.test("an outsider is refused, and told which kind of audience they missed", async () => {
    const r = await fetch(srv.base + "/api/shared?id=" + shareId, as(OUTSIDER));
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /shared with a firm/);
  });

  await t.test("an anonymous reader is asked to sign in, not told the link is dead", async () => {
    const r = await fetch(srv.base + "/api/shared?id=" + shareId);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).signin_required, true);
  });

  await t.test("a member cannot invite, and cannot see another firm's roster", async () => {
    const bad = await fetch(srv.base + "/api/org/invite", as(MIKE, {
      method: "POST", body: JSON.stringify({ orgId, emails: ["someone@else.com"] }),
    }));
    assert.equal(bad.status, 403);
    const nosy = await fetch(srv.base + "/api/org/members?id=" + orgId, as(OUTSIDER));
    assert.equal(nosy.status, 403);
  });

  await t.test("the roster shows both people to a member of the firm", async () => {
    const r = await fetch(srv.base + "/api/org/members?id=" + orgId, as(MIKE));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.members.length, 2);
    assert.equal(body.canManage, false);
    assert.ok(body.members.find((m) => m.email === MIKE.email).self);
  });

  await t.test("the last owner cannot leave, so a firm is never left unmanageable", async () => {
    const bradRow = tables.org_members.find((m) => m.email === BRAD.email);
    const r = await fetch(
      `${srv.base}/api/org/member?org=${orgId}&id=${bradRow.id}`, as(BRAD, { method: "DELETE" }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /needs an owner/);
  });

  await t.test("removing Mike takes the report away again, immediately", async () => {
    const mikeRow = tables.org_members.find((m) => m.email === MIKE.email);
    const r = await fetch(
      `${srv.base}/api/org/member?org=${orgId}&id=${mikeRow.id}`, as(BRAD, { method: "DELETE" }));
    assert.equal(r.status, 200);
    assert.ok(mikeRow.removed_at, "stamped, not deleted — the row is the record");

    // The ACL is never cached: getShareRecord re-reads it every call, and
    // activeOrgIds is computed per request. A removal that only took effect
    // on the next deploy would be the same bug 018's rule exists to prevent.
    const read = await fetch(srv.base + "/api/shared?id=" + shareId, as(MIKE));
    assert.equal(read.status, 403);
    const list = await (await fetch(srv.base + "/api/shares", as(MIKE))).json();
    assert.deepEqual(list.sharedWithFirm, []);
  });

  await t.test("the fake never had to guess at a filter it did not understand", () => {
    // A fake that silently matched everything would have reported every scoped
    // read above as working while returning another account's rows.
    assert.deepEqual(db.unparsed, []);
  });
});

test("joining a firm is something the joiner does", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const org = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise" }) }))).json();

  await t.test("posting a firm id you were never invited to joins nothing", async () => {
    // The accept PATCH matches on the CALLER'S OWN email, so an org id — which
    // is not a secret; it travels in every roster read a member makes — can
    // never be enough to join.
    const r = await fetch(srv.base + "/api/org/accept",
      as(OUTSIDER, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
    assert.equal(r.status, 404);
    assert.equal(tables.org_members.length, 1, "still just the owner");
  });

  await t.test("accepting twice is idempotent and does not rewrite the join date", async () => {
    await fetch(srv.base + "/api/org/invite", as(BRAD, {
      method: "POST", body: JSON.stringify({ orgId: org.id, emails: [MIKE.email] }),
    }));
    const first = await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
    assert.equal(first.status, 200);
    const row = tables.org_members.find((m) => m.email === MIKE.email);
    const joinedAt = row.joined_at;
    const second = await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
    assert.equal(second.status, 404, "there is no longer an open invitation");
    assert.equal(row.joined_at, joinedAt, "and the date he actually joined is untouched");
  });

  await t.test("re-inviting a removed colleague returns them to PENDING, never straight back in", async () => {
    // Coming back to a firm has to be something the returning person does,
    // exactly like joining it the first time. An invite that silently
    // restored access would make removal reversible by the remover alone.
    const row = tables.org_members.find((m) => m.email === MIKE.email);
    await fetch(`${srv.base}/api/org/member?org=${org.id}&id=${row.id}`, as(BRAD, { method: "DELETE" }));
    assert.ok(row.removed_at);

    const r = await fetch(srv.base + "/api/org/invite", as(BRAD, {
      method: "POST", body: JSON.stringify({ orgId: org.id, emails: [MIKE.email] }),
    }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).invited, 1, "a removed person is invitable again");
    assert.equal(row.removed_at, null, "the removal is cleared");
    assert.equal(row.joined_at, null, "but they are pending, not a member");

    const mine = await (await fetch(srv.base + "/api/org", as(MIKE))).json();
    assert.deepEqual(mine.orgs, []);
    assert.equal(mine.invites.length, 1);
  });
});

test("a firm share still refuses to carry whole vault comps", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const created = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise" }) }))).json();

  // 400 rather than a silent strip: sharing a broker's book across their firm
  // is the spec's §7 and is deliberately not built, so a client asking for it
  // should be loud on the first attempt rather than quietly right.
  const r = await fetch(srv.base + "/api/share", as(BRAD, {
    method: "POST",
    body: JSON.stringify({ ...REPORT, visibility: "org", orgId: created.id, includePrivate: true }),
  }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /can't be shared with a firm yet/);
  assert.equal(tables.shared_reports.length, 0);
});
