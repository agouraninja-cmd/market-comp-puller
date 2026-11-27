// test/boot-helper.test.js
// test/helpers/boot.js asks nothing of a port its own server does not hold.
//
// A boot's port comes from the OS and is let go before the server binds it,
// so now and then something else on the machine is handed the same number
// first. The server then dies on EADDRINUSE and the boot retries. Until
// 2026-11-27 the boot was already polling GET /healthz by then, and the polls
// landed on whoever held the port: another suite's stand-in, which counted
// them (test/owner-lookup-run.test.js, "2 !== 0" on CI). This parks a
// listener on a port, boots onto it, and reads what the listener was sent.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const shared = require("./helpers/boot");

test("a boot whose port somebody else holds sends the holder nothing", async (t) => {
  const got = [];
  const holder = http.createServer((req, res) => {
    got.push(req.method + " " + req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => holder.listen(0, r));
  t.after(() => new Promise((r) => holder.close(r)));
  // A named port is how to lose the race on purpose: boot() honours it and
  // does not retry on another.
  await assert.rejects(shared.boot({ PORT: String(holder.address().port) }), /exited early[\s\S]*EADDRINUSE/);
  assert.deepEqual(got, [], "the boot polled a port its server never held");
});

test("a boot that wins its port is still found healthy", async (t) => {
  const srv = await shared.boot({});
  t.after(() => srv.stop());
  assert.equal(await srv.alive(), true);
});
