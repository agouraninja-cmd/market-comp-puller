// The nightly "who shipped what" post to the Developer thread of the team's
// Google Chat space, and the numbers behind the shipped board.
//
//   node scripts/ship-chat.js build --out DIR [--day YYYY-MM-DD]
//   node scripts/ship-chat.js post  --out DIR [--intro] [--dry-run]
//
// `build` reads the PRs merged to main, counts them per person, and writes
// DIR/model.json (the day, as the board at /dev/shipped reads it) and
// DIR/board.html (that page, for a local look). `post` sends the day's summary
// to the webhook in GOOGLE_CHAT_WEBHOOK_URL. .github/workflows/ship-chat.yml
// runs both every night at midnight in Boise and saves model.json to the
// `ship-charts` branch in between, which is where the board reads it.
//
// The counting rules and the page live in ../ship-board.js, shared with
// server.js so the post and the board can never quote different numbers.
// Requiring this file starts nothing (the require.main guard at the bottom),
// which is what lets test/ship-chat.test.js exercise it with no network.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const B = require("../ship-board.js");

// Where the post's button goes. The board is team-only, behind the same key
// as /admin and /dev.
const BOARD_URL = `https://compninja.co${B.BOARD_PATH}`;

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

// Every post goes into ONE thread of the CompNinja space, the "Developer
// thread", rather than a new thread a night. Chat keys a webhook's threads by
// this string: the first post with it starts the thread and every later one
// replies into it (REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD). Changing it starts a
// new thread, and so does replacing the webhook, since keys belong to it.
const THREAD_KEY = "developer-thread";

// What opens that thread, posted once (`post --intro`, already done on
// 2026-09-25) so the thread reads as the place development talk goes.
const THREAD_INTRO =
  "*Developer thread*\n" +
  "Where talk about CompNinja development goes. The nightly shipped summary posts here at midnight, Boise time: " +
  "who merged how many commits that day, with a link to the board and its chart that starts over every two weeks. " +
  "Reply here to talk about any of it.";

// Whether a scheduled fire should post. No schedule means a person pressed
// "Run workflow", which always posts.
function shouldPost(schedule, now) {
  if (!schedule) return true;
  if (!(schedule in SCHEDULE_OFFSETS)) throw new Error(`Unknown schedule "${schedule}" — add it to SCHEDULE_OFFSETS.`);
  return B.boiseOffsetMinutes(now) === SCHEDULE_OFFSETS[schedule];
}

// --- the post ---------------------------------------------------------------

// The plain line Chat shows in notifications and above the card.
function summaryLine(model) {
  const who = model.series.map((s) => `${s.name} ${s.today.commits}`).join(" · ");
  return `*Shipped ${B.shortDay(model.day)}* — ${who} commits`;
}

// The Chat message: the summary line, then a card with each person's day as
// native Chat text — never a picture, which Chat shrinks to a phone's width
// until the figures are unreadable — and a button to the board, where the
// chart and the day's PRs are drawn at full size.
function chatPayload(model) {
  const widgets = model.series.map((s) => ({
    decoratedText: {
      topLabel: s.name,
      text: `<font color="${s.color}">●</font> <b>${B.plural(s.today.commits, "commit", "commits")}</b> · ` +
        (s.today.prs ? `${B.plural(s.today.prs, "PR", "PRs")} merged` : "nothing merged"),
      bottomLabel: `${B.plural(s.periodTotal, "commit", "commits")} this period`,
    },
  }));
  if (model.others && model.others.commits) {
    widgets.push({ textParagraph: { text: `Also ${B.plural(model.others.commits, "commit", "commits")} from others.` } });
  }
  widgets.push({ buttonList: { buttons: [
    { text: "Open the board", onClick: { openLink: { url: BOARD_URL } } },
    { text: "See the PRs", onClick: { openLink: { url: B.prSearchUrl(model) } } },
  ] } });
  return {
    text: summaryLine(model),
    cardsV2: [{
      cardId: `shipped-${model.day}`,
      card: {
        header: {
          title: `Shipped · ${B.longDay(model.day)}`,
          subtitle: `Day ${model.period.index} of ${model.period.length} · the chart resets ${B.shortDay(model.resetsOn)}`,
        },
        sections: [{ widgets }],
      },
    }],
  };
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
      nodes{number title mergedAt updatedAt author{login}
        commits(first:250){nodes{commit{parents{totalCount}}}}}}}}`;

// Every PR merged to main on or after `sinceDay`. Ordered by last update,
// which is never earlier than the merge, so the first page whose oldest row
// predates the window is the last page worth reading.
async function fetchMergedPRs(sinceDay, token = githubToken()) {
  const [owner, name] = B.REPO.split("/");
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

// Lets the workflow read one value off a step (the day it saves).
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
      console.log(`Schedule "${schedule}" belongs to the other season (Boise is UTC${B.boiseOffsetMinutes(now) / 60}); standing down.`);
      setOutput("post", "false");
      return;
    }
    const day = argOf(args, "--day") || B.targetDay(now);
    if (!B.isDay(day)) throw new Error(`--day must be YYYY-MM-DD, got "${day}".`);
    const prs = await fetchMergedPRs(B.periodFor(day).start);
    const model = B.buildModel(prs, day, B.PEOPLE, now);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "model.json"), JSON.stringify(model, null, 2));
    fs.writeFileSync(path.join(out, "board.html"), B.renderBoardPage(model, now));
    console.log(summaryLine(model).replace(/\*/g, ""));
    console.log(`Day ${model.period.index} of ${model.period.length} (${model.period.start} to ${model.period.end}); ${prs.length} PRs read.`);
    setOutput("post", "true");
    setOutput("day", day);
    return;
  }
  if (cmd === "post") {
    const model = JSON.parse(fs.readFileSync(path.join(out, "model.json"), "utf8"));
    const payload = chatPayload(model);
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
  throw new Error("Usage: node scripts/ship-chat.js build|post --out DIR [--day YYYY-MM-DD] [--intro] [--dry-run]");
}

module.exports = {
  ...B,
  BOARD_URL, SCHEDULE_OFFSETS, THREAD_KEY, THREAD_INTRO,
  shouldPost, summaryLine, chatPayload, threadedUrl, postToChat,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
