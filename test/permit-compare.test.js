// permit-compare.js — the swept cities side by side by their permits
// (2026-10-01).
//
// The rules with teeth: comparing needs two cities with a pulse, and one or
// none is a sentence, never a column of zeros; a city keeps its colour slot
// whichever other cities are present; the words claim a difference only past
// their thresholds (15% on counts, five points on trends, five days on
// waits); "against its own average" indexes each city to its own mean; every
// chart but the defaults is drawn hidden, so the page reads with no script;
// and the inlined script can never break the page literal it sits in.

const test = require("node:test");
const assert = require("node:assert");
const C = require("../permit-compare");
const P = require("../permit-pulse");

const NOW = Date.parse("2026-10-01T16:00:00Z");
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// A year of filings for one city, as permit-pulse.test.js builds them.
function year({ perDay = { ti: 2, new: 1 }, wait = { ti: 40, new: 90 }, type = "New/Added Commercial", days = 380 } = {}) {
  const rows = [];
  let n = 0;
  for (let age = 0; age < days; age++) {
    const date = iso(NOW - age * DAY);
    for (const [kind, t] of [["ti", "Tenant Improvement"], ["new", type]]) {
      for (let i = 0; i < perDay[kind]; i++) {
        n += 1;
        rows.push({ permit_type: t, status: n % 10 === 0 ? "Void" : age > wait[kind] ? "Issued" : "In Review", applied_date: date, last_seen_at: "2026-10-01T13:05:00Z" });
      }
    }
  }
  return rows;
}

// A hand-made pulse, for the reads: only what they look at.
function fake({ all = 70, allChg = 0, ti = 50, tiChg = 0, nw = 7, nwChg = 0, waitTi = 30, waitNew = 80, newShare = 0.1, ended = 0.04, open = 0.3 } = {}) {
  const months = ["2025-10", "2025-11", "2025-12", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `2026-0${m}`)]
    .map((month) => ({ month, total: 100, new: Math.round(newShare * 100), ti: 80, other: 0 }));
  const pace = (last, chg) => ({ last, prior: chg == null ? null : last / (1 + chg), priorMonths: 9, chg });
  return {
    months, from: months[0].month, through: months[11].month,
    pace: { all: pace(all, allChg), ti: pace(ti, tiChg), new: pace(nw, nwChg) },
    curves: { ti: [], new: [], all: [] }, waits: { ti: waitTi, new: waitNew, all: waitTi },
    total: 1200, ended: Math.round(ended * 1200), endedShare: ended, openShare: open, lastSeenAt: "2026-10-01T13:05:00Z",
  };
}
const two = (a, b) => C.buildComparison([{ key: "boise", city: "Boise", slot: 0, pulse: a }, { key: "meridian", city: "Meridian", slot: 1, pulse: b }]);
const read = (cmp, title) => (cmp.reads.find((r) => r.title === title) || {}).text || "";

test("comparing needs two cities with a pulse; a city with none is left out, never zeroed", () => {
  const b = P.buildPulse(year(), { now: NOW });
  assert.ok(b && b.waits.all != null, "the pulse now carries an all-permits wait for this page");
  const one = C.buildComparison([{ key: "boise", city: "Boise", slot: 0, pulse: b }, { key: "meridian", city: "Meridian", slot: 1, pulse: null }]);
  assert.equal(one.ready, false);
  assert.deepEqual(one.cities.map((c) => c.city), ["Boise"]);
  assert.equal(C.buildComparison([]).ready, false);
  assert.equal(C.buildComparison(null).ready, false);

  const cmp = two(b, P.buildPulse(year({ perDay: { ti: 1, new: 1 }, type: "New Commercial" }), { now: NOW }));
  assert.equal(cmp.ready, true);
  assert.equal(cmp.months.length, 12);
  assert.equal(cmp.from, "2025-10");
  assert.equal(cmp.through, "2026-09");
});

test("a city's colour follows the city, not its place on the page", () => {
  const b = P.buildPulse(year(), { now: NOW });
  // Meridian and a third city (slot 2) without Boise: Meridian stays slot 1.
  const cmp = C.buildComparison([
    { key: "meridian", city: "Meridian", slot: 1, pulse: b },
    { key: "nampa", city: "Nampa", slot: 2, pulse: b },
  ]);
  assert.deepEqual(cmp.cities.map((c) => c.slot), [1, 2]);
  const svg = C.linesSvg(cmp, "all", "count", 620, 250, 1);
  assert.match(svg, /class="pc-line pc-s1"/);
  assert.match(svg, /class="pc-line pc-s2"/);
  assert.doesNotMatch(svg, /pc-s0/, "nobody took Boise's blue");
  assert.match(C.tableHtml(cmp), /<i class="pc-k pc-s1" aria-hidden="true"><\/i>Meridian/);
});

test("how busy: a ratio past 15% is named, closer is about the same", () => {
  assert.equal(read(two(fake({ all: 71 }), fake({ all: 31 })), "How busy each city is"),
    "Boise files about 71 commercial permits a month, 2.3 times Meridian’s 31.");
  assert.equal(read(two(fake({ all: 40 }), fake({ all: 52 })), "How busy each city is"),
    "Meridian files about 52 commercial permits a month, 30% more than Boise’s 40.");
  assert.equal(read(two(fake({ all: 50 }), fake({ all: 46 })), "How busy each city is"),
    "Boise and Meridian file about the same number of commercial permits, 50 and 46 a month.");
});

test("trends get a verdict only five points apart, and the verdict matches the direction", () => {
  assert.equal(read(two(fake({ allChg: 0.08 }), fake({ allChg: -0.04 })), "Which way it’s heading"),
    "Over the last three months, against the months before, filings are up 8% in Boise and down 4% in Meridian. Boise’s filings are picking up while Meridian’s are slowing.");
  assert.equal(read(two(fake({ allChg: 0.03 }), fake({ allChg: 0.05 })), "Which way it’s heading"),
    "Over the last three months, against the months before, filings are up 3% in Boise and up 5% in Meridian.", "two points apart says nothing");
  assert.match(read(two(fake({ allChg: -0.02 }), fake({ allChg: -0.12 })), "Which way it’s heading"), /Meridian’s filings are slowing more\.$/);
  assert.match(read(two(fake({ tiChg: 0.2 }), fake({ tiChg: 0.05 })), "Leasing demand"),
    /Boise 50 a month \(up 20%\) and Meridian 50 a month \(up 5%\)\. Boise’s build-outs are picking up faster\.$/);
  // No months before to compare with: no trend line at all.
  assert.equal(read(two(fake({ allChg: null }), fake({ allChg: null })), "Which way it’s heading"), "");
});

test("waits: the faster city named past five days, about the same within, and a missing wait said as such", () => {
  assert.equal(read(two(fake({ waitTi: 34, waitNew: 85 }), fake({ waitTi: 21, waitNew: 60 })), "How fast permits are issued"),
    "Meridian issues half its tenant build-outs within about 21 days; Boise takes about 34. New buildings take about 85 days in Boise and 60 days in Meridian.");
  assert.match(read(two(fake({ waitTi: 30 }), fake({ waitTi: 33 })), "How fast permits are issued"),
    /^Boise and Meridian issue half their tenant build-outs in about the same time: 30 and 33 days\./);
  assert.equal(read(two(fake({ waitTi: 30, waitNew: null }), fake({ waitTi: null, waitNew: null })), "How fast permits are issued"),
    "Boise issues half its tenant build-outs within about 30 days. There are too few recent build-outs in Meridian to read a wait yet.");
  assert.equal(read(two(fake({ waitTi: null, waitNew: null }), fake({ waitTi: null, waitNew: null })), "How fast permits are issued"),
    "There are too few recent permits in Boise and Meridian to read a wait yet.");
});

test("new supply and voided permits compare shares, and only a real gap gets a sentence", () => {
  assert.equal(read(two(fake({ newShare: 0.09 }), fake({ newShare: 0.23 })), "New supply for its size"),
    "New buildings and additions are 9% of Boise’s and 23% of Meridian’s permits. More of Meridian’s activity is new space that will compete for tenants in a year or two.");
  assert.match(read(two(fake({ newShare: 0.1 }), fake({ newShare: 0.11 })), "New supply for its size"), /A similar share in both\.$/);
  assert.equal(read(two(fake({ ended: 0.04 }), fake({ ended: 0.05 })), "Second thoughts"),
    "4% of Boise’s and 5% of Meridian’s permits were voided or withdrawn.");
  assert.match(read(two(fake({ ended: 0.04 }), fake({ ended: 0.09 })), "Second thoughts"), /A higher share of Meridian’s projects were shelved\.$/);
});

test("a city filing far fewer permits is flagged as swinging more", () => {
  assert.equal(two(fake({ all: 71 }), fake({ all: 31 })).swing, "Meridian files far fewer permits, so its percentages swing more from month to month.");
  assert.equal(two(fake({ all: 71 }), fake({ all: 60 })).swing, "");
});

test("against its own average, each city's mean is 100", () => {
  const b = P.buildPulse(year(), { now: NOW });
  const cmp = two(b, P.buildPulse(year({ perDay: { ti: 1, new: 0 } }), { now: NOW }));
  for (const c of cmp.cities) {
    const { vals, counts } = C.seriesOf(c, cmp.months, "total", "index");
    const known = vals.filter((v) => v != null);
    assert.ok(Math.abs(known.reduce((a, v) => a + v, 0) / known.length - 100) < 1e-9);
    assert.ok(counts.every((v) => Number.isInteger(v)), "the tooltip still carries the count");
  }
  const svg = C.linesSvg(cmp, "all", "index", 620, 250, 1);
  assert.match(svg, /class="pc-base"[^>]*\/><text class="pc-tick"[^>]*>100<\/text>/, "the 100 line is drawn and named");
  assert.doesNotMatch(svg, /NaN|undefined/);
  // A kind a city never files (Meridian, no new buildings) draws no line for
  // it on the indexed chart rather than dividing by zero.
  const nw = C.linesSvg(cmp, "new", "index", 620, 250, 1);
  assert.doesNotMatch(nw, /NaN|Infinity/);
});

test("the charts draw every city, end labels never stack, and every month has a hover target", () => {
  const b = P.buildPulse(year(), { now: NOW });
  const cmp = two(b, P.buildPulse(year(), { now: NOW }));
  const svg = C.linesSvg(cmp, "all", "count", 620, 250, 1);
  assert.equal((svg.match(/<path class="pc-line/g) || []).length, 2);
  assert.equal((svg.match(/<g class="pc-hit"/g) || []).length, 12);
  const ys = [...svg.matchAll(/<text class="pc-val" x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 2);
  assert.ok(Math.abs(ys[0] - ys[1]) >= 14, `identical cities' end labels sit apart (${ys})`);
  assert.match(svg, /data-t="September 2026" data-v="0~Boise~\d+ filed\|1~Meridian~\d+ filed"/);
  const w = C.waitsSvg(cmp, "ti", 440, 250, 1);
  assert.equal((w.match(/<polyline class="pc-line/g) || []).length, 2);
  assert.match(w, /<circle class="pc-dot pc-s0"/);
  assert.match(w, /\d+ days<\/text>/);
});

test("a wait line with no young permits to anchor it is said in words, never drawn floating", () => {
  const b = P.buildPulse(year(), { now: NOW });
  // Boise's new buildings: nothing usable before ~10 weeks old.
  const sparse = { ...b, curves: { ...b.curves, new: b.curves.new.map((x) => (x.from < 70 ? { ...x, n: 2, issued: 0 } : x)) } };
  const cmp = two(sparse, P.buildPulse(year(), { now: NOW }));
  const w = C.waitsSvg(cmp, "new", 440, 250, 1);
  assert.equal((w.match(/<polyline class="pc-line/g) || []).length, 1);
  assert.doesNotMatch(w, /pc-line pc-s0/);
  const html = C.renderCompareBody({ s: 200, comparison: cmp, swept: ["Boise", "Meridian"] });
  assert.match(html, /<p class="pc-cap" data-kind="new" hidden>Too few recent new buildings in Boise to draw its line\.<\/p>/);
  assert.doesNotMatch(html, /data-kind="ti"[^>]*>Too few/, "build-outs draw for both");
});

test("the page: defaults shown, the rest hidden, controls revealed only by the script", () => {
  const b = P.buildPulse(year(), { now: NOW });
  const html = C.renderCompareBody({ s: 200, comparison: two(b, P.buildPulse(year({ perDay: { ti: 1, new: 1 } }), { now: NOW })),
    swept: ["Boise", "Meridian"], marketLinks: [{ city: "Boise", href: "/market/industrial-boise-id#permits" }, { city: "Meridian", href: null }] });
  assert.match(html, /<h1>Compare cities by their permits<\/h1>/);
  assert.match(html, /<h2 id="pcSide">Side by side<\/h2>/);
  assert.match(html, /<h2 id="pcReads">What it says<\/h2>/);
  for (const m of html.matchAll(/<svg class="pc-(?:wide|narrow)" data-kind="(\w+)"(?: data-scale="(\w+)")?([^>]*)>/g)) {
    const shown = m[1] === "all" && (!m[2] || m[2] === "count");
    assert.equal(/ hidden/.test(m[3]), !shown, m[0].slice(0, 80));
  }
  assert.match(html, /<div class="pc-ctl" hidden>/, "no script, no buttons that do nothing");
  assert.match(html, /<a href="\/market\/industrial-boise-id#permits">Boise’s market page &rarr;<\/a>/);
  assert.doesNotMatch(html, /Meridian’s market page/, "no link where there is no page");
  assert.match(html, /Every commercial permit, of every property type/);
  assert.match(html, /<a href="\/permits">See each permit &rarr;<\/a>/);
});

test("signed out, unavailable, one city and none: a sentence each, never a zero", () => {
  assert.match(C.renderCompareBody({ s: 401 }), /Sign in to compare cities by their building permits\.<\/p><p><a href="\/\?auth=signin">Sign in<\/a>/);
  assert.match(C.renderCompareBody({ s: 503, error: "The permit tracker is unavailable right now." }), /The permit tracker is unavailable right now\./);
  assert.match(C.renderCompareBody(null), /unavailable right now/);
  const b = P.buildPulse(year(), { now: NOW });
  const thin = C.renderCompareBody({ s: 200, swept: ["Boise", "Meridian"],
    comparison: C.buildComparison([{ key: "boise", city: "Boise", slot: 0, pulse: b }]) });
  assert.match(thin, /Comparing needs two cities with at least six months of permits\. Right now only Boise has that\. Meridian will appear here once enough months are in\./);
  const none = C.renderCompareBody({ s: 200, swept: ["Boise", "Meridian"], comparison: C.buildComparison([]) });
  assert.match(none, /The permit figures for Boise and Meridian couldn’t be loaded just now\./);
  for (const h of [thin, none]) assert.doesNotMatch(h, /\b0 a month|<table/);
});

test("names are escaped, and the inlined script cannot break a template literal", () => {
  const b = P.buildPulse(year(), { now: NOW });
  const evil = C.buildComparison([{ key: "x", city: "<b>x</b>", slot: 0, pulse: b }, { key: "y", city: "Y\"", slot: 1, pulse: b }]);
  const html = C.renderCompareBody({ s: 200, comparison: evil, swept: [] });
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(!C.COMPARE_JS.includes("`") && !C.COMPARE_JS.includes("${"));
  assert.ok(!C.COMPARE_CSS.includes("`") && !C.COMPARE_CSS.includes("${"));
  assert.doesNotThrow(() => new Function(C.COMPARE_JS));
});
