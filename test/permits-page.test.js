// The Permit tracker (/permits, under Tools — 2026-09-24).
//
// Three things are pinned here. The page's own script compiles (the whole
// page is one template literal, so a stray backtick or single-backslash
// escape ships a page that renders and does nothing). The route, against the
// stand-in PostgREST: a signed-out reader gets the sign-in wall and no
// filings; a member gets the window, newest first, with the filing at their
// firm's building marked; an old filing and an unswept city stay out. And
// the nav: "Permit tracker" is a Tools row on BOTH nav authors, directly
// after Market explorer.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");
const VAULT = require("../broker-vault");
const PF = require("../permit-filings");
const { renderPermitsBody } = require("../permits-page");

const ROOT = path.join(__dirname, "..");
const SERVER_JS = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SRC = fs.readFileSync(path.join(ROOT, "permits-page.js"), "utf8");

test("the page's script compiles, and the literal interpolates the boot alone", () => {
  for (const boot of [null, { s: 401, j: {} }, { s: 200, j: { filings: [] } }]) {
    const html = renderPermitsBody(boot);
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m);
    assert.doesNotThrow(() => new Function(m[1]));
  }
  const literal = SRC.slice(SRC.indexOf("return `<style>"), SRC.lastIndexOf("</script>`"));
  assert.deepEqual([...literal.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]), ["bootJson"]);
  assert.equal((literal.match(/`/g) || []).length, 1, "only the literal's own opener");
  // HTML text outside the script takes the character, not an escape: the
  // first capture printed "city\u2019s" on the page.
  const markup = renderPermitsBody(null).split("<script>")[0];
  assert.equal(/\\u[0-9a-f]{4}/i.test(markup), false, "no literal \\uXXXX in the page's HTML text");
  assert.ok(renderPermitsBody({ s: 200, j: { filings: [{ address: "</script><b>" }] } }).includes("\\u003c/script>"),
    "the boot escapes < so a portal string cannot close the script");
});

test("Permit tracker is a Tools row on both nav authors, right after Market explorer", () => {
  for (const [name, src] of [["server.js", SERVER_JS], ["index.html", INDEX_HTML]]) {
    const me = src.indexOf('<a href="/markets"', src.indexOf('class="navsec">Tools<'));
    const pt = src.indexOf('<a href="/permits"', me);
    assert.ok(me > -1 && pt > me && pt - me < 400, `${name}: /permits follows Market explorer`);
  }
  assert.ok(/CTA_FREE_PAGES = new Set\([^)]*"\/permits"/.test(SERVER_JS), "a working page drops the red CTA");
});

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const NOW = new Date().toISOString();
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const dayAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const BRAD = { id: "u-brad", email: "brad@colliers.com", name: "Brad" };
const SOLO = { id: "u-solo", email: "solo@nowhere.com", name: "Solo" };
const ORG = "5a1e9a1e-0000-4000-8000-000000000001";
const B1 = "5a1e9a1e-0000-4000-8000-0000000000b1";
const fl = (street, over) => ({
  id: crypto.randomUUID(), jurisdiction: "boise", permit_number: "BLD-" + crypto.randomUUID().slice(0, 6),
  permit_type: "Tenant Improvement", description: null, project_name: null, address: street,
  street_key: PF.streetKey(street, VAULT.addressKey), market: "Boise, ID", parcel_number: null, zoning: "C-2",
  is_industrial: false, applicant_company: "Somebody LLC", contractor_company: null, applied_date: dayAgo(2),
  status: "Received", status_changed_at: null, source_url: "https://aca-prod.accela.com/BOISE/x",
  first_seen_at: NOW, last_seen_at: NOW, ...over });

test("the /permits route, signed out and signed in", async (t) => {
  const db = await fake.start({ tables: {
    users: [BRAD, SOLO].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [BRAD, SOLO].map((u) => ({ token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT })),
    subscriptions: [],
    orgs: [{ id: ORG, name: "Colliers Boise", share_default: "none", seats: 5, kind: "broker" }],
    org_members: [{ id: crypto.randomUUID(), org_id: ORG, email: BRAD.email, user_id: BRAD.id, role: "owner",
      invited_at: NOW, joined_at: NOW, removed_at: null, auto_share: null }],
    org_buildings: [{ id: B1, org_id: ORG, address: "1450 W Mission Ave, Boise, ID 83705",
      address_key: VAULT.addressKey("1450 W Mission Ave, Boise, ID 83705"), verified_key: null, market: "Boise, ID",
      property_type: "Industrial", size_sqft: null, year_built: null, lat: null, lng: null,
      added_by_user_id: BRAD.id, added_by_name: "Brad", created_at: NOW, updated_at: NOW }],
    permit_filings: [
      fl("1450 W MISSION AVE", { permit_number: "ON-BOARD", applied_date: dayAgo(1), is_industrial: true, zoning: "I-2" }),
      fl("200 N 8TH ST", { permit_number: "OFFICE-TI", applied_date: dayAgo(3) }),
      fl("9 OLD RD", { permit_number: "TOO-OLD", applied_date: dayAgo(45) }),
      fl("1 NAMPA ST", { permit_number: "NAMPA-OFF", jurisdiction: "nampa", market: "Nampa, ID" }),
    ],
    permit_filing_events: [], analytics_events: [],
  } });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const page = async (user) => {
    const r = await fetch(`${srv.base}/permits`, user ? { headers: { cookie: `cn_session=tok-${user.id}` } } : {});
    const html = await r.text();
    assert.equal(r.status, 200);
    return { html, boot: JSON.parse(html.match(/var BOOT = (.*);\n/)[1]), headers: r.headers };
  };

  await t.test("signed out: the wall, and not one filing", async () => {
    const { html, boot, headers } = await page(null);
    assert.equal(boot.s, 401);
    assert.equal(html.includes("ON-BOARD"), false);
    assert.equal(headers.get("cache-control"), "no-store");
  });

  await t.test("a firm member: the window, newest first, their building's filing marked", async () => {
    const { html, boot } = await page(BRAD);
    assert.equal(boot.s, 200);
    assert.deepEqual(boot.j.filings.map((f) => f.permitNumber), ["ON-BOARD", "OFFICE-TI"],
      "the 45-day-old filing and the switched-off city stay out");
    assert.deepEqual(boot.j.filings[0].onBoard, { id: B1, address: "1450 W Mission Ave, Boise, ID 83705" });
    assert.equal(boot.j.filings[1].onBoard, null);
    assert.equal(boot.j.inFirm, true);
    assert.equal(boot.j.cities, "Boise and Meridian");
    assert.equal(boot.j.stale, false);
    assert.ok(html.includes('<a href="/permits" aria-current="page">Permit tracker</a>'), "the Tools row marks the page");
  });

  await t.test("a member with no firm still gets the list, with nothing marked", async () => {
    const { boot } = await page(SOLO);
    assert.equal(boot.s, 200);
    assert.equal(boot.j.inFirm, false);
    assert.equal(boot.j.filings.length, 2);
    assert.ok(boot.j.filings.every((f) => f.onBoard === null));
  });
});
