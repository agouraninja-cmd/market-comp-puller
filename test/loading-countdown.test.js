// The time left on the single report's loading card (index.html, 2026-11-10).
//
// The comp report page (/bulk) got a bar with the time left first; this is the
// same countdown on the card a re-run and a property's "Refresh value" show.
// Its rules are about what the card says over time, so the block is lifted out
// of index.html and EXECUTED against a stand-in page with a clock the test
// moves by hand. The sentence is the comp report page's own
// (BULKRUN.leftWords, from the run view server.js injects into index.html),
// so the real one is mounted here rather than restated.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BULK = require("../bulk.js");
const BULKPAGE = require("../bulk-page");

// The countdown's own block: its state and its three functions.
function countdownSource() {
  const from = INDEX.indexOf('  const LOADING_STOCK_DETAIL = "This usually takes 20-60 seconds.";');
  assert.ok(from > -1, "the countdown block is gone from index.html");
  const last = INDEX.indexOf("  function stopLoadingCountdown() {", from);
  assert.ok(last > -1, "stopLoadingCountdown is gone");
  const end = INDEX.indexOf("\n  }\n", last) + 5;
  return INDEX.slice(from, end);
}

// One function out of index.html, by name, for the source-level checks.
function fn(name) {
  const at = INDEX.indexOf("  function " + name + "(");
  assert.ok(at > -1, name + " is gone from index.html");
  return INDEX.slice(at, INDEX.indexOf("\n  }\n", at) + 5);
}

function mount(opts) {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, textContent: "", hidden: false,
    classList: { contains(c) { return c === "hidden" && els[id].hidden; } },
  });
  el("loadingDetail").textContent = "This usually takes 20-60 seconds.";
  const clock = { t: 1700000000000 };
  const intervals = [];
  // The real words, from the real run view.
  const bulkCtx = { document: { getElementById: () => null, querySelectorAll: () => [] } };
  vm.runInNewContext(BULKPAGE.BULK_RUN_JS, bulkCtx);
  const ctx = {
    document: { getElementById: (id) => (opts && opts.missing === id ? null : el(id)) },
    window: { BULKRUN: opts && opts.noRunView ? undefined : bulkCtx.BULKRUN },
    Date: class extends Date { static now() { return clock.t; } },
    setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; },
    clearInterval: (id) => { if (id) intervals[id - 1] = null; },
    Number,
  };
  vm.runInNewContext(countdownSource() +
    "\nthis.api={start:startLoadingCountdown,draw:drawLoadingLeft,stop:stopLoadingCountdown};", ctx);
  return {
    el, clock, api: ctx.api,
    ticking: () => intervals.filter(Boolean),
    tick: (ms) => { clock.t += ms; intervals.filter(Boolean).forEach((i) => i.f()); },
    left: () => el("loadingLeft").textContent,
  };
}

// What the server sends with nothing timed yet: bulk.js's default.
const TYPICAL = BULK.typicalSearchMs([]);
const PACE = { phase: "pace", typical_ms: TYPICAL, late_after_ms: Math.round(TYPICAL - BULK.lateLeftMs(TYPICAL)) };

test("the card has a line for the time left, and it stays out of the live region", () => {
  const at = INDEX.indexOf('<div id="loadingCard"');
  const card = INDEX.slice(at, INDEX.indexOf("<!--BULK_RUN-->", at));
  const line = card.match(/<p id="loadingLeft"[^>]*>/);
  assert.ok(line, "the loading card lost #loadingLeft");
  // The card is role=status aria-live=polite; a countdown inside it would be
  // read aloud every few seconds.
  assert.match(line[0], /aria-live="off"/);
  // Its height is held, and so is the detail line's, so the card does not
  // jump when one fills and the other empties.
  assert.match(line[0], /min-height:1\.25rem/);
  assert.match(card, /<p id="loadingDetail"[^>]*min-height:1\.25rem/);
  // Under the bar, not above it.
  assert.ok(card.indexOf('id="loadingLeft"') > card.indexOf('id="loadingBar"'));
  // Ships empty: no time is quoted until the server gives one.
  assert.match(card, /<p id="loadingLeft"[^>]*><\/p>/);
});

test("it counts down from the server's pace, in the comp report page's words", () => {
  const v = mount();
  assert.equal(v.left(), "", "nothing before the server has said");
  v.api.start(PACE);
  assert.equal(v.left(), "About 50 seconds left", "47 seconds, said coarsely");
  assert.equal(v.ticking().length, 1);
  assert.equal(v.ticking()[0].ms, 1000);
  // The stock sentence quoted a range; with a real figure under the bar it goes.
  assert.equal(v.el("loadingDetail").textContent, "");
  v.tick(10000);
  assert.equal(v.left(), "About 40 seconds left");
  v.tick(20000);
  assert.equal(v.left(), "About 20 seconds left");
  v.tick(9000);
  assert.equal(v.left(), "A few seconds left", "8 seconds to go, and never 'About a few seconds'");
});

test("past its time it says so, and never promises seconds again", () => {
  const v = mount();
  v.api.start(PACE);
  v.tick(PACE.late_after_ms - 1000);
  assert.equal(v.left(), "A few seconds left", "still on time a second before");
  v.tick(1000);
  assert.equal(v.left(), "Taking a little longer than usual");
  v.tick(600000);
  assert.equal(v.left(), "Taking a little longer than usual", "ten minutes on, the same honest line");
  // The moment is the server's, the same rule a bulk row is judged by.
  const row = (spent) => BULK.runProgress({
    now: 1000000 + spent, startedAt: 1000000, typicalMs: TYPICAL, concurrency: 3,
    items: [{ id: "a", status: "running" }], runningSince: { a: 1000000 },
  });
  assert.equal(row(PACE.late_after_ms - 1000).late, false);
  assert.equal(row(PACE.late_after_ms + 1000).late, true);
});

test("no pace, no clock", () => {
  // A stream that never arrives (a buffering proxy) or an older answer with
  // no figure leaves the line empty and the stock sentence standing.
  for (const bad of [null, {}, { typical_ms: 0 }, { typical_ms: "soon" }, { typical_ms: -5 }]) {
    const v = mount();
    v.api.start(bad);
    assert.equal(v.left(), "", JSON.stringify(bad));
    assert.equal(v.ticking().length, 0);
    assert.equal(v.el("loadingDetail").textContent, "This usually takes 20-60 seconds.");
  }
  // A pace with no late moment falls back to the usual time itself.
  const v = mount();
  v.api.start({ typical_ms: 20000 });
  v.tick(19000);
  assert.equal(v.left(), "A few seconds left");
  v.tick(1000);
  assert.equal(v.left(), "Taking a little longer than usual");
  // Without the run view (the marker missing) there are no words, so no line:
  // better silent than a second wording of the same time.
  const w = mount({ noRunView: true });
  w.api.start(PACE);
  assert.equal(w.left(), "");
  // And a page without the line does not throw.
  const x = mount({ missing: "loadingLeft" });
  assert.doesNotThrow(() => { x.api.start(PACE); x.tick(5000); x.api.stop(); });
});

test("a hidden card starts no clock, and stopping clears it", () => {
  // A report opened from Home mid-search hides the card while the stream
  // behind it keeps sending events.
  const v = mount();
  v.el("loadingCard").hidden = true;
  v.api.start(PACE);
  assert.equal(v.ticking().length, 0);
  assert.equal(v.left(), "");

  const w = mount();
  w.api.start(PACE);
  w.tick(5000);
  w.api.stop();
  assert.equal(w.left(), "");
  assert.equal(w.ticking().length, 0, "nothing goes on ticking behind a finished search");
  // Starting again is a fresh count, with one ticker.
  w.api.start(PACE);
  assert.equal(w.left(), "About 50 seconds left");
  assert.equal(w.ticking().length, 1);
  // A detail line that already says something specific is left alone.
  const x = mount();
  x.el("loadingDetail").textContent = "This one should be quick.";
  x.api.start(PACE);
  assert.equal(x.el("loadingDetail").textContent, "This one should be quick.");
});

test("the card's own seams start, restart and stop the count", () => {
  const apply = fn("applyProgress");
  assert.match(apply, /if \(evt\.phase === "pace"\) \{\s*startLoadingCountdown\(evt\);/,
    "the pace event no longer starts the countdown");
  // A recheck is a second search, so the count starts over from the same pace.
  const retry = apply.slice(apply.indexOf('evt.phase === "retry"'));
  assert.match(retry, /if \(loadingPace\) startLoadingCountdown\(\{ typical_ms: loadingPace\.typicalMs, late_after_ms: loadingPace\.lateAfterMs \}\);/);
  // The clock is not a stage of the search: it must not claim lastPhase, or
  // the headline logic that reads it would see "pace" where it expects a stage.
  assert.match(apply, /evt\.phase !== "field" && evt\.phase !== "pace"\) ctx\.lastPhase = evt\.phase;/);
  // Every way the card ends or begins clears the last search's clock.
  for (const name of ["showLoadingCard", "completeLoadingCard", "hideLoadingCard"]) {
    assert.ok(fn(name).includes("stopLoadingCountdown();"), name + " leaves the old countdown running");
  }
  // One stock sentence, one copy: the markup's and the script's must agree,
  // because the countdown clears the detail line only while it still says it.
  assert.ok(fn("showLoadingCard").includes("setLoadingDetail(LOADING_STOCK_DETAIL);"));
  assert.match(INDEX, /<p id="loadingDetail"[^>]*>This usually takes 20-60 seconds\.<\/p>/);
});

test("the pace is a clock, not progress: it leaves the fallback animation running", async () => {
  // Found by photographing the card against a provider that sends no events:
  // the pace arrived first, was counted as progress, switched the wall-clock
  // simulation off, and the bar sat at 8% for the whole search.
  const at = INDEX.indexOf("  async function readProgressStream(");
  assert.ok(at > -1, "readProgressStream is gone");
  const src = INDEX.slice(at, INDEX.indexOf("\n  }\n", at) + 5);
  const run = async (events) => {
    const enc = new TextEncoder();
    const chunks = events.map((e) => enc.encode("event: " + e[0] + "\ndata: " + JSON.stringify(e[1]) + "\n\n"));
    const seen = [];
    let stopped = 0;
    const sandbox = {
      TextDecoder, JSON, Error, Date,
      applyProgress: (p) => seen.push(p.phase),
      stopFakeProgress: () => { stopped++; },
    };
    const ctx = { sawProgress: false, lastPhase: null, lastAt: 111 };
    const res = { body: { getReader: () => ({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) }) } };
    const state = {};
    const read = vm.runInNewContext("(" + src.trim().replace(/^async function readProgressStream/, "async function") + ")", sandbox);
    const out = await read(res, ctx, (p, c) => {
      seen.push(p.phase);
      // What the card knew at the moment each event was applied.
      state[p.phase] = { saw: c.sawProgress, lastAt: c.lastAt, stopped };
    });
    return { out, seen, state, ctx, stopped };
  };
  const r = await run([
    ["progress", { phase: "pace", typical_ms: 47000, late_after_ms: 39950 }],
    ["progress", { phase: "search", n: 1, query: "boise industrial sales" }],
    ["result", { comps: [] }],
  ]);
  assert.deepEqual(r.seen, ["pace", "search"], "both events still reach the card");
  assert.deepEqual(r.state.pace, { saw: false, lastAt: 111, stopped: 0 },
    "the pace must not count as progress, stop the simulation, or reset the watchdog's clock");
  assert.equal(r.state.search.saw, true);
  assert.equal(r.state.search.stopped, 1, "a real event still takes over from the simulation");
  assert.deepEqual(r.out, { comps: [] });
  // A stream that says only the pace (a provider that does not stream) never
  // claims to have seen progress, so the watchdog can bring the simulation back.
  const quiet = await run([["progress", { phase: "pace", typical_ms: 47000 }], ["result", { ok: 1 }]]);
  assert.equal(quiet.ctx.sawProgress, false);
  assert.equal(quiet.stopped, 0);
});
