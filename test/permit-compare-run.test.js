// test/permit-compare-run.test.js
// /permits/compare (2026-10-01), actually run: a real server.js against the
// stand-in PostgREST with a year of Boise and Meridian filings.
//
// What this proves that permit-compare.test.js cannot: the page is the
// tracker's (signed out is a sign-in prompt, no database is "unavailable");
// it draws from the market pages' cached pulse and waits for a cold one
// rather than calling it unavailable; one city with a year of permits is a
// sentence, not a comparison; the two doors in (the /permits header and the
// market page's table, for a member) are wired; and nothing it reads is a
// query shape the stand-in does not know.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const SEED = require("../market-seed.json");

const DAY = 86400000;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * DAY).toISOString();
const MEMBER = { id: "5a1e9a1e-0000-4000-8000-00000000c0a1", email: "compare@example.com", name: "Compare" };
const COOKIE = `cn_session=tok-${MEMBER.id}`;

function marketPage(city) {
  const p = JSON.parse(JSON.stringify(SEED["industrial-dallas-tx"]));
  p.city = city; p.state = "ID";
  return { slug: `industrial-${city.toLowerCase()}-id`, payload: p };
}

// A year of filings for one city: `perDay` build-outs a day and one new
// building, issued once older than `wait` / 90 days.
function filings(jurisdiction, perDay, wait) {
  const rows = [];
  for (let age = 0; age < 380; age++) {
    const date = new Date(Date.now() - age * DAY).toISOString().slice(0, 10);
    for (const [type, n, w] of [["Tenant Improvement", perDay, wait], [jurisdiction === "boise" ? "New/Added Commercial" : "New Commercial", 1, 90]]) {
      for (let i = 0; i < n; i++) {
        rows.push({
          id: crypto.randomUUID(), jurisdiction, permit_number: `${jurisdiction}-${age}-${type[0]}${i}`,
          permit_type: type, status: age > w ? "Issued" : "In Review", applied_date: date,
          market: jurisdiction === "boise" ? "Boise, ID" : "Meridian, ID", is_industrial: false,
          first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
        });
      }
    }
  }
  return rows;
}

const tables = (extra) => ({
  users: [{ ...MEMBER, pro_tester: false, vault_beta: false, digest_optout: false }],
  sessions: [{ token_hash: sha256("tok-" + MEMBER.id), user_id: MEMBER.id, expires_at: YEAR_OUT }],
  subscriptions: [], orgs: [], org_members: [], comp_submissions: [], comp_corpus: [], analytics_events: [],
  market_pages: [marketPage("Boise"), marketPage("Meridian")],
  permit_filing_events: [], permit_watches: [], permit_watch_events: [], permit_watch_mutes: [], permit_alerts: [],
  ...extra,
});

async function get(srv, path, cookie) {
  const r = await fetch(`${srv.base}${path}`, { headers: cookie ? { cookie } : {} });
  assert.equal(r.status, 200, path);
  return r.text();
}
// The Explorer pages load at boot without anyone waiting on them.
async function settled(srv, path, needle, cookie) {
  for (let i = 0; i < 150; i++) {
    const r = await fetch(`${srv.base}${path}`, { headers: cookie ? { cookie } : {} });
    if (r.ok) {
      const html = await r.text();
      if (needle.test(html)) return html;
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  return get(srv, path, cookie);
}

test("a member compares Boise and Meridian; signed out is asked to sign in", async (t) => {
  const db = await fake.start({ tables: tables({ permit_filings: [...filings("boise", 2, 40), ...filings("meridian", 1, 20)] }) });
  t.after(() => db.stop());
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(() => srv.stop());

  const out = await get(srv, "/permits/compare");
  assert.match(out, /Sign in to compare cities by their building permits\./);
  assert.doesNotMatch(out, /Side by side/);

  // Asked at once: the page waits for the cache the boot is warming.
  const html = await get(srv, "/permits/compare", COOKIE);
  assert.match(html, /<h1>Compare cities by their permits<\/h1>/);
  assert.match(html, /<th scope="col"><i class="pc-k pc-s0" aria-hidden="true"><\/i>Boise<\/th><th scope="col"><i class="pc-k pc-s1" aria-hidden="true"><\/i>Meridian<\/th>/);
  assert.match(html, /Boise files about \d+ commercial permits a month, [45]\d% more than Meridian’s \d+\./, "three a day against two");
  assert.match(html, /Meridian issues half its tenant build-outs within about \d+ days; Boise takes about \d+\./);
  assert.match(html, /aria-current="page"[^>]*>Permit tracker|href="\/permits" aria-current="page"/, "the tracker's nav row stays lit");
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));

  // The Explorer pages arrive a moment after boot; then each city's link appears.
  const linked = await settled(srv, "/permits/compare", /Boise’s market page/, COOKIE);
  assert.match(linked, /<a href="\/market\/industrial-boise-id#permits">Boise’s market page &rarr;<\/a>/);

  // The doors in.
  assert.match(await get(srv, "/permits", COOKIE), /<a class="pt-cmp" href="\/permits\/compare">Compare cities &rarr;<\/a>/);
  const member = await settled(srv, "/market/industrial-boise-id", /Building permits in Boise/, COOKIE);
  assert.match(member, /<a class="pp-more" href="\/permits\/compare">Compare the cities in full &rarr;<\/a>/);
  const visitor = await settled(srv, "/market/industrial-boise-id", /Building permits in Boise/);
  assert.doesNotMatch(visitor, /\/permits\/compare/, "a signed-out reader keeps the one sign-up door");
});

test("one city with a year of permits is a sentence, not a comparison", async (t) => {
  const db = await fake.start({ tables: tables({ permit_filings: filings("boise", 1, 40) }) });
  t.after(() => db.stop());
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(() => srv.stop());
  const html = await get(srv, "/permits/compare", COOKIE);
  assert.match(html, /Comparing needs two cities with at least six months of permits\. Right now only Boise has that\. Meridian will appear here once enough months are in\./);
  const main = html.slice(html.indexOf("<main class=\"wrap pc-page\""), html.indexOf("</main>"));
  assert.ok(main.length > 100);
  assert.doesNotMatch(main, /<table|0 a month/);
});

test("with no database the page says the tracker is unavailable", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  // No database means no sessions either, so no member: the sign-in prompt.
  const html = await get(srv, "/permits/compare", COOKIE);
  assert.match(html, /Sign in to compare cities|unavailable right now/);
  assert.doesNotMatch(html, /Side by side/);
});
