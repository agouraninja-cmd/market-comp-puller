// The deal wall on The Board (deal-wall.js): the buying read, what goes on the
// wall and in which tab, the cards, the photo math, and the privacy rule that
// a deal's address only ever reaches our own geocoder.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const DW = require("../deal-wall");
const SITES = require("../sites");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TODAY = "2026-10-06";
let n = 0;
function site(o) {
  n++;
  return Object.assign({ id: "00000000-0000-4000-8000-" + String(n).padStart(12, "0"), address: "1550 S Federal Way, Boise, ID 83716",
    market: "Boise, ID", property_type: "Industrial", stage: "prospect", dates: [], stage_dates: {},
    portfolio_item_id: null, updated_at: "2026-10-0" + (n % 9 + 1) + "T00:00:00Z" }, o);
}
const feedItem = (o) => Object.assign({ id: "w1", market: "Boise, ID", property_type: "Industrial", new_count: 3 }, o);

// ---- the buying read ----------------------------------------------------------

test("no signal is no read, never a default", () => {
  assert.equal(DW.buyingRead(null), null);
  assert.equal(DW.buyingRead(feedItem({})), null);
  assert.equal(DW.buyingRead(feedItem({ median_trend: { current: 100, prior: 0 } })), null, "a zero prior is not a trend");
  assert.equal(DW.buyingRead(feedItem({ direction: "sideways" })), null, "an unknown direction word is not a signal");
});

test("falling prices help a buyer, rising ones work against one, and two points either way is flat", () => {
  const down = DW.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 } }));
  assert.equal(down.lean, "good");
  assert.equal(down.reasons[0].text, "Prices down 4.6% in six months ($173 to $165/SF)");
  assert.equal(down.reasons[0].helps, "buyers");
  const up = DW.buyingRead(feedItem({ median_trend: { current: 131, prior: 120 } }));
  assert.equal(up.lean, "bad");
  assert.match(up.reasons[0].text, /^Prices up 9.2% in six months/);
  assert.equal(DW.buyingRead(feedItem({ median_trend: { current: 98, prior: 100 } })).lean, "good", "exactly -2% counts");
  const flat = DW.buyingRead(feedItem({ median_trend: { current: 99, prior: 100 } }));
  assert.equal(flat.lean, "mid");
  assert.match(flat.reasons[0].text, /^Prices flat/);
});

test("the market page's direction is the second signal, and the two can cancel", () => {
  assert.equal(DW.buyingRead(feedItem({ direction: "contracting" })).lean, "good");
  assert.equal(DW.buyingRead(feedItem({ direction: "expanding" })).lean, "bad");
  assert.equal(DW.buyingRead(feedItem({ direction: "flat" })).lean, "mid");
  const both = DW.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 }, direction: "expanding" }));
  assert.equal(both.lean, "mid");
  assert.deepEqual(both.reasons.map((r) => r.helps), ["buyers", "against"]);
  assert.equal(DW.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 }, direction: "contracting" })).score, 2);
});

test("a deal reads its own market and type off The Board, Land when it has no type", () => {
  const feed = [feedItem({}), feedItem({ id: "w2", property_type: "Land", market: "Meridian, ID" })];
  assert.equal(DW.feedFor(site({}), feed).id, "w1");
  assert.equal(DW.feedFor(site({ market: "Meridian, ID", property_type: null }), feed).id, "w2");
  assert.equal(DW.feedFor(site({ property_type: "Retail" }), feed), null);
});

// ---- what goes on the wall ------------------------------------------------------

test("the wall holds deals in progress and closed ones; tracking is not a card, passed is its own tab", () => {
  assert.ok(["prospect", "loi", "contract", "entitle", "owned"].every((st) => DW.onWall(site({ stage: st }))));
  assert.ok(!DW.onWall(site({ stage: "tracking" })));
  assert.ok(!DW.onWall(site({ stage: "passed" })));
  // The wall's stages are sites.js's: a renamed or added stage has to be met here too.
  for (const st of DW.LIVE) assert.ok(SITES.isBuying(st), st + " is not a buying stage in sites.js");
});

test("Entitlements is a tab for a development firm or a deal in it; Passed only when there is one", () => {
  const plain = [site({}), site({ stage: "loi" })];
  assert.deepEqual(DW.stageTabs(plain, false), ["prospect", "loi", "contract", "owned"]);
  assert.deepEqual(DW.stageTabs(plain, true), ["prospect", "loi", "contract", "entitle", "owned"]);
  assert.deepEqual(DW.stageTabs(plain.concat(site({ stage: "entitle" }), site({ stage: "passed" })), false),
    ["prospect", "loi", "contract", "entitle", "owned", "passed"]);
  assert.equal(DW.stepsFor(site({}), false).length, 4);
  assert.equal(DW.stepsFor(site({}), true).length, 5);
});

test("tabs and chips filter the wall, furthest-along first", () => {
  const list = [
    site({ stage: "prospect" }), site({ stage: "contract", address: "640 N Kings Rd, Nampa, ID 83687", market: "Nampa, ID" }),
    site({ stage: "owned" }), site({ stage: "passed" }), site({ stage: "tracking" }),
  ];
  assert.deepEqual(DW.filterSites(list, "all", "all").map((s) => s.stage), ["owned", "contract", "prospect"]);
  assert.deepEqual(DW.filterSites(list, "passed", "all").map((s) => s.stage), ["passed"]);
  assert.deepEqual(DW.filterSites(list, "all", "Nampa").map((s) => s.stage), ["contract"]);
  assert.deepEqual(DW.filterSites(list, "loi", "all"), []);
  const c = DW.counts(list);
  assert.equal(c.all, 3);
  assert.equal(c.passed, 1);
  assert.equal(DW.cityOf(site({ market: null, address: "12 Main St, Star, ID 83669" })), "Star");
});

test("in play is the asking prices of deals in progress, never closed or passed ones", () => {
  const list = [site({ asking_price: 1000000 }), site({ stage: "contract", asking_price: 2500000 }),
    site({ stage: "owned", asking_price: 9000000 }), site({ stage: "passed", asking_price: 9000000 }), site({ asking_price: null })];
  assert.equal(DW.inPlay(list), 3500000);
  assert.equal(DW.short(3500000), "$3.5M");
  assert.equal(DW.short(4000000), "$4M");
  assert.equal(DW.short(250000), "$250K");
});

// ---- cards --------------------------------------------------------------------------

test("a card says the stage, price, next date and the read, all escaped", () => {
  const s = site({ address: '<img src=x onerror=1>, Boise, ID', stage: "contract", asking_price: 3450000, acres: 18.4,
    dates: [{ on: "2026-10-10", label: "Due diligence ends" }, { on: "2026-12-01", label: "Closing" }] });
  const html = DW.cardHtml(s, { esc, escA: esc, today: TODAY, dev: false, feed: [feedItem({ median_trend: { current: 165, prior: 173 } })] });
  assert.ok(!html.includes("<img src=x"), "the address went out unescaped");
  assert.match(html, /class="dw-stamp dw-s-contract">Under contract</);
  assert.match(html, /<b>\$3.5M<\/b><span>\$188K\/ac<\/span>/);
  assert.match(html, /class="dw-due hot">Due diligence ends in 4 days</);
  assert.match(html, /Buying here: <b class="dw-l-good">Favorable<\/b>/);
  assert.equal((html.match(/<i class="on/g) || []).length, 3, "Under contract is the third of four steps");
});

test("a closed deal shows no read and no deadline; a deal off The Board shows no read", () => {
  const feed = [feedItem({ median_trend: { current: 165, prior: 173 } })];
  const owned = DW.cardHtml(site({ stage: "owned", dates: [{ on: "2026-10-08", label: "Walk-through" }] }), { esc, escA: esc, today: TODAY, feed });
  assert.ok(!/dw-read|dw-due/.test(owned));
  const elsewhere = DW.cardHtml(site({ market: "Nampa, ID" }), { esc, escA: esc, today: TODAY, feed });
  assert.ok(!/dw-read/.test(elsewhere));
  assert.match(DW.cardHtml(site({ asking_price: null }), { esc, escA: esc, today: TODAY, feed }), /No asking price yet/);
  assert.equal(DW.nextDate(site({ dates: [{ on: "2026-10-07", label: "Tour" }] }), TODAY).text, "Tour tomorrow");
  assert.equal(DW.nextDate(site({ dates: [{ on: "2026-10-01", label: "Old" }] }), TODAY), null);
});

// ---- photos ---------------------------------------------------------------------------

test("the photo crop is centred on the point and covered by tiles", () => {
  const ll = { lat: 43.5655, lng: -116.1905 }, w = 480, h = 160, z = 18;
  const tiles = DW.aerialTiles(ll, w, h, z);
  assert.ok(tiles.length >= 2 && tiles.length <= 6, tiles.length + " tiles");
  for (const t of tiles) assert.match(t.src, /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/18\/\d+\/\d+$/);
  assert.ok(Math.min(...tiles.map((t) => t.left)) <= 0 && Math.max(...tiles.map((t) => t.left + 256)) >= w, "a gap at the sides");
  assert.ok(Math.min(...tiles.map((t) => t.top)) <= 0 && Math.max(...tiles.map((t) => t.top + 256)) >= h, "a gap at the top or bottom");
});

test("⚠ the photo math matches index.html's aerialTileSpec", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const start = src.indexOf("function aerialTileSpec(ll, w, h, z) {");
  const end = src.indexOf("return tiles;", start);
  assert.ok(start > 0 && end > start, "aerialTileSpec moved");
  const spec = new Function(src.slice(start, src.indexOf("}", end) + 1) + "; return aerialTileSpec;")();
  for (const [ll, w, h, z] of [[{ lat: 43.5655, lng: -116.1905 }, 480, 160, 18], [{ lat: 40.71, lng: -74.0 }, 720, 220, 18], [{ lat: -33.9, lng: 151.2 }, 260, 156, 17]]) {
    assert.deepEqual(DW.aerialTiles(ll, w, h, z), spec(ll, w, h, z));
  }
});

// ---- the browser half, against a stub page ---------------------------------------------------

function stubRoot() {
  const on = {}, boxes = [];
  let drawn = null;
  const root = {
    innerHTML: "",
    addEventListener(type, fn) { (on[type] = on[type] || []).push(fn); },
    fire(type, e) { (on[type] || []).forEach((fn) => fn(e)); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel !== "[data-ph]") return [];
      // A real page keeps its elements between lookups; so does this stub,
      // until the markup is redrawn.
      if (root.innerHTML === drawn) return boxes;
      drawn = root.innerHTML;
      boxes.length = 0;
      for (const m of root.innerHTML.matchAll(/class="(dw-ph[^"]*)" data-ph="([^"]*)"/g)) {
        boxes.push({ className: m[1], painted: "", getAttribute: () => m[2].replace(/&amp;/g, "&"),
          insertAdjacentHTML(_, h) { this.painted += h; }, classList: { add() {} } });
      }
      return boxes;
    },
    boxes,
  };
  return root;
}
function target(attrs) {
  return { closest(sel) { const k = sel.replace(/^\[|\]$/g, ""); return k in attrs ? { getAttribute: (a) => attrs[a], disabled: false } : null; } };
}
const settle = () => new Promise((r) => setImmediate(r));
async function mountWith(answer) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null });
    const r = answer(String(url), init || {}) || { s: 404, j: {} };
    return Promise.resolve({ status: r.s, json: () => Promise.resolve(r.j) });
  };
  const root = stubRoot();
  const counts = [];
  const view = DW.mount({ root, esc, escA: esc, isDev: () => false, feed: () => [feedItem({ median_trend: { current: 165, prior: 173 } })],
    propTypes: ["Industrial", "Land"], setCount: (k) => counts.push(k) });
  await settle(); await settle(); await settle();
  return { root, calls, counts, view, done() { global.fetch = realFetch; } };
}

test("a free member sees the Pro door, not an error", async () => {
  const m = await mountWith((u) => (u === "/api/sites" ? { s: 403, j: { code: "pro_required" } } : null));
  try {
    assert.match(m.root.innerHTML, /Tracking the properties you.re chasing is part of Pro/);
    assert.equal(m.counts[m.counts.length - 1], null);
  } finally { m.done(); }
});

test("the wall draws, and a deal's address only ever goes to our own geocoder", async () => {
  const deals = [site({ stage: "contract", asking_price: 7900000, address: "640 N Kings Rd, Nampa, ID 83687", market: "Nampa, ID" }),
    site({ stage: "prospect", asking_price: 6400000 })];
  const m = await mountWith((u) => {
    if (u === "/api/sites") return { s: 200, j: { sites: deals, today: TODAY } };
    if (u === "/api/geocode") return { s: 200, j: { lat: 43.5655, lng: -116.1905 } };
    return null;
  });
  try {
    assert.match(m.root.innerHTML, /\$14.3M<\/b> in play/);
    assert.match(m.root.innerHTML, /data-city="Nampa"/);
    assert.equal(m.counts[m.counts.length - 1], 2);
    // Every request stayed on our own origin, and the addresses travelled only
    // in the body of POST /api/geocode -- never in a URL.
    for (const c of m.calls) assert.ok(c.url.startsWith("/api/"), "left the origin: " + c.url);
    const geo = m.calls.filter((c) => c.url === "/api/geocode");
    assert.equal(geo.length, 2);
    assert.ok(geo.every((c) => c.method === "POST" && /, id 83/.test(c.body.address)));
    assert.ok(m.calls.every((c) => !/Kings|Federal/i.test(c.url)), "an address went into a URL");
    // The photos were painted from imagery fetched by coordinates.
    assert.ok(m.root.boxes.every((b) => /server\.arcgisonline\.com/.test(b.painted)));
  } finally { m.done(); }
});

test("adding a property posts it to /api/sites as typed; closing one joins the properties first", async () => {
  const deal = site({ stage: "contract", asking_price: 7900000 });
  let sites = [deal];
  const m = await mountWith((u, init) => {
    if (u === "/api/sites" && (init.method || "GET") === "GET") return { s: 200, j: { sites, today: TODAY } };
    if (u === "/api/sites" && init.method === "POST") return { s: 200, j: { site: {} } };
    if (u === "/api/portfolio" && init.method === "POST") return { s: 200, j: { id: "11111111-1111-4111-8111-111111111111" } };
    if (u === "/api/sites/update") return { s: 200, j: { ok: true } };
    if (u === "/api/geocode") return { s: 200, j: {} };
    return null;
  });
  try {
    const form = { id: "dwAddForm", elements: [
      { name: "address", value: "990 W Bannock St, Boise, ID 83702" }, { name: "property_type", value: "Industrial" },
      { name: "stage", value: "loi" }, { name: "asking_price", value: "5,100,000" }, { name: "acres", value: "" },
      { name: "on", value: "2026-10-15" }, { name: "label", value: "LOI response due" }] };
    m.root.fire("submit", { target: form, preventDefault() {} });
    await settle();
    const add = m.calls.find((c) => c.url === "/api/sites" && c.method === "POST");
    assert.deepEqual(add.body, { address: "990 W Bannock St, Boise, ID 83702", property_type: "Industrial", stage: "loi",
      asking_price: "5,100,000", acres: "", dates: [{ on: "2026-10-15", label: "LOI response due" }] });

    m.root.fire("click", { target: target({ "data-open": deal.id }) });
    m.root.fire("click", { target: target({ "data-stage": "owned" }) });
    await settle(); await settle(); await settle();
    const urls = m.calls.map((c) => c.method + " " + c.url);
    const pf = urls.indexOf("POST /api/portfolio"), up = urls.indexOf("POST /api/sites/update");
    assert.ok(pf >= 0 && up > pf, "closing must add the property before marking the deal Owned: " + urls.join(", "));
    assert.deepEqual(m.calls[up].body, { id: deal.id, stage: "owned", portfolio_item_id: "11111111-1111-4111-8111-111111111111" });
  } finally { m.done(); }
});
