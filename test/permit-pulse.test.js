// permit-pulse.js — what a city's permits say about its market (2026-10-01).
//
// The rules with teeth: only a contiguous run of COMPLETE months is drawn (a
// hole ends it, the partial current month never counts toward the bars or the
// pace); too few months is no section at all; the wait is the age at which
// half the permits are issued, and with no young permits to anchor it there is
// no wait and no line, only a caption saying why; voided permits never count
// toward it; and the section says where
// the figures come from, links a signed-out reader to a free account, and
// never prints a number it does not have.

const test = require("node:test");
const assert = require("node:assert");
const P = require("../permit-pulse");
const F = require("../permit-filings");

const NOW = Date.parse("2026-10-01T16:00:00Z"); // a Thursday morning in Boise
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// A year of synthetic filings: `perDay` of each kind every day, issued once
// older than `wait[kind]` days, and every 10th one voided.
function year({ days = 365, wait = { ti: 40, new: 90 }, perDay = { ti: 2, new: 1 }, skip = () => false } = {}) {
  const rows = [];
  let n = 0;
  for (let age = 0; age < days; age++) {
    const date = iso(NOW - age * DAY);
    if (skip(date)) continue;
    for (const [kind, type] of [["ti", "Tenant Improvement"], ["new", "New/Added Commercial"]]) {
      for (let i = 0; i < perDay[kind]; i++) {
        n += 1;
        const status = n % 10 === 0 ? "Void" : age > wait[kind] ? "Issued" : "In Review";
        rows.push({ permit_type: type, status, applied_date: date, last_seen_at: "2026-10-01T13:05:00Z" });
      }
    }
  }
  return rows;
}

test("permit types group into build-outs, new buildings and the rest; statuses into issued, open and ended", () => {
  assert.equal(P.groupOf("Tenant Improvement"), "ti");
  for (const t of ["New/Added Commercial", "Commercial Modular", "New Commercial", "Commercial Shell Only", "Commercial Addition"]) {
    assert.equal(P.groupOf(t), "new", t);
  }
  assert.equal(P.groupOf("Rack/Shelving"), "other");
  assert.equal(P.groupOf(undefined), "other");
  assert.equal(P.stateOf("Issued"), "issued");
  assert.equal(P.stateOf("Finaled"), "issued");
  assert.equal(P.stateOf("CO Issued"), "issued");
  assert.equal(P.stateOf("Inspection Phase"), "issued");
  assert.equal(P.stateOf("Void"), "ended");
  assert.equal(P.stateOf("Withdrawn"), "ended");
  assert.equal(P.stateOf("Returned to Applicant"), "open");
  assert.equal(P.stateOf("Ready"), "open", "words that do not settle it are not issued");
});

test("the months drawn are the complete months up to last month, at most twelve", () => {
  const p = P.buildPulse(year(), { now: NOW });
  assert.equal(p.months.length, 12);
  assert.equal(p.from, "2025-10");
  assert.equal(p.through, "2026-09", "October has barely begun, so it is not a bar");
  const sep = p.months[p.months.length - 1];
  assert.equal(sep.ti, 60, "30 days of two a day");
  assert.equal(sep.new, 30);
  assert.equal(sep.total, 90);
  assert.equal(sep.issued + sep.open + sep.ended, sep.total);
});

test("a month the sweep never read ends the run, and fewer than six months is no section at all", () => {
  const holed = P.buildPulse(year({ skip: (d) => d.startsWith("2026-03") }), { now: NOW });
  assert.equal(holed.from, "2026-04", "March is a hole, so the run starts after it");
  assert.equal(holed.months.length, 6);
  assert.equal(P.buildPulse(year({ days: 150 }), { now: NOW }), null, "five complete months is too thin");
  assert.equal(P.buildPulse([], { now: NOW }), null);
});

test("the wait is the age at which half are issued, and voided permits do not count against it", () => {
  const p = P.buildPulse(year({ wait: { ti: 40, new: 90 } }), { now: NOW });
  assert.ok(Math.abs(p.waits.ti - 40) <= P.BUCKET_DAYS, `build-outs ~40 days, got ${p.waits.ti}`);
  assert.ok(Math.abs(p.waits.new - 90) <= P.BUCKET_DAYS, `new buildings ~90 days, got ${p.waits.new}`);
  assert.ok(p.waits.ti < p.waits.new);
  // Every bucket's share is issued over NOT-voided permits: an old bucket is
  // all issued, though a tenth of its permits were voided.
  const old = p.curves.ti.find((b) => b.from === 196);
  assert.equal(old.issued, old.n);
  assert.ok(Math.abs(p.endedShare - 0.1) < 0.01);
});

// Build-outs every day, but new buildings only older than 60 days: the new-
// building curve starts too late to anchor a halfway point.
const sparseNew = () => year().filter((r) => r.permit_type === "Tenant Improvement" || Date.parse(r.applied_date) < NOW - 60 * DAY);

test("with no young permits of a kind there is no wait for it, rather than a line drawn from nothing", () => {
  const p = P.buildPulse(sparseNew(), { now: NOW });
  assert.ok(p.waits.ti != null, "build-outs still have one");
  assert.equal(p.waits.new, null);
});

// Build-outs every day, but new buildings only filed 84 to 111 days ago: the
// Boise shape, two usable buckets around day 90-105 and nothing young.
const lateNew = () => year().filter((r) => {
  const age = Math.round((NOW - Date.parse(r.applied_date)) / DAY);
  return r.permit_type === "Tenant Improvement" || (age >= 84 && age <= 111);
});

test("a kind with no young permits draws no line, and the chart says so instead of floating a stub", () => {
  const p = P.buildPulse(lateNew(), { now: NOW });
  const stub = P.curvePoints(p.curves.new);
  assert.ok(stub.length >= 2 && stub[0].day > P.ANCHOR_DAY, `the curve has points, but none young (${stub.map((x) => x.day)})`);
  assert.deepEqual(P.drawablePoints(p.curves.new), [], "too far from day zero to draw");
  assert.ok(P.drawablePoints(p.curves.ti).length >= 2, "build-outs still draw");
  assert.equal(p.waits.new, null, "and no halfway dot");

  const out = P.pulseSectionHtml({ city: "Boise", pulse: p, others: [], signedIn: false, freshness: {} });
  assert.equal((out.match(/class="pp-line-ti"/g) || []).length, 2, "build-outs at both widths");
  assert.doesNotMatch(out, /class="pp-line-new"/, "no new-building stroke at either width");
  assert.match(out, /<p class="disc" style="margin-top:6px">Too few recent new buildings in Boise to draw its line\.<\/p>/);

  // A full year draws both and says nothing; neither kind names both.
  const full = P.pulseSectionHtml({ city: "Boise", pulse: P.buildPulse(year(), { now: NOW }), others: [], signedIn: false, freshness: {} });
  assert.equal((full.match(/class="pp-line-new"/g) || []).length, 2);
  assert.doesNotMatch(full, /Too few recent/);
  const neither = P.pulseSectionHtml({ city: "Boise", pulse: { ...p, curves: { ...p.curves, ti: p.curves.new } }, others: [], signedIn: false, freshness: {} });
  assert.doesNotMatch(neither, /<polyline/);
  assert.match(neither, /Too few recent tenant build-outs and new buildings in Boise to draw their lines\./);
});

test("the pace is the last three months a month against the months before, worded by how many there were", () => {
  const p = P.buildPulse(year(), { now: NOW });
  assert.equal(p.pace.all.priorMonths, 9);
  assert.ok(Math.abs(p.pace.all.chg) < 0.05, "a steady city reads level");
  assert.match(P.changeHtml(p.pace.all), /about level with the year/);
  assert.match(P.changeHtml({ chg: -0.12, priorMonths: 9 }), /down 12%<\/span> on the year/);
  assert.match(P.changeHtml({ chg: 0.3, priorMonths: 4 }), /up 30%<\/span> vs the 4 months before/);
  assert.equal(P.changeHtml({ chg: null, priorMonths: 2 }), "");
  const short = P.buildPulse(year({ skip: (d) => d < "2026-03-01" }), { now: NOW });
  assert.equal(short.months.length, 7);
  assert.equal(short.pace.all.priorMonths, 4);
});

test("the section names its source and window, links a signed-out reader to a free account, and escapes the city", () => {
  const b = P.buildPulse(year(), { now: NOW });
  const m = P.buildPulse(year({ perDay: { ti: 1, new: 1 } }), { now: NOW });
  const out = P.pulseSectionHtml({ city: "Boise", pulse: b, others: [{ city: "Meridian", pulse: m }], signedIn: false, freshness: { stale: false } });
  assert.match(out, /<h2>Building permits in Boise<\/h2>/);
  assert.match(out, /From Boise’s building permit portal, read every weekday morning: October 2025 through September 2026\./);
  assert.match(out, /Every commercial permit, of every property type\./);
  assert.match(out, /href="\/\?auth=signup">See each permit with a free account/);
  assert.match(out, /<h3 style="margin-top:18px">Next to Meridian<\/h3>/);
  assert.equal((out.match(/<svg class="pp-wide"/g) || []).length, 2, "two charts, each in a wide and a narrow size");
  assert.equal((out.match(/<svg class="pp-narrow"/g) || []).length, 2);
  assert.doesNotMatch(out, /Last read/, "a fresh read says nothing about freshness");
  assert.doesNotMatch(out, /NaN|undefined|null/);

  const mine = P.pulseSectionHtml({ city: "Boise", pulse: b, others: [], signedIn: true, freshness: { stale: true } });
  assert.match(mine, /href="\/permits">See each permit &rarr;/);
  assert.match(mine, /Last read Oct 1, more than a business day ago/);
  assert.doesNotMatch(mine, /Next to/, "no other city, no table");

  const evil = P.pulseSectionHtml({ city: "<b>x</b>", pulse: b, others: [], signedIn: false, freshness: {} });
  assert.doesNotMatch(evil, /<b>x<\/b>/);
});

test("a figure the pulse does not have is a dash with a reason, never a zero", () => {
  const p = P.buildPulse(sparseNew(), { now: NOW });
  const out = P.pulseSectionHtml({ city: "Boise", pulse: P.buildPulse(year(), { now: NOW }), others: [{ city: "Meridian", pulse: p }], signedIn: false, freshness: {} });
  assert.match(out, /<td>Meridian<\/td><td>\d+<\/td><td>\d+ days<\/td><td>–<\/td>/);
  const alone = P.pulseSectionHtml({ city: "Meridian", pulse: { ...p, waits: { ti: null, new: null } }, others: [], signedIn: false, freshness: {} });
  assert.match(alone, /<span class="k">Typical wait<\/span><div class="v">–<\/div><div class="n">not enough recent permits yet<\/div>/);
  assert.doesNotMatch(alone, /\b0 days/);
});

test("a city we know but do not read gets a sentence and links to the cities we do", () => {
  const out = P.unreadCardHtml({ city: "Nampa", swept: [{ city: "Boise", href: "/market/industrial-boise-id" }, { city: "Meridian", href: null }] });
  assert.match(out, /We read commercial building permits in Boise and Meridian so far, not yet in Nampa\./);
  assert.match(out, /href="\/market\/industrial-boise-id">Permits in Boise/);
  assert.doesNotMatch(out, /Permits in Meridian/, "no page, no link");
  assert.doesNotMatch(out, /\d+ permits|0 a month/);
});

test("history windows: this month and last month every run, the rest in rotation, every month within about three weeks", () => {
  const w = F.historyWindows(NOW);
  assert.equal(w.length, 2 + F.HISTORY_ROTATE);
  assert.deepEqual(w.slice(0, 2).map((x) => x.month), ["2026-10", "2026-09"]);
  assert.deepEqual(w[0], { from: "2026-10-01", to: "2026-10-01", month: "2026-10" }, "never past today");
  assert.deepEqual(w[1], { from: "2026-09-01", to: "2026-09-30", month: "2026-09" });
  const all = F.historyWindows(NOW, { all: true });
  assert.equal(all.length, F.HISTORY_MONTHS);
  assert.deepEqual(all.find((x) => x.month === "2026-02"), { from: "2026-02-01", to: "2026-02-28", month: "2026-02" });
  assert.equal(all[all.length - 1].month, "2025-10");
  const seen = new Set();
  // 22 days: every older month comes round twice, and two turns eleven days
  // apart cannot both fall on a weekend.
  for (let d = 0; d < 22; d++) {
    const t = NOW + d * DAY;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const x of F.historyWindows(t)) seen.add(x.month);
  }
  assert.ok(seen.size >= F.HISTORY_MONTHS, `22 days of weekday runs reach every month (${seen.size})`);
});
