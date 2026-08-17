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
