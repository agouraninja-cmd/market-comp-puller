// GET /buildings, actually served (Three Spaces, slice 4): the firm's whole
// list, from the same read the Workspace uses, behind the same membership
// gate. A no-file-fallback page can only be proved against the stand-in
// PostgREST — a bare boot stops at the 503.

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

function tables() {
  return {
    users: [BRAD, NOBODY].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [BRAD, NOBODY].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    orgs: [{ id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [{ id: crypto.randomUUID(), org_id: ORG_ID, email: BRAD.email, user_id: BRAD.id, role: "owner",
      invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null }],
    org_buildings: [
      { id: crypto.randomUUID(), org_id: ORG_ID, address: "1210 N 17th St, Boise, ID", address_key: "1210 n 17th st boise id",
        verified_key: null, market: "Boise, ID", property_type: "Industrial", size_sqft: 12500, year_built: 1994,
        lat: null, lng: null, added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: NOW },
    ],
    analytics_events: [],
  };
}
const as = (user) => ({ headers: { cookie: `cn_session=tok-${user.id}` } });

test("/buildings, served", async (t) => {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });

  await t.test("a member gets the whole list in the boot payload, no-store, noindex, with the rail's chrome", async () => {
    const r = await fetch(srv.base + "/buildings", as(BRAD));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("vary") || "", /cookie/i);
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    const html = await r.text();
    assert.match(html, /"s":200/);
    assert.match(html, /"name":"Colliers Boise"/);
    assert.match(html, /1210 N 17th St, Boise, ID/);
    assert.match(html, /"summary":"1 building · 1 Industrial"/, "the same line the Workspace states");
    assert.match(html, /"mine":true/);
    assert.doesNotMatch(html, /added_by_user_id|"org_id"/, "the wire shape is the allowlist");
    // marketShell: the header is there, the CTA is dropped (a page a member
    // works IN), and the way back is the Workspace row.
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    assert.doesNotMatch(nav, /Run a report/);
    assert.match(nav, /<a href="\/desk">Workspace<\/a>/);
  });

  await t.test("a tagged link still reaches the page — pagePath, never req.url", async () => {
    const r = await fetch(srv.base + "/buildings?utm_source=newsletter&fbclid=abc123", as(BRAD));
    assert.equal(r.status, 200);
    assert.match(await r.text(), /"s":200/);
    // No canonical assertion: the shell omits the link on a noindex page, which this is.
  });

  await t.test("a member of no firm is told so, and sees no other firm's rows", async () => {
    const html = await (await fetch(srv.base + "/buildings", as(NOBODY))).text();
    assert.match(html, /"s":403/);
    assert.doesNotMatch(html, /1210 N 17th St/);
  });

  await t.test("a signed-out reader is told to sign in, not shown an empty list", async () => {
    const html = await (await fetch(srv.base + "/buildings")).text();
    assert.match(html, /"s":401/);
    assert.doesNotMatch(html, /1210 N 17th St/);
  });

  await t.test("the fake refused nothing", () => {
    assert.deepEqual(db.unparsed, []);
  });
});
