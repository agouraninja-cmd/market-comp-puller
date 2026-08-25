const test = require("node:test");
const assert = require("node:assert");
const DEMAND = require("../search-demand");

// Every test here is a way the demand figure could lie to a broker. The
// module's header lists the four rules; these pin them, plus the shapes the
// desk card depends on.

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0); // 2026-08-25T12:00:00Z
const ago = (days, hours) =>
  new Date(NOW - days * 86400000 - (hours || 0) * 3600000).toISOString();

const row = (over) => ({
  ts: ago(1),
  kind: "search",
  prop_type: "Industrial",
  market: "Boise, ID",
  source: "",
  visitor_id: "v1",
  user_id: "",
  ...over,
});

const agg = (rows, over) => DEMAND.aggregateDemand(rows, {
  now: NOW,
  windowDays: DEMAND.DEMAND_WINDOW_DAYS,
  ...over,
});

test("what counts as demand", async (t) => {
  await t.test("a completed search counts", () => {
    const out = agg([row()]);
    assert.equal(out["Boise, ID"].searches, 1);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("a blocked search counts: the visitor wanted the same answer", () => {
    const out = agg([row({ kind: "signup_gate", visitor_id: "v9" })]);
    assert.equal(out["Boise, ID"].searches, 1);
  });

  await t.test("kinds that ride along with a search never count", () => {
    // portfolio_add is written by the SAME request as the search above it.
    // Counting it would double every signed-in subscriber's activity.
    const out = agg([
      row({ kind: "portfolio_add" }),
      row({ kind: "portfolio_refresh" }),
      row({ kind: "watchlist_add" }),
      row({ kind: "bov" }),
      row({ kind: "lead" }),
      row({ kind: "feed_view" }),
    ]);
    assert.deepEqual(out, {});
  });

  await t.test("an Explorer sweep never counts", () => {
    // One Pro subscriber walking a market must not read as a demand spike.
    const out = agg([
      row({ source: "explore" }),
      row({ kind: "signup_gate", source: "explore" }),
    ]);
    assert.deepEqual(out, {});
  });

  await t.test("a non-canonical market is dropped, not reported", () => {
    // The analytics market column has held a street address in production.
    const out = agg([
      row({ market: "1200 W Front St" }),
      row({ market: "" }),
      row({ market: "Boise" }),
    ]);
    assert.deepEqual(out, {});
  });

  await t.test("rows outside the window are dropped", () => {
    const out = agg([row({ ts: ago(31) }), row({ ts: ago(29) })]);
    assert.equal(out["Boise, ID"].searches, 1);
  });
});

test("the broker's own searches are not reported back to them", async (t) => {
  await t.test("excludeUserId removes them", () => {
    const rows = [
      row({ user_id: "broker-1", visitor_id: "vb" }),
      row({ user_id: "someone-else", visitor_id: "vx" }),
    ];
    const out = agg(rows, { excludeUserId: "broker-1" });
    assert.equal(out["Boise, ID"].searches, 1);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("the id is compared as a string across both stores", () => {
    // uuid in the database, plain string in account-store.json.
    const out = agg([row({ user_id: 42, visitor_id: "vb" })], { excludeUserId: "42" });
    assert.deepEqual(out, {});
  });

  await t.test("no excludeUserId leaves everything in place", () => {
    const out = agg([row({ user_id: "broker-1" })]);
    assert.equal(out["Boise, ID"].searches, 1);
  });
});

test("one attempt is one search", async (t) => {
  await t.test("a gate followed by a search on the same day counts once", () => {
    const out = agg([
      row({ kind: "signup_gate", visitor_id: "v1", ts: ago(2, 1) }),
      row({ kind: "search", visitor_id: "v1", ts: ago(2) }),
    ]);
    assert.equal(out["Boise, ID"].searches, 1);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("a gate on a different day still counts", () => {
    const out = agg([
      row({ kind: "signup_gate", visitor_id: "v1", ts: ago(5) }),
      row({ kind: "search", visitor_id: "v1", ts: ago(2) }),
    ]);
    assert.equal(out["Boise, ID"].searches, 2);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("a gate in a market the visitor never completed still counts", () => {
    const out = agg([
      row({ kind: "signup_gate", market: "Nampa, ID", visitor_id: "v1" }),
      row({ kind: "search", market: "Boise, ID", visitor_id: "v1" }),
    ]);
    assert.equal(out["Nampa, ID"].searches, 1);
    assert.equal(out["Boise, ID"].searches, 1);
  });
});

test("people and searches are different numbers", async (t) => {
  await t.test("one visitor running six searches is one person", () => {
    const rows = [0, 1, 2, 3, 4, 5].map((i) => row({ ts: ago(i + 1) }));
    const out = agg(rows);
    assert.equal(out["Boise, ID"].searches, 6);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("a signed-in row with no visitor id falls back to the user id", () => {
    const out = agg([
      row({ visitor_id: "", user_id: "u1", ts: ago(1) }),
      row({ visitor_id: "", user_id: "u1", ts: ago(2) }),
    ]);
    assert.equal(out["Boise, ID"].searches, 2);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("rows attributed to nobody collapse into one person, never many", () => {
    // The direction that matters: 700 unattributed log lines must not be
    // reported to a broker as 700 people. Undercounting is the allowed error.
    const out = agg([
      row({ visitor_id: "", user_id: "", ts: ago(1) }),
      row({ visitor_id: "", user_id: "", ts: ago(2) }),
      row({ visitor_id: "", user_id: "", ts: ago(3) }),
    ]);
    assert.equal(out["Boise, ID"].searches, 3);
    assert.equal(out["Boise, ID"].viewers, 1);
  });

  await t.test("an unattributed market's people count is never zero while it has searches", () => {
    // "0 people ran 4 searches" is not a sentence the card can render.
    const out = agg([row({ visitor_id: "", user_id: "" })]);
    assert.ok(out["Boise, ID"].viewers >= 1);
  });
});

test("markets and types stay separate", async (t) => {
  await t.test("each market gets its own bucket", () => {
    const out = agg([
      row({ market: "Boise, ID" }),
      row({ market: "Nampa, ID", visitor_id: "v2" }),
    ]);
    assert.equal(out["Boise, ID"].searches, 1);
    assert.equal(out["Nampa, ID"].searches, 1);
  });

  await t.test("types are counted within a market", () => {
    const out = agg([
      row({ prop_type: "Industrial" }),
      row({ prop_type: "Retail", visitor_id: "v2" }),
      row({ prop_type: "Retail", visitor_id: "v3" }),
    ]);
    assert.deepEqual(out["Boise, ID"].by_type, { Industrial: 1, Retail: 2 });
  });
});

test("the wire shape the desk card reads", async (t) => {
  await t.test("in_type is a subset of searches, never a second total", () => {
    const out = agg([
      row({ prop_type: "Industrial" }),
      row({ prop_type: "Retail", visitor_id: "v2" }),
    ]);
    const p = DEMAND.demandPayload(out["Boise, ID"], "Industrial", 30);
    assert.equal(p.searches, 2);
    assert.equal(p.in_type, 1);
    assert.ok(p.in_type <= p.searches);
  });

  await t.test("a market with no rows answers zero rather than nothing", () => {
    // The card must render "nobody searched this" instead of blanking.
    const p = DEMAND.demandPayload(undefined, "Industrial", 30);
    assert.deepEqual(p, { window_days: 30, searches: 0, viewers: 0, in_type: 0 });
  });

  await t.test("viewers never exceeds searches", () => {
    const out = agg([row(), row({ visitor_id: "v2" }), row({ visitor_id: "v2", ts: ago(3) })]);
    const p = DEMAND.demandPayload(out["Boise, ID"], "Industrial", 30);
    assert.ok(p.viewers <= p.searches);
  });

  await t.test("nothing identifying survives the aggregate", () => {
    const out = agg([row({ visitor_id: "v-secret", user_id: "u-secret" })]);
    const serialized = JSON.stringify(out);
    assert.ok(!serialized.includes("v-secret"));
    assert.ok(!serialized.includes("u-secret"));
    assert.ok(!Object.prototype.hasOwnProperty.call(out["Boise, ID"], "_seen"));
  });
});

test("the cutoff the database query is given matches the one applied here", () => {
  const cutoff = DEMAND.demandCutoff(NOW, 30);
  assert.equal(cutoff, new Date(NOW - 30 * 86400000).toISOString());
  // A row exactly at the cutoff is inside the window, so a query using
  // gte on this value cannot exclude a row the aggregate would have kept.
  const out = agg([row({ ts: cutoff })]);
  assert.equal(out["Boise, ID"].searches, 1);
});

test("bad input is answered, never thrown", async (t) => {
  await t.test("junk rows are skipped", () => {
    assert.deepEqual(agg([null, undefined, {}, 7, "x", []]), {});
  });
  await t.test("a non-array answers an empty aggregate", () => {
    assert.deepEqual(agg(null), {});
    assert.deepEqual(agg(undefined), {});
  });
});
