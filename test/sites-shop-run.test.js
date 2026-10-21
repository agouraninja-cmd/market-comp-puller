// /sites tells the rail which firm it read (2026-10-21), against a real
// server and the stand-in database. app-shell.md's rule: the rail shows
// Pipeline or Sites from a per-browser note that only Home wrote, so a
// development firm's member opening /sites on a new browser read "Pipeline"
// on the very page that is Sites. The page reads the firm's kind for its own
// wall anyway, so it corrects the note before the rail paints.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PEOPLE = [
  { id: "u-dev", email: "dev@ridgeline.example", name: "Dev" },
  { id: "u-brk", email: "brk@colliers.example", name: "Brk" },
  { id: "u-solo", email: "solo@solo.example", name: "Solo" },
];

test("/sites stamps the rail from the firm it read, and says nothing without one", async (t) => {
  const tables = {
    users: PEOPLE.map((p) => ({ ...p, pro_tester: false, vault_beta: false, digest_optout: false, created_at: "2025-01-01T00:00:00Z" })),
    sessions: PEOPLE.map((p) => ({ token_hash: sha256("tok-" + p.id), user_id: p.id, expires_at: YEAR_OUT })),
    subscriptions: PEOPLE.map((p) => ({ user_id: p.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false })),
    orgs: [], org_members: [], org_subscriptions: [], user_sites: [], analytics_events: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const as = (id, init = {}) => ({ ...init, headers: { "content-type": "application/json", cookie: `cn_session=tok-${id}` } });
  for (const [id, name, kind] of [["u-dev", "Ridgeline Dev", "development"], ["u-brk", "Colliers Boise", "broker"]]) {
    const r = await fetch(srv.base + "/api/org", as(id, { method: "POST", body: JSON.stringify({ name, kind }) }));
    assert.equal(r.status, 200, await r.text());
  }
  const page = async (id) => (await (await fetch(srv.base + "/sites", as(id))).text());
  const dev = await page("u-dev");
  assert.match(dev, /<script>window\.cnShopNav&&cnShopNav\(true\)<\/script>/, "a development firm's member reads Sites on /sites");
  // Stamped in the head, after the script that defines cnShopNav and before the rail.
  assert.ok(dev.indexOf("cnShopNav(true)") > dev.indexOf("window.cnShopNav=function"), "called before it is defined");
  assert.ok(dev.indexOf("cnShopNav(true)") < dev.indexOf("</head>"), "stamped after the rail painted");
  assert.match(await page("u-brk"), /<script>window\.cnShopNav&&cnShopNav\(false\)<\/script>/, "a broker firm's member is put back on Pipeline");
  assert.doesNotMatch(await page("u-solo"), /<script>window\.cnShopNav&&cnShopNav\((true|false)\)<\/script>/, "no firm read, nothing said");
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});

test("a firm share says where it landed in copy's words, never the code name 'desk'", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes("? `Link copied. Everyone at ${firm.name} can open it in Messages, under Reports.`"));
  assert.doesNotMatch(html, /`Link copied\. It is on \$\{firm\.name\}'s desk now\.`/);
});
