const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");
const GRACEFUL = require("../graceful-shutdown");

// Stopping without dropping the request somebody is waiting on.
//
// Until 2026-11-14 server.js died on the spot at SIGTERM, which is how Render
// ends the old instance of every deploy, so each deploy cut off the searches
// in flight after they had been billed. graceful-shutdown.js is the drain.
//
// Three layers, because each can be wrong while the others pass: the counting
// rules against a plain http.Server with no signal sent to anything; the real
// server.js as a child process, sent a real SIGTERM with a slow request in
// flight; and a source check that the four process handlers are registered,
// since the two crash events cannot be raised in the real server from outside.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A server whose every response waits until the test lets it go.
async function slowServer() {
  const waiting = [];
  const exits = [];
  const logs = [];
  let shutdown = null;
  const server = http.createServer((req, res) => {
    shutdown.track(req, res);
    waiting.push(() => { res.writeHead(200, { "content-type": "text/plain" }); res.end("done"); });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const make = (opts) => {
    shutdown = GRACEFUL.createShutdown({
      server, log: (l) => logs.push(l), exit: (code) => exits.push(code), ...(opts || {}),
    });
    return shutdown;
  };
  return {
    server, port, waiting, exits, logs, make,
    get: () => fetch(`http://127.0.0.1:${port}/`).then(async (r) => ({ status: r.status, body: await r.text() })),
    close: () => new Promise((r) => { try { server.closeAllConnections(); } catch (_) {} server.close(() => r()); }),
  };
}

test("with nothing in flight a stop is immediate, and the port is closed", async () => {
  const s = await slowServer();
  const shutdown = s.make();
  shutdown.begin("SIGTERM", 0);
  assert.deepEqual(s.exits, [0]);
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}/`), "nothing is listening any more");
  await s.close();
});

test("a request in flight is finished before the exit, and new connections are refused meanwhile", async () => {
  const s = await slowServer();
  const shutdown = s.make({ graceMs: 60000 });
  const inFlight = s.get();
  while (!s.waiting.length) await sleep(5);

  shutdown.begin("SIGTERM", 0);
  assert.deepEqual(s.exits, [], "not while somebody is still waiting on an answer");
  assert.equal(shutdown.state().inFlight, 1);
  assert.match(s.logs.join("\n"), /Waiting up to 60s for 1 request/);
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}/`), "the port stopped taking new visitors at once");

  s.waiting[0]();
  const answer = await inFlight;
  assert.equal(answer.status, 200);
  assert.equal(answer.body, "done", "the visitor got the whole answer, not a reset connection");
  for (let i = 0; i < 100 && !s.exits.length; i++) await sleep(5);
  assert.deepEqual(s.exits, [0], "and then it exits, exactly once");
  await s.close();
});

test("a stuck request cannot hold the stop open past the deadline", async () => {
  const s = await slowServer();
  let fire = null;
  const shutdown = s.make({ graceMs: 5000, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  const stuck = s.get().catch((e) => ({ failed: e }));
  while (!s.waiting.length) await sleep(5);

  shutdown.begin("SIGTERM", 0);
  assert.deepEqual(s.exits, []);
  assert.equal(typeof fire, "function", "a deadline was set");
  fire();
  assert.deepEqual(s.exits, [0]);
  assert.match(s.logs.join("\n"), /gave up after 5s with 1 request/);
  const r = await stuck;
  assert.ok(r.failed, "the stuck request is the one that is cut off");
  // The late close must not exit a second time.
  await sleep(20);
  assert.deepEqual(s.exits, [0]);
  await s.close();
});

test("a second signal ends it at once", async () => {
  const s = await slowServer();
  const shutdown = s.make({ graceMs: 60000 });
  s.get().catch(() => {});
  while (!s.waiting.length) await sleep(5);
  shutdown.begin("SIGINT", 0);
  assert.deepEqual(s.exits, []);
  shutdown.begin("SIGINT", 0);
  assert.deepEqual(s.exits, [0], "Ctrl+C twice always works");
  shutdown.begin("SIGINT", 0);
  assert.deepEqual(s.exits, [0], "and never exits twice");
  await s.close();
});

test("a crash drains the same way and exits non-zero", async () => {
  const s = await slowServer();
  const shutdown = s.make({ graceMs: 60000 });
  const inFlight = s.get();
  while (!s.waiting.length) await sleep(5);
  shutdown.begin("an uncaught exception", 1);
  s.waiting[0]();
  assert.equal((await inFlight).status, 200);
  for (let i = 0; i < 100 && !s.exits.length; i++) await sleep(5);
  assert.deepEqual(s.exits, [1], "so the host restarts it");
  await s.close();
});

test("a request handed back through the handler twice is counted once", () => {
  const exits = [];
  const fakeServer = { close() {}, closeIdleConnections() {} };
  const shutdown = GRACEFUL.createShutdown({ server: fakeServer, exit: (c) => exits.push(c) });
  const listeners = [];
  const res = { once: (ev, fn) => listeners.push(fn) };
  shutdown.track({}, res);
  shutdown.track({}, res);
  assert.equal(shutdown.state().inFlight, 1);
  shutdown.begin("SIGTERM", 0);
  assert.deepEqual(exits, []);
  listeners.forEach((fn) => fn());
  assert.deepEqual(exits, [0]);
  // A response object with no events (a stand-in) is ignored, never counted.
  assert.doesNotThrow(() => shutdown.track({}, {}));
  assert.doesNotThrow(() => shutdown.track(null, null));
});

test("a server that never bound its port still stops cleanly", () => {
  const exits = [];
  const notListening = { close() { throw new Error("ERR_SERVER_NOT_RUNNING"); } };
  GRACEFUL.createShutdown({ server: notListening, exit: (c) => exits.push(c) }).begin("an uncaught exception", 1);
  assert.deepEqual(exits, [1], "a crash during boot exits non-zero instead of hanging");
});

test("the wait comes from SHUTDOWN_GRACE_SECONDS and never reads as no wait", () => {
  const dflt = GRACEFUL.DEFAULT_GRACE_SECONDS * 1000;
  assert.equal(GRACEFUL.graceMsFrom(undefined), dflt);
  assert.equal(GRACEFUL.graceMsFrom(""), dflt);
  assert.equal(GRACEFUL.graceMsFrom("0"), dflt, "zero is a typo, not an instruction to drop every request");
  assert.equal(GRACEFUL.graceMsFrom("-5"), dflt);
  assert.equal(GRACEFUL.graceMsFrom("soon"), dflt);
  assert.equal(GRACEFUL.graceMsFrom("45"), 45000);
  assert.equal(GRACEFUL.graceMsFrom(" 2 "), 2000);
  assert.equal(GRACEFUL.graceMsFrom("999999"), 3600 * 1000, "capped at an hour");
  assert.ok(GRACEFUL.DEFAULT_GRACE_SECONDS < 300, "inside the longest wait the host allows");
});

test("the crash mail is limited per kind, per window", () => {
  let now = 1000;
  const allow = GRACEFUL.createLimiter(60000, () => now);
  assert.equal(allow("rejection"), true);
  assert.equal(allow("rejection"), false, "a bug on every request is one message");
  assert.equal(allow("exception"), true, "a different kind is a different message");
  now += 59999;
  assert.equal(allow("rejection"), false);
  now += 2;
  assert.equal(allow("rejection"), true);
});

test("whatever was thrown becomes text that can be logged and mailed", () => {
  const e = new Error("boom");
  assert.match(GRACEFUL.describeError(e), /Error: boom/);
  assert.match(GRACEFUL.describeError(e), /graceful-shutdown\.test\.js/, "the stack, not just the message");
  assert.equal(GRACEFUL.describeError("plain"), "plain");
  assert.equal(GRACEFUL.describeError({ code: 7 }), '{"code":7}');
  assert.equal(GRACEFUL.describeError(undefined), "undefined");
  assert.equal(GRACEFUL.describeError(null), "null");
  const loop = {}; loop.self = loop;
  assert.doesNotThrow(() => GRACEFUL.describeError(loop));
  assert.ok(GRACEFUL.describeError("x".repeat(9000), 100).length < 120, "capped");
});

// The crash events cannot be raised in the real server from outside, so what
// is checked is that they are registered at all: before this, none were.
test("server.js registers both signals and both crash events, and counts every request", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const ev of ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"]) {
    assert.ok(src.includes(`process.on("${ev}"`), `server.js must handle ${ev}`);
  }
  const handler = src.indexOf("const server = http.createServer(");
  const track = src.indexOf("SHUTDOWN.track(req, res);", handler);
  const warm = src.indexOf("if (routeWarm(req, res", handler);
  assert.ok(handler > 0 && track > handler, "every request is counted in the request handler");
  assert.ok(track < warm, "before routeWarm, which answers some requests itself");
});

// A stand-in for the Census geocoder that answers after `delayMs`. It is what
// makes POST /api/geocode a slow request on the real server, with no model,
// no database and no account involved.
async function slowCensus(delayMs) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: { addressMatches: [] } }));
    }, delayMs);
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://127.0.0.1:${server.address().port}/census`,
    hits: () => hits,
    stop: () => new Promise((r) => { try { server.closeAllConnections(); } catch (_) {} server.close(() => r()); }),
  };
}

const geocode = (srv) => fetch(srv.base + "/api/geocode", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: "100 Main St, Boise, ID" }),
});

test("the real server, sent a real SIGTERM", { skip: process.platform === "win32" && "Windows has no SIGTERM to deliver" }, async (t) => {
  await t.test("idle, it exits at once with code 0", async () => {
    const srv = await shared.boot({});
    const started = Date.now();
    srv.signal("SIGTERM");
    const end = await srv.exited;
    srv.stop();
    assert.equal(end.code, 0, "an exit it chose, not a death by signal: " + JSON.stringify(end));
    assert.ok(Date.now() - started < 3000, "nothing in flight means no waiting");
  });

  await t.test("with a request in flight, the visitor gets the answer and THEN it exits", async () => {
    const census = await slowCensus(1200);
    const srv = await shared.boot({ CENSUS_API_URL: census.url, SHUTDOWN_GRACE_SECONDS: "20" });
    try {
      const inFlight = geocode(srv).then(async (r) => ({ status: r.status, body: await r.json() }),
        (e) => ({ failed: String(e && e.cause && e.cause.code || e) }));
      for (let i = 0; i < 400 && !census.hits(); i++) await sleep(5);
      assert.equal(census.hits(), 1, "the request reached the slow upstream, so it is in flight");

      srv.signal("SIGTERM");
      let stillRunning = true;
      srv.exited.then(() => { stillRunning = false; });
      await sleep(250);
      assert.equal(stillRunning, true, "before this change it was already dead here");
      await assert.rejects(fetch(srv.base + "/healthz"), "it stopped taking new visitors at once");

      const answer = await inFlight;
      assert.equal(answer.failed, undefined, "the request was cut off: " + answer.failed);
      assert.equal(answer.status, 200);
      const end = await srv.exited;
      assert.equal(end.code, 0, JSON.stringify(end));
    } finally { srv.stop(); await census.stop(); }
  });

  await t.test("a request slower than the wait is given up on, and it still exits by itself", async () => {
    const census = await slowCensus(5000);
    const srv = await shared.boot({ CENSUS_API_URL: census.url, SHUTDOWN_GRACE_SECONDS: "1" });
    try {
      const inFlight = geocode(srv).then((r) => ({ status: r.status }), () => ({ failed: true }));
      for (let i = 0; i < 400 && !census.hits(); i++) await sleep(5);
      const started = Date.now();
      srv.signal("SIGTERM");
      const end = await srv.exited;
      const took = Date.now() - started;
      assert.equal(end.code, 0, JSON.stringify(end));
      assert.ok(took >= 900 && took < 4000, `waited about the one second it was given (${took}ms)`);
      assert.equal((await inFlight).failed, true);
    } finally { srv.stop(); await census.stop(); }
  });
});
