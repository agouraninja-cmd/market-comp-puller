"use strict";
// permit-pulse.js — what a city's building permits say about its market, on
// the market pages (2026-10-01, the owner's pick of Draft C: "do C").
//
// Pure: no I/O, no clock reads (the caller passes `now`). It requires only
// the two other pure permit modules: permit-watch.js for what a portal status
// MEANS (one reading of "issued" across the tracker and this page), and
// permit-filings.js for the portal's own calendar date.
//
// FOUR READINGS OF ONE TABLE. From the stored filings of one swept city:
//  - how many permits are filed a month, split into tenant build-outs (a
//    tenant has signed and is fitting out space: demand) and new buildings
//    and additions (space that will compete for tenants: supply);
//  - how long the city takes to issue them;
//  - how much of the last two months is still in review;
//  - how many were voided or withdrawn (projects shelved).
//
// THE WAIT IS READ ACROSS THE YEAR, NOT TIMED. A portal lists a permit's
// filing date and today's status, never the day it was issued. So the wait is
// the age at which half the permits of that age are issued today: of the ones
// filed two weeks ago, how many are issued; of the ones filed a month ago; and
// so on (`curve`, `halfwayDays`). It assumes the city's pace was steady over
// the window, and the page says so. Voided and withdrawn permits are left out
// of it, since they will never be issued. A curve whose youngest usable
// bucket is not near day zero (ANCHOR_DAY) has no honest halfway point and
// answers null, and is not drawn either: a short stroke floating at day 90
// reads as a wait the numbers do not carry, so the chart says why instead.
//
// NOTHING IS SHOWN FROM A THIN TABLE. The months drawn are the CONTIGUOUS run
// of complete months ending last month: a month with no filing at all is a
// month the sweep has not read yet (a commercial-permit month at zero does not
// happen in these cities), so a hole ends the run rather than drawing a zero.
// Fewer than MIN_MONTHS and buildPulse answers null: no section at all, the
// building sheet's "never claim we looked" rule. The current month is partial,
// so it never draws as a bar or counts toward the pace; its permits do count
// toward the wait, where youth is the point.
//
// The section's HTML is drawn here too (pulseSectionHtml, unreadCardHtml), as
// plain strings with every value escaped, so the rules that decide what a
// reader is told are tested with the numbers that decide them.

const W = require("./permit-watch");
const F = require("./permit-filings");

const PULSE_MONTHS = 12;
const MIN_MONTHS = 6;
const PACE_MONTHS = 3;
const BUCKET_DAYS = 14;
const CURVE_DAYS = 364;
// Fewer permits than this of one age and that age says nothing.
const MIN_BUCKET = 5;
// A curve's first usable point must be this young (days) to anchor a halfway
// point, or a line, back to day zero: ~5 weeks, the third bucket's middle.
const ANCHOR_DAY = 35;
// The wait charts' x axis ends here (this section's and the compare page's).
const WAIT_MAX_DAY = 210;
// How far back the market page's read goes: the full run plus this month.
const READ_DAYS = 400;

// Each city's own permit types (permit-portals.js's registry labels).
const NEW_TYPES = new Set([
  "New/Added Commercial", "Commercial Modular",                    // Boise
  "New Commercial", "Commercial Shell Only", "Commercial Addition", // Meridian
]);
const TI_TYPES = new Set(["Tenant Improvement"]);

const DAY_MS = 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function groupOf(type) {
  const t = String(type || "").trim();
  if (TI_TYPES.has(t)) return "ti";
  if (NEW_TYPES.has(t)) return "new";
  return "other";
}

// "issued" (issued, finaled, final inspection pending), "ended" (void,
// withdrawn, expired, denied) or "open" (everything else, including any status
// whose words do not settle it: under-claim, the tracker's badge rule).
function stateOf(status) {
  const c = W.classifyStatus(status);
  if (c.flag === "ended") return "ended";
  if (c.step === "issued" || c.step === "final") return "issued";
  return "open";
}

function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
function dayNumber(iso) { return Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS); }
function prevMonth(m) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
function monthLabel(m, long) {
  const i = Number(m.slice(5, 7)) - 1;
  return long ? `${MONTH_LONG[i]} ${m.slice(0, 4)}` : MON[i];
}
function sum(list, k) { return list.reduce((a, x) => a + (x[k] || 0), 0); }

// Share issued by age, in BUCKET_DAYS buckets up to CURVE_DAYS.
function curve(permits) {
  const out = [];
  for (let a = 0; a < CURVE_DAYS; a += BUCKET_DAYS) {
    const b = permits.filter((p) => p.age >= a && p.age < a + BUCKET_DAYS);
    const issued = b.filter((p) => p.state === "issued").length;
    out.push({ from: a, to: a + BUCKET_DAYS - 1, n: b.length, issued });
  }
  return out;
}

// The usable points of a curve, its share made non-decreasing: a permit
// issued at 40 days is still issued at 60, so a dip is sampling noise.
function curvePoints(c) {
  let best = 0;
  return (c || []).filter((b) => b.n >= MIN_BUCKET).map((b) => {
    best = Math.max(best, b.issued / b.n);
    return { day: (b.from + b.to) / 2, share: best, n: b.n, issued: b.issued };
  });
}

// The day the curve passes one half, interpolated, or null.
function halfwayDays(c) {
  const pts = curvePoints(c);
  // A curve that starts late has no honest line back to day zero.
  if (!pts.length || pts[0].day > ANCHOR_DAY) return null;
  let prev = { day: 0, share: 0 };
  for (const p of pts) {
    if (p.share >= 0.5) {
      const t = p.share === prev.share ? 0 : (0.5 - prev.share) / (p.share - prev.share);
      return Math.round(prev.day + t * (p.day - prev.day));
    }
    prev = p;
  }
  return null;
}

// A curve's points as a wait chart draws them, or [] when it cannot be:
// under two usable points up to `maxDay`, or a first point past ANCHOR_DAY
// (halfwayDays' anchor). One rule for the market section and /permits/compare.
function drawablePoints(c, maxDay = WAIT_MAX_DAY) {
  const pts = curvePoints(c).filter((p) => p.day <= maxDay);
  return pts.length >= 2 && pts[0].day <= ANCHOR_DAY ? pts : [];
}

// Last PACE_MONTHS months a month, against the months before them.
function pace(months, key) {
  if (months.length < PACE_MONTHS) return null;
  const last = months.slice(-PACE_MONTHS), prior = months.slice(0, -PACE_MONTHS);
  const a = sum(last, key) / last.length;
  const b = prior.length >= PACE_MONTHS ? sum(prior, key) / prior.length : null;
  return { last: a, prior: b, priorMonths: prior.length, chg: b ? (a - b) / b : null };
}

// One swept city's filings -> its pulse, or null when there is too little to
// say. Rows: { permit_type, status, applied_date, last_seen_at }.
// `through` (YYYY-MM) ends the run earlier than last month: a city read from
// its published reports (Nampa, permit-reports.js) is complete only up to the
// last month its reports cover, and `now` is then the date its reports are
// true on, so ages and "issued by now" are measured where the data stops.
function buildPulse(rows, { now, through } = {}) {
  const today = F.localIsoDate(now);
  const current = today.slice(0, 7);
  const last = /^\d{4}-\d{2}$/.test(String(through || "")) && through < current ? through : prevMonth(current);
  const todayNum = dayNumber(today);
  const permits = [];
  let lastSeen = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isIsoDate(r.applied_date)) continue;
    const age = todayNum - dayNumber(r.applied_date);
    if (age < 0) continue;
    permits.push({ month: r.applied_date.slice(0, 7), group: groupOf(r.permit_type), state: stateOf(r.status), age });
    const seen = Date.parse(String(r.last_seen_at || ""));
    if (Number.isFinite(seen) && seen > lastSeen) lastSeen = seen;
  }
  const byMonth = new Map();
  for (const p of permits) {
    if (p.month >= current) continue;
    const m = byMonth.get(p.month) || { new: 0, ti: 0, other: 0, total: 0, issued: 0, open: 0, ended: 0 };
    m[p.group] += 1; m.total += 1; m[p.state] += 1;
    byMonth.set(p.month, m);
  }
  const months = [];
  for (let m = last; months.length < PULSE_MONTHS && byMonth.has(m); m = prevMonth(m)) {
    months.unshift({ month: m, ...byMonth.get(m) });
  }
  if (months.length < MIN_MONTHS) return null;
  const from = months[0].month;
  const live = permits.filter((p) => p.month >= from && p.state !== "ended");
  // `all` is every live permit, the other kinds too: the compare page reads
  // it (permit-compare.js); this section draws the two kinds only.
  const curves = { ti: curve(live.filter((p) => p.group === "ti")), new: curve(live.filter((p) => p.group === "new")), all: curve(live) };
  const recent = months.slice(-2);
  const total = sum(months, "total"), ended = sum(months, "ended");
  return {
    months, from, through: months[months.length - 1].month,
    pace: { all: pace(months, "total"), ti: pace(months, "ti"), new: pace(months, "new") },
    curves, waits: { ti: halfwayDays(curves.ti), new: halfwayDays(curves.new), all: halfwayDays(curves.all) },
    total, ended, endedShare: total ? ended / total : 0,
    openShare: sum(recent, "total") ? sum(recent, "open") / sum(recent, "total") : 0,
    lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
    asOf: today,
  };
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function round(n) { return Math.round(n); }

// "down 12% on the year", "about level with the months before", or "".
function changeHtml(p) {
  if (!p || p.chg == null) return "";
  const x = Math.round(p.chg * 100);
  const span = p.priorMonths >= 9 ? "on the year" : `vs the ${p.priorMonths} months before`;
  if (Math.abs(x) < 2) return p.priorMonths >= 9 ? "about level with the year" : `about level with the ${p.priorMonths} months before`;
  return `<span class="${x > 0 ? "pp-up" : "pp-down"}">${x > 0 ? "up" : "down"} ${Math.abs(x)}%</span> ${span}`;
}
function changeWords(p) {
  if (!p || p.chg == null) return "";
  const x = Math.round(p.chg * 100);
  if (Math.abs(x) < 2) return "about level with before";
  return `${x > 0 ? "up" : "down"} ${Math.abs(x)}%`;
}

// Filed each month: tenant build-outs stacked on new buildings. Two sizes,
// shown by width, so the phone's labels are not a shrunken desktop's.
function volumeSvg(months, W0, H0, every) {
  const pad = { l: 30, r: 6, t: 18, b: 22 }, iw = W0 - pad.l - pad.r, ih = H0 - pad.t - pad.b;
  const max = Math.max(1, ...months.map((m) => m.total));
  const step = max > 100 ? 50 : max > 40 ? 20 : max > 16 ? 10 : 5;
  const top = Math.ceil(max * 1.15 / step) * step;
  const band = iw / months.length, bw = Math.min(22, band * 0.58);
  const hi = months.reduce((a, m, i) => (m.total > months[a].total ? i : a), 0);
  let s = "";
  for (let t = 0; t <= top; t += step) {
    const y = pad.t + ih - t / top * ih;
    s += `<line class="pp-grid" x1="${pad.l}" x2="${W0 - pad.r}" y1="${y}" y2="${y}"/>` +
      `<text class="pp-tick" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${t}</text>`;
  }
  months.forEach((m, i) => {
    const cx = pad.l + band * (i + 0.5), x = cx - bw / 2, base = pad.t + ih;
    const hn = m.new / top * ih, ht = (m.ti + m.other) / top * ih;
    if (hn > 0) s += `<rect class="pp-new" x="${x.toFixed(1)}" y="${(base - hn).toFixed(1)}" width="${bw.toFixed(1)}" height="${hn.toFixed(1)}"/>`;
    const y2 = base - hn - ht, gap = hn > 0 ? 2 : 0;
    if (ht > gap + 3) {
      s += `<path class="pp-ti" d="M${x.toFixed(1)},${(base - hn - gap).toFixed(1)}V${(y2 + 3).toFixed(1)}Q${x.toFixed(1)},${y2.toFixed(1)} ${(x + 3).toFixed(1)},${y2.toFixed(1)}` +
        `H${(x + bw - 3).toFixed(1)}Q${(x + bw).toFixed(1)},${y2.toFixed(1)} ${(x + bw).toFixed(1)},${(y2 + 3).toFixed(1)}V${(base - hn - gap).toFixed(1)}Z"/>`;
    }
    if (i === months.length - 1 || i === hi) s += `<text class="pp-val" x="${cx.toFixed(1)}" y="${(y2 - 5).toFixed(1)}" text-anchor="middle">${m.total}</text>`;
    if (i % every === 0 || i === months.length - 1) {
      const yr = m.month.slice(5) === "01" || i === 0 ? ` ’${m.month.slice(2, 4)}` : "";
      s += `<text class="pp-tick" x="${cx.toFixed(1)}" y="${H0 - 6}" text-anchor="middle">${monthLabel(m.month)}${yr}</text>`;
    }
  });
  return s;
}

// Share issued by days since filing, one line per kind, the halfway point red.
// A kind with no young permits to anchor it draws no line (drawablePoints);
// pulseSectionHtml says so under the chart.
function waitSvg(pulse, W0, H0, every) {
  const pad = { l: 34, r: 10, t: 14, b: 24 }, iw = W0 - pad.l - pad.r, ih = H0 - pad.t - pad.b;
  const maxD = WAIT_MAX_DAY;
  const x = (d) => pad.l + Math.min(d, maxD) / maxD * iw, y = (p) => pad.t + ih - p * ih;
  let s = "";
  [0, 0.5, 1].forEach((p) => {
    s += `<line class="${p === 0.5 ? "pp-half" : "pp-grid"}" x1="${pad.l}" x2="${W0 - pad.r}" y1="${y(p)}" y2="${y(p)}"/>` +
      `<text class="pp-tick" x="${pad.l - 6}" y="${y(p) + 4}" text-anchor="end">${p * 100}%</text>`;
  });
  for (let d = 0; d <= maxD; d += 30 * every) {
    // Plain numbers: the caption under the chart says they are days.
    s += `<text class="pp-tick" x="${x(d)}" y="${H0 - 6}" text-anchor="middle">${d}</text>`;
  }
  [["ti", "pp-line-ti"], ["new", "pp-line-new"]].forEach(([k, cls]) => {
    const pts = drawablePoints(pulse.curves[k], maxD);
    if (!pts.length) return;
    s += `<polyline class="${cls}" points="${pts.map((p) => `${x(p.day).toFixed(1)},${y(p.share).toFixed(1)}`).join(" ")}"/>`;
    const d = pulse.waits[k];
    if (d == null || d > maxD) return;
    const up = k === "ti";
    s += `<circle class="pp-dot" cx="${x(d).toFixed(1)}" cy="${y(0.5)}" r="4.5"/>` +
      `<text class="pp-val" x="${(x(d) + (up ? -7 : 7)).toFixed(1)}" y="${y(0.5) + (up ? -9 : 17)}" text-anchor="${up ? "end" : "start"}">${d} days</text>`;
  });
  return s;
}

const PULSE_CSS =
  ".pp .pp-figs{display:flex;border:1px solid var(--hair);border-radius:6px;margin:4px 0 16px;overflow:hidden}" +
  ".pp .pp-fig{flex:1;min-width:0;padding:10px 14px;border-right:1px solid var(--hair)}" +
  ".pp .pp-fig:last-child{border-right:0}" +
  ".pp .pp-fig .k{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600}" +
  ".pp .pp-fig .v{font-family:Georgia,'Times New Roman',serif;font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.25;margin-top:2px}" +
  ".pp .pp-fig .v small{font-family:inherit;font-size:12.5px;color:var(--ink-3);margin-left:4px}" +
  ".pp .pp-fig .n{font-size:12px;color:var(--ink-3)}" +
  ".pp .pp-up{color:var(--ok-text);font-weight:600}.pp .pp-down{color:var(--err-text);font-weight:600}" +
  ".pp .pp-two{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:26px;margin-top:6px}" +
  ".pp .pp-two>div{min-width:0}" +
  ".pp .pp-lg{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-2);margin:0 0 4px}" +
  ".pp .pp-lg i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}" +
  ".pp .pp-lg i.ln{height:2px;width:16px;vertical-align:3px}" +
  ".pp .pp-k-ti{background:var(--ink)}.pp .pp-k-new{background:var(--ink-3)}" +
  ".pp svg{width:100%;height:auto;display:block}" +
  ".pp svg text{font-size:11px}" +
  ".pp .pp-grid{stroke:var(--hair);stroke-width:1}.pp .pp-half{stroke:var(--ink-4);stroke-width:1}" +
  ".pp .pp-tick{fill:var(--ink-3)}.pp .pp-val{fill:var(--ink);font-weight:600;font-size:11.5px}" +
  ".pp .pp-ti{fill:var(--ink)}.pp .pp-new{fill:var(--ink-3)}" +
  ".pp .pp-line-ti,.pp .pp-line-new{fill:none;stroke-width:2;stroke-linejoin:round}" +
  ".pp .pp-line-ti{stroke:var(--ink)}.pp .pp-line-new{stroke:var(--ink-3)}" +
  ".pp .pp-dot{fill:var(--red-fill);stroke:var(--card);stroke-width:2}" +
  ".pp .pp-narrow{display:none}" +
  ".pp .pp-sigs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 22px;margin-top:6px}" +
  ".pp .pp-sig{border-top:1px solid var(--ink);padding-top:8px;min-width:0}" +
  ".pp .pp-sig b{display:block;color:var(--ink);font-size:14px;margin-bottom:2px}" +
  ".pp .pp-sig span{font-size:13.5px;color:var(--ink-body)}" +
  ".pp .pp-tbl{overflow-x:auto}" +
  ".pp table{width:100%;min-width:400px;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}" +
  ".pp td,.pp th{white-space:nowrap;padding:6px 4px;border-bottom:1px solid var(--hair);text-align:right}" +
  ".pp td:first-child,.pp th:first-child{text-align:left}" +
  ".pp th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600}" +
  ".pp tr.me td{color:var(--ink);font-weight:600}" +
  ".pp a.pp-more{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--edge);text-underline-offset:3px}" +
  ".pp .pp-stale{color:var(--warn-text)}" +
  ".pp p.pp-cmp{margin:8px 0 0;font-size:13.5px}" +
  // .card p (margin 0 0 10px) outranks .disc, so the small print says its own.
  ".pp p.disc{margin:14px 0 0}" +
  "@media (max-width:640px){.pp .pp-figs{flex-wrap:wrap}.pp .pp-fig{flex:1 1 45%;border-bottom:1px solid var(--hair)}" +
  ".pp .pp-two,.pp .pp-sigs{grid-template-columns:minmax(0,1fr)}.pp .pp-wide{display:none}.pp .pp-narrow{display:block}}";

function dash(v, unit) { return v == null ? "–" : `${v}${unit ? `<small>${unit}</small>` : ""}`; }

// view: { city, pulse, others: [{ city, pulse }], signedIn, freshness: { stale } }
function pulseSectionHtml(view) {
  const p = view.pulse;
  const city = esc(view.city);
  const pa = p.pace.all, pt = p.pace.ti, pn = p.pace.new;
  const wTi = p.waits.ti, wNew = p.waits.new;
  const n = p.months.length;
  const fig = (k, v, note) => `<div class="pp-fig"><span class="k">${k}</span><div class="v">${v}</div><div class="n">${note}</div></div>`;
  const figs = `<div class="pp-figs">` +
    fig("Filed / month", pa ? round(pa.last) : "–", changeHtml(pa) || "last 3 months") +
    fig("Tenant build-outs", pt ? `${round(pt.last)}<small>a month</small>` : "–", changeHtml(pt) || "last 3 months") +
    fig("New buildings", pn ? `${round(pn.last)}<small>a month</small>` : "–", changeHtml(pn) || "last 3 months") +
    fig("Typical wait", dash(wTi, "days"), wTi == null ? "not enough recent permits yet" : "tenant build-out to issued") +
    `</div>`;
  const aria = `Commercial permits filed each month in ${city}, ${esc(monthLabel(p.from, true))} to ${esc(monthLabel(p.through, true))}`;
  const volume = `<h3>Filed each month</h3><div class="pp-lg"><span><i class="pp-k-ti"></i>Tenant build-outs</span><span><i class="pp-k-new"></i>New buildings &amp; additions</span></div>` +
    `<svg class="pp-wide" viewBox="0 0 620 230" role="img" aria-label="${aria}">${volumeSvg(p.months, 620, 230, 1)}</svg>` +
    `<svg class="pp-narrow" viewBox="0 0 340 190" role="img" aria-label="${aria}">${volumeSvg(p.months, 340, 190, 2)}</svg>`;
  const waitAria = `Share of permits issued by days since filing in ${city}`;
  // The kinds waitSvg could not draw, named rather than left as a gap.
  const undrawn = [["ti", "tenant build-outs"], ["new", "new buildings"]].filter(([k]) => !drawablePoints(p.curves[k]).length).map(([, noun]) => noun);
  const wait = `<h3>How long until they’re issued</h3><div class="pp-lg"><span><i class="ln pp-k-ti"></i>Tenant build-outs</span><span><i class="ln pp-k-new"></i>New buildings</span></div>` +
    `<svg class="pp-wide" viewBox="0 0 440 230" role="img" aria-label="${waitAria}">${waitSvg(p, 440, 230, 1)}</svg>` +
    `<svg class="pp-narrow" viewBox="0 0 340 190" role="img" aria-label="${waitAria}">${waitSvg(p, 340, 190, 2)}</svg>` +
    (undrawn.length ? `<p class="disc" style="margin-top:6px">Too few recent ${undrawn.join(" and ")} in ${city} to draw ${undrawn.length === 1 ? "its line" : "their lines"}.</p>` : "") +
    `<p class="disc" style="margin-top:6px">Share of permits issued by days since filing. The red dot is where half are issued.</p>`;
  const sig = (t, s) => `<div class="pp-sig"><b>${t}</b><span>${s}</span></div>`;
  const sigs = `<h3 style="margin-top:18px">What it says</h3><div class="pp-sigs">` +
    sig("Leasing demand", pt ? `${round(pt.last)} tenant build-outs a month${changeWords(pt) ? `, ${changeWords(pt)}` : ""}. A build-out follows a signed lease, so this moves before vacancy does.` : "Not enough months yet.") +
    sig("New supply", pn ? `${round(pn.last)} new buildings and additions a month${changeWords(pn) ? `, ${changeWords(pn)}` : ""}. This is the space competing for tenants in a year or two.` : "Not enough months yet.") +
    sig("How busy the city is", `${round(p.openShare * 100)}% of the last two months’ permits are still in review. Longer waits hold back new supply.`) +
    sig("Second thoughts", `${round(p.endedShare * 100)}% of the ${n} months’ permits were voided or withdrawn (${p.ended} of ${p.total}). A rising share means projects are being shelved.`) +
    `</div>`;
  const others = (view.others || []).filter((o) => o && o.pulse);
  const row = (name, q, me) => `<tr${me ? ' class="me"' : ""}><td>${esc(name)}</td><td>${q.pace.all ? round(q.pace.all.last) : "–"}</td>` +
    `<td>${q.waits.ti == null ? "–" : `${q.waits.ti} days`}</td><td>${q.waits.new == null ? "–" : `${q.waits.new} days`}</td></tr>`;
  const table = others.length
    ? `<h3 style="margin-top:18px">Next to ${esc(others.map((o) => o.city).join(" and "))}</h3><div class="pp-tbl"><table>` +
      `<thead><tr><th>City</th><th>A month</th><th>Build-out wait</th><th>New-building wait</th></tr></thead><tbody>` +
      row(view.city, p, true) + others.map((o) => row(o.city, o.pulse, false)).join("") + `</tbody></table></div>` +
      // The whole comparison is the tracker's (/permits/compare), so a member
      // only; a signed-out reader already has the section's one sign-up door.
      (view.signedIn ? `<p class="pp-cmp"><a class="pp-more" href="/permits/compare">Compare the cities in full &rarr;</a></p>` : "")
    : "";
  const stale = view.freshness && view.freshness.stale && p.lastSeenAt
    ? ` <span class="pp-stale">Last read ${esc(new Date(p.lastSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: F.PORTAL_TZ }))}, more than a business day ago, so newer permits may be missing.</span>`
    : "";
  const more = view.signedIn
    ? `<a class="pp-more" href="/permits">See each permit &rarr;</a>`
    : `<a class="pp-more" href="/?auth=signup">See each permit with a free account &rarr;</a>`;
  const span = `${esc(monthLabel(p.from, true))} through ${esc(monthLabel(p.through, true))}`;
  // A city read from its published reports (Nampa, permit-reports.js) says so:
  // where the figures come from, that they run behind, and that its kinds are
  // read from the words, since its reports carry no permit type.
  const asOf = p.asOf ? new Date(p.asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "";
  const source = view.reports
    ? `From the City of ${city}’s published permit reports, checked every weekday morning: ${span}. ` +
      `They run about a month behind, and they carry no permit type, so build-outs and new buildings are read from each permit’s description. ` +
      `Every commercial permit, of every property type. The wait is read from how many permits of each age had been issued by ${esc(asOf || "the reports’ latest date")}, so it assumes the city kept a steady pace.`
    : `From ${city}’s building permit portal, read every weekday morning: ${span}. ` +
      `Every commercial permit, of every property type. The wait is read from how many permits of each age are issued today, so it assumes the city kept a steady pace.`;
  return `<style>${PULSE_CSS}</style><div class="card pp" id="permits"><h2>Building permits in ${city}</h2>` + figs +
    `<div class="pp-two"><div>${volume}</div><div>${wait}</div></div>` + sigs + table +
    `<p class="disc">${source}${stale} ${more}</p></div>`;
}

// A city whose portal we know but do not read (Nampa): say so, and point at
// the market pages of the cities we do read. Never a zero.
// view: { city, swept: [{ city, href|null }] }
function unreadCardHtml(view) {
  const swept = (view.swept || []).filter((s) => s && s.city);
  const names = swept.map((s) => s.city);
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const links = swept.filter((s) => s.href).map((s) => `<a class="pp-more" href="${esc(s.href)}">Permits in ${esc(s.city)} &rarr;</a>`).join(" &middot; ");
  return `<style>${PULSE_CSS}</style><div class="card pp" id="permits"><h2>Building permits in ${esc(view.city)}</h2>` +
    `<p>We read commercial building permits in ${esc(list)} so far, not yet in ${esc(view.city)}.</p>` +
    (links ? `<p style="margin:0">${links}</p>` : "") + `</div>`;
}

module.exports = {
  PULSE_MONTHS, MIN_MONTHS, PACE_MONTHS, BUCKET_DAYS, CURVE_DAYS, MIN_BUCKET, READ_DAYS, ANCHOR_DAY, WAIT_MAX_DAY,
  NEW_TYPES, TI_TYPES, PULSE_CSS,
  groupOf, stateOf, prevMonth, monthLabel, curve, curvePoints, halfwayDays, drawablePoints, pace, buildPulse,
  changeHtml, pulseSectionHtml, unreadCardHtml,
};
