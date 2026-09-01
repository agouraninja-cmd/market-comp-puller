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
const ORG = require("../org-access");
const { xlsxFromRows } = require("./helpers/make-xlsx.js");

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
    orgs: [], org_members: [], shared_reports: [], report_viewers: [], org_contacts: [],
    analytics_events: [], export_usage: [], report_purchases: [],
  };
}

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    ...extraEnv,
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
      as(MIKE, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }));
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.upgrade, true, "the browser branches on the flag, never the prose");
    assert.equal(tables.orgs.length, 0, "and nothing was written");
  });

  await t.test("a Pro member creates a firm and is its owner", async () => {
    const r = await fetch(srv.base + "/api/org",
      as(BRAD, { method: "POST", body: JSON.stringify({ name: "  Colliers   Boise ", kind: "broker" }) }));
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
      as(BRAD, { method: "POST", body: JSON.stringify({ name: "Another Firm", kind: "broker" }) }));
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
    // And the firm's shelf refuses him outright, rather than answering with
    // an empty one: an unaccepted invitation is not a membership.
    const shelf = await fetch(srv.base + "/api/org/shelf?id=" + orgId, as(MIKE));
    assert.equal(shelf.status, 403);
    const mine = await (await fetch(srv.base + "/api/org", as(MIKE))).json();
    assert.deepEqual(mine.orgs, []);
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

  await t.test("and it is on the firm's shelf, attributed to Brad", async () => {
    const shelf = await (await fetch(srv.base + "/api/org/shelf?id=" + orgId, as(MIKE))).json();
    assert.equal(shelf.items.length, 1);
    assert.equal(shelf.items[0].id, shareId);
    assert.equal(shelf.items[0].address, REPORT.meta.address);
    assert.equal(shelf.items[0].market, "Boise, ID", "canonical marketOf form, so the filter matches the corpus");
    assert.equal(shelf.items[0].sharedBy, "Brad", "a row nobody can be asked about is a dead end");
    assert.equal(shelf.items[0].mine, false);
    assert.equal(shelf.truncated, false);
  });

  await t.test("the shelf holds Brad's OWN share too — it is the firm's whole record", async () => {
    // Slice 1 excluded the caller's own, which is right for a "shared with
    // you" list and wrong for a shelf: a record with your own work missing
    // cannot answer "has anybody here valued this building".
    const shelf = await (await fetch(srv.base + "/api/org/shelf?id=" + orgId, as(BRAD))).json();
    assert.equal(shelf.items.length, 1);
    assert.equal(shelf.items[0].mine, true, "and the browser marks it as his");
  });

  await t.test("his own row still says which firm it went to, never 'anyone with the link'", async () => {
    const list = await (await fetch(srv.base + "/api/shares", as(BRAD))).json();
    const mine = list.mine.find((s) => s.id === shareId);
    assert.equal(mine.visibility, "org");
    assert.equal(mine.firm, "Colliers Boise");
  });

  await t.test("a colleague opening it is told it is a firm link, and by whom", async () => {
    // Without this the report is indistinguishable from a public one on
    // screen, and the concrete mistake is forwarding the link to a client and
    // learning it was refused only after sending.
    const body = await (await fetch(srv.base + "/api/shared?id=" + shareId, as(MIKE))).json();
    assert.deepEqual(
      { firm: body.meta.firmShare.firm, sharedBy: body.meta.firmShare.sharedBy, mine: body.meta.firmShare.mine },
      { firm: "Colliers Boise", sharedBy: "Brad", mine: false });
    // The sender gets it too — the "do not forward this" warning is his as
    // much as anyone's — and knows it as his own.
    const own = await (await fetch(srv.base + "/api/shared?id=" + shareId, as(BRAD))).json();
    assert.equal(own.meta.firmShare.mine, true);
  });

  await t.test("the stored payload is copied, never stamped with one reader's context", async () => {
    // sharedReportsMem holds the payload object for the life of the process,
    // so writing the notice into it would put Mike's reading context on every
    // later reader's copy — and on the row itself.
    const row = tables.shared_reports.find((s) => s.id === shareId);
    assert.equal(row.payload.meta.firmShare, undefined);
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
    // The shelf is every valuation the firm has done, so knowing an org id —
    // which travels in every roster read a member makes — must not open it.
    const shelf = await fetch(srv.base + "/api/org/shelf?id=" + orgId, as(OUTSIDER));
    assert.equal(shelf.status, 403);
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
    const shelf = await fetch(srv.base + "/api/org/shelf?id=" + orgId, as(MIKE));
    assert.equal(shelf.status, 403, "and the shelf closes with it");
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
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }))).json();

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

test("the firm's auto-share default, and the member's veto over it", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const org = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }))).json();
  await fetch(srv.base + "/api/org/invite", as(BRAD, {
    method: "POST", body: JSON.stringify({ orgId: org.id, emails: [MIKE.email] }),
  }));

  const settings = (user, body) => fetch(srv.base + "/api/org/settings",
    as(user, { method: "POST", body: JSON.stringify({ orgId: org.id, ...body }) }));
  const myOrg = async (user) =>
    (await (await fetch(srv.base + "/api/org", as(user))).json());

  await t.test("a firm starts with automatic sharing OFF", async () => {
    // 028 defaults share_default to 'none'. A feature that publishes other
    // people's work must never arrive switched on.
    const me = await myOrg(BRAD);
    assert.equal(me.orgs[0].shareDefault, "none");
    assert.equal(me.orgs[0].autoShareOn, false);
  });

  await t.test("the invitation discloses the firm's setting BEFORE it is accepted", async () => {
    await settings(BRAD, { shareDefault: "reports" });
    const mike = await myOrg(MIKE);
    assert.equal(mike.invites[0].shareDefault, "reports",
      "joining changes what happens to work not yet run; being told after is too late");
  });

  await t.test("an owner sets the firm default; a plain member cannot", async () => {
    await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
    const refused = await settings(MIKE, { shareDefault: "none" });
    assert.equal(refused.status, 403);
    const still = await myOrg(BRAD);
    assert.equal(still.orgs[0].shareDefault, "reports", "and nothing changed");
  });

  await t.test("a member who has not chosen follows the firm", async () => {
    const mike = await myOrg(MIKE);
    assert.equal(mike.orgs[0].autoShare, "follow");
    assert.equal(mike.orgs[0].autoShareOn, true);
  });

  await t.test("a member's NO beats the firm's yes — the safeguard", async () => {
    const r = await settings(MIKE, { autoShare: "never" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.autoShareOn, false);
    assert.equal(body.shareDefault, "reports", "the firm still says yes");
    const mike = await myOrg(MIKE);
    assert.equal(mike.orgs[0].autoShareOn, false, "and it survives a fresh read");
    assert.equal((await myOrg(BRAD)).orgs[0].autoShareOn, true, "for him alone, not the firm");
  });

  await t.test("an admin turning the firm switch off and on again does not revive it", async () => {
    // The rule that makes the veto worth having: read the other way round, a
    // broker who said "not my client work" starts publishing again the next
    // time an admin changes their mind, with nothing telling them.
    await settings(BRAD, { shareDefault: "none" });
    await settings(BRAD, { shareDefault: "reports" });
    assert.equal((await myOrg(MIKE)).orgs[0].autoShareOn, false);
  });

  await t.test("a member's YES stands even when the firm's default is off", async () => {
    await settings(BRAD, { shareDefault: "none" });
    await settings(MIKE, { autoShare: "always" });
    const mike = await myOrg(MIKE);
    assert.equal(mike.orgs[0].autoShareOn, true, "publishing your own work is yours to decide");
    assert.equal((await myOrg(BRAD)).orgs[0].autoShareOn, false);
  });

  await t.test("'follow' is a real choice, and junk is refused", async () => {
    const back = await settings(MIKE, { autoShare: "follow" });
    assert.equal(back.status, 200);
    assert.equal((await back.json()).autoShare, "follow");
    for (const junk of ["yes", "", true, "REPORTS"]) {
      const r = await settings(MIKE, { autoShare: junk });
      assert.equal(r.status, 400, JSON.stringify(junk));
    }
    assert.equal((await settings(BRAD, { shareDefault: "everything" })).status, 400);
    assert.equal((await settings(BRAD, {})).status, 400, "a call that changes nothing is a mistake");
  });

  await t.test("a non-member cannot read or set a firm's settings", async () => {
    assert.equal((await settings(OUTSIDER, { autoShare: "always" })).status, 403);
  });
});

test("the shared vault: a comp's whole life on the firm's shelf", async (t) => {
  // The write half, end to end. The blend into a colleague's REPORT needs a
  // billed search to reach gate(), so it is covered by the pure rules in
  // blend-comps.test.js plus the source-level guards in org-routes.test.js;
  // everything below is a real database path.
  const tables = seedTables();
  tables.broker_comps = [{
    id: "11111111-1111-4111-8111-111111111111",
    user_id: BRAD.id, market: "Boise, ID", property_type: "Industrial",
    address: "100 Main St", address_key: "100 main st", deal_date: "2026-05-01",
    transaction: "sale", price: 1000000, size_sqft: 10000, price_per_sqft: 100,
    dedupe_key: "k1", published: false, notes: "off market",
  }];
  tables.broker_properties = [];
  tables.org_comps = [];
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;
  const COMP = tables.broker_comps[0].id;

  const org = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }))).json();
  const firm = (method, body) => fetch(srv.base + "/api/vault/firm",
    as(BRAD, { method, body: JSON.stringify(body) }));

  await t.test("a broker cannot share into a firm they are not in", async () => {
    const r = await firm("POST", { orgId: "some-other-firm", compIds: [COMP] });
    assert.equal(r.status, 403);
    assert.equal(tables.org_comps.length, 0);
  });

  await t.test("sharing copies the comp, and copies NONE of the vault's plumbing", async () => {
    const r = await firm("POST", { orgId: org.id, compIds: [COMP] });
    assert.equal(r.status, 200);
    assert.equal(tables.org_comps.length, 1);
    const row = tables.org_comps[0];
    assert.equal(row.org_id, org.id);
    assert.equal(row.source_comp_id, COMP);
    assert.equal(row.market, "Boise, ID", "the filter columns are real columns");
    assert.equal(row.deal_date, "2026-05-01");
    assert.equal(row.comp.address, "100 Main St");
    for (const leak of ["user_id", "dedupe_key", "address_key", "published"]) {
      assert.equal(leak in row.comp, false, `${leak} must not reach the shelf`);
    }
    assert.equal(row.shared_by_name, "Brad", "attributed, so a colleague knows who to ask");
  });

  await t.test("sharing the same comp twice is a no-op, not a second row", async () => {
    await firm("POST", { orgId: org.id, compIds: [COMP] });
    assert.equal(tables.org_comps.length, 1);
  });

  await t.test("the vault says what is shared, and with whom", async () => {
    const v = await (await fetch(srv.base + "/api/vault", as(BRAD))).json();
    assert.equal(v.firm.name, "Colliers Boise");
    assert.deepEqual(v.sharedWithFirm, [COMP]);
  });

  await t.test("an edit REFRESHES the copy — a colleague never reads a stale price", async () => {
    const r = await fetch(`${srv.base}/api/vault/comp?id=${COMP}`,
      as(BRAD, { method: "PATCH", body: JSON.stringify({ price: 1250000 }) }));
    assert.equal(r.status, 200);
    assert.equal(tables.org_comps.length, 1, "still one row");
    assert.equal(tables.org_comps[0].comp.price, 1250000);
  });

  await t.test("a REJECTED edit changes nothing on the shelf", async () => {
    // The scar retractPublishedComp carries, applied here: a broker typing
    // "1.2M" — the exact input the vault exists to refuse — must not have
    // their colleagues' copy disturbed before the 400 comes back.
    const r = await fetch(`${srv.base}/api/vault/comp?id=${COMP}`,
      as(BRAD, { method: "PATCH", body: JSON.stringify({ price: "1.2M" }) }));
    assert.equal(r.status, 400);
    assert.equal(tables.org_comps[0].comp.price, 1250000, "untouched");
  });

  await t.test("unsharing takes it back", async () => {
    const r = await firm("DELETE", { compIds: [COMP] });
    assert.equal(r.status, 200);
    assert.equal(tables.org_comps.length, 0);
  });

  await t.test("deleting the comp pulls it off the shelf too", async () => {
    await firm("POST", { orgId: org.id, compIds: [COMP] });
    assert.equal(tables.org_comps.length, 1);
    const r = await fetch(`${srv.base}/api/vault/comp?id=${COMP}`, as(BRAD, { method: "DELETE" }));
    assert.equal(r.status, 200);
    assert.equal(tables.org_comps.length, 0, "explicitly, not left to the FK cascade");
  });

  await t.test("a comp id from somebody else's vault shares nothing", async () => {
    tables.broker_comps.push({
      id: "22222222-2222-4222-8222-222222222222",
      user_id: MIKE.id, market: "Boise, ID", property_type: "Industrial",
      address: "999 Not Yours", address_key: "999 not yours", deal_date: "2026-05-01",
      transaction: "sale", price: 1, dedupe_key: "k2", published: false,
    });
    const r = await firm("POST", { orgId: org.id, compIds: ["22222222-2222-4222-8222-222222222222"] });
    assert.equal(r.status, 200, "not an error — there was simply nothing of theirs to share");
    assert.equal(tables.org_comps.length, 0);
  });
});

test("per-seat firm billing", async (t) => {
  // The seat rules and the entitlement fallback, against real database paths.
  // Stripe itself is never called: checkout is refused before the network on
  // every case below, and the subscription row is written directly, which is
  // exactly what the webhook does.
  const tables = seedTables();
  tables.org_subscriptions = [];
  // Stripe keys, because /api/checkout and /api/billing-portal 503 before any
  // of their own checks without them. Nothing here reaches Stripe's API: every
  // checkout case below is a refusal that returns first, and the subscription
  // row is written directly — which is exactly what the webhook does.
  const ctx = await bootWithDb(tables, {
    STRIPE_SECRET_KEY: "sk_test_not_used",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro",
    STRIPE_PRICE_FIRM_MONTHLY: "price_firm",
  });
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const org = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }))).json();
  const orgRow = tables.orgs[0];
  const buy = (user, body) => fetch(srv.base + "/api/checkout",
    as(user, { method: "POST", body: JSON.stringify({ plan: "firm_monthly", orgId: org.id, ...body }) }));
  const invite = (emails) => fetch(srv.base + "/api/org/invite",
    as(BRAD, { method: "POST", body: JSON.stringify({ orgId: org.id, emails }) }));

  await t.test("a new firm starts at the structural cap, not at one seat", async () => {
    // The failure direction that matters: an unreadable or unwritten seat
    // count must never resolve to "nobody may be in this firm".
    assert.equal(orgRow.seats, 200);
    const me = await (await fetch(srv.base + "/api/org", as(BRAD))).json();
    assert.equal(me.billing[org.id].seats, 200);
    assert.equal(me.billing[org.id].used, 1);
    assert.equal(me.billing[org.id].status, "none", "hand-granted, no subscription");
  });

  await t.test("invitations are refused once the seats are full, by name and number", async () => {
    orgRow.seats = 2;
    assert.equal((await invite([MIKE.email])).status, 200, "the second seat is free");
    const full = await invite([OUTSIDER.email]);
    assert.equal(full.status, 409);
    const body = await full.json();
    assert.equal(body.code, "no_seats");
    assert.equal(body.seats, 2);
    assert.match(body.error, /all taken/);
  });

  await t.test("a PENDING invitation holds its seat", async () => {
    // Mike has not accepted. If pending rows did not count, a firm could
    // invite its way past the cap and only discover it as people arrived.
    const mike = tables.org_members.find((m) => m.email === MIKE.email);
    assert.equal(mike.joined_at, undefined);
    assert.equal((await invite([OUTSIDER.email])).status, 409);
  });

  await t.test("only the owner can buy seats, and never fewer than the headcount", async () => {
    await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
    const notOwner = await buy(MIKE, { seats: 5 });
    assert.equal(notOwner.status, 403);
    assert.match((await notOwner.json()).error, /owner/);
    const stranger = await buy(OUTSIDER, { seats: 5 });
    assert.equal(stranger.status, 403);
    // Three in the firm now, so two seats would drop a named colleague to free
    // the moment the webhook landed. Asked for THREE people rather than the
    // original two because one seat is refused by the minimum before the
    // headcount is ever consulted — the two rules need separate arithmetic to
    // stay separately tested.
    orgRow.seats = 200;
    assert.equal((await invite([OUTSIDER.email])).status, 200);
    const tooFew = await buy(BRAD, { seats: 2 });
    assert.equal(tooFew.status, 400);
    const body = await tooFew.json();
    assert.equal(body.code, "seats_below_headcount");
    assert.equal(body.headcount, 3, "a pending invitation still counts as a person");
    // Put the firm back to the two people the rest of this sequence expects.
    // The third was only ever arithmetic for the assertion above, and leaving
    // them in place fails a later test that counts survivors after a lapse.
    tables.org_members = tables.org_members.filter((m) => m.email !== OUTSIDER.email);
    orgRow.seats = 2;
  });

  // The solo-arbitrage close. `canUseOrg` gates CREATING a firm on already
  // holding Pro, but getEntitlements grants Pro from a firm SEAT once a
  // personal subscription lapses — so a one-seat firm plan is a cheaper Pro
  // wearing a firm's clothes, and the seat price is below the individual
  // price by construction. Refused by name and number so the buyer is told
  // the rule rather than left clicking a button that fails.
  await t.test("a one-seat firm plan cannot be bought", async () => {
    const one = await buy(BRAD, { seats: 1 });
    assert.equal(one.status, 400);
    const body = await one.json();
    assert.equal(body.code, "seats_below_minimum");
    assert.equal(body.minimum, ORG.MIN_SEATS);
    assert.match(body.error, new RegExp(String(ORG.MIN_SEATS)),
      "the refusal should name the smallest plan that exists");
  });

  await t.test("nonsense seat counts are refused without claiming a minimum", async () => {
    // Same branch, deliberately without the `seats_below_minimum` code: zero,
    // a negative and a non-number are not somebody asking for a small firm,
    // and labelling them as such would send a caller looking for a pricing
    // rule when they have a bug.
    for (const seats of [0, -3, "lots", null]) {
      const r = await buy(BRAD, { seats });
      assert.equal(r.status, 400, `seats: ${JSON.stringify(seats)}`);
      assert.equal((await r.json()).code, undefined, `seats: ${JSON.stringify(seats)}`);
    }
  });

  await t.test("checkout refuses a firm the caller is not in", async () => {
    const r = await fetch(srv.base + "/api/checkout", as(BRAD, {
      method: "POST",
      body: JSON.stringify({ plan: "firm_monthly", orgId: "some-other-firm", seats: 5 }),
    }));
    assert.equal(r.status, 403);
  });

  await t.test("a firm subscription grants Pro to its seat holders", async () => {
    // Written directly, which is what applyOrgSubscription does on the
    // webhook. Mike pays for nothing and holds a seat.
    tables.org_subscriptions.push({
      org_id: org.id, stripe_subscription_id: "sub_firm", stripe_customer_id: "cus_firm",
      plan: "firm_monthly", status: "active", current_period_end: YEAR_OUT,
      cancel_at_period_end: false, grace_until: null,
    });
    const cfg = await (await fetch(srv.base + "/api/config", as(MIKE))).json();
    assert.equal(cfg.pro.isPro, true, "a free colleague on a paid seat is Pro");
    assert.equal(cfg.pro.viaFirm.name, "Colliers Boise");
    assert.equal(cfg.pro.viaFirm.canManage, false, "and is not the payer");
  });

  await t.test("a member past the seat cap does NOT get the firm's Pro", async () => {
    // The defined answer for a portal downgrade, which we cannot prevent.
    // Oldest-first, so the result is explicable rather than arbitrary.
    orgRow.seats = 1;
    const mike = await (await fetch(srv.base + "/api/config", as(MIKE))).json();
    assert.equal(mike.pro.isPro, false, "the most recently joined loses the seat");
    const brad = await (await fetch(srv.base + "/api/config", as(BRAD))).json();
    assert.equal(brad.pro.isPro, true, "the owner joined first and keeps it");
    orgRow.seats = 2;
  });

  await t.test("a member's OWN subscription wins over the firm's", async () => {
    // Brad has his own row from seedTables. He must keep his own plan name and
    // his own billing portal rather than being folded onto the firm's.
    const cfg = await (await fetch(srv.base + "/api/config", as(BRAD))).json();
    assert.equal(cfg.pro.plan, "pro_monthly");
    assert.equal(cfg.pro.viaFirm, null, "so the personal Manage billing stays offered");
  });

  await t.test("a lapsed firm plan takes the seat with it, and grants nothing", async () => {
    tables.org_subscriptions[0].status = "cancelled";
    tables.org_subscriptions[0].current_period_end = "2020-01-01T00:00:00Z";
    const cfg = await (await fetch(srv.base + "/api/config", as(MIKE))).json();
    assert.equal(cfg.pro.isPro, false);
    assert.equal(cfg.pro.viaFirm, null);
    // And nothing was deleted: the firm, its people and its shelf survive a
    // lapse, exactly as a lapsed vault survives.
    assert.equal(tables.org_members.filter((m) => !m.removed_at).length, 2);
  });

  await t.test("an outsider cannot open a firm's billing portal", async () => {
    for (const user of [MIKE, OUTSIDER]) {
      const r = await fetch(srv.base + "/api/billing-portal",
        as(user, { method: "POST", body: JSON.stringify({ orgId: org.id }) }));
      assert.equal(r.status, 403, user.email);
    }
  });
});

test("a firm share still refuses to carry whole vault comps", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const created = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }))).json();

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

// ---------------------------------------------------------------------------
// The invitation email
//
// Every test above asserts the ROW an invitation writes. None of them asserted
// the mail, which is the half the invited colleague actually experiences —
// and the half where the mistakes are expensive: mailing somebody twice,
// mailing the inviter, mailing an address that was refused, or sending a
// stranger a message that reads as though a firm already has their data.
//
// RESEND_API_URL is the test-only hook that makes this possible (see
// CLAUDE.md's bullet on it); the fake collects every post to it.
// ---------------------------------------------------------------------------

// Mail is fire-and-forget on purpose — a provider having a bad minute must
// never turn a written invitation into an error — so the route answers before
// the post lands.
async function settleMail(db, want) {
  for (let i = 0; i < 80 && db.sent.length < want; i++) await new Promise((r) => setTimeout(r, 25));
  return db.sent;
}

test("what an invited colleague actually receives", async (t) => {
  // Booted by hand rather than through bootWithDb: the fake's Resend url is
  // only knowable once it is listening, and server.js reads its environment
  // once at startup, so the server has to be started after it.
  const tables = seedTables();
  const db = await fake.start({ tables });
  const srv2 = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    // Both are required for a send: sendOutboundEmail is a silent no-op
    // without EMAIL_FROM, which is the state every deployment without a
    // verified domain is in.
    EMAIL_FROM: "CompNinja <reports@compninja.co>",
    RESEND_API_KEY: "resend-key", RESEND_API_URL: db.resendUrl,
  });
  t.after(async () => { srv2.stop(); await db.stop(); });

  const create = await fetch(srv2.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }) }));
  assert.equal(create.status, 200);
  const org = await create.json();
  const invite = (emails) => fetch(srv2.base + "/api/org/invite",
    as(BRAD, { method: "POST", body: JSON.stringify({ orgId: org.id, emails }) }));

  await t.test("the invitation says who, which firm, and what accepting does", async () => {
    assert.equal((await invite([MIKE.email])).status, 200);
    const [mail] = await settleMail(db, 1);
    assert.ok(mail, "no invitation reached the provider");
    assert.deepEqual(mail.to, [MIKE.email]);
    assert.match(mail.subject, /Colliers Boise invited you/);
    assert.match(mail.text, /brad@colliers\.com/, "the invitation must name who sent it");
    assert.match(mail.text, /https:\/\/compninja\.co\/desk/, "no way to accept");
    // Identity is the EMAIL — 018's decision, adopted by 030 — so the mail has
    // to name the address that will work, or a colleague signs in with another
    // one and finds nothing.
    assert.match(mail.text, new RegExp(MIKE.email.replace(".", "\\.") + "\\)"));
    // Case-insensitive: the sentence moved from a mid-sentence clause after an
    // em dash to a sentence of its own, matching how sendShareInvites has
    // always written it. What this asserts is the PROMISE, not its punctuation.
    assert.match(mail.text, /a free account is all it takes/i,
      "a colleague who needs no plan must not be left assuming they need to buy one");
    // The safeguard, restated to the person it protects: this mail can reach
    // somebody who has never heard of the firm.
    assert.match(mail.text, /Nothing is shared with you until you accept/);
    assert.match(mail.text, /an unaccepted invitation gives nobody access to anything/);
  });

  await t.test("a colleague already invited is not mailed again", async () => {
    // The MAIL has to be idempotent as well as the row, or a firm working
    // through a list turns one invitation into four. A list that dropped to
    // nothing is answered as an error rather than a cheerful 200 — the
    // inviter typed somebody, and "sent!" would be a lie about a person.
    const before = db.sent.length;
    const r = await invite([MIKE.email]);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /No new email addresses/);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(db.sent.length, before, "an already-invited colleague was mailed a second time");
  });

  await t.test("only the newly-added addresses are mailed", async () => {
    const before = db.sent.length;
    const r = await invite([MIKE.email, "  New@Colliers.com  ", "new@colliers.com"]);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).invited, 1, "the count must be the server's own, after dedupe");
    const sent = await settleMail(db, before + 1);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(sent.length, before + 1, "one address, two spellings, two emails");
    assert.deepEqual(sent[sent.length - 1].to, ["new@colliers.com"]);
  });

  await t.test("the inviter never invites themselves", async () => {
    // Dropped by normalizeInviteEmails before the route ever gets a list, so
    // this is refused for the same reason as the line above rather than
    // quietly mailing the sender an invitation to their own firm.
    const before = db.sent.length;
    const r = await invite([BRAD.email]);
    assert.equal(r.status, 400);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(db.sent.length, before);
  });

  await t.test("a refused invitation mails nobody", async () => {
    // Mike is a plain member. The mail must ride BEHIND the permission check,
    // not beside it — an invitation nobody was authorized to send must not
    // still arrive in somebody's inbox.
    const before = db.sent.length;
    const r = await fetch(srv2.base + "/api/org/invite",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId: org.id, emails: ["someone@else.com"] }) }));
    assert.equal(r.status, 403);
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(db.sent.length, before, "a refused invitation was still mailed");
  });

  await t.test("the invitation speaks the shop's own language", async () => {
    // 036. The first sentence a stranger reads about the product describes
    // what this shelf holds, and describing a development shop's shelf as
    // "comp sets and BOVs" describes somebody else's job to them.
    const broker = db.sent[0];
    assert.match(broker.text, /comp sets, BOVs, market reports and lease abstracts/);

    const flip = await fetch(srv2.base + "/api/org/settings", as(BRAD, {
      method: "POST", body: JSON.stringify({ orgId: org.id, kind: "development" }),
    }));
    assert.equal(flip.status, 200);
    assert.equal((await flip.json()).kind, "development");

    const before = db.sent.length;
    assert.equal((await invite(["land@colliers.com"])).status, 200);
    const sent = await settleMail(db, before + 1);
    const mail = sent[sent.length - 1];
    assert.match(mail.text, /land comps, rent comps, absorption studies and feasibility packets/);
    assert.doesNotMatch(mail.text, /lease abstracts/,
      "the two vocabularies must not both arrive in one invitation");
  });

  await t.test("the fake never had to guess at a query it did not understand", () => {
    assert.deepEqual(db.unparsed, []);
  });
});

// ---------------------------------------------------------------------------
// Shop kind (migration 036) — Transition Plan v2 §6's customer types. A
// tenant rep shop was a third kind from 2026-08-21 and was withdrawn on
// 2026-08-31; the route refusing it is the whole wall, since 037's CHECK
// still accepts the string.
//
// The rules worth executing rather than arguing: the question cannot be
// answered by silence, changing the answer is an admin's job, and the answer
// survives a fresh read. org-access.test.js proves the pure half with no
// database; this is the half that writes a column.
// ---------------------------------------------------------------------------
test("a firm is one of two shops, and says which", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;
  const create = (body) => fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify(body) }));
  const myOrg = async (user) => (await (await fetch(srv.base + "/api/org", as(user))).json());

  await t.test("a firm cannot be created without answering the question", async () => {
    for (const body of [{ name: "Colliers Boise" },
                        { name: "Colliers Boise", kind: "" },
                        { name: "Colliers Boise", kind: "enterprise" }]) {
      const r = await create(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match((await r.json()).error,
        /broker shop or a development shop/);
    }
    assert.equal(tables.orgs.length, 0, "and nothing was written");
  });

  await t.test("the name is checked first, so one missing answer is reported at a time", async () => {
    const r = await create({ name: "x", kind: "development" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /firm's name/);
  });

  await t.test("a development shop is created, and stays one", async () => {
    const r = await create({ name: "Boise Land Partners", kind: "  Development " });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).kind, "development", "normalized server-side, not echoed");
    assert.equal(tables.orgs[0].kind, "development", "and written to the column");
    assert.equal((await myOrg(BRAD)).orgs[0].kind, "development", "and survives a fresh read");
  });

  await t.test("an owner changes it; a plain member cannot", async () => {
    const orgId = tables.orgs[0].id;
    const settings = (user, body) => fetch(srv.base + "/api/org/settings",
      as(user, { method: "POST", body: JSON.stringify({ orgId, ...body }) }));

    await fetch(srv.base + "/api/org/invite",
      as(BRAD, { method: "POST", body: JSON.stringify({ orgId, emails: [MIKE.email] }) }));
    await fetch(srv.base + "/api/org/accept",
      as(MIKE, { method: "POST", body: JSON.stringify({ orgId }) }));

    const refused = await settings(MIKE, { kind: "broker" });
    assert.equal(refused.status, 403, "it re-labels every colleague's desk, not one person's work");
    assert.equal((await myOrg(BRAD)).orgs[0].kind, "development", "and nothing changed");

    assert.equal((await settings(BRAD, { kind: "broker" })).status, 200);
    assert.equal((await myOrg(MIKE)).orgs[0].kind, "broker", "the colleague reads the new words too");

    for (const junk of ["enterprise", "", true, "dev", "brokerage",
                        "tenant_rep", "Tenant_Rep", "tenant", "tenant rep", "tenant-rep"]) {
      assert.equal((await settings(BRAD, { kind: junk })).status, 400, JSON.stringify(junk));
    }
    assert.equal((await myOrg(BRAD)).orgs[0].kind, "broker", "a refused change changed nothing");

    // Case and padding are NORMALIZED on the way in rather than refused, the
    // way validateOrgName collapses a name. The column may only ever hold the
    // two exact values, and that is what this proves: the write path cleans,
    // the read path in org-access.js stays strict.
    assert.equal((await settings(BRAD, { kind: "  DEVELOPMENT " })).status, 200);
    assert.equal((await myOrg(BRAD)).orgs[0].kind, "development");
    assert.equal(tables.orgs[0].kind, "development", "stored lower case, never as typed");

    // The withdrawn kind, driven all the way to the route rather than argued
    // about in the module. 037's CHECK still ACCEPTS 'tenant_rep' — nothing
    // in Postgres would stop this write — so the settings route refusing it
    // above is the only thing keeping the value out of the column, and that
    // refusal is worth executing here as well as in org-access.test.js.
    assert.equal(tables.orgs[0].kind, "development", "the retired kind never reached the column");
  });

  await t.test("the fake never had to guess at a query it did not understand", () => {
    assert.deepEqual(ctx.db.unparsed, []);
  });
});

// ---------------------------------------------------------------------------
// The deal board's attribution after somebody leaves (038).
//
// This is the split the snapshot column exists to close. `org_comps` has
// denormalized `shared_by_name` since 032, so a member who deletes their
// account keeps their attribution on their COMPS; `shared_reports` had no name
// column and 018 sets `user_id` to null on delete, so the same person lost it
// on their REPORTS. The board keys on the id first and the name second, so one
// person arrived as TWO rows — once by name, once unattributed — with correct
// totals and a wrong-looking roster.
// ---------------------------------------------------------------------------
test("a departed member is one row on the deal board, not two", async (t) => {
  const tables = seedTables();
  const { db, srv, stop } = await bootWithDb(tables);
  t.after(stop);

  const org = await (await fetch(srv.base + "/api/org", as(BRAD, {
    method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }),
  }))).json();
  await fetch(srv.base + "/api/org/invite", as(BRAD, {
    method: "POST", body: JSON.stringify({ orgId: org.id, emails: [MIKE.email] }),
  }));
  await fetch(srv.base + "/api/org/accept", as(MIKE, {
    method: "POST", body: JSON.stringify({ orgId: org.id }),
  }));

  // Mike shares a report with the firm while his account still exists.
  const share = await fetch(srv.base + "/api/share", as(MIKE, {
    method: "POST",
    body: JSON.stringify({ ...REPORT, visibility: "org", orgId: org.id }),
  }));
  assert.equal(share.status, 200);

  // The name is snapshotted at share time — the half that makes the rest work.
  const row = tables.shared_reports.find((r) => r.user_id === MIKE.id);
  assert.ok(row, "the share was written");
  assert.equal(row.shared_by_name, "Mike",
    "the sharer's name is stored, not merely joined from users at read time");

  // Now Mike deletes his account: 018's rule nulls user_id and the users row
  // is gone, so the live lookup can no longer answer who shared this.
  tables.shared_reports.forEach((r) => { if (r.user_id === MIKE.id) r.user_id = null; });
  tables.users = tables.users.filter((u) => u.id !== MIKE.id);

  const board = (await (await fetch(srv.base +
    `/api/org/board?id=${encodeURIComponent(org.id)}`, as(BRAD))).json()).board;
  assert.ok(board, "the firm has shared something, so there is a board");

  const mike = board.members.filter((m) => m.name === "Mike");
  assert.equal(mike.length, 1, "Mike is one row");
  assert.equal(mike[0].reports, 1);
  // And crucially NOT an extra anonymous row beside him.
  const anon = board.members.filter((m) => !m.name);
  assert.deepEqual(anon, [],
    "a departed member with a stored name never also appears as an unattributed row");
});

test("the live name wins over the snapshot while the account exists", async (t) => {
  // The opposite ordering to report branding's, deliberately: a mark must look
  // the way it looked when it was sent, while an attribution should say what a
  // colleague is called TODAY. Somebody who fixes a typo in their profile
  // should not read the old spelling back on their own shelf row.
  const tables = seedTables();
  const { db, srv, stop } = await bootWithDb(tables);
  t.after(stop);

  const org = await (await fetch(srv.base + "/api/org", as(BRAD, {
    method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }),
  }))).json();
  await fetch(srv.base + "/api/share", as(BRAD, {
    method: "POST",
    body: JSON.stringify({ ...REPORT, visibility: "org", orgId: org.id }),
  }));

  // Brad renames himself after sharing. The snapshot still says "Brad".
  tables.users.find((u) => u.id === BRAD.id).name = "Bradley";

  const shelf = await (await fetch(srv.base +
    `/api/org/shelf?id=${encodeURIComponent(org.id)}`, as(BRAD))).json();
  assert.equal(shelf.items[0].sharedBy, "Bradley",
    "the shelf shows the current name, not the one snapshotted at share time");
});

// ---------------------------------------------------------------------------
// The firm's tenant contacts (039).
//
// Firm-wide by design, so the assertion that matters most is the one about
// ANOTHER firm: this list is the only place the product stores tenant names
// and addresses a customer typed, and a scoping mistake here hands one
// brokerage another's client list.
// ---------------------------------------------------------------------------
const CONTACT_CSV = [
  "name,email,company",
  "# a note line the importer skips",
  "Dana Wu,dana@acme.com,Acme Logistics",
  "Ray Ortiz,,Nordic Cold",
  "Bad Row,not-an-email,X",
].join("\n");

async function firmWithMike(t) {
  const tables = seedTables();
  const { db, srv, stop } = await bootWithDb(tables);
  t.after(stop);
  const org = await (await fetch(srv.base + "/api/org", as(BRAD, {
    method: "POST", body: JSON.stringify({ name: "Colliers Boise", kind: "broker" }),
  }))).json();
  await fetch(srv.base + "/api/org/invite", as(BRAD, {
    method: "POST", body: JSON.stringify({ orgId: org.id, emails: [MIKE.email] }),
  }));
  await fetch(srv.base + "/api/org/accept", as(MIKE, {
    method: "POST", body: JSON.stringify({ orgId: org.id }),
  }));
  return { tables, db, srv, org };
}

test("a firm's tenant contacts", async (t) => {
  await t.test("one member adds, every member sees, and who added it is recorded", async () => {
    const { srv, org } = await firmWithMike(t);

    const add = await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(MIKE, {
      method: "POST",
      body: JSON.stringify({ name: "Dana Wu", email: "Dana@Acme.com", company: "Acme Logistics" }),
    }));
    assert.equal(add.status, 200);
    assert.equal((await add.json()).imported, 1);

    // Brad reads what Mike typed — the whole point of firm-scoping it.
    const list = await (await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD))).json();
    assert.equal(list.contacts.length, 1);
    assert.equal(list.contacts[0].name, "Dana Wu");
    assert.equal(list.contacts[0].email, "dana@acme.com", "stored lowercased");
    assert.equal(list.contacts[0].addedBy, "Mike",
      "the member who added it is recorded, which is what keeps the private-by-default option open");
    assert.equal(list.contacts[0].mine, false, "and Brad is told it is not his");
  });

  await t.test("a CSV imports, refuses its bad rows by line, and counts its note lines", async () => {
    const { srv, org } = await firmWithMike(t);
    const r = await (await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ csv: CONTACT_CSV }),
    }))).json();
    assert.equal(r.imported, 2);
    assert.equal(r.total, 3, "the note line is not counted as data");
    assert.equal(r.commented, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^Line 5:/);
    assert.match(r.errors[0], /not an email address/);
  });

  await t.test("an Excel file imports, through the same rules the CSV obeys", async () => {
    const { srv, org } = await firmWithMike(t);
    // A real .xlsx: shared strings, r= cell references, deflated parts.
    const xlsx = xlsxFromRows([
      ["Name", "Email", "Company"],
      ["Dana Wu", "dana@acme.com", "Acme Logistics"],
      ["Ray Ortiz", null, "Nordic Cold"],
    ]);
    const r = await (await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST",
      body: JSON.stringify({ filename: "tenants.xlsx", xlsx: xlsx.toString("base64") }),
    }))).json();
    assert.equal(r.imported, 2);
    assert.equal(r.total, 2);
    assert.deepStrictEqual(r.errors, []);

    const list = await (await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD))).json();
    assert.deepStrictEqual(list.contacts.map((c) => c.name).sort(), ["Dana Wu", "Ray Ortiz"]);
    assert.equal(list.contacts.find((c) => c.name === "Dana Wu").email, "dana@acme.com",
      "lowercased by the same normalizeContact the typed door uses");
    // Excel omits an empty cell ENTIRELY rather than writing a blank one, so
    // without the r= reference being read "Nordic Cold" slides one column left
    // and the company is stored as the email address.
    const ray = list.contacts.find((c) => c.name === "Ray Ortiz");
    assert.ok(!ray.email, "the omitted cell stays empty");
    assert.equal(ray.company, "Nordic Cold", "and the cell after the gap keeps its own column");
  });

  await t.test("a spreadsheet refusal names the row the person is looking at", async () => {
    const { srv, org } = await firmWithMike(t);
    // Rows 2 and 3 are blank. The bad address is on row 5 OF THE SHEET, and
    // that is the number the error has to give: counting surviving rows would
    // say 3, and there is nothing wrong with row 3.
    const xlsx = xlsxFromRows([
      ["Name", "Email"],
      [],
      [],
      ["Dana Wu", "dana@acme.com"],
      ["Bad Row", "not-an-email"],
    ]);
    const r = await (await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ xlsx: xlsx.toString("base64") }),
    }))).json();
    assert.equal(r.imported, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^Line 5:/);
  });

  await t.test("a CSV with a spacer row also names the real line", async () => {
    // The same rule from the other door. This was WRONG until the grid work:
    // parseContactsCsv counted the compacted grid, so one blank line above a
    // bad address pointed the refusal at a line that was fine.
    const { srv, org } = await firmWithMike(t);
    const csv = ["name,email", "", "", "Dana Wu,dana@acme.com", "Bad Row,not-an-email"].join(String.fromCharCode(10));
    const r = await (await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ csv }),
    }))).json();
    assert.equal(r.imported, 1);
    assert.match(r.errors[0], /^Line 5:/);
  });

  await t.test("a wrong file is refused by name, and nothing is stored", async () => {
    const { srv, org, tables } = await firmWithMike(t);
    const post = (body) => fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`,
      as(BRAD, { method: "POST", body: JSON.stringify(body) }));

    // An older .xls: an OLE2 document, not a zip. Named, because it is the
    // likeliest wrong file to arrive and "could not be read" sends somebody
    // hunting for a fault in their own contact list.
    const xls = Buffer.alloc(64);
    xls[0] = 0xd0; xls[1] = 0xcf; xls[2] = 0x11; xls[3] = 0xe0;
    const old = await post({ xlsx: xls.toString("base64") });
    assert.equal(old.status, 400);
    assert.match((await old.json()).error, /older .xls/i);

    // A PDF someone picked by mistake.
    const pdf = await post({ xlsx: Buffer.from("%PDF-1.7 nope").toString("base64") });
    assert.equal(pdf.status, 400);
    assert.match((await pdf.json()).error, /spreadsheet|.csv/i);

    // Too big to be worth decompressing.
    const big = await post({ xlsx: Buffer.alloc(1024 * 1024 + 1).toString("base64") });
    assert.equal(big.status, 413);

    assert.equal(tables.org_contacts.length, 0, "no refusal wrote a row");
  });

  await t.test("importing the same file twice never doubles an emailed contact", async () => {
    const { srv, org } = await firmWithMike(t);
    const post = () => fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ csv: CONTACT_CSV }),
    })).then((x) => x.json());

    await post();
    const again = await post();

    // The EMAILED contact is recognised and dropped; the un-emailed one is
    // not, and that asymmetry is deliberate rather than a gap. Merging Ray
    // would mean deciding that two contacts sharing a name are one person,
    // which is exactly the guess this module refuses to make — the same rule
    // that keeps two "Dana Wu"s apart. The cost is a duplicate somebody can
    // delete; the cost of the alternative is quietly destroying one of two
    // real contacts, which nothing on screen would show.
    assert.equal(again.duplicates, 1, "the emailed one is recognised and reported");
    assert.equal(again.imported, 1, "the un-emailed one is imported again, by design");

    const list = await (await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD))).json();
    assert.equal(list.contacts.filter((c) => c.email === "dana@acme.com").length, 1,
      "so the firm never ends up with two rows for one address");

    // And Ray, who has no email, is imported AGAIN — the visible cost of
    // refusing to merge on a name. The fake models Postgres here (a NULL in a
    // unique key never conflicts), which it did not until this feature was
    // built: it was collapsing two un-emailed rows into one, so this exact
    // assertion would have proved the opposite of what production does.
    assert.equal(list.contacts.filter((c) => c.name === "Ray Ortiz").length, 2,
      "an un-emailed contact is never merged, so a re-import duplicates it");
  });

  await t.test("an edit is refused when it would make a row the import would reject", async () => {
    const { srv, org } = await firmWithMike(t);
    await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ name: "Dana Wu", email: "dana@acme.com" }),
    }));
    const id = (await (await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD))).json()).contacts[0].id;

    const bad = await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}&contact=${encodeURIComponent(id)}`, as(BRAD, {
        method: "PATCH", body: JSON.stringify({ email: "nope" }),
      }));
    assert.equal(bad.status, 400);

    const good = await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}&contact=${encodeURIComponent(id)}`, as(BRAD, {
        method: "PATCH", body: JSON.stringify({ company: "Nordic Cold" }),
      }));
    assert.equal(good.status, 200);
    const after = await (await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD))).json();
    assert.equal(after.contacts[0].company, "Nordic Cold");
    assert.equal(after.contacts[0].name, "Dana Wu", "an untouched field survives the edit");
  });

  await t.test("another firm cannot read, edit or delete these contacts", async () => {
    const { srv, org, tables } = await firmWithMike(t);
    await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ name: "Dana Wu", email: "dana@acme.com" }),
    }));
    const id = tables.org_contacts[0].id;

    // The outsider is in no firm at all.
    for (const [method, path] of [
      ["GET", `/api/org/contacts?id=${encodeURIComponent(org.id)}`],
      ["PATCH", `/api/org/contacts?id=${encodeURIComponent(org.id)}&contact=${encodeURIComponent(id)}`],
      ["DELETE", `/api/org/contacts?id=${encodeURIComponent(org.id)}&contact=${encodeURIComponent(id)}`],
    ]) {
      const res = await fetch(srv.base + path, as(OUTSIDER, {
        method, ...(method === "PATCH" ? { body: JSON.stringify({ name: "Stolen" }) } : {}),
      }));
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    assert.equal(tables.org_contacts.length, 1, "and nothing was written or removed");
    assert.equal(tables.org_contacts[0].name, "Dana Wu");
  });

  await t.test("a delete is scoped to the firm as well as the id", async () => {
    const { srv, org, tables } = await firmWithMike(t);
    await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ name: "Dana Wu", email: "dana@acme.com" }),
    }));
    const id = tables.org_contacts[0].id;

    // Brad's own firm, a real id, but the WRONG org in the query — the shape a
    // scoping bug would let through.
    const wrongOrg = await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent("00000000-0000-4000-8000-000000000000")}` +
      `&contact=${encodeURIComponent(id)}`, as(BRAD, { method: "DELETE" }));
    assert.equal(wrongOrg.status, 403, "membership is checked before the row is ever looked up");
    assert.equal(tables.org_contacts.length, 1);

    const ok = await fetch(srv.base +
      `/api/org/contacts?id=${encodeURIComponent(org.id)}&contact=${encodeURIComponent(id)}`,
      as(BRAD, { method: "DELETE" }));
    assert.equal(ok.status, 200);
    assert.equal(tables.org_contacts.length, 0);
  });

  await t.test("the fake understood every filter these routes sent", async () => {
    const { srv, org, db } = await firmWithMike(t);
    await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD, {
      method: "POST", body: JSON.stringify({ csv: CONTACT_CSV }),
    }));
    await fetch(srv.base + `/api/org/contacts?id=${encodeURIComponent(org.id)}`, as(BRAD));
    assert.deepEqual(db.unparsed, [],
      `fake-supabase refused a filter: ${db.unparsed.join(", ")}`);
  });
});
