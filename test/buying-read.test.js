// The buying read on The Board's market tiles (buying-read.js): how conditions
// look for buying in one market, computed from two public signals and never
// typed. It was half of deal-wall.js until the deal wall left The Board on
// 2026-10-09 (deals are a development firm's, on Home: test/home-sites.test.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BR = require("../buying-read");

const feedItem = (o) => Object.assign({ id: "w1", market: "Boise, ID", property_type: "Industrial", new_count: 3 }, o);

test("no signal is no read, never a default", () => {
  assert.equal(BR.buyingRead(null), null);
  assert.equal(BR.buyingRead(feedItem({})), null);
  assert.equal(BR.buyingRead(feedItem({ median_trend: { current: 100, prior: 0 } })), null, "a zero prior is not a trend");
  assert.equal(BR.buyingRead(feedItem({ direction: "sideways" })), null, "an unknown direction word is not a signal");
});

test("falling prices help a buyer, rising ones work against one, and two points either way is flat", () => {
  const down = BR.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 } }));
  assert.equal(down.lean, "good");
  assert.equal(down.reasons[0].text, "Prices down 4.6% in six months ($173 to $165/SF)");
  assert.equal(down.reasons[0].helps, "buyers");
  const up = BR.buyingRead(feedItem({ median_trend: { current: 131, prior: 120 } }));
  assert.equal(up.lean, "bad");
  assert.match(up.reasons[0].text, /^Prices up 9.2% in six months/);
  assert.equal(BR.buyingRead(feedItem({ median_trend: { current: 98, prior: 100 } })).lean, "good", "exactly -2% counts");
  const flat = BR.buyingRead(feedItem({ median_trend: { current: 99, prior: 100 } }));
  assert.equal(flat.lean, "mid");
  assert.match(flat.reasons[0].text, /^Prices flat/);
});

test("the market page's direction is the second signal, and the two can cancel", () => {
  assert.equal(BR.buyingRead(feedItem({ direction: "contracting" })).lean, "good");
  assert.equal(BR.buyingRead(feedItem({ direction: "expanding" })).lean, "bad");
  assert.equal(BR.buyingRead(feedItem({ direction: "flat" })).lean, "mid");
  const both = BR.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 }, direction: "expanding" }));
  assert.equal(both.lean, "mid");
  assert.deepEqual(both.reasons.map((r) => r.helps), ["buyers", "against"]);
  assert.equal(BR.buyingRead(feedItem({ median_trend: { current: 165, prior: 173 }, direction: "contracting" })).score, 2);
  assert.deepEqual(BR.LEANS, { good: "Favorable", mid: "Mixed", bad: "Tough" });
});

test("the module is the read and nothing else: the wall, its cards and its photos are gone", () => {
  assert.deepEqual(Object.keys(BR).sort(), ["FLAT_PCT", "LEANS", "buyingRead", "priceMove"]);
  for (const f of ["deal-wall.js", "test/deal-wall.test.js", "sites-tab.js"]) {
    assert.ok(!fs.existsSync(path.join(__dirname, "..", f)), f + " is back");
  }
});
