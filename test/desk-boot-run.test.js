// The workspace's data served WITH the page (2026-09-04) — see deskBootPayload
// in server.js. Runs against a real server.js child and the stand-in
// PostgREST, because the whole claim of that feature is "the embedded answer
// IS the route's answer": the only honest proof is to fetch both and compare.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 86400e3).toISOString();
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const MIKE = { id: "u-mike", email: "mike@colliers.com", name: "Mike" };
const SOLO = { id: "u-solo", email: "solo@example.com", name: "Solo" };
const ORG_ID = "9c1e9a1e-0000-4000-8000-000000000001";
const uuid = () => crypto.randomUUID();
// A contact name that would end the <script> early if the payload were
// written raw — the escape rule, exercised rather than asserted from source.
const EVIL = "Eve </script><script>alert(1)</script>";

function tables() {
  const member = (u, role) => ({ id: uuid(), org_id: ORG_ID, email: u.email, user_id: u.id, role,
    invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null });
  return {
    users: [BRAD, MIKE, SOLO].map((u) => ({ ...u, pro_tester: false, vault_beta: u !== SOLO, digest_optout: false })),
    sessions: [BRAD, MIKE, SOLO].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [BRAD, MIKE].map((u) => ({ user_id: u.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [{ id: ORG_ID, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [member(BRAD, "owner"), member(MIKE, "member")],
    org_buildings: [{
      id: uuid(), org_id: ORG_ID, address: "1210 N 17th St, Boise, ID", address_key: VAULT.addressKey("1210 N 17th St, Boise, ID"),
      verified_key: null, market: "Boise, ID", property_type: "Industrial", size_sqft: 12500, year_built: 1994, lat: null, lng: null,
      added_by_user_id: BRAD.id, added_by_name: BRAD.name, created_at: NOW, updated_at: NOW,
    }],
    shared_reports: [{
      id: uuid(), user_id: MIKE.id, org_id: ORG_ID, visibility: "org", revoked_at: null, created_at: NOW, shared_by_name: MIKE.name,
      payload: { meta: { address: "450 W Main St, Boise, ID", type: "Office", subject: { sizeMin: 12000 } }, data: { comps: [] } },
    }],
    org_contacts: [{ id: uuid(), org_id: ORG_ID, name: EVIL, company: "Acme", email: null, notes: null, building_id: null,
      added_by_user_id: BRAD.id, added_by_name: BRAD.name, created_at: NOW }],
    portfolio_items: [], recent_searches: [], broker_comps: [], broker_properties: [], org_comps: [],
    org_building_notes: [], org_leases: [], analytics_events: [], msg_threads: [], msg_thread_members: [], msg_messages: [],
  };
}

async function bootWithDb(extraEnv) {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "on", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co", ...(extraEnv || {}),
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}
const as = (user) => ({ headers: { cookie: `cn_session=tok-${user.id}` } });

// The payload as the browser would see it: what sits between
// `window.DESK_BOOT=` and the script's close. Null when the page carries none.
function bootOf(html) {
  const at = html.indexOf("window.DESK_BOOT=");
  if (at < 0) return null;
  const end = html.indexOf("</script>", at);
  const raw = html.slice(at + "window.DESK_BOOT=".length, end).replace(/;\s*$/, "");
  return { raw, payload: JSON.parse(raw) };
}

test("a member's page carries every workspace read, each equal to the route's own answer", async (t) => {
  const ctx = await bootWithDb();
  t.after(() => ctx.stop());
  const { srv } = ctx;
  const res = await fetch(srv.base + "/desk", as(BRAD));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes("<!--DESK_BOOT-->"), "the marker must be consumed, never served");
  const boot = bootOf(html);
  assert.ok(boot, "a member's page must carry window.DESK_BOOT");
  const keys = Object.keys(boot.payload);
  const id = encodeURIComponent(ORG_ID);
  for (const url of ["/api/config", "/api/account/me", "/api/portfolio", "/api/shares", "/api/org", "/api/branding",
    "/api/recents", "/api/messages/unread", `/api/org/members?id=${id}`, `/api/org/buildings?id=${id}`,
    "/api/messages", `/api/org/board?id=${id}`, `/api/org/shelf?id=${id}`, `/api/org/contacts?id=${id}`,
    `/api/org/leases?id=${id}`]) {
    assert.ok(keys.includes(url), `payload must carry ${url}; has ${keys.join(", ")}`);
  }
  // The claim: nothing here is a second copy of any read. Every entry is
  // what the route says to the same cookie.
  for (const url of keys) {
    const entry = boot.payload[url];
    assert.equal(entry.status, 200, url + " is only embedded when the route answered 200");
    const live = await fetch(srv.base + url, as(BRAD));
    assert.equal(live.status, 200, url + " live");
    assert.deepStrictEqual(entry.body, await live.json(), url + " must equal the live route's answer");
  }
  // The escape: the contact name is in there, and the script did not end early.
  assert.ok(boot.raw.includes("Eve \\u003c/script>"), "a `<` in a body is escaped");
  assert.ok(!boot.raw.includes("</script>"), "no raw close tag inside the payload");
  const contacts = boot.payload[`/api/org/contacts?id=${id}`].body.contacts;
  assert.equal(contacts[0].name, EVIL, "the browser reads the original string back");
  // Same page, same member, /: the other URL that opens the workspace.
  const root = await (await fetch(srv.base + "/", as(BRAD))).text();
  assert.ok(bootOf(root), "/ carries the payload for a member too");
});

test("a member of no firm gets the base reads and none of the firm's", async (t) => {
  const ctx = await bootWithDb();
  t.after(() => ctx.stop());
  const html = await (await fetch(ctx.srv.base + "/desk", as(SOLO))).text();
  const boot = bootOf(html);
  assert.ok(boot);
  const keys = Object.keys(boot.payload);
  assert.ok(keys.includes("/api/account/me") && keys.includes("/api/org"));
  assert.ok(!keys.some((k) => k.startsWith("/api/org/")), "no org-scoped URL without a firm: " + keys.join(", "));
  assert.ok(!keys.includes("/api/broker/leads"), "a non-broker's 403 is not embedded");
});

test("no session, a dead session, and a shared report carry nothing", async (t) => {
  const ctx = await bootWithDb();
  t.after(() => ctx.stop());
  const { srv } = ctx;
  // Anonymous /: the home page, under the wall. No payload and no marker.
  const anon = await (await fetch(srv.base + "/")).text();
  assert.ok(!anon.includes("DESK_BOOT"), "an anonymous page carries nothing");
  // A cookie the database does not know: the routes answer 401, the payload
  // is dropped whole, and the page is the ordinary signed-out app.
  const dead = await fetch(srv.base + "/?auth=signin", { headers: { cookie: "cn_session=not-a-session" } });
  assert.equal(dead.status, 200);
  const deadHtml = await dead.text();
  assert.ok(!deadHtml.includes("window.DESK_BOOT="), "a dead session embeds nothing");
  assert.ok(!deadHtml.includes("<!--DESK_BOOT-->"), "and the marker is still consumed");
  // A shared report is somebody else's link and never opens the reader's desk.
  const shared = await (await fetch(srv.base + "/r/abcdef12", as(BRAD))).text();
  assert.ok(!shared.includes("window.DESK_BOOT="), "/r/<id> carries no payload");
  assert.ok(!shared.includes("<!--DESK_BOOT-->"));
});

test("past the deadline the page ships without the payload, and is otherwise the same page", async (t) => {
  const ctx = await bootWithDb({ DESK_BOOT_DEADLINE_MS: "1" });
  t.after(() => ctx.stop());
  const res = await fetch(ctx.srv.base + "/desk", as(BRAD));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes("window.DESK_BOOT="), "nothing answered inside 1ms, so nothing is embedded");
  assert.ok(!html.includes("<!--DESK_BOOT-->"));
  assert.ok(html.includes('id="myDesk"'), "the app itself is untouched");
});
