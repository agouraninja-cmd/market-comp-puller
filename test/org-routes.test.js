// Firm route wiring — the gates and the routing, not the rules.
//
// org-access.test.js already proves the DECISIONS are right. Nothing there
// proves they are WIRED: that every /api/org* route really refuses a signed-out
// caller before it looks at anything else, that an unknown path under /api/org
// 404s as JSON instead of quietly serving the SPA, and — the one that guards
// other people's reports — that the share read really consults membership
// rather than assuming it. A gate grows holes at the wiring, not at the rule.
//
// Spec: docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md
//
// Cost: zero. Nothing here calls Supabase, Anthropic or Stripe. The bare
// server has no database, which is a state several of these assert on.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const shared = require("./helpers/boot");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("firm routes on a bare server (no database)", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("every /api/org* route refuses a signed-out caller with 401", async () => {
    // 401 BEFORE 503, deliberately and in that order: "please sign in" is
    // actionable and "we are having a database problem" is not, and a caller
    // with no session has not earned the information that there is one.
    const calls = [
      ["GET", "/api/org"],
      ["POST", "/api/org"],
      ["GET", "/api/org/members?id=org1"],
      ["POST", "/api/org/invite"],
      ["POST", "/api/org/accept"],
      ["DELETE", "/api/org/member?org=org1&id=m1"],
    ];
    for (const [method, url] of calls) {
      const r = await fetch(srv.base + url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : "{}",
      });
      assert.equal(r.status, 401, `${method} ${url}`);
      const body = await r.json();
      assert.match(body.error, /sign in/i, `${method} ${url}`);
    }
  });

  await t.test("an unknown path under /api/org is a JSON 404, never the SPA", async () => {
    // The block matches on a prefix, so without its own trailing 404 a typo
    // would fall through to whatever route matched next — and eventually to
    // index.html, which answers 200 and looks like it worked.
    const r = await fetch(srv.base + "/api/org/nonsense");
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /application\/json/);
  });

  await t.test("a firm share id in the body cannot be trusted: the route re-reads membership", () => {
    // Read from the source rather than exercised, because proving it over HTTP
    // needs a database and two accounts. What must never appear is the org id
    // going from the request body into the stored row without a membership
    // lookup in between. `orgId = asked` is only ever reached after
    // ORG.membershipOf has answered.
    const i = SERVER.indexOf('if (visibility === "org") {');
    assert.ok(i > 0, "POST /api/share should have a firm branch");
    const branch = SERVER.slice(i, i + 1400);
    assert.match(branch, /orgMembershipsFor\(user\.email\)/,
      "membership must be read from the caller's own rows");
    assert.match(branch, /ORG\.membershipOf/, "and decided by org-access.js");
    assert.ok(branch.indexOf("ORG.membershipOf") < branch.indexOf("orgId = asked"),
      "the membership check must run BEFORE the org id is accepted");
  });

  await t.test("the share read passes membership to report-access.js, and only when it needs it", () => {
    // Two properties in one: canReadShare is CALLED with orgIds (without it
    // every firm share would refuse its own firm), and the membership read is
    // skipped for public and invited links so /r/<id> keeps its page-load cost.
    const i = SERVER.indexOf("SHAREACCESS.canReadShare({ share: rec.share");
    assert.ok(i > 0, "GET /api/shared should ask report-access.js");
    const call = SERVER.slice(i, i + 200);
    assert.match(call, /orgIds/, "canReadShare must be handed the caller's firms");
    const before = SERVER.slice(Math.max(0, i - 500), i);
    assert.match(before, /rec\.share\.visibility === "org"/,
      "and the membership read must be gated on the share actually being a firm share");
  });

  await t.test("nothing in server.js widens an existing user-scoped read to an org", () => {
    // The failure the whole design is shaped to avoid, and the one that would
    // look correct in review: `or=(user_id.eq.X,org_id.eq.Y)` on a vault read
    // returns [] on error and logs nothing a person reads.
    // Comment lines are stripped first: the rule is written down in
    // server.js's own firm section, and a check that matched its own warning
    // would fail the build for saying so.
    const code = SERVER.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(code, /or=\(\s*user_id\.eq/,
      "a firm read must be a new query against the new tables, never a widened one");
  });

  await t.test("/api/vault/firm refuses a signed-out caller before anything else", async () => {
    for (const method of ["POST", "DELETE"]) {
      const r = await fetch(srv.base + "/api/vault/firm", {
        method, headers: { "content-type": "application/json" }, body: "{}",
      });
      assert.equal(r.status, 401, method);
    }
  });

  await t.test("a firm comp blends at SERIALIZATION, downstream of the cache and the harvest", () => {
    // The rule blend-comps.js's header states, and the one that fails
    // silently in both directions: blend before the cache write and one
    // firm's private book is served to the next visitor who searches that
    // address; blend before harvestComps() and it enters the public corpus
    // permanently, on a path that swallows its own errors.
    const gateAt = SERVER.indexOf("const gate = async (rep) => {");
    const blendAt = SERVER.indexOf("BLEND.dedupeFirmComps");
    const harvestAt = SERVER.indexOf("harvestComps(");
    assert.ok(gateAt > 0 && blendAt > gateAt, "firm comps must blend inside gate()");
    assert.ok(harvestAt < gateAt || harvestAt > blendAt,
      "the harvest must never see a blended report");
  });

  await t.test("the firm comp read is gated on canUseVault and excludes the caller's own", () => {
    const i = SERVER.indexOf("async function orgCompsForReport");
    assert.ok(i > 0);
    const fn = SERVER.slice(i, i + 2200);
    assert.match(fn, /ent\.canUseVault/,
      "blending private comps is the vault capability, not a membership perk");
    assert.match(fn, /shared_by_user_id=neq\./,
      "the caller's own shared comps already arrive through vaultCompsForReport");
    assert.match(fn, /return \[\];/, "and it must fail closed to nothing");
  });

  await t.test("a firm session writes the firm's table, never the buyer's own", () => {
    // The failure worth a test rather than a comment: without the org_id
    // branch returning, a firm checkout would land a row in `subscriptions`
    // keyed on whoever clicked Buy — giving one person a personal
    // subscription their firm is paying for, and leaving the firm with none.
    const i = SERVER.indexOf('case "checkout.session.completed": {');
    assert.ok(i > 0);
    const branch = SERVER.slice(i, i + 4000);
    const orgAt = branch.indexOf("applyOrgSubscription");
    const userAt = branch.indexOf("await upsertSubscription(row)");
    assert.ok(orgAt > 0 && userAt > 0, "both paths should exist");
    assert.ok(orgAt < userAt, "the firm branch must be reached — and returned from — first");
  });

  await t.test("seat enforcement and the seat entitlement read one definition", () => {
    // One refusing a colleague the other would have granted Pro to is a
    // support ticket nobody can reproduce.
    assert.match(SERVER, /function seatCapOf\(org\)/);
    const uses = (SERVER.match(/seatCapOf\(/g) || []).length;
    assert.ok(uses >= 3, "declared once, used by both the invite gate and the seat read");
    assert.doesNotMatch(SERVER.replace(/function seatCapOf[\s\S]*?\n}/, ""),
      /Number\(org(Row)? && org(Row)?\.seats\)/,
      "nothing may read orgs.seats except that function");
  });

  await t.test("every read that feeds seatCapOf actually selects orgs.seats", () => {
    // The test above pins the funnel; this one pins the fuel, and the gap
    // between them is what shipped on 2026-08-16. orgsByIds() selected
    // `id,name,share_default`, so seatCapOf() got `undefined`, and its
    // documented fallback answered MAX_MEMBERS — 200 — for the invite gate,
    // the billing display AND the entitlement read. A firm with seats=2
    // accepted a third member without a word, and every member of a 2-seat
    // firm would have held Pro. Nothing failed, nothing logged: an omitted
    // PostgREST column is absent, not an error.
    //
    // Both MAX_MEMBERS and 030's column default are 200, which is why no
    // amount of reading caught it — the wrong answer and the right answer
    // were the same number until a firm bought a different one.
    for (const fn of ["orgsByIds", "findOrg"]) {
      const i = SERVER.indexOf(`async function ${fn}(`);
      assert.ok(i > 0, `${fn} should exist`);
      const body = SERVER.slice(i, i + 1200);
      const select = body.match(/orgs\?[^`]*?select=([a-z_,]+)/);
      assert.ok(select, `${fn} should read the orgs table with an explicit select`);
      assert.ok(select[1].split(",").includes("seats"),
        `${fn} must select orgs.seats — seatCapOf() reads a missing column as MAX_MEMBERS, ` +
        `so leaving it out disables the seat cap everywhere instead of failing`);
    }
  });

  await t.test("the firm share write is refused without a database, never written to the file store", () => {
    // The file store has no column for org_id, so a firm share landing there
    // would come back out of getShareRecord as a PUBLIC link. storeSharedReport
    // enforces this itself rather than trusting the route — the same rule 018
    // carries for invited shares, and it covers 'org' because the guard tests
    // `visibility !== "public"` rather than naming one visibility.
    const i = SERVER.indexOf("async function storeSharedReport");
    const fn = SERVER.slice(i, i + 4000);
    const guards = fn.match(/visibility !== "public"/g) || [];
    assert.ok(guards.length >= 2,
      "both the write-failure fallback and the no-database path must refuse a non-public share");
  });
});
