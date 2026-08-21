#!/usr/bin/env node
// Screenshot a CompNinja page — and, with --before, the same page as it looked
// before the current change, so a design edit can be shown rather than
// described.
//
// WHY THIS EXISTS. Every design change in this repo used to be reviewed by
// reading a diff of `index.html` or a template literal in `vault-page.js`,
// which says what the markup now is and nothing about what the page now looks
// like. The standing rule in CLAUDE.md ("Design changes: before and after")
// is the policy; this file is the one command that makes obeying it cheap.
//
// ZERO DEPENDENCIES, like everything else outside desktop-app/. It drives a
// Chromium that the machine already has (see desktop.js's header for why that
// assumption holds) over the DevTools protocol using Node's built-in
// WebSocket, and falls back to Chromium's own --screenshot flag on a Node too
// old to have one.
//
// THE HARD PART IS THE "BEFORE". It has to be rendered from the pre-change
// code, and this repo's checkout is routinely shared with another session
// (see CLAUDE.md "Working alongside another session"), so `git stash` is the
// one tool that must NOT be used here: it moves files under the other
// session mid-edit. --before instead adds a DETACHED worktree at the
// comparison ref, boots a second server there, shoots the same paths, and
// removes the worktree again. Detached because git refuses to check out one
// branch in two worktrees, and a comparison needs no branch of its own.
//
// BOTH SERVERS ARE BOOTED WITH SUPABASE BLANKED, deliberately and explicitly.
// A screenshot run is a scratch server; pointed at the real database it would
// write into production's corpus, market pages and cache exactly as the eval
// runner would (CLAUDE.md says the same thing at more length about run-eval).
// Blanking is done by assigning "" in the child's env rather than by deleting
// the keys, because server.js's .env loader fills any var that is `undefined`
// and would helpfully restore the real ones.
//
// Usage:
//   node scripts/shot.js /how-it-works
//   node scripts/shot.js / /markets /brokers          several pages in one boot
//   node scripts/shot.js /how-it-works --before       vs origin/main
//   node scripts/shot.js /how-it-works --before HEAD~1
//   node scripts/shot.js / --size 390x844             a phone-width capture
//   node scripts/shot.js / --env ACCOUNT_WALL=off     signed-out app, not the landing page
//   node scripts/shot.js /markets --viewport          just the fold, not the whole page
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

// findBrowser and the per-platform candidate list are desktop.js's, reused
// rather than copied — a second copy of "where is Chromium on Windows" is a
// second thing to keep in step, and this repo already carries one such pair
// under a ⚠ (compWeight) as the cautionary tale.
const { chromiumCandidates, findBrowser } = require("../desktop.js");

const REPO = path.join(__dirname, "..");
const DEFAULT_SIZE = { width: 1280, height: 900 };
const DEFAULT_REF = "origin/main";
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_POLL_MS = 300;
const SETTLE_MS = 900;          // after load: webfonts, the theme boot, late paint
const MAX_CAPTURE_PX = 20000;   // a runaway page must not produce a 400MB PNG

// ---------------------------------------------------------------------------
// Pure helpers (exported for test/shot.test.js)
// ---------------------------------------------------------------------------

// A page path, not a URL: this tool only ever shoots the server it just
// booted, so an absolute URL would either be ignored or point somewhere the
// comparison cannot be made. Refused rather than guessed at.
function normalizeShotPath(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null; // http:, file:, javascript:
  if (trimmed.startsWith("//")) return null;                  // protocol-relative
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

// "1280x900" -> {width, height}. Both must be present: a lone width would have
// to invent a height, and the height is what decides whether a --viewport shot
// shows the fold or half of it.
function parseSize(raw) {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(raw || "").trim());
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

// The file name a path is shot into. Kept flat and readable — "/market/
// industrial-boise-id" becomes "market-industrial-boise-id" — because these
// are read by a person comparing two of them side by side, not by a program.
function slugForPath(pathname) {
  const cleaned = String(pathname || "/").split("?")[0].replace(/^\/+|\/+$/g, "");
  const slug = cleaned.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "home";
}

function parseShotArgs(argv) {
  const out = {
    paths: [], before: null, size: { ...DEFAULT_SIZE }, out: null, browser: null,
    fullPage: true, expand: false, keep: false, help: false, env: {}, settleMs: SETTLE_MS, errors: [],
  };
  const args = Array.isArray(argv) ? argv.slice() : [];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--before") {
      // The ref is optional: `--before` alone means origin/main. A following
      // token that starts with "-" is the next flag, not a ref.
      const next = args[0];
      if (next && !next.startsWith("-")) out.before = args.shift();
      else out.before = DEFAULT_REF;
      continue;
    }
    if (arg === "--size") {
      const size = parseSize(args.shift());
      if (!size) out.errors.push("--size needs WIDTHxHEIGHT, e.g. --size 1280x900");
      else out.size = size;
      continue;
    }
    if (arg === "--out") {
      const dir = args.shift();
      if (!dir) out.errors.push("--out needs a directory");
      else out.out = dir;
      continue;
    }
    if (arg === "--browser") {
      const bin = args.shift();
      if (!bin) out.errors.push("--browser needs a path to a Chromium-family binary");
      else out.browser = bin;
      continue;
    }
    if (arg === "--settle") {
      const n = Number(args.shift());
      if (!Number.isFinite(n) || n < 0 || n > 60000) out.errors.push("--settle needs milliseconds between 0 and 60000");
      else out.settleMs = n;
      continue;
    }
    if (arg === "--env") {
      const pair = args.shift() || "";
      const eq = pair.indexOf("=");
      if (eq < 1) out.errors.push(`--env needs KEY=VALUE (got "${pair}")`);
      else out.env[pair.slice(0, eq)] = pair.slice(eq + 1);
      continue;
    }
    if (arg === "--expand") { out.expand = true; continue; }
    if (arg === "--viewport") { out.fullPage = false; continue; }
    if (arg === "--full") { out.fullPage = true; continue; }
    if (arg === "--keep") { out.keep = true; continue; }
    if (arg.startsWith("-")) { out.errors.push(`Unknown flag ${arg}`); continue; }
    const p = normalizeShotPath(arg);
    if (!p) out.errors.push(`"${arg}" is not a page path — pass /how-it-works, not a full URL`);
    else out.paths.push(p);
  }
  if (!out.paths.length && !out.help) out.errors.push("Nothing to shoot — pass at least one page path, e.g. /how-it-works");
  return out;
}

// The env a scratch server is booted with. Blanked by ASSIGNMENT, never by
// delete: server.js's .env loader fills anything `undefined`, so deleting the
// Supabase keys here would restore the real ones from .env — the same trap
// CLAUDE.md documents for the eval runner on Windows.
function shotServerEnv(baseEnv, port, overrides) {
  return {
    ...baseEnv,
    SUPABASE_URL: "",
    SUPABASE_SERVICE_KEY: "",
    // Overrides come LAST so `--env SUPABASE_URL=...` can deliberately put a
    // database back. It is the only way to shoot a surface whose content comes
    // out of one (a market page's real figures, /vault, the desk), and main()
    // prints a warning when it happens: the "before" pass runs OLD code
    // against whatever database it is handed, and this repo's write paths
    // swallow their own errors.
    ...overrides,
    PORT: String(port),
  };
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url, child, label) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} server exited (code ${child.exitCode}) before it was healthy.`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(`${label} server did not answer ${url} within ${HEALTH_TIMEOUT_MS / 1000}s.`);
}

function startServer(cwd, port, overrides, label) {
  // process.execPath, never "node" — the owner's Windows Node is portable and
  // not on PATH (desktop.js carries the same rule and the same reason).
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: shotServerEnv(process.env, port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  const keep = (buf) => { log.push(String(buf)); if (log.length > 80) log.shift(); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.serverLog = log;
  child.label = label;
  return child;
}

// Where is a Chromium? An explicit --browser wins; then CN_SHOT_BROWSER; then
// a Playwright-managed one (this is what exists in a Claude Code cloud
// session, and it is not on PATH); then desktop.js's per-platform list.
function resolveBrowser(explicit, env) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`--browser ${explicit} does not exist.`);
    return explicit;
  }
  const fromEnv = env.CN_SHOT_BROWSER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const pwRoot = env.PLAYWRIGHT_BROWSERS_PATH;
  if (pwRoot && fs.existsSync(pwRoot)) {
    const rels = [
      ["chrome-linux", "chrome"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ["chrome-win", "chrome.exe"],
    ];
    const dirs = fs.readdirSync(pwRoot)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse(); // highest build first; headless_shell sorts after chromium-<n>
    for (const dir of dirs) {
      for (const rel of rels) {
        const full = path.join(pwRoot, dir, ...rel);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  const found = findBrowser(chromiumCandidates(process.platform, env), env);
  if (!found) {
    throw new Error(
      "No Chromium-family browser found. Install Chrome/Edge/Chromium, or point at one:\n" +
      "  node scripts/shot.js <path> --browser /path/to/chrome\n" +
      "  (or set CN_SHOT_BROWSER)"
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// A very small DevTools protocol client
// ---------------------------------------------------------------------------
//
// Chromium's own --screenshot flag can only capture the viewport, and a design
// review usually wants the whole page. Page.captureScreenshot with
// captureBeyondViewport does that in one shot. Node's built-in WebSocket is
// what makes it dependency-free; on a Node without one, captureViaFlag()
// below is the fallback and the run says so rather than silently shrinking
// what it captured.
class Devtools {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("Could not open a DevTools connection to the browser.")), { once: true });
    });
    const dt = new Devtools(ws);
    ws.addEventListener("message", (ev) => dt.onMessage(ev.data));
    return dt;
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || "DevTools error"}`));
      else resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      const list = this.handlers.get(msg.method) || [];
      for (const fn of list.splice(0)) fn(msg.params || {});
    }
  }

  send(method, params, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const list = this.handlers.get(method) || [];
      list.push(resolve);
      this.handlers.set(method, list);
    });
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

// Chromium writes the port it actually chose (we ask for 0) into
// DevToolsActivePort in the profile dir: line 1 the port, line 2 the browser
// websocket path.
async function readDevtoolsEndpoint(profileDir, child) {
  const file = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The browser exited (code ${child.exitCode}) before it was ready.`);
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      if (lines.length >= 2 && lines[0].trim()) {
        return `ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`;
      }
    } catch { /* not written yet */ }
    await sleep(120);
  }
  throw new Error("The browser never reported a DevTools port.");
}

function launchBrowser(bin, profileDir) {
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--disable-gpu",
    "--force-color-profile=srgb",     // same colours on every machine
    "--font-render-hinting=none",     // and roughly the same text metrics
    "--disable-lcd-text",
    "--force-prefers-reduced-motion", // see captureViaCdp: reveals the fold
  ];
  // Chromium refuses to run as root without this, and CI/cloud sessions are
  // routinely root. Only added when it is actually needed.
  if (process.getuid && process.getuid() === 0) args.push("--no-sandbox");
  return spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
}

async function captureViaCdp(dt, url, size, fullPage, settleMs, expand) {
  const { targetId } = await dt.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await dt.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await dt.send("Page.enable", {}, sessionId);
    await dt.send("Emulation.setDeviceMetricsOverride", {
      width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.width < 700,
    }, sessionId);
    // Reduced motion, and it is load-bearing rather than polite. The
    // server-rendered pages hide their below-the-fold content with
    // `.anim .rv{opacity:0}` and reveal it from an IntersectionObserver
    // (server.js) — which never fires in a beyond-viewport capture, because
    // the viewport never scrolls past the fold. The first version of this
    // script produced /how-it-works with two blank bands where the Method and
    // the FAQ should be. The site already draws the finished page at once
    // under prefers-reduced-motion, so emulating it uses the page's own
    // accessibility path instead of injecting stylesheet overrides that would
    // have to know each surface's class names.
    await dt.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    }, sessionId).catch(() => { /* older Chromium: the flag below still applies */ });

    const loaded = dt.once("Page.loadEventFired");
    await dt.send("Page.navigate", { url }, sessionId);
    await Promise.race([loaded, sleep(30000)]);
    await sleep(settleMs);

    if (expand) {
      // Collapsed content is invisible to a screenshot, and this site puts
      // real copy inside <details>: the FAQ accordions on / and /how-it-works
      // and /brokers, the vault's three `dbox` panels, the uploader's
      // "Required columns & privacy details". A change to any of it produces
      // two identical pictures otherwise — which reads as "nothing changed"
      // rather than "you photographed a closed drawer". Kept off by default,
      // because the closed state is what a visitor actually sees.
      await dt.send("Runtime.evaluate", {
        expression: "document.querySelectorAll('details').forEach(function(d){d.open=true});true",
      }, sessionId).catch(() => { /* no <details> here, or evaluation refused */ });
      await sleep(250); // the accordions animate open
    }

    let clip;
    if (fullPage) {
      const metrics = await dt.send("Page.getLayoutMetrics", {}, sessionId);
      const content = metrics.cssContentSize || metrics.contentSize;
      clip = {
        x: 0, y: 0,
        width: size.width,
        height: Math.min(Math.max(Math.ceil(content.height), size.height), MAX_CAPTURE_PX),
        scale: 1,
      };
    }
    const shot = await dt.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: Boolean(fullPage),
      ...(clip ? { clip } : {}),
    }, sessionId);
    return Buffer.from(shot.data, "base64");
  } finally {
    await dt.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// Fallback for a Node with no global WebSocket: Chromium's own flag. Viewport
// only — the run prints that, because a silently cropped "after" compared
// against a full "before" is worse than no picture.
function captureViaFlag(bin, url, size, outFile, settleMs) {
  const args = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--force-prefers-reduced-motion",
    `--virtual-time-budget=${Math.max(2000, settleMs + 2000)}`,
    `--window-size=${size.width},${size.height}`,
    `--screenshot=${outFile}`,
    url,
  ];
  if (process.getuid && process.getuid() === 0) args.push("--no-sandbox");
  const res = spawnSync(bin, args, { encoding: "utf8" });
  if (!fs.existsSync(outFile)) {
    throw new Error(`Chromium wrote no screenshot for ${url}:\n${(res.stderr || "").trim().split("\n").slice(-5).join("\n")}`);
  }
}

// ---------------------------------------------------------------------------
// One pass: boot a server in `cwd`, shoot every path, tear the server down
// ---------------------------------------------------------------------------

async function shootPass({ cwd, paths, size, fullPage, expand, settleMs, outDir, suffix, browserBin, envOverrides, label }) {
  const port = await freePort();
  const server = startServer(cwd, port, envOverrides, label);
  const written = [];
  let browser = null;
  let dt = null;
  let profileDir = null;
  try {
    await waitForHealth(`http://127.0.0.1:${port}/healthz`, server, label);

    const useCdp = typeof WebSocket === "function";
    if (useCdp) {
      profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-shot-profile-"));
      browser = launchBrowser(browserBin, profileDir);
      dt = await Devtools.attach(await readDevtoolsEndpoint(profileDir, browser));
    } else {
      console.warn("! This Node has no global WebSocket — falling back to viewport-only captures.");
    }

    for (const pathname of paths) {
      const url = `http://127.0.0.1:${port}${pathname}`;
      const file = path.join(outDir, `${slugForPath(pathname)}${suffix}.png`);
      if (dt) fs.writeFileSync(file, await captureViaCdp(dt, url, size, fullPage, settleMs, expand));
      else captureViaFlag(browserBin, url, size, file, settleMs);
      written.push({ pathname, file });
      console.log(`  ${label}  ${pathname}  ->  ${path.relative(REPO, file)}`);
    }
    return written;
  } catch (err) {
    const tail = (server.serverLog || []).join("").trim().split("\n").slice(-8).join("\n");
    if (tail) err.message += `\n\n--- last lines from the ${label} server ---\n${tail}`;
    throw err;
  } finally {
    if (dt) dt.close();
    if (browser) browser.kill();
    server.kill();
  }
}

// ---------------------------------------------------------------------------
// The "before" worktree
// ---------------------------------------------------------------------------

function git(args, opts) {
  const res = spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8", ...opts });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${(res.stderr || "").trim()}`);
  return (res.stdout || "").trim();
}

// A DETACHED worktree: git refuses to check out one branch in two worktrees,
// and a comparison needs no branch of its own. Never `git stash` — this
// checkout is routinely shared with another session.
function addBeforeWorktree(ref) {
  let resolved;
  try { resolved = git(["rev-parse", "--verify", `${ref}^{commit}`]); }
  catch { throw new Error(`"${ref}" is not a commit this checkout knows. Try: git fetch origin`); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-shot-before-"));
  fs.rmSync(dir, { recursive: true, force: true }); // git wants to create it itself
  git(["worktree", "add", "--detach", dir, resolved]);
  return { dir, resolved };
}

function removeBeforeWorktree(dir) {
  try {
    git(["worktree", "remove", "--force", dir]);
    git(["worktree", "prune"]);
  } catch (err) {
    console.warn(`! Could not remove the comparison worktree at ${dir}: ${err.message}`);
    console.warn("  Clean it up with: git worktree remove --force " + dir);
  }
}

// ---------------------------------------------------------------------------

const USAGE = `
Screenshot a CompNinja page, before and after a design change.

  node scripts/shot.js <path> [<path>...] [options]

  node scripts/shot.js /how-it-works
  node scripts/shot.js / /markets /brokers
  node scripts/shot.js /how-it-works --before            compare against ${DEFAULT_REF}
  node scripts/shot.js /how-it-works --before HEAD~1
  node scripts/shot.js / --size 390x844                  phone width
  node scripts/shot.js / --env ACCOUNT_WALL=off          the app, not the landing page

Options:
  --before [ref]   also shoot the page as of <ref> (default ${DEFAULT_REF}), in a
                   throwaway detached worktree
  --size WxH       viewport size (default ${DEFAULT_SIZE.width}x${DEFAULT_SIZE.height})
  --expand         open every <details> first (FAQ accordions, vault panels)
  --viewport       capture the fold only, not the whole page
  --out <dir>      where the PNGs go (default screenshots/)
  --env K=V        an env var for the scratch server (repeatable)
  --browser <path> a Chromium-family binary to drive
  --settle <ms>    wait this long after load before capturing (default ${SETTLE_MS})
  --keep           leave the comparison worktree in place
`.trim();

async function main() {
  const opts = parseShotArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return; }
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`✗ ${e}`);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(REPO, opts.out || "screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  const browserBin = resolveBrowser(opts.browser, process.env);

  if (opts.env.SUPABASE_URL) {
    console.warn("! A database was passed in with --env. Both servers can WRITE to it,");
    console.warn("  the before pass with old code. Point this at a scratch project, never production.");
  }

  let before = null;
  if (opts.before) before = addBeforeWorktree(opts.before);

  try {
    if (before) {
      console.log(`\nBefore — ${opts.before} (${before.resolved.slice(0, 7)})`);
      await shootPass({
        cwd: before.dir, paths: opts.paths, size: opts.size, fullPage: opts.fullPage, expand: opts.expand,
        settleMs: opts.settleMs, outDir, suffix: "--before", browserBin,
        envOverrides: opts.env, label: "before",
      });
    }
    console.log(`\n${before ? "After — " : ""}working tree`);
    const after = await shootPass({
      cwd: REPO, paths: opts.paths, size: opts.size, fullPage: opts.fullPage, expand: opts.expand,
      settleMs: opts.settleMs, outDir, suffix: before ? "--after" : "", browserBin,
      envOverrides: opts.env, label: before ? "after " : "shot  ",
    });

    console.log(`\n✓ ${after.length * (before ? 2 : 1)} screenshot(s) in ${path.relative(REPO, outDir)}/`);
    if (!before) console.log("  Add --before to get the same pages as they looked on " + DEFAULT_REF + ".");
  } finally {
    if (before && !opts.keep) removeBeforeWorktree(before.dir);
    else if (before) console.log(`  Comparison worktree kept at ${before.dir}`);
  }
}

module.exports = { normalizeShotPath, parseSize, slugForPath, parseShotArgs, shotServerEnv };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n✗ ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}
