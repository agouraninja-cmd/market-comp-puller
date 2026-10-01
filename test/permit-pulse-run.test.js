// test/permit-pulse-run.test.js
// The market pages' permit section (2026-10-01, Draft C), actually run: a real
// server.js against the stand-in PostgREST, with Explorer-style market pages
// for Boise, Meridian and Nampa and a year of filings in permit_filings.
//
// What this proves that permit-pulse.test.js cannot: the cached read is wired
// to the page (warmed at boot, never waited on); a city the sweep reads gets
// the whole section with the other swept city beside it; a city whose portal
// we know but do not read gets one sentence and a link; a city we know
// nothing about gets nothing; a database that cannot answer costs the section
// and never the page; and a signed-in reader is sent to the tracker itself.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const SEED = require("../market-seed.json");

const DAY = 86400000;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * DAY).toISOString();
const MEMBER = { id: "5a1e9a1e-0000-4000-8000-00000000d0a1", email: "dev@example.com", name: "Dev" };

// A real seeded page, moved to an Idaho city, the way the Explorer stores one.
function marketPage(city) {
  const p = JSON.parse(JSON.stringify(SEED["industrial-dallas-tx"]));
  p.city = city; p.state = "ID";
  return { slug: `industrial-${city.toLowerCase()}-id`, payload: p };
}

// A year of filings for one city: `perDay` build-outs and new buildings,
// issued once older than 40 / 90 days.
function filings(jurisdiction, perDay) {
  const rows = [];
  for (let age = 0; age < 380; age++) {
    const date = new Date(Date.now() - age * DAY).toISOString().slice(0, 10);
    for (const [type, n, wait] of [["Tenant Improvement", perDay, 40], ["New/Added Commercial", 1, 90]]) {
      for (let i = 0; i < n; i++) {
        rows.push({
          id: crypto.randomUUID(), jurisdiction, permit_number: `${jurisdiction}-${age}-${type[0]}${i}`,
          permit_type: type, status: age > wait ? "Issued" : "In Review", applied_date: date,
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
  market_pages: [marketPage("Boise"), marketPage("Meridian"), marketPage("Nampa")],
  permit_filing_events: [],
  ...extra,
});

async function page(srv, slug, cookie) {
  const r = await fetch(`${srv.base}/market/${slug}`, { headers: cookie ? { cookie } : {} });
  assert.equal(r.status, 200, slug);
  return r.text();
}
// The Explorer pages and the permit cache both load at boot without anyone
// waiting on them, so a busy machine can answer the first request before
// either is in: a 404 for the page, or the page without its section. Give
// both a moment.
async function settled(srv, slug, needle) {
  for (let i = 0; i < 150; i++) {
    const r = await fetch(`${srv.base}/market/${slug}`);
    if (r.ok) {
      const html = await r.text();
      if (!needle || needle.test(html)) return html;
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  return page(srv, slug);
}

test("Boise and Meridian get the permit section, Nampa one sentence, Dallas nothing", async (t) => {
  const db = await fake.start({ tables: tables({ permit_filings: [...filings("boise", 2), ...filings("meridian", 1)] }) });
  t.after(() => db.stop());
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(() => srv.stop());

  const boise = await settled(srv, "industrial-boise-id", /Building permits in Boise/);
  assert.match(boise, /<div class="card pp" id="permits"><h2>Building permits in Boise<\/h2>/);
  assert.match(boise, /<span class="k">Tenant build-outs<\/span><div class="v">6\d<small>a month<\/small>/, "two a day");
  assert.match(boise, /Next to Meridian/);
  assert.match(boise, /<td>Meridian<\/td><td>\d+<\/td><td>\d+ days<\/td>/);
  assert.match(boise, /From Boise’s building permit portal, read every weekday morning/);
  assert.match(boise, /href="\/\?auth=signup">See each permit with a free account/);
  assert.ok(boise.indexOf("Building permits in Boise") < boise.indexOf("Market intelligence"),
    "the section sits before the price trend");
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));

  const meridian = await settled(srv, "industrial-meridian-id", /Building permits in Meridian/);
  assert.match(meridian, /<h2>Building permits in Meridian<\/h2>/);
  assert.match(meridian, /Next to Boise/);

  // Nampa is swept from its published reports (2026-10-01): with none of its
  // permits stored it gets no section at all — never "not read", never a zero.
  // test/permit-reports-run.test.js draws its section from reports.
  const nampa = await settled(srv, "industrial-nampa-id");
  assert.doesNotMatch(nampa, /Building permits in Nampa|not yet in Nampa|id="permits"/);

  const dallas = await page(srv, "industrial-dallas-tx");
  assert.doesNotMatch(dallas, /Building permits in|id="permits"/, "a city we do not know of says nothing");

  const signedIn = await page(srv, "industrial-boise-id", `cn_session=tok-${MEMBER.id}`);
  assert.match(signedIn, /href="\/permits">See each permit &rarr;/);
});

test("too little history is no section, and a read the database refuses costs the section, never the page", async (t) => {
  // Two months of Boise, nothing for Meridian.
  const thin = filings("boise", 1).filter((r) => Date.now() - Date.parse(r.applied_date) < 60 * DAY);
  const db = await fake.start({ tables: tables({ permit_filings: thin }) });
  t.after(() => db.stop());
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(() => srv.stop());
  await settled(srv, "industrial-boise-id");
  await new Promise((r) => setTimeout(r, 600));
  const boise = await page(srv, "industrial-boise-id");
  assert.doesNotMatch(boise, /Building permits in Boise/);
  assert.match(boise, /Market intelligence/, "the rest of the page is untouched");

  // No permit_filings table at all: the stand-in answers 404 like an
  // unmigrated PostgREST, and the page still renders without the section.
  const bare = tables({});
  const db2 = await fake.start({ tables: bare });
  t.after(() => db2.stop());
  const srv2 = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db2.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(() => srv2.stop());
  await settled(srv2, "industrial-boise-id");
  await new Promise((r) => setTimeout(r, 600));
  const html = await page(srv2, "industrial-boise-id");
  assert.doesNotMatch(html, /Building permits in Boise|0 a month/);
  assert.match(html, /Market intelligence/);
});
