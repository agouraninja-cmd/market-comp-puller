const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// The /vault page's FIRST PAINT carries the whole book.
//
// GET /vault bakes its first vault read into the page as
// window.__VAULT_BOOT__, and the page draws everything from it -- the trust
// line's Comps and Published cells, the market rollup, the medians, the table
// -- fetching again only on a filter change or an import. GET /api/vault
// answers 200 rows when a caller names no limit, and the boot used to ask
// with no params at all, so a broker with 290 comps opened a 200-comp vault
// and every figure on it described that slice. #trunc stayed hidden, because
// it fires at 1,000. Found 2026-09-25 against this fake with exactly this
// book: /api/vault?limit=1000 returned 290, the page showed 200 rows and
// "Published 19" where 26 were published.
//
// load() in vault-page.js has asked for ?limit=1000 since the page first
// fetched; the fix makes the server-side boot ask the same question. This
// boots a real server against the fake PostgREST (the vault has no file
// fallback, so nothing short of a database reaches the read) and compares
// what the page was handed with what the page's own fetch would get.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const BOOK = 290;        // past the 200 default, short of the 1,000 cap
const PUBLISHED = 26;    // spread through the book, most of them OLD

function book() {
  const comps = [];
  const submissions = [];
  const start = Date.parse("2026-09-01T00:00:00Z");
  for (let i = 0; i < BOOK; i++) {
    const id = `bc${String(i).padStart(3, "0")}`;
    // i = 0 is the most recent deal. Published comps sit at every 11th row,
    // so the newest 200 hold only some of them -- which is what made the
    // truncated count read 19 rather than 26.
    const published = i % 11 === 0 && submissions.length < PUBLISHED;
    const subId = published ? `sub-${i}` : null;
    if (published) {
      submissions.push({ id: subId, status: "approved",
        broker_email: "broker@example.com", cited_count: 0 });
    }
    comps.push({
      id, user_id: "u1", market: i % 2 ? "Meridian, ID" : "Boise, ID",
      property_type: "Industrial", address: `${100 + i} Main St`,
      deal_date: new Date(start - i * DAY).toISOString().slice(0, 10),
      transaction: "sale", price: 1000000 + i * 1000, size_sqft: 10000,
      price_per_sqft: 100 + i / 10,
      published, published_submission_id: subId,
    });
  }
  assert.equal(submissions.length, PUBLISHED, "fixture: the published count is the premise");
  return { comps, submissions };
}

function tables() {
  const { comps, submissions } = book();
  return {
    users: [
      // vault_beta: the comped-vault grant (migration 023), the cheapest
      // honest way to open a vault in a test.
      { id: "u1", email: "broker@example.com", vault_beta: true },
      { id: "u2", email: "other@example.com", vault_beta: true },
    ],
    sessions: [
      { id: "s1", user_id: "u1", token_hash: TOKEN_HASH,
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
    ],
    broker_comps: comps.concat([
      // Another broker's comp: the wider read must still be scoped first.
      { id: "other1", user_id: "u2", market: "Boise, ID", property_type: "Industrial",
        address: "999 Elsewhere Rd", deal_date: "2026-09-10", transaction: "sale",
        price: 5000000, size_sqft: 20000, price_per_sqft: 250,
        published: false, published_submission_id: null },
    ]),
    comp_submissions: submissions,
    broker_uploads: [],
    broker_profiles: [],
    org_members: [],
  };
}

async function bootWithDb() {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
  });
  return { db, srv, stop: async () => { srv.stop(); await db.stop(); } };
}

const auth = { headers: { cookie: `cn_session=${TOKEN}` } };

// What the page's inline script is handed. vault-page.js writes it as
// `window.__VAULT_BOOT__=<json>;` with every "<" escaped, which JSON.parse
// reads back as the same character.
function bootOf(html) {
  const m = html.match(/window\.__VAULT_BOOT__=(.*?);<\/script>/);
  assert.ok(m, "the page must carry its boot payload");
  return JSON.parse(m[1]);
}

test("the /vault boot payload carries a book past 200 comps whole", async (t) => {
  const { db, srv, stop } = await bootWithDb();
  t.after(stop);

  const r = await fetch(srv.base + "/vault", auth);
  assert.equal(r.status, 200);
  const boot = bootOf(await r.text());
  assert.equal(boot.s, 200, "the boot read itself must have succeeded");

  const comps = boot.j.comps;
  assert.equal(comps.length, BOOK,
    "every comp in the book must reach the first paint, not the newest 200");
  assert.equal(comps.filter((c) => c.published).length, PUBLISHED,
    "the trust line's Published cell counts this array -- it must be the whole book's");
  assert.ok(comps.some((c) => c.id === `bc${BOOK - 1}`),
    "the OLDEST comp must be there: a 200 cut drops from the old end");
  assert.ok(!comps.some((c) => c.user_id === "u2" || c.address === "999 Elsewhere Rd"),
    "a wider read is still scoped by user_id first and always");

  assert.deepEqual(db.unparsed, [],
    "every filter the boot sent must be one the fake understands, or the read is unproven");
});

test("the boot answers exactly what the page's own fetch would", async (t) => {
  const { srv, stop } = await bootWithDb();
  t.after(stop);

  const boot = bootOf(await (await fetch(srv.base + "/vault", auth)).text());
  // load() in vault-page.js: the path a filter change or an import takes.
  const live = await (await fetch(srv.base + "/api/vault?limit=1000", auth)).json();
  assert.deepEqual(boot.j.comps.map((c) => c.id), live.comps.map((c) => c.id),
    "the first paint and a reload must describe the same book, in the same order");
});
