"use strict";

// desktop.js is the desktop-app launcher. Requiring it must start NOTHING
// (the require.main guard) — the fact that this file loads it at the top and
// the suite still finishes in milliseconds is itself the pin for that.

const test = require("node:test");
const assert = require("node:assert");
const DESK = require("../desktop");

// --- normalizeDesktopUrl -----------------------------------------------------

test("normalizeDesktopUrl accepts http and https and trims whitespace", () => {
  assert.equal(DESK.normalizeDesktopUrl("https://compninja.co"), "https://compninja.co/");
  assert.equal(DESK.normalizeDesktopUrl("  http://localhost:3000/desk  "), "http://localhost:3000/desk");
});

test("normalizeDesktopUrl refuses everything that is not http(s)", () => {
  // These values go straight onto a browser command line, so reject, never guess.
  assert.equal(DESK.normalizeDesktopUrl("file:///C:/Windows/system32"), null);
  assert.equal(DESK.normalizeDesktopUrl("javascript:alert(1)"), null);
  assert.equal(DESK.normalizeDesktopUrl("compninja.co"), null);
  assert.equal(DESK.normalizeDesktopUrl(""), null);
  assert.equal(DESK.normalizeDesktopUrl(null), null);
  assert.equal(DESK.normalizeDesktopUrl("   "), null);
});

// --- parseDesktopArgs --------------------------------------------------------

test("parseDesktopArgs defaults: local server, no pinned port, no browser override", () => {
  const opts = DESK.parseDesktopArgs([]);
  assert.deepEqual(opts, { url: null, port: null, browser: null, help: false, errors: [] });
});

test("parseDesktopArgs reads --url, --port, --browser and --help", () => {
  assert.equal(DESK.parseDesktopArgs(["--url", "https://compninja.co"]).url, "https://compninja.co/");
  assert.equal(DESK.parseDesktopArgs(["--port", "3210"]).port, 3210);
  assert.equal(DESK.parseDesktopArgs(["--browser", "/usr/bin/chromium"]).browser, "/usr/bin/chromium");
  assert.equal(DESK.parseDesktopArgs(["--help"]).help, true);
  assert.equal(DESK.parseDesktopArgs(["-h"]).help, true);
});

test("parseDesktopArgs rejects rather than guesses", () => {
  // A typo'd flag silently ignored would open the wrong thing.
  assert.ok(DESK.parseDesktopArgs(["--ur", "https://x.co"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--url", "ftp://x.co"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--url"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--port", "0"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--port", "notaport"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--port", "70000"]).errors.length >= 1);
  assert.ok(DESK.parseDesktopArgs(["--browser", ""]).errors.length >= 1);
});

test("parseDesktopArgs refuses --url combined with --port", () => {
  // --port pins the LOCAL server; with --url there is no local server, so a
  // silently ignored --port would read as the launcher honoring it.
  const opts = DESK.parseDesktopArgs(["--url", "https://compninja.co", "--port", "3210"]);
  assert.ok(opts.errors.some((e) => /--port/.test(e)));
});

// --- chromiumCandidates ------------------------------------------------------

test("chromiumCandidates on win32 builds Edge-first absolute paths from every install root", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\o\\AppData\\Local",
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  };
  const cands = DESK.chromiumCandidates("win32", env);
  // Edge is the one browser guaranteed on a Windows box, so it must lead.
  assert.match(cands[0], /msedge\.exe$/);
  assert.ok(cands.includes("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(cands.includes("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(cands.includes("C:\\Users\\o\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"));
});

test("chromiumCandidates on win32 also reads the mixed-case env spellings", () => {
  // process.env is case-insensitive on Windows; a plain object is not, and
  // real shells hand over ProgramFiles(x86) in exactly this casing.
  const cands = DESK.chromiumCandidates("win32", {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
  });
  assert.ok(cands.includes("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(cands.includes("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"));
});

test("chromiumCandidates on darwin and linux return their expected shapes", () => {
  const mac = DESK.chromiumCandidates("darwin", {});
  assert.ok(mac.every((p) => p.startsWith("/Applications/")));
  const linux = DESK.chromiumCandidates("linux", {});
  assert.ok(linux.includes("chromium") && linux.includes("google-chrome"));
  // Linux entries are bare command names for PATH resolution, never paths.
  assert.ok(linux.every((p) => !p.includes("/")));
});

// --- buildAppArgs ------------------------------------------------------------

test("buildAppArgs produces the app-mode flag set with the dedicated profile", () => {
  const args = DESK.buildAppArgs("http://127.0.0.1:4173/", "/home/o/.compninja/desktop-profile");
  assert.equal(args[0], "--app=http://127.0.0.1:4173/");
  // The dedicated profile is load-bearing: without it Chromium hands the URL
  // to an existing instance and exits, leaving nothing to wait on — the
  // server would be torn down while the window is still open.
  assert.ok(args.includes("--user-data-dir=/home/o/.compninja/desktop-profile"));
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
  assert.ok(args.includes(`--window-size=${DESK.WINDOW_SIZE}`));
});
