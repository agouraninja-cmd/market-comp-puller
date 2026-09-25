// The shipped board: who merged how many commits each day, over a 14-day
// chart. One module for the two things that draw it, so they cannot disagree:
//
//   * scripts/ship-chat.js, the nightly job (.github/workflows/ship-chat.yml)
//     that counts the day, saves it, and posts the summary to the Developer
//     thread in Google Chat; and
//   * GET /dev/shipped in server.js, the page that summary links to.
//
// Pure: no I/O, no requires, and the clock only ever arrives as an argument,
// which is what lets test/ship-chat.test.js exercise every rule with nothing
// running.
//
// THE COUNTING RULE, and why each half of it exists:
//
//   * Credit goes to whoever OPENED THE PR, never to the name on a commit.
//     The owner's commits carry three author names (agouraninja-cmd, "Jacob
//     Adler" before 2026-08-13, and "Claude" for cloud sessions), Owen's
//     carry four and Chuck's two. The PR author is the one name each person
//     has exactly one of.
//   * The count is the PR's own NON-MERGE commits, never commits on main.
//     Owen squash-merges (his 3-commit PR #293 is one commit on main) and the
//     owner merge-commits, which also carries every "Merge origin/main into
//     branch" commit — 78 of them in the five weeks before this shipped.
//     Counting main would under-count one person and credit the other for
//     keeping a branch current.
//   * A day is a BOISE day. Most PRs merge between 01:00 and 06:00 UTC, i.e.
//     the evening before, so a UTC day moves an evening's work to tomorrow.

const REPO = "agouraninja-cmd/market-comp-puller";
const TZ = "America/Boise";
const BOARD_PATH = "/dev/shipped";

// Who the board is about, in the order it draws them. The login is the key;
// the colour is theirs for good (colour follows the person, never their rank
// that night). Validated with the dataviz skill's palette checker on a white
// surface: all pass, and Chuck's aqua is under 3:1 against it, which is why
// every line also carries a direct name label and a legend swatch.
const PEOPLE = [
  { login: "agouraninja-cmd", name: "Jacob", color: "#B91C1C" },
  { login: "owenbarnes5", name: "Owen", color: "#2A78D6" },
  { login: "chuckdickinson-ninja", name: "Chuck", color: "#1BAF7A" },
];

// The chart covers fixed 14-day periods and starts over when one ends. The
// first period began the day the first post covered (the owner's call), so
// it resets every other Thursday: Oct 8, Oct 22, and on.
const PERIOD_DAYS = 14;
const PERIOD_ANCHOR = "2026-09-24";

// --- dates ------------------------------------------------------------------

// "YYYY-MM-DD" for the Boise calendar day an instant falls on.
function boiseDate(instant) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(instant));
}

// Boise's offset from UTC at an instant, in minutes (-360 in summer, -420 in
// winter), read off the wall clock rather than a table of transition dates.
function boiseOffsetMinutes(instant) {
  const d = new Date(instant);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

// The day a run reports on: the Boise day it was six hours ago. A run at
// 00:07 reports the day that just ended, and so does one GitHub delayed until
// 05:59 — scheduled Actions are routinely late, sometimes by an hour.
function targetDay(now) {
  return boiseDate(new Date(now).getTime() - 6 * 3600 * 1000);
}

function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

// The fixed 14-day period a day falls in. `index` is 1-based: day 1 is the
// period's first day, day 14 its last.
function periodFor(day, anchor = PERIOD_ANCHOR, length = PERIOD_DAYS) {
  const offset = ((daysBetween(anchor, day) % length) + length) % length;
  const start = addDays(day, -offset);
  const days = Array.from({ length }, (_, i) => addDays(start, i));
  return { start, end: days[length - 1], index: offset + 1, length, days };
}

function isDay(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function dayParts(day) {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
  return { weekday: WEEKDAY[d.getUTCDay()], month: MONTH[d.getUTCMonth()], date: d.getUTCDate() };
}

// "Thursday, September 24"
function longDay(day) {
  const p = dayParts(day);
  return `${p.weekday}, ${p.month} ${p.date}`;
}

// "Thu, Sep 24"
function shortDay(day) {
  const p = dayParts(day);
  return `${p.weekday.slice(0, 3)}, ${p.month.slice(0, 3)} ${p.date}`;
}

// The UTC instant a Boise day starts. The offset is read at 06:30 UTC, which
// is inside the half hour before or after that midnight in both seasons, so
// it is the offset midnight itself had — including on the two nights a year
// the clocks move, when noon's offset would be an hour wrong.
function boiseMidnightUtc(day) {
  const ms = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return new Date(ms - boiseOffsetMinutes(ms + 6.5 * 3600000) * 60000);
}

// GitHub search for the PRs behind the numbers: that Boise day, as UTC
// instants, merged to main.
function prSearchUrl(model) {
  const startUtc = boiseMidnightUtc(model.day);
  const endUtc = new Date(boiseMidnightUtc(addDays(model.day, 1)).getTime() - 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const q = `is:pr is:merged base:main merged:${iso(startUtc)}..${iso(endUtc)}`;
  return `https://github.com/${REPO}/pulls?q=${encodeURIComponent(q)}`;
}

// --- counting ---------------------------------------------------------------

// The commits a PR carries that are work: a commit with two parents is a
// merge from main into the branch and counts for nothing.
function workCommits(pr) {
  const nodes = (pr.commits && pr.commits.nodes) || [];
  return nodes.filter((n) => n && n.commit && n.commit.parents && n.commit.parents.totalCount === 1).length;
}

// Per-day, per-person tallies for the days given. Anybody not in PEOPLE (a
// one-off contributor, a bot) is summed under `others` rather than dropped,
// so the footnote can say the three figures are not the whole day.
function tally(prs, days, people = PEOPLE) {
  const byDay = {};
  for (const day of days) {
    byDay[day] = { others: { commits: 0, prs: 0 } };
    for (const p of people) byDay[day][p.login] = { commits: 0, prs: 0 };
  }
  for (const pr of prs) {
    if (!pr || !pr.mergedAt) continue;
    const day = boiseDate(pr.mergedAt);
    if (!byDay[day]) continue;
    const login = pr.author && pr.author.login;
    const cell = byDay[day][people.some((p) => p.login === login) ? login : "others"];
    cell.commits += workCommits(pr);
    cell.prs += 1;
  }
  return byDay;
}

// Everything the board and the post need, and nothing that needs the network.
// Days after `day` are in the period but have not happened, so their points
// are null and the lines stop there. `merged` is that day's PRs, oldest
// first, which the page lists under the chart.
function buildModel(prs, day, people = PEOPLE, now = Date.now()) {
  const period = periodFor(day);
  const counts = tally(prs, period.days, people);
  const series = people.map((p) => {
    const points = period.days.map((d) => (d <= day ? counts[d][p.login].commits : null));
    const periodTotal = period.days.filter((d) => d <= day).reduce((s, d) => s + counts[d][p.login].commits, 0);
    return { ...p, today: counts[day][p.login], periodTotal, points };
  });
  const merged = prs
    .filter((pr) => pr && pr.mergedAt && boiseDate(pr.mergedAt) === day)
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
    .map((pr) => ({
      number: pr.number,
      title: String(pr.title || ""),
      login: (pr.author && pr.author.login) || "",
      commits: workCommits(pr),
    }));
  return {
    day,
    updatedAt: new Date(now).toISOString(),
    period: { start: period.start, end: period.end, index: period.index, length: period.length, days: period.days },
    resetsOn: addDays(period.end, 1),
    series,
    others: counts[day].others,
    merged,
  };
}

// A model read back from storage, rebuilt rather than trusted. The page
// renders it on compninja.co, so every string that reaches markup is either
// ours (names and colours come from PEOPLE, dates are recomputed from the day)
// or escaped, and every number is coerced. Anything malformed is null, and the
// page says the board is unavailable rather than drawing a guess.
function sanitizeModel(raw, people = PEOPLE) {
  if (!raw || typeof raw !== "object" || !isDay(raw.day)) return null;
  const int = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  const period = periodFor(raw.day);
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const series = people.map((p) => {
    const r = rawSeries.find((s) => s && s.login === p.login) || {};
    const pts = Array.isArray(r.points) ? r.points : [];
    const points = period.days.map((d, i) => (d <= raw.day ? int(pts[i]) : null));
    const today = r.today || {};
    return { ...p, today: { commits: int(today.commits), prs: int(today.prs) }, periodTotal: int(r.periodTotal), points };
  });
  const others = raw.others || {};
  const merged = (Array.isArray(raw.merged) ? raw.merged : []).slice(0, 100).map((m) => ({
    number: int(m && m.number),
    title: String((m && m.title) || "").slice(0, 300),
    login: String((m && m.login) || "").slice(0, 60),
    commits: int(m && m.commits),
  }));
  const updated = Date.parse(raw.updatedAt);
  return {
    day: raw.day,
    updatedAt: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
    period: { start: period.start, end: period.end, index: period.index, length: period.length, days: period.days },
    resetsOn: addDays(period.end, 1),
    series,
    others: { commits: int(others.commits), prs: int(others.prs) },
    merged,
  };
}

// --- drawing ----------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// A y-axis ceiling a person can read at a glance, never below 4 so a quiet
// period is not drawn as a mountain range.
function niceMax(n) {
  const steps = [4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100];
  for (const s of steps) if (n <= s) return s;
  return Math.ceil(n / 50) * 50;
}

// Direct labels sit at each line's last point. Lines often end at the same
// value (three zeros on a quiet night), so push labels apart vertically until
// none are closer than `gap` pixels, keeping their order. Pushing down past
// the baseline pushes the crowded labels back UP, and only as far as they
// crowd — a label with room of its own stays on its point.
function dodge(labels, gap, lo, hi) {
  const out = labels.map((l) => ({ ...l })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  for (let i = out.length - 1; i >= 0; i--) {
    const floor = i === out.length - 1 ? hi : out[i + 1].y - gap;
    if (out[i].y > floor) out[i].y = floor;
  }
  for (let i = 0; i < out.length; i++) {
    const ceil = i === 0 ? lo : out[i - 1].y + gap;
    if (out[i].y < ceil) out[i].y = ceil;
  }
  return out;
}

// The chart: commits merged per day across the period, one line per person.
// Drawn in its own coordinates and scaled by the page (width 100%), with a
// floor on narrow screens so the day labels never shrink past reading.
function chartSvg(model) {
  const W = 896, H = 270, left = 34, right = 84, top = 12, bottom = 34;
  const plotW = W - left - right, plotH = H - top - bottom;
  const n = model.period.days.length;
  const max = niceMax(Math.max(0, ...model.series.flatMap((s) => s.points.filter((v) => v != null))));
  const x = (i) => left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => top + plotH - (v / max) * plotH;
  const todayIdx = model.period.index - 1;
  const parts = [];

  // The board's day, behind everything, and kept inside the plot so on the
  // first and last day of a period it does not run under the axis numbers.
  const colW = plotW / (n - 1);
  const bandL = Math.max(left, x(todayIdx) - colW / 2);
  const bandR = Math.min(left + plotW, x(todayIdx) + colW / 2);
  parts.push(`<rect x="${bandL.toFixed(1)}" y="${top - 6}" width="${(bandR - bandL).toFixed(1)}" height="${plotH + 12}" fill="#F5F4EF"/>`);

  // Recessive grid: a baseline and two lines, labelled at the left.
  for (const v of [0, max / 2, max]) {
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${left}" x2="${left + plotW}" y1="${yy}" y2="${yy}" stroke="${v === 0 ? "#D8D4C9" : "#F0EFE9"}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 10}" y="${yy}" dy="4" text-anchor="end" class="ax">${v}</text>`);
  }

  model.period.days.forEach((d, i) => {
    const p = dayParts(d);
    const cls = i === todayIdx ? "ax on" : i > todayIdx ? "ax off" : "ax";
    parts.push(`<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" class="${cls}">${p.weekday.slice(0, 1)}</text>`);
    parts.push(`<text x="${x(i).toFixed(1)}" y="${H}" text-anchor="middle" class="${cls}">${p.date}</text>`);
  });

  // Lines, then markers with a 2px surface ring so overlapping points stay
  // legible, then the direct labels.
  const ends = [];
  for (const s of model.series) {
    const pts = s.points.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) continue;
    if (pts.length > 1) {
      parts.push(`<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ")}"/>`);
    }
    for (const [a, b] of pts) parts.push(`<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="4" fill="${s.color}" stroke="#ffffff" stroke-width="2"/>`);
    const [lx, ly] = pts[pts.length - 1];
    ends.push({ name: s.name, color: s.color, x: lx, y: ly });
  }
  for (const l of dodge(ends, 16, top, top + plotH)) {
    parts.push(`<line x1="${(l.x + 7).toFixed(1)}" x2="${(l.x + 15).toFixed(1)}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="${l.color}" stroke-width="2"/>`);
    parts.push(`<text x="${(l.x + 19).toFixed(1)}" y="${l.y.toFixed(1)}" dy="4" class="dl">${esc(l.name)}</text>`);
  }

  const alt = `Commits merged per day, ${shortDay(model.period.start)} to ${shortDay(model.period.end)}: ` +
    model.series.map((s) => `${s.name} ${s.periodTotal} this period`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(alt)}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

// The page's look is the site's: paper behind a white card, serif figures,
// letter-spaced labels, hairline rules (theme.js's light values).
const PAGE_CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#FBFBF9;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#1A2433}
.wrap{max-width:1000px;margin:0 auto;padding:20px 16px 40px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;color:#68707E;margin-bottom:12px;flex-wrap:wrap}
.top a{color:#1A2433;text-decoration:none;font-weight:500}
.top a:hover{text-decoration:underline}
.card{background:#fff;border:1px solid #D8D4C9;border-radius:6px;overflow:hidden}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:20px 24px 16px;border-bottom:1px solid #F0EFE9;flex-wrap:wrap}
.kick{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#68707E;margin-bottom:4px}
h1{font-family:Gelasio,Georgia,serif;font-weight:500;font-size:28px;letter-spacing:-.01em;margin:0;line-height:1.2}
.when{text-align:right;font-size:13px;color:#68707E;line-height:1.5}
.when b{color:#1A2433;font-weight:600}
.note{margin:0;padding:10px 24px;background:#FBF3DC;border-bottom:1px solid #EDDFB0;color:#8A6D1A;font-size:13px}
.cells{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid #F0EFE9}
.cell{padding:16px 24px 18px}
.cell+.cell{border-left:1px solid #F0EFE9}
.k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;display:flex;align-items:center;gap:8px}
.sw{width:14px;height:3px;border-radius:2px;display:inline-block}
.v{font-family:Gelasio,Georgia,serif;font-weight:500;font-size:44px;line-height:1.1;letter-spacing:-.02em;margin-top:6px;font-variant-numeric:tabular-nums}
.u{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:14px;letter-spacing:0;color:#68707E;margin-left:8px}
.s{font-size:13px;color:#68707E;margin-top:2px}
.sec{padding:16px 24px 8px}
.sec .kick{margin-bottom:10px}
.chartbox{overflow-x:auto;-webkit-overflow-scrolling:touch}
.chartbox svg{display:block;width:100%;height:auto;min-width:620px}
.ax{font-size:11px;fill:#68707E;font-family:Inter,"Segoe UI",Arial,sans-serif}
.ax.on{fill:#1A2433;font-weight:600}
.ax.off{fill:#C7CBD2}
.dl{font-size:12px;fill:#1A2433;font-weight:600;font-family:Inter,"Segoe UI",Arial,sans-serif}
.prs{list-style:none;margin:0;padding:0 0 8px}
.prs li{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-top:1px solid #F0EFE9;font-size:14px}
.prs li:first-child{border-top:0}
.prs .n{color:#68707E;font-variant-numeric:tabular-nums;min-width:44px}
.prs a{color:#1A2433;text-decoration:none;flex:1}
.prs a:hover{text-decoration:underline}
.prs .by{color:#68707E;font-size:13px;white-space:nowrap}
.empty{color:#68707E;font-size:14px;padding:4px 0 12px;margin:0}
.foot{padding:12px 24px 14px;border-top:1px solid #F0EFE9;font-size:12px;color:#68707E;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.foot a{color:#1A2433}
@media (max-width:640px){
  .cells{grid-template-columns:1fr}
  .cell+.cell{border-left:0;border-top:1px solid #F0EFE9}
  .when{text-align:left}
  h1{font-size:24px}
  .head,.cell,.sec,.foot,.note{padding-left:16px;padding-right:16px}
  .prs li{flex-wrap:wrap;gap:4px 12px}
}`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gelasio:wght@500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/svg+xml" href="/favicon.svg">
${FONTS}
<style>${PAGE_CSS}</style></head>
<body><main class="wrap">${body}</main></body></html>`;
}

// "Sep 25, 12:08 am" in Boise time.
function boiseTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");
}

const TOP = `<div class="top"><a href="/dev">← Dev hub</a><span>Updates every night at midnight, Boise time</span></div>`;

// The board. `model` null means no day could be read, which the page says
// rather than drawing zeros that would read as nobody shipping anything.
// `now` decides whether the board is behind: the newest day it can show is
// the one that ended at the last midnight.
function renderBoardPage(model, now = Date.now()) {
  if (!model) {
    return pageShell("Shipped · CompNinja", `${TOP}<div class="card"><div class="head"><div>
      <div class="kick">CompNinja · shipped</div><h1>The board is unavailable right now</h1></div></div>
      <p class="note">No day's numbers could be read. The nightly job saves them just after midnight; if this lasts, check the Ship chat workflow on GitHub.</p>
      <div class="foot"><span>Try again in a few minutes.</span><a href="https://github.com/${REPO}/actions/workflows/ship-chat.yml">Ship chat runs</a></div></div>`);
  }
  const expected = addDays(boiseDate(now), -1);
  const behind = model.day < expected
    ? `<p class="note">Last night's update has not arrived yet, so this is ${esc(longDay(model.day))}.</p>`
    : "";
  const names = Object.fromEntries(PEOPLE.map((p) => [p.login, p.name]));
  const cells = model.series.map((s) => {
    const t = s.today;
    const sub = t.prs ? `${plural(t.prs, "PR", "PRs")} merged` : "nothing merged";
    return `<div class="cell">
      <div class="k"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</div>
      <div class="v">${t.commits}<span class="u">${t.commits === 1 ? "commit" : "commits"}</span></div>
      <div class="s">${sub} · ${plural(s.periodTotal, "commit", "commits")} this period</div>
    </div>`;
  }).join("");
  const prs = model.merged.length
    ? `<ul class="prs">${model.merged.map((m) => `<li><span class="n">#${m.number}</span>` +
        `<a href="https://github.com/${REPO}/pull/${m.number}">${esc(m.title)}</a>` +
        `<span class="by">${esc(names[m.login] || m.login || "someone")} · ${plural(m.commits, "commit", "commits")}</span></li>`).join("")}</ul>`
    : `<p class="empty">Nothing was merged to main that day.</p>`;
  const others = model.others.commits
    ? ` Also ${plural(model.others.commits, "commit", "commits")} from others.`
    : "";
  const range = `${shortDay(model.period.start).slice(5)} – ${shortDay(model.period.end).slice(5)}`;
  const updated = model.updatedAt ? `Counted ${esc(boiseTime(model.updatedAt))}.` : "";
  return pageShell(`Shipped ${shortDay(model.day)} · CompNinja`, `${TOP}<div class="card">
  <div class="head">
    <div><div class="kick">CompNinja · shipped</div><h1>${esc(longDay(model.day))}</h1></div>
    <div class="when"><b>Day ${model.period.index} of ${model.period.length}</b><br>chart resets ${esc(shortDay(model.resetsOn))}</div>
  </div>
  ${behind}
  <div class="cells">${cells}</div>
  <div class="sec"><div class="kick">Commits merged per day · ${esc(range)}</div><div class="chartbox">${chartSvg(model)}</div></div>
  <div class="sec"><div class="kick">Merged that day</div>${prs}</div>
  <div class="foot"><span>Non-merge commits in PRs merged to main, credited to whoever opened the PR. Days in Boise time.${esc(others)} ${updated}</span>
    <a href="${esc(prSearchUrl(model))}">See the PRs on GitHub</a></div>
</div>`);
}

// What a visitor without the team key sees: the /dev dashboards' own door,
// which trades the key for the 30-day cn_admin cookie and reloads.
function renderBoardGate() {
  return pageShell("Shipped · CompNinja", `${TOP}<div class="card"><div class="head"><div>
    <div class="kick">CompNinja · shipped</div><h1>Enter the team key</h1></div></div>
    <form class="sec" id="gate" style="padding-bottom:20px">
      <p class="empty" style="padding-bottom:12px">The same key as /admin and /dev. This device remembers it for 30 days.</p>
      <input id="key" type="password" autocomplete="current-password" aria-label="Team key"
        style="font:inherit;font-size:16px;padding:10px 12px;border:1px solid #D8D4C9;border-radius:6px;width:100%;max-width:320px">
      <button style="font:inherit;font-size:15px;font-weight:600;padding:10px 16px;margin-left:8px;border:0;border-radius:6px;background:#B91C1C;color:#fff;cursor:pointer">Open</button>
      <p id="msg" class="empty" role="alert" style="padding-top:10px"></p>
    </form>
  </div>
<script>
document.getElementById("gate").addEventListener("submit", function (e) {
  e.preventDefault();
  var msg = document.getElementById("msg");
  fetch("/api/admin-access", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: document.getElementById("key").value }) })
    .then(function (r) { if (r.ok) location.reload(); else msg.textContent = r.status === 429 ? "Too many tries. Wait a few minutes." : "That key is not right."; })
    .catch(function () { msg.textContent = "Could not reach the server. Try again."; });
});
</script>`);
}

module.exports = {
  REPO, TZ, BOARD_PATH, PEOPLE, PERIOD_DAYS, PERIOD_ANCHOR,
  boiseDate, boiseOffsetMinutes, targetDay, addDays, periodFor, isDay,
  longDay, shortDay, boiseMidnightUtc, prSearchUrl,
  workCommits, tally, buildModel, sanitizeModel,
  esc, plural, niceMax, dodge, chartSvg, renderBoardPage, renderBoardGate,
};
