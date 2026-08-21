"use strict";

// scripts/shot.js is the before/after screenshot tool behind CLAUDE.md's
// "Design changes: before and after" rule. Requiring it must start NOTHING
// (the require.main guard), the same pin desktop.js carries — this file loads
// it at the top and the suite still finishes in milliseconds.

const test = require("node:test");
const assert = require("node:assert");
const SHOT = require("../scripts/shot.js");

// --- normalizeShotPath -------------------------------------------------------

test("normalizeShotPath takes a page path and adds the leading slash", () => {
  assert.equal(SHOT.normalizeShotPath("/how-it-works"), "/how-it-works");
  assert.equal(SHOT.normalizeShotPath("markets"), "/markets");
  assert.equal(SHOT.normalizeShotPath("  /brokers  "), "/brokers");
  assert.equal(SHOT.normalizeShotPath("/market/industrial-boise-id"), "/market/industrial-boise-id");
});

test("normalizeShotPath refuses a URL rather than guessing at it", () => {
  // This tool only ever shoots the server it just booted. An absolute URL
  // would point somewhere the before/after comparison cannot be made, so it
  // is refused loudly instead of silently ignored.
  assert.equal(SHOT.normalizeShotPath("https://compninja.co/how-it-works"), null);
  assert.equal(SHOT.normalizeShotPath("http://localhost:3000/"), null);
  assert.equal(SHOT.normalizeShotPath("file:///etc/passwd"), null);
  assert.equal(SHOT.normalizeShotPath("//evil.example.com/x"), null);
  assert.equal(SHOT.normalizeShotPath(""), null);
  assert.equal(SHOT.normalizeShotPath(null), null);
});

// --- parseSize ---------------------------------------------------------------

test("parseSize needs both dimensions", () => {
  assert.deepEqual(SHOT.parseSize("1280x900"), { width: 1280, height: 900 });
  assert.deepEqual(SHOT.parseSize(" 390x844 "), { width: 390, height: 844 });
  // A lone width would have to invent a height, and the height is what decides
  // whether a --viewport shot shows the fold or half of it.
  assert.equal(SHOT.parseSize("1280"), null);
  assert.equal(SHOT.parseSize("1280X900"), null);
  assert.equal(SHOT.parseSize("wide"), null);
});

// --- slugForPath -------------------------------------------------------------

test("slugForPath makes a flat, readable file name", () => {
  assert.equal(SHOT.slugForPath("/"), "home");
  assert.equal(SHOT.slugForPath("/how-it-works"), "how-it-works");
  assert.equal(SHOT.slugForPath("/market/industrial-boise-id"), "market-industrial-boise-id");
  assert.equal(SHOT.slugForPath("/desk?checkout=success"), "desk");
});

// --- parseShotArgs -----------------------------------------------------------

test("parseShotArgs collects paths and defaults to a whole-page shot", () => {
  const o = SHOT.parseShotArgs(["/", "/markets"]);
  assert.deepEqual(o.paths, ["/", "/markets"]);
  assert.equal(o.before, null);
  assert.equal(o.fullPage, true);
  assert.equal(o.expand, false);
  assert.deepEqual(o.errors, []);
});

test("--before alone means origin/main, and a following ref is taken", () => {
  assert.equal(SHOT.parseShotArgs(["/", "--before"]).before, "origin/main");
  assert.equal(SHOT.parseShotArgs(["/", "--before", "HEAD~1"]).before, "HEAD~1");
  // A flag after --before is the next flag, not a ref.
  const o = SHOT.parseShotArgs(["/", "--before", "--expand"]);
  assert.equal(o.before, "origin/main");
  assert.equal(o.expand, true);
});

test("parseShotArgs refuses an unknown flag and a run with nothing to shoot", () => {
  assert.match(SHOT.parseShotArgs(["/", "--fullpage"]).errors[0], /Unknown flag/);
  assert.match(SHOT.parseShotArgs([]).errors[0], /Nothing to shoot/);
  assert.match(SHOT.parseShotArgs(["--size", "big", "/"]).errors[0], /WIDTHxHEIGHT/);
  assert.match(SHOT.parseShotArgs(["--env", "NOPE", "/"]).errors[0], /KEY=VALUE/);
});

test("--env pairs keep everything after the first equals sign", () => {
  const o = SHOT.parseShotArgs(["/", "--env", "SITE_URL=https://x.test/?a=b"]);
  assert.equal(o.env.SITE_URL, "https://x.test/?a=b");
});

// --- shotServerEnv -----------------------------------------------------------

test("shotServerEnv blanks Supabase BY ASSIGNMENT, never by deleting the keys", () => {
  // server.js's .env loader fills any var that is `undefined`, so deleting
  // these would helpfully restore the real ones from .env and point a scratch
  // server at production's corpus, market pages and cache. The empty string is
  // the whole point; a test that only checked falsiness would pass on delete.
  const env = SHOT.shotServerEnv({ SUPABASE_URL: "https://real.supabase.co", SUPABASE_SERVICE_KEY: "secret" }, 4321, {});
  assert.ok("SUPABASE_URL" in env);
  assert.ok("SUPABASE_SERVICE_KEY" in env);
  assert.strictEqual(env.SUPABASE_URL, "");
  assert.strictEqual(env.SUPABASE_SERVICE_KEY, "");
  assert.strictEqual(env.PORT, "4321");
});

test("shotServerEnv lets an explicit --env override put a database back", () => {
  // The only way to shoot a surface whose content comes out of a database.
  // main() warns when this happens; the ordering is what makes it possible.
  const env = SHOT.shotServerEnv({}, 1, { SUPABASE_URL: "https://scratch.supabase.co" });
  assert.equal(env.SUPABASE_URL, "https://scratch.supabase.co");
});

test("shotServerEnv keeps the rest of the environment", () => {
  const env = SHOT.shotServerEnv({ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-x" }, 1, { ACCOUNT_WALL: "off" });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.ANTHROPIC_API_KEY, "sk-x");
  assert.equal(env.ACCOUNT_WALL, "off");
});
