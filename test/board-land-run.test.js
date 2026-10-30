// The Board's land markets read per acre (2026-10-21), against a real server
// and the stand-in database. board.test.js proves the row; only a running
// server can prove the feed works out a land market's median per acre from
// the corpus, reads its change and line in that unit, and leaves every other
// market (and the digest's median_psf) exactly as it was.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const U = { id: "44444444-4444-4444-8444-444444444444", email: "dev@example.com", name: "Dev" };

// A month label parseDealDate reads, `back` months ago.
function monthsAgo(back) {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() - back);
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] + " " + d.getUTCFullYear();
}
const NOW = new Date().toISOString();
const sale = (n, type, acre, psf, back) => ({
  ts: NOW, dedupe_key: "k" + type + n, address: `${n} W Overland Rd, Boise, ID 83709`, market: "Boise, ID", property_type: type,
  transaction: "Sale", deal_date: monthsAgo(back), price_or_rate: "$5,000,000", size_sqft: psf ? "300000" : null,
  price_per_sqft: psf, price_per_acre: acre, lot_acres: acre ? "7.8" : null, cap_rate: null, source_url: "", source_type: "public_record", verified: false,
});

test("a land market on The Board is priced per acre; an industrial one is untouched", async (t) => {
  const tables = {
    users: [{ ...U, pro_tester: false, vault_beta: false, created_at: "2025-01-01T00:00:00Z" }],
    sessions: [{ token_hash: sha256("tok-" + U.id), user_id: U.id, expires_at: YEAR_OUT }],
    subscriptions: [{ user_id: U.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    watchlist_items: [
      { id: "w-land", user_id: U.id, market: "Boise, ID", property_type: "Land", created_at: "2026-01-01T00:00:00Z", last_seen_at: NOW },
      { id: "w-ind", user_id: U.id, market: "Boise, ID", property_type: "Industrial", created_at: "2026-01-02T00:00:00Z", last_seen_at: NOW },
    ],
    // Three land sales priced per acre (two with no $/SF at all, the common
    // case), and three industrial sales priced per SF.
    comp_corpus: [
      sale(1, "Land", 650000, 15, 1), sale(2, "Land", 600000, null, 2), sale(3, "Land", 700000, null, 3),
      sale(4, "Industrial", null, 160, 1), sale(5, "Industrial", null, 170, 2), sale(6, "Industrial", null, 180, 3),
      // The six months before, so the land market has an acre trend.
      // Harvested back then too, so the six-month median above stays the
      // three recent sales.
      ...[sale(7, "Land", 480000, null, 8), sale(8, "Land", 500000, null, 9), sale(9, "Land", 520000, null, 10)]
        .map((r) => ({ ...r, ts: new Date(Date.now() - 270 * 864e5).toISOString() })),
    ],
    analytics_events: [], search_cache: [], market_pages: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); });
  const r = await fetch(srv.base + "/api/watchlist/feed", { headers: { cookie: `cn_session=tok-${U.id}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  const land = j.items.find((x) => x.property_type === "Land");
  const ind = j.items.find((x) => x.property_type === "Industrial");
  assert.ok(land && ind, JSON.stringify(j.items.map((x) => x.property_type)));
  assert.equal(land.median_per_acre, 650000, "the upper-middle of 600K, 650K and 700K");
  assert.equal(land.median_psf, 15, "median_psf stays, for the digest");
  // Its change is per acre, beside (never in place of) the $/SF trend the
  // digest email quotes with "/SF": one $/SF sale a side is no trend at all.
  assert.deepEqual(land.median_trend_acre, { current: 650000, prior: 500000 });
  assert.equal(land.median_trend, undefined, "the $/SF trend is never filled with acre figures");
  assert.equal(ind.median_trend_acre, undefined);
  assert.ok(land.comps.every((c) => "price_per_acre" in c), "a land market's new comps carry their $/acre");
  assert.equal(ind.median_per_acre, undefined, "only land is priced per acre");
  assert.equal(ind.median_psf, 170);
  assert.ok(ind.comps.every((c) => !("price_per_acre" in c)));
  assert.equal(db.unparsed.length, 0, JSON.stringify(db.unparsed));
});
