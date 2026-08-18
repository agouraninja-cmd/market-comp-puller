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

test("the firm's auto-share default, and the member's veto over it", async (t) => {
  const tables = seedTables();
  const ctx = await bootWithDb(tables);
  t.after(() => ctx.stop());
  const { srv } = ctx;

  const org = await (await fetch(srv.base + "/api/org",
    as(BRAD, { method: "POST", body: JSON.stringify({ name: "Colliers Boise" }) }))).json();
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
