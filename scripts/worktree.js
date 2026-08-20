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
// fails with a confusing error rather than an obvious one. Symlinked, never
// copied, so rotating a key does not leave stale copies in half the worktrees.
// The other gitignored files (account-store.json, analytics.jsonl,
// shared-reports.json, search-cache.json) are local fallback DATA and are
// deliberately NOT linked: a fresh worktree starting with its own empty state
// is the point.
// realpath, so a worktree created FROM a worktree links the actual file rather
// than a link to a link that dies with its parent folder.
const env = path.join(MAIN, ".env");
if (fs.existsSync(env)) {
  fs.symlinkSync(fs.realpathSync(env), path.join(dir, ".env"));
  console.log(".env symlinked from the main checkout.");
} else {
  console.log("No .env in the main checkout, so none was linked.");
}

console.log(`\nReady: ${dir}  (branch ${branch})`);
console.log(`  cd ${dir}`);
console.log(`  npm test`);
console.log(`\nWhen the PR merges: git worktree remove ${dir} && git worktree prune`);
