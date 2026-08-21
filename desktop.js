"use strict";

// CompNinja desktop app — a zero-dependency launcher, NOT an Electron build.
//
// This repo runs on plain Node with no npm dependencies, and the desktop app
// keeps that rule: it boots the ordinary server.js on a free localhost port
// (or points at a hosted deployment via --url), then opens CompNinja in a
// Chromium-family browser's --app mode — a chromeless window with its own
// dedicated profile, so it looks and signs in like a desktop app rather than
// a browser tab. Every machine this needs to work on already ships a
// Chromium (Edge is preinstalled on Windows), so bundling a 200MB runtime
// would buy nothing but a dependency tree.
//
// Three rules that are easy to lose in an edit:
// - Children are spawned with process.execPath, never the string "node".
//   The owner's Windows machine runs a portable no-admin Node that is NOT on
//   PATH (see CLAUDE.md "Running it"); execPath is the interpreter that is
//   provably present because it is running this file.
// - The app window gets its OWN --user-data-dir. Without one, Chromium hands
//   the URL to an already-running browser instance and exits immediately, so
//   there is no process to wait on and the server would be torn down while
//   the window is still open. The dedicated profile is also what makes the
//   session persist like an app's rather than sharing the browser's tabs.
// - The launcher never picks port 3000. The owner's dev server lives there;
//   a free port is asked from the OS every time so `npm run desktop` can run
//   beside `npm start` without either stepping on the other.
//
// Usage:
//   node desktop.js                      local server + app window
//   node desktop.js --url https://compninja.co    app window on the hosted site
//   node desktop.js --port 3210          pin the local server's port
//   node desktop.js --browser <path>     use a specific browser binary
//
// scripts/install-desktop-shortcut.ps1 creates the Windows Desktop / Start
// Menu shortcut that runs this file (icon and portable-Node lookup included).

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const WINDOW_SIZE = "1280,860";
const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 400;

// ---------------------------------------------------------------------------
// Pure helpers (exported for test/desktop.test.js)
// ---------------------------------------------------------------------------

// Only http(s) may reach the app window. A shortcut or shell alias passes
// this value straight into a browser command line, so anything else
// (file:, javascript:, a bare word) is refused rather than guessed at.
function normalizeDesktopUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

function parseDesktopArgs(argv) {
  const out = { url: null, port: null, browser: null, help: false, errors: [] };
  const args = Array.isArray(argv) ? argv.slice() : [];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--url") {
      const url = normalizeDesktopUrl(args.shift());
      if (!url) out.errors.push("--url needs an http(s) URL, e.g. --url https://compninja.co");
      else out.url = url;
      continue;
    }
    if (arg === "--port") {
      const n = Number(args.shift());
      if (!Number.isInteger(n) || n < 1 || n > 65535) out.errors.push("--port needs a number between 1 and 65535");
      else out.port = n;
      continue;
    }
    if (arg === "--browser") {
      const p = args.shift();
      if (!p || !String(p).trim()) out.errors.push("--browser needs a path to a Chromium-family binary");
      else out.browser = String(p).trim();
      continue;
    }
    // Reject rather than guess — a typo'd flag silently ignored would launch
    // the wrong thing (e.g. --ur https://… opening the local server instead).
    out.errors.push(`Unknown option: ${arg}`);
  }
  if (out.url && out.port) out.errors.push("--port applies to the local server; it cannot be combined with --url");
  return out;
}

// process.env on Windows is case-insensitive, but tests (and any plain
// object) are not — so read every spelling a Windows box actually uses.
function envAny(env, keys) {
  for (const key of keys) {
    const val = env && env[key];
    if (typeof val === "string" && val) return val;
  }
  return null;
}

// Ordered candidate list per platform. Edge before Chrome on Windows because
// Edge is the one guaranteed present; everywhere else the order is just
// most-common-first. Windows/macOS entries are absolute paths; Linux entries
// are bare command names resolved against PATH by findBrowser().
function chromiumCandidates(platform, env) {
  if (platform === "win32") {
    const roots = [
      envAny(env, ["LOCALAPPDATA"]),
      envAny(env, ["PROGRAMFILES", "ProgramFiles"]),
      envAny(env, ["PROGRAMFILES(X86)", "ProgramFiles(x86)"]),
    ].filter(Boolean);
    const rels = [
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Google\\Chrome\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Chromium\\Application\\chrome.exe",
    ];
    const out = [];
    for (const rel of rels) for (const root of roots) out.push(path.win32.join(root, rel));
    return out;
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "microsoft-edge", "microsoft-edge-stable", "brave-browser",
  ];
}

// The flags that make a Chromium behave like an app shell. --app is the
// chromeless window; the dedicated profile dir is load-bearing (see the
// header comment); the two no-* flags stop a fresh profile's first-run tour
// from opening in front of the app.
function buildAppArgs(url, profileDir) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${WINDOW_SIZE}`,
  ];
}

// ---------------------------------------------------------------------------
// Launcher plumbing (not exported; exercised by running the file)
// ---------------------------------------------------------------------------

function findBrowser(candidates, env) {
  for (const cand of candidates) {
    if (path.isAbsolute(cand) || cand.includes(path.sep) || /^[A-Za-z]:\\/.test(cand)) {
      if (fs.existsSync(cand)) return cand;
      continue;
    }
    // Bare command name (Linux): resolve against PATH ourselves — still no
    // dependency, and no shell involved.
    const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      const full = path.join(dir, cand);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server.js exited (code ${child.exitCode}) before it was healthy — see the log above.`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error(`Server did not answer ${url} within ${HEALTH_TIMEOUT_MS / 1000}s.`);
}

function openDefaultBrowser(url) {
  // Fallback when no Chromium-family browser exists: an ordinary tab in
  // whatever the default browser is. `start` needs the empty "" title arg or
  // it treats the URL as the window title.
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

async function main() {
  const opts = parseDesktopArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("CompNinja desktop launcher\n\n" +
      "  node desktop.js                    boot the local server, open the app window\n" +
      "  node desktop.js --url <https://…>  open a hosted CompNinja instead (no local server)\n" +
      "  node desktop.js --port <n>         pin the local server's port (default: a free one)\n" +
      "  node desktop.js --browser <path>   use this Chromium-family binary\n");
    return;
  }
  if (opts.errors.length) {
    for (const err of opts.errors) console.error(`✗ ${err}`);
    process.exitCode = 1;
    return;
  }

  let serverChild = null;
  let url = opts.url;

  if (!url) {
    const port = opts.port || await freePort();
    url = `http://127.0.0.1:${port}/`;
    console.log(`🥷 CompNinja desktop — starting the local server on port ${port}…`);
    // stdio inherit on purpose: the startup banner (provider, wall state,
    // passkey warnings) is the deployment's self-description and the owner
    // should see it here exactly as on Render.
    serverChild = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit",
    });
    try {
      await waitForHealth(`http://127.0.0.1:${port}/healthz`, serverChild);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      if (serverChild.exitCode === null) serverChild.kill();
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`🥷 CompNinja desktop — opening ${url}`);
  }

  const stopServer = () => {
    if (serverChild && serverChild.exitCode === null) serverChild.kill();
  };
  process.on("SIGINT", () => { stopServer(); process.exit(0); });
  process.on("SIGTERM", () => { stopServer(); process.exit(0); });

  const browser = opts.browser || findBrowser(chromiumCandidates(process.platform, process.env), process.env);
  if (!browser) {
    console.log("No Chromium-family browser found (Edge/Chrome/Brave/Chromium) — opening the default browser instead.");
    openDefaultBrowser(url);
    if (serverChild) {
      console.log("Server is running. Press Ctrl+C to stop it.");
      await new Promise((resolve) => serverChild.once("exit", resolve));
    }
    return;
  }
  if (opts.browser && !fs.existsSync(browser)) {
    console.error(`✗ --browser path does not exist: ${browser}`);
    stopServer();
    process.exitCode = 1;
    return;
  }

  const profileDir = path.join(os.homedir(), ".compninja", "desktop-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`Opening the app window (${path.basename(browser)}). Closing it stops the server.`);
  const browserChild = spawn(browser, buildAppArgs(url, profileDir), { stdio: "ignore" });
  browserChild.once("error", (err) => {
    console.error(`✗ Could not launch ${browser}: ${err.message}`);
    stopServer();
    process.exitCode = 1;
  });
  browserChild.once("exit", () => {
    // The window closed (the dedicated profile guarantees this process WAS
    // the window — see the header comment). Take the server down with it.
    stopServer();
  });
}

module.exports = {
  normalizeDesktopUrl,
  parseDesktopArgs,
  chromiumCandidates,
  buildAppArgs,
  WINDOW_SIZE,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}
