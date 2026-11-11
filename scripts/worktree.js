#!/usr/bin/env node
// Give this session its own checkout, so two of them can work at once.
//
// WHY THIS EXISTS. A clone has ONE checked-out branch and ONE staging area,
// shared by every process pointed at that folder. Two Claude Code sessions in
// ~/dev/compninja-owen are therefore not two workspaces, they are two people at
// one desk: whichever one commits first sweeps up whatever the other has staged,
// and a branch switch pulls files out from under the other mid-edit. On
// 2026-08-20 that filed a whole iOS client under an unrelated feature branch,
// one minute before that branch was pushed. Nothing was lost, but only because
// someone checked.
//
// A worktree is the fix git already ships: a second folder with its own branch
// and its own staging area, sharing one history. Git then REFUSES to check out
// the same branch twice, which is the guardrail the shared folder never had.
//
//   node scripts/worktree.js market-badge         -> ../cn-market-badge on feat/market-badge
//   node scripts/worktree.js fix/comp-map-pins    -> ../cn-comp-map-pins on fix/comp-map-pins
//   node scripts/worktree.js some-branch --attach -> checks out a branch that already exists
//
// When the PR merges: git worktree remove <dir> && git worktree prune
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Put the main checkout's .env into a new worktree: a symlink where the
// machine allows one, a plain copy where it does not. Windows refuses
// fs.symlinkSync without Developer Mode or an elevated shell (EPERM), and
// until 2026-11-10 that threw at the last step: the worktree existed, but the
// script died with a stack trace, printed no "Ready" line, and left the
// worktree keyless. Returns "symlinked", "copied" or "failed"; it never
// throws, because by the time it runs the worktree is already made and a
// missing .env is something to say, not something to exit 1 over.
function linkEnv(realEnv, dest, fsApi = fs) {
  try {
    fsApi.symlinkSync(realEnv, dest);
    return "symlinked";
  } catch { /* no symlink privilege (Windows), or a filesystem without them */ }
  try {
    fsApi.copyFileSync(realEnv, dest);
    return "copied";
  } catch {
    return "failed";
  }
}

function main() {
  // Where this script happens to be RUNNING from (may itself be a worktree).
  const HERE = path.join(__dirname, "..");
  const git = (...args) => {
    const r = spawnSync("git", ["-C", HERE, ...args], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(`git ${args.join(" ")} failed:\n${(r.stderr || "").trim()}`);
      process.exit(1);
    }
    return (r.stdout || "").trim();
  };

  // The MAIN checkout, which may not be where this script was run from: a session
  // already in a worktree must still put its siblings next to the real clone and
  // link the real .env, not build a chain of links through a folder that gets
  // removed when its PR merges. `git worktree list` always names the main working
  // tree first.
  const MAIN = git("worktree", "list", "--porcelain").split("\n")[0].replace(/^worktree /, "").trim();

  const args = process.argv.slice(2).filter((a) => a !== "--attach");
  const attach = process.argv.includes("--attach");
  const raw = (args[0] || "").trim();
  if (!raw) {
    console.error("Usage: node scripts/worktree.js <task-name|branch> [--attach]");
    process.exit(1);
  }

  // "market-badge" becomes feat/market-badge; an explicit prefix is kept as
  // typed, so fix/ and docs/ branches are one argument rather than a flag.
  const branch = raw.includes("/") ? raw : `feat/${raw}`;
  const slug = branch.split("/").pop();
  const dir = path.join(path.dirname(MAIN), `cn-${slug}`);

  if (fs.existsSync(dir)) {
    console.error(`${dir} already exists. Remove it, or pick another name.`);
    process.exit(1);
  }

  // Branch off what is on the server RIGHT NOW, not whatever this folder happens
  // to be sitting on. Branching off a stale local main is how a "new" branch
  // arrives already ten commits behind.
  console.log("Fetching...");
  git("fetch", "origin", "--prune");

  const exists = spawnSync("git", ["-C", HERE, "rev-parse", "--verify", "--quiet", branch]).status === 0;
  if (exists && !attach) {
    console.error(`Branch ${branch} already exists. Pass --attach to check it out here instead.`);
    process.exit(1);
  }
  git("worktree", "add", ...(exists ? [dir, branch] : [dir, "-b", branch, "origin/main"]));

  // .env is gitignored, so a fresh worktree has no API keys and no database
  // credentials: the server boots keyless and every script that touches Supabase
  // fails with a confusing error rather than an obvious one. Symlinked where the
  // machine allows it, so rotating a key does not leave stale copies in half the
  // worktrees; copied where it does not (see linkEnv).
  // The other gitignored files (account-store.json, analytics.jsonl,
  // shared-reports.json, search-cache.json) are local fallback DATA and are
  // deliberately NOT linked: a fresh worktree starting with its own empty state
  // is the point.
  // realpath, so a worktree created FROM a worktree links the actual file rather
  // than a link to a link that dies with its parent folder.
  const env = path.join(MAIN, ".env");
  if (fs.existsSync(env)) {
    const dest = path.join(dir, ".env");
    const how = linkEnv(fs.realpathSync(env), dest);
    if (how === "symlinked") {
      console.log(".env symlinked from the main checkout.");
    } else if (how === "copied") {
      console.log(".env COPIED from the main checkout (this machine does not allow a symlink).");
      console.log("  A copy does not follow the original: after rotating a key, copy it again.");
    } else {
      console.log(`.env could not be linked or copied. Copy it yourself: ${env} -> ${dest}`);
    }
  } else {
    console.log("No .env in the main checkout, so none was linked.");
  }

  console.log(`\nReady: ${dir}  (branch ${branch})`);
  console.log(`  cd ${dir}`);
  console.log(`  npm test`);
  console.log(`\nWhen the PR merges: git worktree remove ${dir} && git worktree prune`);
}

// Requiring this file must create nothing: test/worktree.test.js loads it for
// linkEnv alone.
if (require.main === module) main();

module.exports = { linkEnv };
