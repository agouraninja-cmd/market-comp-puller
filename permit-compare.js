"use strict";
// permit-compare.js — the cities the permit sweep reads, side by side by their
// building permits (2026-10-01, the owner's "add a way to compare cities or
// markets by the permit information for the permit scraper"). The page is
// GET /permits/compare, under the Permit tracker; server.js owns the route,
// the gate and the read, and this file decides what is said and drawn.
//
// Pure: no I/O, no clock reads. It reads the pulses permit-pulse.js already
// builds for the market pages (server.js's PERMIT_PULSE cache), so a figure
// here and the same figure in a city's own market-page section are one
// number, computed once.
//
// CITIES, NOT PROPERTY TYPES. Every commercial permit of every type, as on
// the market pages, and the page says so. A permit's type comes from its
// parcel's zoning, which the sweep looks up only for permits read in full;
// the history pass's year of backfill has none. A per-type count would rise
// month by month as zoned permits replaced unzoned ones: a trend made by the
// sweep, not the market. Split by type once the backfill is zoned.
//
// THE RULES
//  - Only a city with a pulse is compared (six complete months, permit-
//    pulse.js's floor), and comparing needs two. One city, or none, is a
//    sentence saying so, never a column of zeros.
//  - Colour follows the city, never its rank: a city's slot is its place in
//    the jurisdiction registry, so Boise is the same blue on every chart and
//    on every visit, and a city switched on later takes the next slot rather
//    than repainting the others. Three slots, validated together (dataviz
//    validator, all pairs, light and dark) — the registry holds three cities.
//  - One axis. Counts are counts. "Against its own average" indexes each
//    city to 100 = its own monthly average over the months drawn, so a small
//    city's trend reads beside a large one's without a second scale.
//  - The words claim only what the numbers carry. Two counts within 15% are
//    "about the same", two trends within five points get no verdict, two
//    waits within five days are "about the same time". The reads are written
//    for any number of cities and read naturally for two.
//  - Text wears ink. A city's colour is on its line, its dot and the small
//    key beside its name, never on a word or a number.
//
// The page literal's toggles are progressive: the server draws every chart
// (each kind, each scale, two widths) and marks all but the defaults hidden;
// the script only flips `hidden`. With no script the defaults still read.

const P = require("./permit-pulse");
const F = require("./permit-filings");

const SLOTS = 3;
const KINDS = [
  { key: "all", label: "All permits", field: "total" },
  { key: "ti", label: "Tenant build-outs", field: "ti" },
  { key: "new", label: "New buildings", field: "new" },
];
const SAME_RATIO = 1.15;
const TREND_POINTS = 5;
const WAIT_DAYS = 5;
const SHARE_POINTS = 3;
const MAX_WAIT_DAY = P.WAIT_MAX_DAY;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function n0(x) { return Math.round(x); }
function pct(x) { return Math.round(x * 100); }
function words(list) {
  const l = list.filter(Boolean);
  return l.length <= 1 ? (l[0] || "") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}
function possessive(name) { return `${name}’s`; }
function sumOf(months, k) { return months.reduce((a, m) => a + (m[k] || 0), 0); }

// "up 8%", "down 4%", "about level", or null when there is nothing before.
function trendWords(p) {
  if (!p || p.chg == null) return null;
  const x = Math.round(p.chg * 100);
  if (Math.abs(x) < 2) return "about level";
  return `${x > 0 ? "up" : "down"} ${Math.abs(x)}%`;
}

// cities: [{ key, city, slot, pulse }], the swept cities in registry order; a
// city whose pulse is null is left out. Answers { ready, cities, ... }.
function buildComparison(cities) {
  const list = (Array.isArray(cities) ? cities : []).filter((c) => c && c.city && c.pulse)
    .map((c) => ({ ...c, slot: Number.isInteger(c.slot) ? c.slot % SLOTS : 0 }));
  if (list.length < 2) return { ready: false, cities: list };
  const set = new Set();
  for (const c of list) for (const m of c.pulse.months) set.add(m.month);
  const months = [...set].sort().slice(-P.PULSE_MONTHS);
  return {
    ready: true, cities: list, months, from: months[0], through: months[months.length - 1],
    reads: comparisonReads(list), swing: swingNote(list),
  };
}

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------
function paceOf(c, kind) { const p = c.pulse.pace[kind]; return p ? p.last : null; }
function newShare(c) {
  const t = sumOf(c.pulse.months, "total");
  return t ? sumOf(c.pulse.months, "new") / t : null;
}
function ranked(list, get) {
  return list.filter((c) => get(c) != null).sort((a, b) => get(b) - get(a));
}
function times(ratio) {
  return ratio >= 1.95 ? `${String(Math.round(ratio * 10) / 10)} times` : `${Math.round((ratio - 1) * 100)}% more than`;
}

// A verdict on two or more trends, or "" when they are too close to call.
function trendVerdict(list, kind, they) {
  const r = ranked(list, (c) => (c.pulse.pace[kind] && c.pulse.pace[kind].chg != null ? c.pulse.pace[kind].chg : null));
  if (r.length < 2) return "";
  const hi = r[0], lo = r[r.length - 1];
  const a = hi.pulse.pace[kind].chg, b = lo.pulse.pace[kind].chg;
  if ((a - b) * 100 < TREND_POINTS) return "";
  if (a > 0 && b < 0) return ` ${possessive(hi.city)} ${they} are picking up while ${possessive(lo.city)} are slowing.`;
  if (a > 0) return ` ${possessive(hi.city)} ${they} are picking up faster.`;
  return ` ${possessive(lo.city)} ${they} are slowing more.`;
}

function busyRead(list) {
  const r = ranked(list, (c) => paceOf(c, "all"));
  if (r.length < 2) return null;
  const top = r[0], va = paceOf(top, "all");
  if (r.length === 2) {
    const low = r[1], vb = paceOf(low, "all");
    if (!(vb > 0) || va / vb < SAME_RATIO) {
      return `${top.city} and ${low.city} file about the same number of commercial permits, ${n0(va)} and ${n0(vb)} a month.`;
    }
    return `${top.city} files about ${n0(va)} commercial permits a month, ${times(va / vb)} ${possessive(low.city)} ${n0(vb)}.`;
  }
  return `${top.city} files the most, about ${n0(va)} commercial permits a month; then ${words(r.slice(1).map((c) => `${c.city} ${n0(paceOf(c, "all"))}`))}.`;
}

function headingRead(list) {
  const known = list.filter((c) => trendWords(c.pulse.pace.all));
  if (known.length < 2) return null;
  return `Over the last three months, against the months before, filings are ` +
    `${words(known.map((c) => `${trendWords(c.pulse.pace.all)} in ${c.city}`))}.` +
    trendVerdict(known, "all", "filings");
}

function demandRead(list) {
  const known = list.filter((c) => paceOf(c, "ti") != null);
  if (known.length < 2) return null;
  const each = known.map((c) => {
    const t = trendWords(c.pulse.pace.ti);
    return `${c.city} ${n0(paceOf(c, "ti"))} a month${t ? ` (${t})` : ""}`;
  });
  return `A tenant build-out follows a signed lease, so it moves before vacancy does: ${words(each)}.` + trendVerdict(known, "ti", "build-outs");
}

function supplyRead(list) {
  const known = list.filter((c) => newShare(c) != null);
  if (known.length < 2) return null;
  const r = ranked(known, newShare);
  const hi = r[0], next = r[1];
  const lead = (newShare(hi) - newShare(next)) * 100 >= SHARE_POINTS && newShare(hi) >= newShare(next) * 1.25;
  return `New buildings and additions are ${words(known.map((c) => `${pct(newShare(c))}% of ${possessive(c.city)}`))} permits.` +
    (lead ? ` More of ${possessive(hi.city)} activity is new space that will compete for tenants in a year or two.`
      : known.length === 2 ? " A similar share in both." : "");
}

function speedRead(list) {
  const ti = list.filter((c) => c.pulse.waits.ti != null).sort((a, b) => a.pulse.waits.ti - b.pulse.waits.ti);
  const nw = list.filter((c) => c.pulse.waits.new != null);
  const missing = list.filter((c) => c.pulse.waits.ti == null).map((c) => c.city);
  let s = "";
  if (ti.length >= 2) {
    const fast = ti[0], slow = ti[ti.length - 1];
    if (slow.pulse.waits.ti - fast.pulse.waits.ti < WAIT_DAYS) {
      s = `${words(ti.map((c) => c.city))} issue half their tenant build-outs in about the same time: ${words(ti.map((c) => String(c.pulse.waits.ti)))} days.`;
    } else {
      const rest = ti.slice(1);
      s = `${fast.city} issues half its tenant build-outs within about ${fast.pulse.waits.ti} days; ` +
        (rest.length === 1 ? `${rest[0].city} takes about ${rest[0].pulse.waits.ti}.`
          : `${words(rest.map((c) => `${c.city} about ${c.pulse.waits.ti}`))}.`);
    }
  } else if (ti.length === 1) {
    s = `${ti[0].city} issues half its tenant build-outs within about ${ti[0].pulse.waits.ti} days.`;
  }
  if (missing.length && missing.length < list.length) s += ` There are too few recent build-outs in ${words(missing)} to read a wait yet.`;
  if (nw.length >= 2) s += ` New buildings take about ${words(nw.map((c) => `${c.pulse.waits.new} days in ${c.city}`))}.`;
  if (!s) s = `There are too few recent permits in ${words(list.map((c) => c.city))} to read a wait yet.`;
  return s.trim();
}

function shelvedRead(list) {
  const r = ranked(list, (c) => c.pulse.endedShare);
  const each = list.map((c) => `${pct(c.pulse.endedShare)}% of ${possessive(c.city)}`);
  const gap = r.length >= 2 && (r[0].pulse.endedShare - r[1].pulse.endedShare) * 100 >= SHARE_POINTS;
  return `${words(each)} permits were voided or withdrawn.` + (gap ? ` A higher share of ${possessive(r[0].city)} projects were shelved.` : "");
}

function comparisonReads(list) {
  return [
    { title: "How busy each city is", text: busyRead(list) },
    { title: "Which way it’s heading", text: headingRead(list) },
    { title: "Leasing demand", text: demandRead(list) },
    { title: "New supply for its size", text: supplyRead(list) },
    { title: "How fast permits are issued", text: speedRead(list) },
    { title: "Second thoughts", text: shelvedRead(list) },
  ].filter((r) => r.text);
}

// A small city's percentages swing; say so when one files far fewer.
function swingNote(list) {
  const r = ranked(list, (c) => paceOf(c, "all"));
  if (r.length < 2) return "";
  const top = paceOf(r[0], "all");
  const small = r.slice(1).filter((c) => paceOf(c, "all") < top * 0.67).map((c) => c.city);
  if (!small.length) return "";
  return `${words(small)} ${small.length === 1 ? "files" : "file"} far fewer permits, so ${small.length === 1 ? "its" : "their"} percentages swing more from month to month.`;
}

// ---------------------------------------------------------------------------
// The side-by-side table
// ---------------------------------------------------------------------------
function key(slot) { return `<i class="pc-k pc-s${slot}" aria-hidden="true"></i>`; }
function days(v) { return v == null ? "–" : `${v} days`; }

function tableHtml(view) {
  const cs = view.cities;
  const cell = (v, note) => `<td><span class="pc-v">${v}</span>${note ? `<span class="pc-n">${note}</span>` : ""}</td>`;
  const pace = (c, kind) => (c.pulse.pace[kind] ? n0(c.pulse.pace[kind].last) : "–");
  const rows = [
    ["Permits filed a month", "last 3 months", (c) => cell(pace(c, "all"), P.changeHtml(c.pulse.pace.all))],
    ["Tenant build-outs a month", "a sign of leasing demand", (c) => cell(pace(c, "ti"), P.changeHtml(c.pulse.pace.ti))],
    ["New buildings &amp; additions a month", "space that will compete for tenants", (c) => cell(pace(c, "new"), P.changeHtml(c.pulse.pace.new))],
    ["New buildings’ share of permits", "", (c) => cell(newShare(c) == null ? "–" : `${pct(newShare(c))}%`, "")],
    ["Typical wait, tenant build-out", "filed to issued", (c) => cell(days(c.pulse.waits.ti), c.pulse.waits.ti == null ? "too few recent permits" : "")],
    ["Typical wait, new building", "filed to issued", (c) => cell(days(c.pulse.waits.new), c.pulse.waits.new == null ? "too few recent permits" : "")],
    ["Still in review", "of the last two months’ permits", (c) => cell(`${pct(c.pulse.openShare)}%`, "")],
    ["Voided or withdrawn", "", (c) => cell(`${pct(c.pulse.endedShare)}%`, `${c.pulse.ended} of ${c.pulse.total.toLocaleString("en-US")}`)],
    ["Months read", "", (c) => cell(String(c.pulse.months.length), `${esc(P.monthLabel(c.pulse.from))} ’${c.pulse.from.slice(2, 4)} to ${esc(P.monthLabel(c.pulse.through))} ’${c.pulse.through.slice(2, 4)}`)],
  ];
  return `<div class="pc-tbl"><table class="pc-side"><thead><tr><th scope="col"><span class="pc-sr">Measure</span></th>` +
    cs.map((c) => `<th scope="col">${key(c.slot)}${esc(c.city)}</th>`).join("") + `</tr></thead><tbody>` +
    rows.map(([label, sub, f]) => `<tr><th scope="row">${label}${sub ? `<span class="pc-n">${sub}</span>` : ""}</th>${cs.map(f).join("")}</tr>`).join("") +
    `</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// The charts
// ---------------------------------------------------------------------------
function tickStep(span) {
  return span > 200 ? 100 : span > 100 ? 50 : span > 40 ? 20 : span > 16 ? 10 : 5;
}
function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ""); }

// One city's values over the shared months for a kind, as counts or indexed
// to its own average (100). Null where the city has no complete month.
function seriesOf(c, months, field, scale) {
  const by = new Map(c.pulse.months.map((m) => [m.month, m[field] || 0]));
  const counts = months.map((m) => (by.has(m) ? by.get(m) : null));
  if (scale !== "index") return { counts, vals: counts };
  const known = counts.filter((v) => v != null);
  const mean = known.length ? known.reduce((a, v) => a + v, 0) / known.length : 0;
  return { counts, vals: counts.map((v) => (v == null || !(mean > 0) ? null : v / mean * 100)) };
}

function pathOf(points) {
  let d = "", pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

// Two or more end labels never stack: the upper of a close pair goes above
// its dot, the lower below.
function endLabels(ends) {
  const s = ends.slice().sort((a, b) => a.y - b.y);
  return s.map((e, i) => {
    const close = (i > 0 && e.y - s[i - 1].y < 14) || (i < s.length - 1 && s[i + 1].y - e.y < 14);
    const below = close && i > 0 && e.y - s[i - 1].y < 14;
    return `<text class="pc-val" x="${e.x.toFixed(1)}" y="${(below ? e.y + 18 : e.y - 9).toFixed(1)}" text-anchor="end">${e.text}</text>`;
  }).join("");
}

function tipAttr(title, parts) {
  return ` data-t="${esc(title)}" data-v="${esc(parts.map((p) => `${p.slot}~${p.name}~${p.text}`).join("|"))}"`;
}

// Filed each month, one line per city.
function linesSvg(view, kind, scale, W0, H0, every) {
  const k = KINDS.find((x) => x.key === kind) || KINDS[0];
  const months = view.months;
  const pad = { l: 34, r: 14, t: 18, b: 22 }, iw = W0 - pad.l - pad.r, ih = H0 - pad.t - pad.b;
  const series = view.cities.map((c) => ({ c, ...seriesOf(c, months, k.field, scale) }));
  const all = series.flatMap((s) => s.vals.filter((v) => v != null));
  let lo = 0, hi, step;
  if (scale === "index") {
    const mn = Math.min(100, ...all), mx = Math.max(100, ...all);
    step = tickStep(mx - mn) >= 50 ? 50 : 25;
    lo = Math.max(0, Math.floor((mn - 5) / step) * step);
    hi = Math.ceil((mx + 5) / step) * step;
  } else {
    const mx = Math.max(1, ...all);
    step = tickStep(mx);
    hi = Math.ceil(mx * 1.15 / step) * step;
  }
  const band = iw / months.length;
  const x = (i) => pad.l + band * (i + 0.5), y = (v) => pad.t + ih - (v - lo) / (hi - lo) * ih;
  let s = "";
  for (let t = lo; t <= hi; t += step) {
    const cls = scale === "index" && t === 100 ? "pc-base" : "pc-grid";
    s += `<line class="${cls}" x1="${pad.l}" x2="${W0 - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
      `<text class="pc-tick" x="${pad.l - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
  }
  months.forEach((m, i) => {
    if (i % every === 0 || i === months.length - 1) {
      const yr = m.slice(5) === "01" || i === 0 ? ` ’${m.slice(2, 4)}` : "";
      s += `<text class="pc-tick" x="${x(i).toFixed(1)}" y="${H0 - 6}" text-anchor="middle">${P.monthLabel(m)}${yr}</text>`;
    }
  });
  const ends = [];
  for (const sr of series) {
    const pts = sr.vals.map((v, i) => (v == null ? null : [x(i), y(v)]));
    s += `<path class="pc-line pc-s${sr.c.slot}" d="${pathOf(pts)}"/>`;
    const last = sr.vals.reduce((a, v, i) => (v == null ? a : i), -1);
    if (last >= 0) {
      s += `<circle class="pc-dot pc-s${sr.c.slot}" cx="${x(last).toFixed(1)}" cy="${y(sr.vals[last]).toFixed(1)}" r="4"/>`;
      if (scale !== "index") ends.push({ x: x(last) + 4, y: y(sr.vals[last]), text: String(sr.counts[last]) });
    }
  }
  s += endLabels(ends);
  months.forEach((m, i) => {
    const parts = series.filter((sr) => sr.counts[i] != null).map((sr) => ({
      slot: sr.c.slot, name: sr.c.city,
      text: scale === "index" ? `${n0(sr.vals[i])} (${sr.counts[i]} filed)` : `${sr.counts[i]} filed`,
    }));
    s += `<g class="pc-hit"${tipAttr(P.monthLabel(m, true), parts)}><rect x="${(x(i) - band / 2).toFixed(1)}" y="${pad.t}" width="${band.toFixed(1)}" height="${ih}"/>` +
      `<line class="pc-guide" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ih}"/></g>`;
  });
  return s;
}

// A city's wait curve as drawn, or [] when it cannot be: permit-pulse.js's
// drawablePoints, the market section's own rule (under two usable points, or
// a first point past halfwayDays' anchor, ~5 weeks).
function drawablePoints(c, kind) {
  return P.drawablePoints(c.pulse.curves && c.pulse.curves[kind], MAX_WAIT_DAY);
}

// Share issued by days since filing, one line per city, each halfway dot in
// the city's colour.
function waitsSvg(view, kind, W0, H0, every) {
  const pad = { l: 38, r: 14, t: 16, b: 24 }, iw = W0 - pad.l - pad.r, ih = H0 - pad.t - pad.b;
  const x = (d) => pad.l + Math.min(d, MAX_WAIT_DAY) / MAX_WAIT_DAY * iw, y = (p) => pad.t + ih - p * ih;
  let s = "";
  [0, 0.5, 1].forEach((p) => {
    s += `<line class="${p === 0.5 ? "pc-base" : "pc-grid"}" x1="${pad.l}" x2="${W0 - pad.r}" y1="${y(p)}" y2="${y(p)}"/>` +
      `<text class="pc-tick" x="${pad.l - 6}" y="${y(p) + 4}" text-anchor="end">${p * 100}%</text>`;
  });
  for (let d = 0; d <= MAX_WAIT_DAY; d += 30 * every) {
    s += `<text class="pc-tick" x="${x(d)}" y="${H0 - 6}" text-anchor="middle">${d}</text>`;
  }
  const curves = view.cities.map((c) => ({ c, pts: drawablePoints(c, kind), wait: c.pulse.waits[kind] }));
  for (const cv of curves) {
    if (!cv.pts.length) continue;
    s += `<polyline class="pc-line pc-s${cv.c.slot}" points="${cv.pts.map((p) => `${x(p.day).toFixed(1)},${y(p.share).toFixed(1)}`).join(" ")}"/>`;
  }
  const dots = curves.filter((cv) => cv.wait != null && cv.wait <= MAX_WAIT_DAY && cv.pts.length).sort((a, b) => a.wait - b.wait);
  dots.forEach((cv, i) => {
    const up = i % 2 === 0;
    s += `<circle class="pc-dot pc-s${cv.c.slot}" cx="${x(cv.wait).toFixed(1)}" cy="${y(0.5)}" r="4.5"/>` +
      `<text class="pc-val" x="${(x(cv.wait) + (up ? -7 : 7)).toFixed(1)}" y="${y(0.5) + (up ? -9 : 17)}" text-anchor="${up ? "end" : "start"}">${cv.wait} days</text>`;
  });
  const daysSet = [...new Set(curves.flatMap((cv) => cv.pts.map((p) => p.day)))].sort((a, b) => a - b);
  const w = P.BUCKET_DAYS / MAX_WAIT_DAY * iw;
  for (const d of daysSet) {
    const parts = curves.map((cv) => ({ cv, p: cv.pts.find((q) => q.day === d) })).filter((o) => o.p)
      .map((o) => ({ slot: o.cv.c.slot, name: o.cv.c.city, text: `${pct(o.p.share)}% issued` }));
    s += `<g class="pc-hit"${tipAttr(`Filed about ${Math.round(d)} days ago`, parts)}><rect x="${(x(d) - w / 2).toFixed(1)}" y="${pad.t}" width="${w.toFixed(1)}" height="${ih}"/>` +
      `<line class="pc-guide" x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ih}"/></g>`;
  }
  return s;
}

// The month-by-month numbers behind the line chart: its table view.
function numbersHtml(view) {
  const cs = view.cities;
  return `<details class="pc-nums"><summary>Each month’s numbers</summary>` + KINDS.map((k) => {
    const series = cs.map((c) => seriesOf(c, view.months, k.field, "count").counts);
    return `<div class="pc-tbl" data-kind="${k.key}"${k.key === "all" ? "" : " hidden"}><table class="pc-month"><thead><tr><th scope="col">${esc(k.label)}</th>` +
      cs.map((c) => `<th scope="col">${key(c.slot)}${esc(c.city)}</th>`).join("") + `</tr></thead><tbody>` +
      view.months.slice().reverse().map((m) => {
        const i = view.months.indexOf(m);
        return `<tr><th scope="row">${esc(P.monthLabel(m, true))}</th>${series.map((v) => `<td>${v[i] == null ? "–" : v[i]}</td>`).join("")}</tr>`;
      }).join("") + `</tbody></table></div>`;
  }).join("") + `</details>`;
}

// ---------------------------------------------------------------------------
// The page body
// ---------------------------------------------------------------------------
const COMPARE_CSS =
  ".pc-page,.pc-page *{box-sizing:border-box}" +
  ".pc-page{margin:24px 0 48px;--s0:#2a78d6;--s1:#eb6834;--s2:#1baf7a}" +
  "@media screen{[data-theme=\"dark\"] .pc-page{--s0:#3987e5;--s1:#d95926;--s2:#199e70}}" +
  ".pc-page [hidden]{display:none!important}" +
  ".pc-page .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}" +
  ".pc-page .kicker a{color:var(--ink-3)}.pc-page .kicker a:hover{color:var(--ink)}" +
  ".pc-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1.5px solid var(--ink);padding-bottom:6px;margin-bottom:10px}" +
  ".pc-head h1{margin:0;font-family:Georgia,\"Times New Roman\",serif;font-weight:400;font-size:24px;color:var(--ink)}" +
  ".pc-when{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;white-space:nowrap}" +
  ".pc-sub{font-size:13.5px;color:var(--ink-2);margin:0 0 4px;max-width:72ch}" +
  ".pc-sub.stale{color:var(--warn-text)}" +
  ".pc-page .card{margin:16px 0}" +
  ".pc-k{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:7px;vertical-align:4px;background:var(--s0)}" +
  ".pc-k.pc-s1{background:var(--s1)}.pc-k.pc-s2{background:var(--s2)}" +
  ".pc-tbl{overflow-x:auto}" +
  // MARKET_CSS styles every table as the comp table (640px floor, a washed,
  // upper-case th, a hairline above each td); this page's tables are not that.
  ".pc-page table{width:100%;min-width:0;border-collapse:collapse;font-size:13.5px}" +
  ".pc-page table.pc-side{min-width:380px}" +
  ".pc-page th,.pc-page td{padding:9px 8px;border-top:0;border-bottom:1px solid var(--hair);text-align:right;vertical-align:top;" +
  "background:none;text-transform:none;letter-spacing:normal;font-size:13.5px;color:var(--ink-body)}" +
  ".pc-page th:first-child,.pc-page td:first-child{min-width:0}" +
  ".pc-page thead th{font-size:13px;font-weight:600;color:var(--ink);border-bottom:1px solid var(--edge);white-space:nowrap}" +
  ".pc-page th[scope=row]{text-align:left;font-weight:500;color:var(--ink);padding-left:0;min-width:150px}" +
  ".pc-page thead th:first-child{text-align:left;padding-left:0}" +
  ".pc-page tbody tr:last-child th,.pc-page tbody tr:last-child td{border-bottom:0}" +
  ".pc-v{display:block;font-family:Georgia,\"Times New Roman\",serif;font-size:18px;color:var(--ink);line-height:1.25}" +
  ".pc-n{display:block;font-size:12px;color:var(--ink-3);font-weight:400;margin-top:1px}" +
  ".pc-page .pp-up{color:var(--ok-text);font-weight:600}.pc-page .pp-down{color:var(--err-text);font-weight:600}" +
  ".pc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
  ".pc-ctl{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 12px}" +
  ".pc-seg{display:inline-flex;border:1px solid var(--edge);border-radius:8px;overflow:hidden;background:var(--card)}" +
  ".pc-seg button{font:inherit;font-size:13px;color:var(--ink-2);background:none;border:0;border-left:1px solid var(--edge);padding:6px 12px;cursor:pointer;white-space:nowrap}" +
  ".pc-seg button:first-child{border-left:0}" +
  ".pc-seg button[aria-pressed=true]{background:var(--slab,var(--ink));color:#fff}" +
  ".pc-seg button:focus-visible{outline:2px solid var(--red);outline-offset:-2px}" +
  ".pc-lg{display:flex;gap:6px 18px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}" +
  ".pc-two{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:26px}" +
  ".pc-two>div{min-width:0;position:relative}" +
  ".pc-ch{display:flex;align-items:center;justify-content:space-between;gap:8px 10px;flex-wrap:wrap;margin:6px 0 8px;min-height:28px}" +
  ".pc-page .pc-ch h3{margin:0}" +
  ".pc-ch .pc-seg button{font-size:12px;padding:4px 9px}" +
  ".pc-page svg{width:100%;height:auto;display:block;overflow:visible}" +
  ".pc-page svg text{font-size:11px}" +
  ".pc-grid{stroke:var(--hair);stroke-width:1}.pc-base{stroke:var(--ink-4);stroke-width:1}" +
  ".pc-tick{fill:var(--ink-3)}.pc-val{fill:var(--ink);font-weight:600;font-size:11.5px}" +
  ".pc-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;stroke:var(--s0)}" +
  ".pc-line.pc-s1{stroke:var(--s1)}.pc-line.pc-s2{stroke:var(--s2)}" +
  ".pc-dot{fill:var(--s0);stroke:var(--card);stroke-width:2}.pc-dot.pc-s1{fill:var(--s1)}.pc-dot.pc-s2{fill:var(--s2)}" +
  ".pc-hit rect{fill:transparent}.pc-guide{stroke:var(--ink-3);stroke-width:1;opacity:0}" +
  ".pc-hit:hover .pc-guide{opacity:.6}" +
  ".pc-page svg.pc-narrow{display:none}" +
  ".pc-page .pc-cap{font-size:12px;color:var(--ink-3);margin:6px 0 0}" +
  ".pc-tip{position:absolute;pointer-events:none;z-index:5;background:var(--card);border:1px solid var(--edge);border-radius:6px;box-shadow:0 6px 18px -8px rgba(15,23,42,.35);padding:7px 10px;font-size:12.5px;color:var(--ink-body);white-space:nowrap}" +
  ".pc-tip b{display:block;color:var(--ink);font-weight:600;margin-bottom:2px}" +
  ".pc-nums{margin-top:14px;font-size:13px}" +
  ".pc-nums summary{cursor:pointer;color:var(--ink-2)}" +
  ".pc-month{max-width:520px;margin-top:6px;font-variant-numeric:tabular-nums}" +
  ".pc-month td,.pc-month th{padding:5px 8px}" +
  ".pc-reads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 26px}" +
  ".pc-read{border-top:1px solid var(--ink);padding-top:8px;min-width:0}" +
  ".pc-read b{display:block;color:var(--ink);font-size:14px;margin-bottom:2px}" +
  ".pc-read span{font-size:13.5px;color:var(--ink-body)}" +
  ".pc-disc{font-size:12.5px;color:var(--ink-3);margin:14px 0 0;max-width:80ch}" +
  ".pc-disc a,.pc-wall a.pc-more{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--edge);text-underline-offset:3px}" +
  ".pc-wall{border:1px solid var(--edge);border-radius:8px;background:var(--card);padding:18px 20px;margin:18px 0}" +
  ".pc-wall p{margin:0 0 8px;color:var(--ink-body);font-size:14.5px}.pc-wall p:last-child{margin:0}" +
  "@media (max-width:640px){.pc-two,.pc-reads{grid-template-columns:minmax(0,1fr)}.pc-page svg.pc-wide{display:none}.pc-page svg.pc-narrow{display:block}" +
  ".pc-page .card{padding:18px 14px}" +
  ".pc-page table.pc-side{min-width:0;table-layout:fixed}" +
  ".pc-page th[scope=row]{min-width:0;width:42%}" +
  ".pc-page th,.pc-page td{padding:8px 4px}" +
  ".pc-v{font-size:16px}.pc-n{font-size:11.5px}" +
  ".pc-ctl>.pc-seg{display:flex;width:100%}.pc-ctl>.pc-seg button{flex:1 1 auto;padding:6px 4px;font-size:12.5px}}";

// The tooltip and the toggles. No backtick and no template interpolation:
// this string is inlined into a template literal by the caller.
const COMPARE_JS =
  "(function(){var root=document.getElementById('pcRoot');if(!root)return;" +
  "var st={kind:'all',scale:'count'};" +
  "function show(){root.querySelectorAll('[data-kind]').forEach(function(el){" +
  "var off=el.getAttribute('data-kind')!==st.kind||(el.hasAttribute('data-scale')&&el.getAttribute('data-scale')!==st.scale);" +
  "if(off)el.setAttribute('hidden','');else el.removeAttribute('hidden');});" +
  "root.querySelectorAll('[data-set-kind]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-set-kind')===st.kind));});" +
  "root.querySelectorAll('[data-set-scale]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-set-scale')===st.scale));});}" +
  "root.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;" +
  "if(b.hasAttribute('data-set-kind'))st.kind=b.getAttribute('data-set-kind');" +
  "else if(b.hasAttribute('data-set-scale'))st.scale=b.getAttribute('data-set-scale');else return;show();});" +
  "root.querySelectorAll('.pc-ctl,.pc-scale').forEach(function(el){el.removeAttribute('hidden');});" +
  "var tip=document.createElement('div');tip.className='pc-tip';tip.hidden=true;" +
  "function esc(s){return String(s).replace(/[&<>\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]});}" +
  "root.addEventListener('mouseover',function(e){var g=e.target.closest('.pc-hit');if(!g){tip.hidden=true;return;}" +
  "var box=g.closest('.pc-chart');if(!box)return;if(tip.parentNode!==box)box.appendChild(tip);" +
  "var rows=(g.getAttribute('data-v')||'').split('|').filter(Boolean).map(function(p){var a=p.split('~');" +
  "return '<div><i class=\"pc-k pc-s'+esc(a[0])+'\"></i>'+esc(a[1])+' '+esc(a[2])+'</div>';}).join('');" +
  "tip.innerHTML='<b>'+esc(g.getAttribute('data-t')||'')+'</b>'+rows;tip.hidden=false;" +
  "var r=g.getBoundingClientRect(),b=box.getBoundingClientRect(),w=tip.offsetWidth;" +
  "var left=r.left-b.left+r.width/2+12;if(left+w>b.width)left=r.left-b.left+r.width/2-w-12;" +
  "tip.style.left=Math.max(0,left)+'px';tip.style.top='28px';});" +
  "root.addEventListener('mouseleave',function(){tip.hidden=true;});show();})();";

function seg(attr, items, cur, label) {
  return `<div class="pc-seg" role="group" aria-label="${esc(label)}">` +
    items.map((it) => `<button type="button" ${attr}="${it.key}" aria-pressed="${it.key === cur}">${esc(it.label)}</button>`).join("") + `</div>`;
}

function chartsHtml(view) {
  const names = words(view.cities.map((c) => c.city));
  const lines = KINDS.map((k) => ["count", "index"].map((sc) => {
    const off = k.key !== "all" || sc !== "count" ? " hidden" : "";
    const aria = `${esc(k.label)} filed each month in ${esc(names)}${sc === "index" ? ", against each city’s own average" : ""}`;
    return `<svg class="pc-wide" data-kind="${k.key}" data-scale="${sc}"${off} viewBox="0 0 620 250" role="img" aria-label="${aria}">${linesSvg(view, k.key, sc, 620, 250, 1)}</svg>` +
      `<svg class="pc-narrow" data-kind="${k.key}" data-scale="${sc}"${off} viewBox="0 0 340 210" role="img" aria-label="${aria}">${linesSvg(view, k.key, sc, 340, 210, 2)}</svg>`;
  }).join("")).join("");
  const waits = KINDS.map((k) => {
    const off = k.key !== "all" ? " hidden" : "";
    const aria = `Share of ${esc(k.label.toLowerCase())} issued by days since filing in ${esc(names)}`;
    const missing = view.cities.filter((c) => !drawablePoints(c, k.key).length).map((c) => c.city);
    const noun = k.key === "all" ? "permits" : k.label.toLowerCase();
    return `<svg class="pc-wide" data-kind="${k.key}"${off} viewBox="0 0 440 250" role="img" aria-label="${aria}">${waitsSvg(view, k.key, 440, 250, 1)}</svg>` +
      `<svg class="pc-narrow" data-kind="${k.key}"${off} viewBox="0 0 340 210" role="img" aria-label="${aria}">${waitsSvg(view, k.key, 340, 210, 2)}</svg>` +
      (missing.length ? `<p class="pc-cap" data-kind="${k.key}"${off}>Too few recent ${esc(noun)} in ${esc(words(missing))} to draw ${missing.length === 1 ? "its" : "their"} line.</p>` : "");
  }).join("");
  const capIndex = `<p class="pc-cap" data-kind="all" data-scale="index" hidden>100 is each city’s own monthly average over these months, so the lines show which way each city is moving, not which is bigger.</p>`;
  const capIdx = KINDS.map((k) => capIndex.replace('data-kind="all"', `data-kind="${k.key}"`)).join("");
  return `<div class="pc-ctl" hidden>${seg("data-set-kind", KINDS, "all", "Which permits")}` +
    `<div class="pc-lg">${view.cities.map((c) => `<span>${key(c.slot)}${esc(c.city)}</span>`).join("")}</div></div>` +
    `<noscript><div class="pc-lg" style="margin-bottom:10px">${view.cities.map((c) => `<span>${key(c.slot)}${esc(c.city)}</span>`).join("")}</div></noscript>` +
    `<div class="pc-two"><div class="pc-chart"><div class="pc-ch"><h3>Filed each month</h3><span class="pc-scale" hidden>${seg("data-set-scale", [{ key: "count", label: "Count" }, { key: "index", label: "Against its own average" }], "count", "Scale")}</span></div>${lines}${capIdx}</div>` +
    `<div class="pc-chart"><div class="pc-ch"><h3>How long until they’re issued</h3></div>${waits}<p class="pc-cap">Share of permits issued by days since filing. The dot is where half are issued.</p></div></div>` +
    numbersHtml(view);
}

function readsHtml(view) {
  return `<div class="pc-reads">${view.reads.map((r) => `<div class="pc-read"><b>${esc(r.title)}</b><span>${esc(r.text)}</span></div>`).join("")}</div>`;
}

function rangeLabel(from, through) {
  return `${P.monthLabel(from, true)} to ${P.monthLabel(through, true)}`;
}

// view: { s, error?, comparison?, swept: [labels], stale?: { at }, marketLinks: [{ city, href }] }
// Answers the <main> body for marketShell.
function renderCompareBody(view) {
  const v = view || {};
  const head = (when) => `<style>${COMPARE_CSS}</style><main class="wrap pc-page" id="pcRoot"><div class="kicker"><a href="/permits">Permit tracker</a></div>` +
    `<div class="pc-head"><h1>Compare cities by their permits</h1>${when ? `<span class="pc-when">${esc(when)}</span>` : ""}</div>`;
  const wall = (html) => `${head("")}<div class="pc-wall">${html}</div></main>`;
  if (v.s === 401) return wall(`<p>Sign in to compare cities by their building permits.</p><p><a href="/?auth=signin">Sign in</a></p>`);
  if (v.s !== 200) return wall(`<p>${esc(v.error || "The permit figures are unavailable right now. Please try again in a minute.")}</p>`);
  const cmp = v.comparison || { ready: false, cities: [] };
  const swept = words(v.swept || []);
  if (!cmp.ready) {
    const have = cmp.cities.map((c) => c.city);
    const rest = (v.swept || []).filter((s) => !have.includes(s));
    return wall(have.length
      ? `<p>Comparing needs two cities with at least six months of permits. Right now only ${esc(words(have))} has that.${rest.length ? ` ${esc(words(rest))} will appear here once enough months are in.` : ""}</p><p><a class="pc-more" href="/permits">See each permit &rarr;</a></p>`
      : `<p>The permit figures for ${esc(swept || "the cities we read")} couldn’t be loaded just now. Please try again in a minute.</p><p><a class="pc-more" href="/permits">See each permit &rarr;</a></p>`);
  }
  const stale = v.stale && v.stale.at
    ? `<p class="pc-sub stale">Last read ${esc(new Date(v.stale.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: F.PORTAL_TZ }))}, more than a business day ago, so newer permits may be missing.</p>`
    : "";
  const links = (v.marketLinks || []).filter((l) => l && l.href);
  return head(rangeLabel(cmp.from, cmp.through)) +
    `<p class="pc-sub">Commercial building permits in ${esc(words(cmp.cities.map((c) => c.city)))}, side by side. Every figure is read from each city’s own permit portal, the same way as on its market page.</p>${stale}` +
    `<section class="card" aria-labelledby="pcSide"><h2 id="pcSide">Side by side</h2>${tableHtml(cmp)}</section>` +
    `<section class="card" aria-labelledby="pcMonths"><h2 id="pcMonths">Month by month</h2>${chartsHtml(cmp)}</section>` +
    `<section class="card" aria-labelledby="pcReads"><h2 id="pcReads">What it says</h2>${readsHtml(cmp)}</section>` +
    `<p class="pc-disc">From each city’s building permit portal, read every weekday morning: ${esc(rangeLabel(cmp.from, cmp.through))}. ` +
    `Every commercial permit, of every property type: a permit’s type comes from its parcel’s zoning, which the older months do not have yet, so splitting by type would invent a trend. ` +
    `A month is counted once it is over. The wait is read from how many permits of each age are issued today, so it assumes each city kept a steady pace.` +
    `${cmp.swing ? ` ${esc(cmp.swing)}` : ""} <a href="/permits">See each permit &rarr;</a>` +
    (links.length ? ` &middot; ${links.map((l) => `<a href="${esc(l.href)}">${esc(l.city)}’s market page &rarr;</a>`).join(" &middot; ")}` : "") +
    `</p></main><script>${COMPARE_JS}</script>`;
}

module.exports = {
  SLOTS, KINDS, SAME_RATIO, TREND_POINTS, WAIT_DAYS, SHARE_POINTS, COMPARE_CSS, COMPARE_JS,
  trendWords, buildComparison, comparisonReads, swingNote, seriesOf, linesSvg, waitsSvg,
  tableHtml, renderCompareBody,
};
