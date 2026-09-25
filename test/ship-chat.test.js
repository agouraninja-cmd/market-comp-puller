// The nightly shipped post (scripts/ship-chat.js): who gets credit, which day
// a merge belongs to, which of the two cron fires posts, and what the card
// and the Chat message say. Nothing here touches the network except one test
// that stands up its own local server to prove a failed post never prints the
// webhook URL.

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

test("the chart covers fixed 14-day periods that restart every other Monday", () => {
  assert.strictEqual(S.PERIOD_ANCHOR, "2026-09-14");
  let p = S.periodFor("2026-09-14");
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-09-14", "2026-09-27", 1]);
  p = S.periodFor("2026-09-24");
  assert.deepStrictEqual([p.start, p.index], ["2026-09-14", 11]);
  assert.strictEqual(S.periodFor("2026-09-27").index, 14);
  p = S.periodFor("2026-09-28");
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-09-28", "2026-10-11", 1]);
  p = S.periodFor("2026-09-13"); // before the anchor still lands in a whole period
  assert.deepStrictEqual([p.start, p.end, p.index], ["2026-08-31", "2026-09-13", 14]);
  assert.strictEqual(p.days.length, 14);
  assert.strictEqual(new Date(`${S.periodFor("2027-02-01").start}T00:00:00Z`).getUTCDay(), 1);
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
    pr("agouraninja-cmd", "2026-09-16T18:00:00Z", [1, 1]),
    pr("agouraninja-cmd", "2026-09-24T18:00:00Z", [1, 1, 1]),
  ], "2026-09-24");
  const jacob = m.series.find((s) => s.name === "Jacob");
  assert.strictEqual(jacob.points.length, 14);
  assert.deepStrictEqual(jacob.points.slice(10), [3, null, null, null]);
  assert.strictEqual(jacob.points[2], 2);
  assert.strictEqual(jacob.periodTotal, 5);
  assert.deepStrictEqual(jacob.today, { commits: 3, prs: 1 });
  assert.strictEqual(m.resetsOn, "2026-09-28");
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

test("the card names everyone, escapes what it prints, and plots no future day", () => {
  const people = [
    { login: "a", name: "Jacob <b>", color: "#B91C1C" },
    { login: "b", name: "Owen", color: "#2A78D6" },
  ];
  const m = S.buildModel([pr("a", "2026-09-24T18:00:00Z", [1])], "2026-09-24", people);
  const html = S.renderCardHtml(m);
  assert.ok(html.includes("Jacob &lt;b&gt;") && !html.includes("Jacob <b>"));
  assert.ok(html.includes("Thursday, September 24"));
  assert.ok(html.includes("Day 11 of 14"));
  assert.ok(html.includes("chart resets Mon, Sep 28"));
  assert.strictEqual((html.match(/<circle /g) || []).length, 11 * people.length);
});

test("the Chat message carries the picture, or the numbers when the picture failed", () => {
  const m = S.buildModel([pr("owenbarnes5", "2026-09-24T18:00:00Z", [1, 1])], "2026-09-24");
  const withImage = S.chatPayload(m, "https://example.com/c.png");
  assert.strictEqual(withImage.text, "*Shipped Thu, Sep 24* — Jacob 0 · Owen 2 · Chuck 0 commits");
  const card = withImage.cardsV2[0].card;
  assert.strictEqual(withImage.cardsV2[0].cardId, "shipped-2026-09-24");
  assert.strictEqual(card.header, undefined, "the picture opens with the date already");
  assert.strictEqual(card.sections[0].widgets[0].image.imageUrl, "https://example.com/c.png");
  assert.match(card.sections[0].widgets[0].image.altText, /Owen 2/);

  const noImage = S.chatPayload(m, undefined).cardsV2[0].card;
  assert.match(noImage.header.title, /Thursday, September 24/);
  assert.match(noImage.sections[0].widgets[0].textParagraph.text, /<b>Owen<\/b> 2 commits · 1 PR · 2 this period/);
});

test("See the PRs asks GitHub for that Boise day, including the night the clocks change", () => {
  const url = (day) => decodeURIComponent(S.prSearchUrl({ day }));
  assert.match(url("2026-09-24"), /merged:2026-09-24T06:00:00Z\.\.2026-09-25T05:59:59Z/);
  // Nov 1 starts at midnight MDT and ends at midnight MST, so it is 25 hours long.
  assert.match(url("2026-11-01"), /merged:2026-11-01T06:00:00Z\.\.2026-11-02T06:59:59Z/);
  assert.match(url("2027-03-14"), /merged:2027-03-14T07:00:00Z\.\.2027-03-15T05:59:59Z/);
  assert.match(url("2026-09-24"), /base:main/);
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
