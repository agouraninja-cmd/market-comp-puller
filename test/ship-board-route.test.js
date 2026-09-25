// GET /dev/shipped against a real server: team-only behind the admin key (or
// its cookie), reading the day the nightly job saved from a stand-in for the
// ship-charts branch (SHIP_BOARD_BASE), stepping back past a day not saved
// yet, and saying so in words when nothing can be read. The rules behind the
// numbers are in test/ship-chat.test.js.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { boot } = require("./helpers/boot");
const B = require("../ship-board.js");

const KEY = "ship-board-test-key";

// A stand-in for raw.githubusercontent.com/.../ship-charts/days/. `state.mode`
// is "down" (every read 500s) or "ok" (the newest day the board would ask for
// is not saved yet, and the one before it is).
async function dayServer(t) {
  const state = { mode: "ok", seen: [], present: null };
  const server = http.createServer((req, res) => {
    state.seen.push(req.url);
    const m = req.url.match(/^\/days\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (state.mode === "down") { res.writeHead(500); return res.end("upstream down"); }
    if (!m || m[1] !== state.present) { res.writeHead(404); return res.end("404: Not Found"); }
    const prs = [{ number: 401, title: "Board <b>test</b>", mergedAt: `${m[1]}T18:00:00Z`,
      author: { login: "owenbarnes5" },
      commits: { nodes: [1, 1, 2].map((n) => ({ commit: { parents: { totalCount: n } } })) } }];
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(JSON.stringify(B.buildModel(prs, m[1])));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  state.base = `http://127.0.0.1:${server.address().port}/days/`;
  return state;
}

test("the shipped board does not exist where the dashboards do not", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const res = await fetch(srv.base + "/dev/shipped");
  assert.strictEqual(res.status, 404);
});

test("the shipped board is behind the team key, and reads the saved day", async (t) => {
  const days = await dayServer(t);
  const srv = await boot({ ADMIN_KEY: KEY, SHIP_BOARD_BASE: days.base });
  t.after(() => srv.stop());

  // No key: the door, and not a single read of the day.
  let res = await fetch(srv.base + "/dev/shipped");
  let html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /Enter the team key/);
  assert.ok(!/class="v"/.test(html), "no figures behind the door");
  assert.strictEqual(days.seen.length, 0, "the door reads nothing");
  assert.strictEqual(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("x-robots-tag"), /noindex/);

  // A failed read is said in words, not drawn as a board of zeros.
  days.mode = "down";
  res = await fetch(srv.base + "/dev/shipped", { headers: { "x-admin-key": KEY } });
  html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /The board is unavailable right now/);
  assert.ok(!/<circle /.test(html));

  // The newest day is not saved yet, so the board steps back one and says so.
  const newest = B.addDays(B.boiseDate(Date.now()), -1);
  const before = B.addDays(newest, -1);
  days.mode = "ok";
  days.present = before;
  days.seen.length = 0;
  res = await fetch(srv.base + "/dev/shipped", { headers: { "x-admin-key": KEY } });
  html = await res.text();
  assert.deepStrictEqual(days.seen, [`/days/${newest}.json`, `/days/${before}.json`]);
  assert.match(html, new RegExp(B.longDay(before)));
  assert.match(html, /Last night's update has not arrived yet/);
  assert.match(html, /<div class="v">2<span class="u">commits/, "Owen's two non-merge commits");
  assert.ok(html.includes("Board &lt;b&gt;test&lt;/b&gt;"), "a PR title from the file is escaped");

  // The cookie the /api/admin-access door hands out opens it too.
  const grant = await fetch(srv.base + "/api/admin-access", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY }),
  });
  assert.strictEqual(grant.status, 200);
  const cookie = grant.headers.get("set-cookie").split(";")[0];
  html = await (await fetch(srv.base + "/dev/shipped", { headers: { cookie } })).text();
  assert.match(html, new RegExp(B.longDay(before)));

  // And /dev links to it.
  const dev = await (await fetch(srv.base + "/dev")).text();
  assert.match(dev, /<a href="\/dev\/shipped">Shipped<\/a>/);
});
