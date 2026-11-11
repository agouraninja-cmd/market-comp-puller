"use strict";

// scripts/worktree.js makes a second checkout and puts the main checkout's
// .env in it. Requiring it must create NOTHING (the require.main guard): this
// file loads it for linkEnv alone, which is the one step that used to crash.
//
// Windows refuses fs.symlinkSync without Developer Mode or an elevated shell.
// Until 2026-11-10 that EPERM was thrown at the script's last step, after the
// worktree had been made: a stack trace, no "Ready" line, and a worktree with
// no .env, on the owner's own machine, every time.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { linkEnv } = require("../scripts/worktree.js");

function eperm() {
  const e = new Error("EPERM: operation not permitted, symlink");
  e.code = "EPERM";
  return e;
}

test("linkEnv symlinks where the machine allows it", () => {
  const calls = [];
  const fsApi = {
    symlinkSync: (a, b) => calls.push(["symlink", a, b]),
    copyFileSync: (a, b) => calls.push(["copy", a, b]),
  };
  assert.equal(linkEnv("/main/.env", "/wt/.env", fsApi), "symlinked");
  assert.deepEqual(calls, [["symlink", "/main/.env", "/wt/.env"]]);
});

test("linkEnv falls back to a copy when a symlink is refused (Windows EPERM)", () => {
  const calls = [];
  const fsApi = {
    symlinkSync: () => { throw eperm(); },
    copyFileSync: (a, b) => calls.push(["copy", a, b]),
  };
  assert.equal(linkEnv("/main/.env", "/wt/.env", fsApi), "copied");
  assert.deepEqual(calls, [["copy", "/main/.env", "/wt/.env"]]);
});

test("linkEnv reports a failure instead of throwing: the worktree already exists", () => {
  const fsApi = {
    symlinkSync: () => { throw eperm(); },
    copyFileSync: () => { throw new Error("EACCES"); },
  };
  assert.equal(linkEnv("/main/.env", "/wt/.env", fsApi), "failed");
});

test("linkEnv on the real filesystem leaves a readable .env either way", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-worktree-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, "main.env");
  const dest = path.join(dir, "wt.env");
  fs.writeFileSync(src, "EXAMPLE=1\n");
  const how = linkEnv(src, dest);
  assert.ok(how === "symlinked" || how === "copied", `got ${how}`);
  assert.equal(fs.readFileSync(dest, "utf8"), "EXAMPLE=1\n");
});
