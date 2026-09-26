"use strict";

// The desktop app's instant tabs (desktop-app/tab-pool.js + main.js, 1.1.0).
// Electron has no prerendering, so the shell builds tabs in hidden views and
// swaps one in when the page navigates there; instant-nav.js (THE DESKTOP
// APP) is the site's half. main.js needs Electron and is not run here — its
// decisions live in tab-pool.js, which is pure — so this suite tests those,
// holds the constants the two halves share together, and pins the parts of
// main.js a refactor could quietly lose: the lockdown, the header, the
// sessionStorage rule, the readiness check. The real thing was measured in
// Electron 43 against a local server (instant-nav.js and app-shell.md).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const POOL = require("../desktop-app/tab-pool");
const NAV = require("../instant-nav");

const root = path.join(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(root, "desktop-app", "main.js"), "utf8");
const poolSrc = fs.readFileSync(path.join(root, "desktop-app", "tab-pool.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "desktop-app", "package.json"), "utf8"));
const ORIGIN = "https://compninja.co";

test("the shell and the site speak one contract", () => {
  // ⚠ pairs: a rename on one side alone breaks nothing loudly — the app
  // simply stops being instant.
  assert.equal(POOL.WARM_PATH, NAV.WARM_PATH);
  assert.equal(POOL.PRELOAD_HEADER, NAV.DESKTOP_PRELOAD_HEADER);
  assert.equal(POOL.TTL_MS, NAV.TTL_MS);
  assert.equal(POOL.WARM_TTL_MS, NAV.WARM_TTL_MS);
  assert.ok(POOL.MAX_VIEWS >= NAV.MAX_LIVE + 1, "room for every tab the page may ask for, plus its warm one");
  for (const p of NAV.TAB_PATHS) assert.ok(POOL.swapPath(ORIGIN + p, ORIGIN) === p, `${p} must be swappable`);
});

test("a signal is a drop, a tab to build, or nothing", () => {
  assert.deepEqual(POOL.parseSignal('{"drop":true}'), { drop: true });
  assert.deepEqual(POOL.parseSignal('{"path":"/vault","warm":false}'), { path: "/vault", warm: false });
  assert.deepEqual(POOL.parseSignal('{"path":"/desk","warm":true}'), { path: "/desk", warm: true });
  assert.deepEqual(POOL.parseSignal('{"path":"/"}'), { path: "/", warm: false });
  for (const bad of [
    "", "nonsense", "null", "[]", '{"drop":"yes"}', '{"path":5}',
    '{"path":"vault"}', '{"path":"//evil.example/x"}', '{"path":"/vault?x=1"}',
    '{"path":"/vault#a"}', '{"path":"/../etc"}', '{"path":"/Vault"}',
    `{"path":"/${"a".repeat(60)}"}`,
  ]) assert.equal(POOL.parseSignal(bad), null, bad);
});

test("only a plain same-origin path can be swapped", () => {
  assert.equal(POOL.swapPath(ORIGIN + "/vault", ORIGIN), "/vault");
  assert.equal(POOL.swapPath(ORIGIN + "/", ORIGIN), "/");
  for (const bad of [
    ORIGIN + "/desk?settings=1", ORIGIN + "/vault#map", "https://evil.example/vault",
    "http://compninja.co/vault", "file:///C:/offline.html", "not a url", ORIGIN + "/market/boise-id",
  ]) assert.equal(POOL.swapPath(bad, ORIGIN), null, bad);
});

test("the pool evicts a pointed-at tab before the warm one, never the one being added", () => {
  const pool = POOL.createPool({ max: 3 });
  const warm = { path: "/desk", warm: true };
  assert.deepEqual(pool.add(warm), []);
  pool.add({ path: "/vault", warm: false });
  pool.add({ path: "/messages", warm: false });
  const evicted = pool.add({ path: "/permits", warm: false });
  assert.deepEqual(evicted.map((e) => e.path), ["/vault"]);
  assert.ok(pool.get("/desk") === warm, "the warm tab is the one most likely to be opened");
  const onlyWarm = POOL.createPool({ max: 1 });
  onlyWarm.add({ path: "/desk", warm: true });
  assert.deepEqual(onlyWarm.add({ path: "/vault", warm: true }).map((e) => e.path), ["/desk"]);
  assert.equal(onlyWarm.size, 1);
});

test("removing a replaced entry never removes its replacement", () => {
  const pool = POOL.createPool({ max: 3 });
  const first = { path: "/vault", warm: false };
  pool.add(first);
  const second = { path: "/vault", warm: false };
  pool.add(second);
  assert.equal(pool.remove(first), false);
  assert.ok(pool.get("/vault") === second);
  assert.equal(pool.remove(second), true);
  assert.equal(pool.get("/vault"), null);
});

test("tab-pool.js stays pure and ships in the installer", () => {
  assert.ok(!/require\(["']electron["']\)/.test(poolSrc), "the root suite must be able to require it");
  assert.ok(pkg.build.files.includes("tab-pool.js"), "main.js requires it; an installer without it dies at launch");
  assert.match(mainSrc, /require\("\.\/tab-pool"\)/);
});

test("every view stays locked down like a browser tab", () => {
  // Remote content in every view: the posture main.js's header states.
  assert.ok(!/\bpreload\s*:/.test(mainSrc), "no preload script");
  assert.ok(!/ipcMain|ipcRenderer|contextBridge/.test(mainSrc), "no IPC surface");
  assert.match(mainSrc, /sandbox: true/);
  assert.match(mainSrc, /contextIsolation: true/);
  assert.match(mainSrc, /nodeIntegration: false/);
  assert.equal((mainSrc.match(/new WebContentsView\(/g) || []).length, 1, "one view factory, so no view skips the lockdown");
  assert.match(mainSrc, /wc\.setUserAgent\(`\$\{wc\.getUserAgent\(\)\} \$\{UA_TOKEN\}`\)/,
    "every view carries the token: it is what makes the page ask the shell");
});

test("a hidden view is only ever the guarded page, shown only when nothing rides sessionStorage", () => {
  assert.match(mainSrc, /extraHeaders: `\$\{POOL\.PRELOAD_HEADER\}: 1\\n`/,
    "the header is what makes the site answer with the guarded page, or nothing");
  assert.match(mainSrc, /typeof window\.__cnShow === 'function'/, "ready means the guarded page arrived");
  assert.match(mainSrc, /executeJavaScript\("window\.__cnShow && window\.__cnShow\(\)"\)/);
  assert.match(mainSrc, /executeJavaScript\("sessionStorage\.length"\)/);
  assert.match(mainSrc, /if \(from !== active \|\| n !== 0 \|\| pool\.get\(tabPath\) !== entry\)/,
    "a page carrying sessionStorage across the navigation gets an ordinary navigation");
  assert.match(mainSrc, /callback\(\{ cancel: true \}\)/, "the ask is the shell's; the server never builds an unused copy");
  // Cursor Bugbot, PR #343: the newest navigation wins and is never dropped.
  const swap0 = mainSrc.slice(mainSrc.indexOf("function trySwap("), mainSrc.indexOf("function navigatePendingNormally("));
  assert.match(swap0, /const seq = \+\+navSeq;/);
  assert.match(swap0, /if \(seq !== navSeq \|\| !active\) return;/, "a superseded check does nothing");
  assert.match(swap0, /if \(from !== active \|\| n !== 0/, "a latest click whose page moved on is replayed, not dropped");
  assert.match(swap0, /active\.webContents\.loadURL\(url/);
  assert.match(mainSrc, /if \(signal\.drop\) discardAll\(\);/, "a write on the page throws every built tab away");
  const swap = mainSrc.slice(mainSrc.indexOf("function swapTo("));
  assert.ok(swap.indexOf("active = view;") < swap.indexOf("__cnShow"),
    "active before shown: the shown page's own asks must be listened to");
  assert.match(swap, /setBackgroundThrottling\(true\)/, "on screen, it idles like any page again");
});
