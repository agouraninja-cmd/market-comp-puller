// The extraction harness's exit code is load-bearing: it is how a run says
// whether it may be read as a verdict at all (2 = something was excluded,
// 1 = it did not run, 0 = every file scored). Nothing else in the repo
// executes this script -- it is an IIFE that would start a real run on
// require -- so what can be checked is its source.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "scripts", "extraction-eval.js"), "utf8");

test("the harness never calls process.exit() once a fetch is in flight", () => {
  // process.exit() tears the process down while undici's sockets are still
  // closing. On Windows that trips libuv's own assertion
  // (!(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76) and aborts with
  // 0xC0000409 -- exit code -1073740791, which is neither 0, 1 nor 2.
  // Reproduced on a real 401 against production on 2026-08-25: the sign-in
  // failure printed correctly and then aborted on top of its own exit code.
  const signIn = SRC.match(/async function signIn\(\)[\s\S]*?\n\}/);
  assert.ok(signIn, "could not bound signIn()");
  const afterFetch = signIn[0].slice(signIn[0].indexOf("await fetch("));
  assert.ok(!/process\.exit\(/.test(afterFetch),
    "signIn() calls process.exit() after its fetch -- it must throw, so Node drains its handles first");

  // The outer catch fires after any fetch in the run, so it carries the same
  // hazard and must set exitCode rather than exit.
  const tail = SRC.slice(SRC.lastIndexOf("})().catch("));
  assert.ok(tail.length > 0, "could not find the top-level catch");
  assert.ok(!/process\.exit\(/.test(tail),
    "the top-level catch calls process.exit() -- use process.exitCode so the code survives");
  assert.match(tail, /process\.exitCode\s*=\s*1/);
});

test("the pre-flight exits stay exits", () => {
  // Everything before the first fetch is free to exit immediately, and should:
  // a dry run reporting its plan and leaving is the normal path.
  const preflight = SRC.slice(0, SRC.indexOf("const cookie = await signIn()"));
  assert.match(preflight, /Dry run[\s\S]{0,120}process\.exit\(0\)/,
    "the dry-run path should still exit(0) immediately -- it has opened no sockets");
});
