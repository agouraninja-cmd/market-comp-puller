// The nightly shipped post (scripts/ship-chat.js) and the board it links to
// (ship-board.js, served at /dev/shipped): who gets credit, which day a merge
// belongs to, which of the two cron fires posts, what the board draws, and
// what the Chat message says. Nothing here touches the network except two
// tests that stand up their own local server for the webhook. The page's
// route is proven against a real server in test/ship-board-route.test.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const S = require("../scripts/ship-chat.js");

const utc = (s) => Date.parse(s);

test("a merge belongs to the Boise day it happened on, not the UTC one", () => {
  // #321 merged 05:24 UTC on the 25th, which was 11:24 pm on the 24th in Boise.
  assert.strictEqual(S.boiseDate("2026-09-25T05:24:06Z"), "2026-09-24");
  assert.strictEqual(S.boiseDate("2026-09-25T06:00:00Z"), "2026-09-25");
  assert.strictEqual(S.boiseDate("2026-12-01T06:30:00Z"), "2026-11-30"); // MST: 11:30 pm
  assert.strictEqual(S.boiseOffsetMinutes(utc("2026-07-01T12:00:00Z")), -360);
  assert.strictEqual(S.boiseOffsetMinutes(utc("2026-12-01T12:00:00Z")), -420);
});

test("a run reports the day that just ended, even when GitHub starts it late", () => {
  assert.strictEqual(S.targetDay(utc("2026-09-26T06:07:00Z")), "2026-09-25"); // 00:07 MDT
  assert.strictEqual(S.targetDay(utc("2026-09-26T11:50:00Z")), "2026-09-25"); // 05:50 MDT
  assert.strictEqual(S.targetDay(utc("2026-12-02T07:07:00Z")), "2026-12-01"); // 00:07 MST
});

test("exactly one of the two cron fires posts, every night for two years", () => {
  const seen = new Set();
  for (let t = utc("2026-01-01T00:00:00Z"); t < utc("2028-01-01T00:00:00Z"); t += 86400000) {
    const fires = [
      ["7 6 * * *", t + (6 * 60 + 7) * 60000],
      ["7 7 * * *", t + (7 * 60 + 7) * 60000],
    ].filter(([cron, at]) => S.shouldPost(cron, at));
    const day = new Date(t).toISOString().slice(0, 10);
    assert.strictEqual(fires.length, 1, `${day}: ${fires.length} posts`);
    const reported = S.targetDay(fires[0][1]);
    assert.strictEqual(reported, S.addDays(day, -1), `${day} reported ${reported}`);
    seen.add(reported);
  }
  assert.strictEqual(seen.size, 730, "every day reported once, including both clock changes");
});

test("a person pressing Run workflow always posts; an unknown cron never guesses", () => {
  assert.strictEqual(S.shouldPost("", Date.now()), true);
  assert.throws(() => S.shouldPost("0 6 * * *", Date.now()), /Unknown schedule/);
});

test("the workflow's crons are exactly the ones the script knows", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ship-chat.yml"), "utf8");
  const crons = [...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(crons, Object.keys(S.SCHEDULE_OFFSETS).sort());
});

test("the chart starts with the first post's day and restarts every two weeks after", () => {
  assert.strictEqual(S.PERIOD_ANCHOR, "2026-09-24");
  let p = S.periodFor("2026-09-24"); // the first post
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-09-24", "2026-10-07", 1]);
  assert.strictEqual(S.periodFor("2026-09-25").index, 2); // the first midnight post
  assert.strictEqual(S.periodFor("2026-10-07").index, 14);
  p = S.periodFor("2026-10-08");
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-10-08", "2026-10-21", 1]);
  p = S.periodFor("2026-09-23"); // before the anchor still lands in a whole period
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-09-10", "2026-09-23", 14]);
  assert.strictEqual(p.days.length, 14);
  // Every period starts on a Thursday, the weekday of the first one.
  assert.strictEqual(new Date(`${S.periodFor("2027-02-01").start}T00:00:00Z`).getUTCDay(), 4);
});

const pr = (login, mergedAt, parents) => ({
  author: { login }, mergedAt,
  commits: { nodes: parents.map((n) => ({ commit: { parents: { totalCount: n } } })) },
});

test("credit goes to the PR's author and merges from main count for nothing", () => {
  assert.strictEqual(S.workCommits(pr("x", "2026-09-24T12:00:00Z", [1, 2, 1, 2])), 2);
  const days = ["2026-09-24", "2026-09-25"];
  const counts = S.tally([
    pr("agouraninja-cmd", "2026-09-25T05:24:06Z", [1, 1, 1]),   // Boise: the 24th
    pr("owenbarnes5", "2026-09-24T19:00:00Z", [1, 2]),
    pr("pete", "2026-09-24T20:00:00Z", [1]),                   // nobody on the card
    pr("chuckdickinson-ninja", "2026-09-26T20:00:00Z", [1]),   // outside the days asked for
    { author: null, mergedAt: null },
  ], days);
  assert.deepStrictEqual(counts["2026-09-24"]["agouraninja-cmd"], { commits: 3, prs: 1 });
  assert.deepStrictEqual(counts["2026-09-24"].owenbarnes5, { commits: 1, prs: 1 });
  assert.deepStrictEqual(counts["2026-09-24"].others, { commits: 1, prs: 1 });
  assert.deepStrictEqual(counts["2026-09-25"]["chuckdickinson-ninja"], { commits: 0, prs: 0 });
});

test("the lines stop at tonight and the period total counts only days that happened", () => {
  const m = S.buildModel([
    pr("agouraninja-cmd", "2026-09-20T18:00:00Z", [1]),        // the period before
    pr("agouraninja-cmd", "2026-09-26T18:00:00Z", [1, 1]),
    pr("agouraninja-cmd", "2026-10-02T18:00:00Z", [1, 1, 1]),
  ], "2026-10-02");
  const jacob = m.series.find((s) => s.name === "Jacob");
  assert.strictEqual(m.period.index, 9);
  assert.strictEqual(jacob.points.length, 14);
  assert.deepStrictEqual(jacob.points.slice(8), [3, null, null, null, null, null]);
  assert.strictEqual(jacob.points[2], 2);
  assert.strictEqual(jacob.periodTotal, 5);
  assert.deepStrictEqual(jacob.today, { commits: 3, prs: 1 });
  assert.strictEqual(m.resetsOn, "2026-10-08");
  assert.deepStrictEqual(m.series.map((s) => s.name), ["Jacob", "Owen", "Chuck"]);
});

test("line labels only move when they crowd each other", () => {
  const alone = S.dodge([{ name: "a", y: 40 }, { name: "b", y: 200 }], 16, 10, 220);
  assert.deepStrictEqual(alone.map((l) => l.y), [40, 200]);
  const crowded = S.dodge([{ name: "a", y: 40 }, { name: "b", y: 220 }, { name: "c", y: 220 }], 16, 10, 220);
  assert.deepStrictEqual(crowded.map((l) => l.y), [40, 204, 220]);
  const all = S.dodge([{ y: 220 }, { y: 220 }, { y: 220 }], 16, 10, 220).map((l) => l.y);
  assert.deepStrictEqual(all, [188, 204, 220]);
});

test("the y axis rounds up to a readable ceiling and never draws a quiet period as a peak", () => {
  assert.strictEqual(S.niceMax(0), 4);
  assert.strictEqual(S.niceMax(11), 12);
  assert.strictEqual(S.niceMax(20), 20);
  assert.strictEqual(S.niceMax(21), 24);
  assert.strictEqual(S.niceMax(130), 150);
});

const OCT4 = utc("2026-10-05T18:00:00Z"); // a "now" the day after Oct 4

test("the board names everyone, escapes what it prints, and plots no future day", () => {
  const people = [
    { login: "a", name: "Jacob <b>", color: "#B91C1C" },
    { login: "b", name: "Owen", color: "#2A78D6" },
  ];
  const m = S.buildModel([pr("a", "2026-10-04T18:00:00Z", [1])], "2026-10-04", people, OCT4);
  const html = S.renderBoardPage(m, OCT4);
  assert.ok(html.includes("Jacob &lt;b&gt;") && !html.includes("Jacob <b>"));
  assert.ok(html.includes("Sunday, October 4"));
  assert.ok(html.includes("Day 11 of 14"));
  assert.ok(html.includes("chart resets Thu, Oct 8"));
  assert.strictEqual((html.match(/<circle /g) || []).length, 11 * people.length);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /name="viewport"/, "it is opened from a phone as often as a desk");
  assert.ok(!/Last night's update/.test(html), "a current board says nothing about being behind");
});

test("the board lists the day's PRs, titles escaped and credited to the opener", () => {
  const prs = [
    { ...pr("owenbarnes5", "2026-10-04T20:00:00Z", [1, 2, 1]), number: 330, title: "Fix <script> in titles" },
    { ...pr("agouraninja-cmd", "2026-10-04T15:00:00Z", [1]), number: 329, title: "Earlier one" },
    { ...pr("agouraninja-cmd", "2026-10-03T15:00:00Z", [1]), number: 328, title: "The day before" },
  ];
  const m = S.buildModel(prs, "2026-10-04", S.PEOPLE, OCT4);
  assert.deepStrictEqual(m.merged.map((x) => x.number), [329, 330], "that day only, oldest first");
  assert.strictEqual(m.merged[1].commits, 2);
  const html = S.renderBoardPage(m, OCT4);
  assert.ok(html.includes("Fix &lt;script&gt; in titles") && !html.includes("<script> in"));
  assert.match(html, /pull\/330">Fix &lt;script&gt; in titles<\/a><span class="by">Owen · 2 commits/);
  assert.match(S.renderBoardPage(S.buildModel([], "2026-10-04", S.PEOPLE, OCT4), OCT4), /Nothing was merged to main that day/);
});

test("a board that is behind says so, and a missing board is never drawn as zeros", () => {
  const m = S.buildModel([], "2026-10-02", S.PEOPLE, OCT4);
  assert.match(S.renderBoardPage(m, OCT4), /Last night's update has not arrived yet, so this is Friday, October 2/);
  const none = S.renderBoardPage(null, OCT4);
  assert.match(none, /The board is unavailable right now/);
  assert.ok(!/<circle /.test(none) && !/class="v"/.test(none));
});

test("a day read back from storage is rebuilt, never trusted", () => {
  const m = S.buildModel([{ ...pr("owenbarnes5", "2026-10-04T18:00:00Z", [1, 1]), number: 331, title: "A PR" }],
    "2026-10-04", S.PEOPLE, OCT4);
  const round = S.sanitizeModel(JSON.parse(JSON.stringify(m)));
  assert.deepStrictEqual(round, m, "an honest file survives the trip unchanged");

  const evil = JSON.parse(JSON.stringify(m));
  evil.series[1].name = "<img src=x onerror=alert(1)>";
  evil.series[1].color = "red;background:url(//x)";
  evil.series[1].today.commits = "9; drop";
  evil.series[1].points[0] = -5;
  const clean = S.sanitizeModel(evil);
  assert.strictEqual(clean.series[1].name, "Owen", "names come from the code, not the file");
  assert.strictEqual(clean.series[1].color, "#2A78D6");
  assert.strictEqual(clean.series[1].today.commits, 0);
  assert.strictEqual(clean.series[1].points[0], 0);
  assert.strictEqual(clean.series[1].points[13], null, "future days stay empty whatever the file says");
  assert.strictEqual(S.sanitizeModel({ day: "2026-02-30" }), null);
  assert.strictEqual(S.sanitizeModel(null), null);
});

test("the Chat post is sharp text and a button to the board, never a picture", () => {
  const m = S.buildModel([pr("owenbarnes5", "2026-09-24T18:00:00Z", [1, 1])], "2026-09-24");
  const post = S.chatPayload(m);
  assert.strictEqual(post.text, "*Shipped Thu, Sep 24* — Jacob 0 · Owen 2 · Chuck 0 commits");
  assert.strictEqual(post.cardsV2[0].cardId, "shipped-2026-09-24");
  const card = post.cardsV2[0].card;
  assert.match(card.header.title, /Thursday, September 24/);
  assert.match(card.header.subtitle, /Day 1 of 14 · the chart resets Thu, Oct 8/);
  const widgets = card.sections[0].widgets;
  assert.ok(!JSON.stringify(post).includes("imageUrl"), "Chat shrinks pictures until they are unreadable");
  const owen = widgets.find((w) => w.decoratedText && w.decoratedText.topLabel === "Owen").decoratedText;
  assert.match(owen.text, /<b>2 commits<\/b> · 1 PR merged/);
  assert.strictEqual(owen.bottomLabel, "2 commits this period");
  const buttons = widgets.find((w) => w.buttonList).buttonList.buttons;
  assert.deepStrictEqual(buttons.map((b) => b.text), ["Open the board", "See the PRs"]);
  assert.strictEqual(buttons[0].onClick.openLink.url, "https://compninja.co/dev/shipped");
  assert.strictEqual(S.BOARD_URL, `https://compninja.co${S.BOARD_PATH}`);
});

test("See the PRs asks GitHub for that Boise day, including the night the clocks change", () => {
  const url = (day) => decodeURIComponent(S.prSearchUrl({ day }));
  assert.match(url("2026-09-24"), /merged:2026-09-24T06:00:00Z\.\.2026-09-25T05:59:59Z/);
  // Nov 1 starts at midnight MDT and ends at midnight MST, so it is 25 hours long.
  assert.match(url("2026-11-01"), /merged:2026-11-01T06:00:00Z\.\.2026-11-02T06:59:59Z/);
  assert.match(url("2027-03-14"), /merged:2027-03-14T07:00:00Z\.\.2027-03-15T05:59:59Z/);
  assert.match(url("2026-09-24"), /base:main/);
});

test("every post goes to the Developer thread, beside the webhook's own key and token", () => {
  assert.strictEqual(S.THREAD_KEY, "developer-thread");
  const u = new URL(S.threadedUrl("https://chat.googleapis.com/v1/spaces/AAQ/messages?key=K&token=T"));
  assert.strictEqual(u.searchParams.get("key"), "K");
  assert.strictEqual(u.searchParams.get("token"), "T");
  assert.strictEqual(u.searchParams.get("threadKey"), "developer-thread");
  assert.strictEqual(u.searchParams.get("messageReplyOption"), "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  assert.strictEqual(u.pathname, "/v1/spaces/AAQ/messages");
  // Setting, not appending: a URL that already names the thread is not doubled.
  const again = new URL(S.threadedUrl(u.toString()));
  assert.deepStrictEqual(again.searchParams.getAll("threadKey"), ["developer-thread"]);
  assert.throws(() => S.threadedUrl("not a url ?key=SECRET"), (err) => !/SECRET/.test(err.message));
});

test("the thread opens by saying what it is for", () => {
  assert.match(S.THREAD_INTRO, /^\*Developer thread\*\n/);
  assert.match(S.THREAD_INTRO, /development/);
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ship-chat.yml"), "utf8");
  assert.match(yml, /start_thread:[\s\S]*default: false/, "opening the thread is opt-in, never nightly");
  assert.match(yml, /"\$START_THREAD" = "true" \]; then args\+=\(--intro\)/);
});

test("the workflow saves the day before it posts, so the button never opens yesterday", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ship-chat.yml"), "utf8");
  const save = yml.indexOf("- name: Save the day for the board");
  const post = yml.indexOf("- name: Post to Google Chat");
  assert.ok(save > 0 && post > save, "save, then post");
  assert.match(yml, /cp out\/model\.json "\$dir\/days\/\$\{DAY_OUT\}\.json"/, "where server.js reads it");
  assert.match(yml, /skip_post:[\s\S]*?default: false/, "posting is the default");
  assert.match(yml.slice(post), /^\s*if: .*!inputs\.skip_post/m);
  assert.match(yml, /- name: Fail if the board was not saved\n\s*if: steps\.save\.outcome == 'failure'/);
  assert.ok(!/imageUrl|image-url|card\.png/.test(yml), "no picture any more");
});

test("a post really reaches the thread URL", async (t) => {
  let seen = null;
  const server = http.createServer((req, res) => { seen = req.url; res.writeHead(200); res.end("{}"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  await S.postToChat({ text: "x" }, `http://127.0.0.1:${server.address().port}/v1/spaces/X/messages?key=K&token=T`);
  const q = new URL(seen, "http://x").searchParams;
  assert.deepStrictEqual([q.get("key"), q.get("token"), q.get("threadKey")], ["K", "T", "developer-thread"]);
});

test("a failed post never prints the webhook URL, whose query string is the key", async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(500); res.end("nope"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const { postToChat } = require("../scripts/ship-chat.js");
  const hook = `http://127.0.0.1:${server.address().port}/v1/spaces/X/messages?key=SECRETKEY&token=SECRETTOKEN`;
  await assert.rejects(postToChat({ text: "x" }, hook), (err) => {
    assert.match(err.message, /Google Chat answered 500/);
    assert.ok(!/SECRET/.test(err.message));
    return true;
  });
});
