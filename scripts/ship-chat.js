// The nightly "who shipped what" post to the team's Google Chat space.
//
//   node scripts/ship-chat.js build --out DIR [--day YYYY-MM-DD]
//   node scripts/ship-chat.js post  --out DIR [--image-url URL] [--intro] [--dry-run]
//
// `build` reads the PRs merged to main, counts them per person, draws the card
// as a PNG with a Chrome the machine already has, and writes DIR/model.json +
// DIR/card.html + DIR/card.png. `post` sends DIR/model.json to the webhook in
// GOOGLE_CHAT_WEBHOOK_URL. .github/workflows/ship-chat.yml runs both every
// night at midnight in Boise, and hosts the PNG in between (a Chat card can
// only show an image that lives at a public https URL).
//
// Zero dependencies, like everything else here. Requiring this file starts
// nothing (the require.main guard at the bottom), which is what lets
// test/ship-chat.test.js exercise every rule with no network.
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

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const REPO = "agouraninja-cmd/market-comp-puller";
const TZ = "America/Boise";

// Who the post is about, in the order the card draws them. The login is the
// key; the colour is theirs for good (colour follows the person, never their
// rank that night). Validated with the dataviz skill's palette checker on a
// white surface: all pass, and Chuck's aqua is under 3:1 against it, which is
// why every line also carries a direct name label and a legend swatch.
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

// Every post goes into ONE thread of the CompNinja space, the "Developer
// thread", rather than a new thread a night. Chat keys a webhook's threads by
// this string: the first post with it starts the thread and every later one
// replies into it (REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD). Changing it starts a
// new thread, and so does replacing the webhook, since keys belong to it.
const THREAD_KEY = "developer-thread";

// What opens that thread, posted once (`post --intro`) so the thread reads as
// the place development talk goes and not as one night's card.
const THREAD_INTRO =
  "*Developer thread*\n" +
  "Where talk about CompNinja development goes. The nightly shipped card posts here at midnight, Boise time: " +
  "who merged how many commits that day, over a chart that starts over every two weeks. Reply here to talk about any of it.";

// GitHub cron runs in UTC and Boise moves an hour twice a year, so the
// workflow fires at BOTH candidate hours and each fire posts only in the
// season it belongs to. Keyed on the exact cron string the workflow sends as
// github.event.schedule; an unknown string throws rather than posting,
// because two posts a night is the failure a guess would produce.
// test/ship-chat.test.js holds these keys and the workflow's crons together.
const SCHEDULE_OFFSETS = {
  "7 6 * * *": -360, // 00:07 MDT
  "7 7 * * *": -420, // 00:07 MST
};

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

// Whether a scheduled fire should post. No schedule means a person pressed
// "Run workflow", which always posts.
function shouldPost(schedule, now) {
  if (!schedule) return true;
  if (!(schedule in SCHEDULE_OFFSETS)) throw new Error(`Unknown schedule "${schedule}" — add it to SCHEDULE_OFFSETS.`);
  return boiseOffsetMinutes(now) === SCHEDULE_OFFSETS[schedule];
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
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
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

// "Mon, Sep 28"
function shortDay(day) {
  const p = dayParts(day);
  return `${p.weekday.slice(0, 3)}, ${p.month.slice(0, 3)} ${p.date}`;
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

// Everything the card and the post need, and nothing that needs the network.
// Days after `day` are in the period but have not happened, so their points
// are null and the lines stop at tonight.
function buildModel(prs, day, people = PEOPLE) {
  const period = periodFor(day);
  const counts = tally(prs, period.days, people);
  const series = people.map((p) => {
    const points = period.days.map((d) => (d <= day ? counts[d][p.login].commits : null));
    const periodTotal = period.days.filter((d) => d <= day).reduce((s, d) => s + counts[d][p.login].commits, 0);
    return { ...p, today: counts[day][p.login], periodTotal, points };
  });
  return {
    day,
    period: { start: period.start, end: period.end, index: period.index, length: period.length, days: period.days },
    resetsOn: addDays(period.end, 1),
    series,
    others: counts[day].others,
  };
}

// --- the card ---------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

const CARD_W = 960;
const CARD_H = 580;

// The chart: commits merged per day across the period, one line per person.
function chartSvg(model) {
  const W = 896, H = 270, left = 34, right = 84, top = 12, bottom = 34;
  const plotW = W - left - right, plotH = H - top - bottom;
  const n = model.period.days.length;
  const max = niceMax(Math.max(0, ...model.series.flatMap((s) => s.points.filter((v) => v != null))));
  const x = (i) => left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => top + plotH - (v / max) * plotH;
  const todayIdx = model.period.index - 1;
  const parts = [];

  // Tonight's column, behind everything, and kept inside the plot so on the
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

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// The whole card as one HTML page, sized exactly to the PNG it becomes. The
// look is the site's: paper behind a white card, serif figures, letter-spaced
// labels, hairline rules (theme.js's light values, since a PNG has no dark
// mode to follow).
function renderCardHtml(model) {
  const cells = model.series.map((s) => {
    const t = s.today;
    const sub = t.prs ? `${plural(t.prs, "PR", "PRs")} merged` : "nothing merged";
    return `<div class="cell">
      <div class="k"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</div>
      <div class="v">${t.commits}<span class="u">${t.commits === 1 ? "commit" : "commits"}</span></div>
      <div class="s">${sub} · ${plural(s.periodTotal, "commit", "commits")} this period</div>
    </div>`;
  }).join("");
  const others = model.others.commits
    ? ` Also ${plural(model.others.commits, "commit", "commits")} from others.`
    : "";
  const range = `${shortDay(model.period.start).slice(5)} – ${shortDay(model.period.end).slice(5)}`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gelasio:wght@500&family=Inter:wght@400;500;600&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:${CARD_W}px;height:${CARD_H}px;background:#FBFBF9;overflow:hidden}
body{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#1A2433;padding:16px}
.card{height:100%;background:#fff;border:1px solid #D8D4C9;border-radius:6px;display:flex;flex-direction:column}
.head{display:flex;justify-content:space-between;align-items:flex-end;padding:18px 24px 14px;border-bottom:1px solid #F0EFE9}
.kick{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#68707E;margin-bottom:4px}
.title{font-family:Gelasio,Georgia,serif;font-weight:500;font-size:24px;letter-spacing:-.01em}
.when{text-align:right;font-size:12.5px;color:#68707E;line-height:1.5}
.when b{color:#1A2433;font-weight:600}
.cells{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid #F0EFE9}
.cell{padding:14px 24px 16px}
.cell+.cell{border-left:1px solid #F0EFE9}
.k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;display:flex;align-items:center;gap:8px}
.sw{width:14px;height:3px;border-radius:2px;display:inline-block}
.v{font-family:Gelasio,Georgia,serif;font-weight:500;font-size:40px;line-height:1.1;letter-spacing:-.02em;margin-top:6px;font-variant-numeric:tabular-nums}
.u{font-family:Inter,"Segoe UI",Arial,sans-serif;font-size:13px;letter-spacing:0;color:#68707E;margin-left:8px}
.s{font-size:12.5px;color:#68707E;margin-top:2px}
.chart{padding:14px 24px 0;flex:1}
.chart .kick{margin-bottom:8px}
.ax{font-size:11px;fill:#68707E;font-family:Inter,"Segoe UI",Arial,sans-serif}
.ax.on{fill:#1A2433;font-weight:600}
.ax.off{fill:#C7CBD2}
.dl{font-size:12px;fill:#1A2433;font-weight:600;font-family:Inter,"Segoe UI",Arial,sans-serif}
.foot{padding:10px 24px 12px;border-top:1px solid #F0EFE9;font-size:11px;color:#68707E}
</style></head>
<body><div class="card">
  <div class="head">
    <div><div class="kick">CompNinja · shipped</div><div class="title">${esc(longDay(model.day))}</div></div>
    <div class="when"><b>Day ${model.period.index} of ${model.period.length}</b><br>chart resets ${esc(shortDay(model.resetsOn))}</div>
  </div>
  <div class="cells">${cells}</div>
  <div class="chart"><div class="kick">Commits merged per day · ${esc(range)}</div>${chartSvg(model)}</div>
  <div class="foot">Non-merge commits in PRs merged to main, credited to whoever opened the PR. Days in Boise time.${esc(others)}</div>
</div></body></html>`;
}

// --- the post ---------------------------------------------------------------

// The plain line Chat shows in notifications and beside the card.
function summaryLine(model) {
  const who = model.series.map((s) => `${s.name} ${s.today.commits}`).join(" · ");
  return `*Shipped ${shortDay(model.day)}* — ${who} commits`;
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

// The Chat message: the summary line, then a card holding the picture. The
// card carries no header of its own because the picture opens with the date.
// With no image (hosting failed) the card says the numbers in text instead,
// under a header, so a broken image host never costs the night's post.
function chatPayload(model, imageUrl) {
  const widgets = [];
  if (imageUrl) {
    widgets.push({ image: {
      imageUrl,
      altText: `Commits merged on ${longDay(model.day)}: ${model.series.map((s) => `${s.name} ${s.today.commits}`).join(", ")}. Line chart of commits per day for the period.`,
    } });
  } else {
    widgets.push({ textParagraph: {
      text: model.series.map((s) => `<b>${esc(s.name)}</b> ${plural(s.today.commits, "commit", "commits")} · ${plural(s.today.prs, "PR", "PRs")} · ${s.periodTotal} this period`).join("<br>"),
    } });
  }
  widgets.push({ buttonList: { buttons: [{ text: "See the PRs", onClick: { openLink: { url: prSearchUrl(model) } } }] } });
  const card = { sections: [{ widgets }] };
  if (!imageUrl) {
    card.header = {
      title: `Shipped · ${longDay(model.day)}`,
      subtitle: `Day ${model.period.index} of ${model.period.length} · the chart resets ${shortDay(model.resetsOn)}`,
    };
  }
  return { text: summaryLine(model), cardsV2: [{ cardId: `shipped-${model.day}`, card }] };
}

// --- I/O --------------------------------------------------------------------

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

const PR_QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    pullRequests(states:MERGED,baseRefName:"main",first:50,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{number mergedAt updatedAt author{login}
        commits(first:250){nodes{commit{parents{totalCount}}}}}}}}`;

// Every PR merged to main on or after `sinceDay`. Ordered by last update,
// which is never earlier than the merge, so the first page whose oldest row
// predates the window is the last page worth reading.
async function fetchMergedPRs(sinceDay, token = githubToken()) {
  const [owner, name] = REPO.split("/");
  const cutoff = Date.UTC(+sinceDay.slice(0, 4), +sinceDay.slice(5, 7) - 1, +sinceDay.slice(8, 10)) - 86400000;
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "compninja-ship-chat" },
      body: JSON.stringify({ query: PR_QUERY, variables: { owner, name, after } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors) throw new Error(`GitHub answered ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 300)}`);
    const conn = body.data.repository.pullRequests;
    out.push(...conn.nodes);
    const oldest = conn.nodes.length ? Date.parse(conn.nodes[conn.nodes.length - 1].updatedAt) : 0;
    if (!conn.pageInfo.hasNextPage || oldest < cutoff) break;
    after = conn.pageInfo.endCursor;
  }
  return out.filter((pr) => Date.parse(pr.mergedAt) >= cutoff);
}

function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) return env;
  const candidates = process.platform === "win32"
    ? [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const hit = candidates.find((p) => p && fs.existsSync(p));
  if (!hit) throw new Error("No Chrome found. Set CHROME_PATH to one.");
  return hit;
}

// Headless Chrome's own screenshot flag, at twice the pixel density so the
// figures stay sharp when Chat scales the image. The virtual-time budget is
// what waits for the webfonts; its own profile keeps it from handing the job
// to a Chrome the person already has open.
function screenshot(htmlPath, pngPath) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ship-chat-"));
  try {
    execFileSync(findChrome(), [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--no-first-run",
      `--user-data-dir=${profile}`, "--force-device-scale-factor=2",
      `--window-size=${CARD_W},${CARD_H}`, "--virtual-time-budget=10000",
      `--screenshot=${path.resolve(pngPath)}`, `file://${path.resolve(htmlPath).replace(/\\/g, "/")}`,
    ], { stdio: "ignore", timeout: 60000 });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (!fs.existsSync(pngPath)) throw new Error("Chrome ran but wrote no screenshot.");
}

// The webhook URL with the thread parameters added beside its key and token.
// Parsed rather than string-joined, because the URL already has a query string
// and a second `?` would be read as part of the token.
function threadedUrl(webhook, threadKey = THREAD_KEY) {
  let url;
  try {
    url = new URL(webhook);
  } catch {
    throw new Error("GOOGLE_CHAT_WEBHOOK_URL is not a URL."); // never echo it
  }
  url.searchParams.set("threadKey", threadKey);
  url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  return url.toString();
}

async function postToChat(payload, webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL) {
  if (!webhook) throw new Error("GOOGLE_CHAT_WEBHOOK_URL is not set.");
  const res = await fetch(threadedUrl(webhook), {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  // Never echo the webhook URL: its query string is the credential.
  if (!res.ok) throw new Error(`Google Chat answered ${res.status}: ${text.slice(0, 300)}`);
}

function argOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// Lets the workflow read one value off a step (the file name it hosts).
function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const out = argOf(args, "--out") || "ship-chat-out";
  if (cmd === "build") {
    const now = Date.now();
    const schedule = process.env.SHIP_SCHEDULE || "";
    if (!shouldPost(schedule, now)) {
      console.log(`Schedule "${schedule}" belongs to the other season (Boise is UTC${boiseOffsetMinutes(now) / 60}); standing down.`);
      setOutput("post", "false");
      return;
    }
    const day = argOf(args, "--day") || targetDay(now);
    if (!isDay(day)) throw new Error(`--day must be YYYY-MM-DD, got "${day}".`);
    const prs = await fetchMergedPRs(periodFor(day).start);
    const model = buildModel(prs, day);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "model.json"), JSON.stringify(model, null, 2));
    fs.writeFileSync(path.join(out, "card.html"), renderCardHtml(model));
    screenshot(path.join(out, "card.html"), path.join(out, "card.png"));
    console.log(summaryLine(model).replace(/\*/g, ""));
    console.log(`Day ${model.period.index} of ${model.period.length} (${model.period.start} to ${model.period.end}); ${prs.length} PRs read.`);
    setOutput("post", "true");
    setOutput("day", day);
    return;
  }
  if (cmd === "post") {
    const model = JSON.parse(fs.readFileSync(path.join(out, "model.json"), "utf8"));
    const payload = chatPayload(model, argOf(args, "--image-url"));
    const intro = args.includes("--intro");
    if (args.includes("--dry-run")) {
      if (intro) console.log(JSON.stringify({ text: THREAD_INTRO }, null, 2));
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    if (intro) {
      await postToChat({ text: THREAD_INTRO });
      console.log("Opened the Developer thread.");
      // Chat allows one webhook message per second per space.
      await new Promise((r) => setTimeout(r, 1500));
    }
    await postToChat(payload);
    console.log(`Posted ${model.day} to the Developer thread.`);
    return;
  }
  throw new Error("Usage: node scripts/ship-chat.js build|post --out DIR [--day YYYY-MM-DD] [--image-url URL] [--intro] [--dry-run]");
}

module.exports = {
  PEOPLE, PERIOD_DAYS, PERIOD_ANCHOR, SCHEDULE_OFFSETS, THREAD_KEY, THREAD_INTRO,
  boiseDate, boiseOffsetMinutes, targetDay, shouldPost, addDays, periodFor, isDay,
  longDay, shortDay, boiseMidnightUtc, workCommits, tally, buildModel, niceMax, dodge,
  renderCardHtml, summaryLine, prSearchUrl, chatPayload, threadedUrl, postToChat,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
