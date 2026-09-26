"use strict";

// CompNinja — the standalone desktop app users download and install.
//
// This is a thin Electron shell around the live site: its own CompNinja.exe /
// .dmg / .AppImage with its own icon, taskbar identity and process — no
// visible browser anywhere. The app deliberately holds NO product code: it
// loads https://compninja.co, so every deploy of the site reaches every
// installed copy instantly and this shell only needs a new release when the
// shell itself changes (rare).
//
// This folder is the ONE place in the repo with npm dependencies, and they
// are dev-only build tools (electron, electron-builder) — the site's
// zero-dependency rule is about server.js and stands. Nothing in here is
// required by, imported by, or tested by the site, except tab-pool.js, which
// is pure and which the root suite tests.
//
// Security posture: every view renders REMOTE content, so each is locked down
// like a browser tab, not a Node app — sandbox on, no nodeIntegration, no
// preload, contextIsolation on. There is no IPC surface at all.
//
// INSTANT TABS (1.1.0, 2026-09-26). Electron has no prerendering, so the
// site's instant tab switching only ever gave the app a head start. The shell
// now does the prerender itself. The page asks for a tab it expects to be
// opened (POST {path, warm} to /api/warm — the same ask Safari makes of the
// server); this shell intercepts that ask, loads the tab in a hidden view, and
// when the page then navigates to that tab, swaps the hidden view in instead
// of loading it. Measured with this file against a local server: a switch
// drops from ~370-465 ms (the 1.0.2 shell) to 12-18 ms. The pieces, in order:
//
//   - The window is a BaseWindow and every page is a WebContentsView, because
//     a finished page cannot be moved into another page's slot. The default
//     menu keeps working: its roles (reload, zoom, copy) act on the FOCUSED
//     web contents, measured on Electron 43, and the view on screen always
//     has focus.
//   - A hidden view is loaded with PRELOAD_HEADER. The site answers that ONLY
//     with a speculative render (visit parked, /vault backfills skipped) that
//     carries a script making `document.prerendering` true until
//     window.__cnShow() — so writes, read/seen stamps and the visit wait for
//     the swap exactly as they do in Chrome's prerender — and with an empty
//     204 for anything else. A view whose page has no __cnShow is never
//     swapped in.
//   - The swap happens only when the page on screen has nothing in
//     sessionStorage. Each view is its own tab to Chromium, so a hidden page
//     booted with an empty sessionStorage, and a page that carried something
//     across a navigation in it (a market page's pending address, an app
//     password) must get an ordinary navigation that keeps it.
//   - A hidden view builds unthrottled, so its deferred drawing is done before
//     the swap rather than at it; it is throttled like any page once shown.
//   - A write on the page (it sends {"drop": true}) throws every hidden view
//     away; each also dies at the page's own TTL. At most MAX_VIEWS are held.

const path = require("path");
const { app, BaseWindow, WebContentsView, session, shell } = require("electron");
const POOL = require("./tab-pool");

const APP_URL = process.env.COMPNINJA_URL || "https://compninja.co/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PAPER = "#FBFBF9"; // the site's paper — no white flash before first paint

// Windows only in practice, harmless elsewhere: Chromium's native window
// occlusion tracker on Windows can decide this window is covered when it is
// not, and a window it calls occluded stops painting -- the DOM is complete,
// DevTools can screenshot it, and the user sees the bare paper background.
// Seen on the owner's machine on 2026-09-16: every page blank after a
// navigation or a resize, surviving a full relaunch and --disable-gpu; the
// same build painted every page once launched with this switch. Must be set
// before the app is ready.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// How the site knows a page is being viewed from inside this app. Electron
// reports `display-mode: browser` (measured, Electron 43), so the media query
// an installed PWA answers to does NOT fire here and the user agent is the
// only honest signal. The site hides its "Download the app" link on seeing
// this token; server.js declares the same string as INAPP_UA_TOKEN and
// test/inapp-nav.test.js fails the build if the two ever drift, because a
// rename on one side alone breaks nothing loudly — the link simply comes
// back. Appended rather than replacing the UA, so nothing that sniffs for
// Chrome/Electron stops working.
const UA_TOKEN = "CompNinjaDesktop/1";

// Where navigation may stay inside the app window. Everything else opens in
// the system browser — a support article or a comp's source_url should not
// take over the app frame. Stripe is in-window on purpose: Pro checkout and
// the billing portal are redirects to *.stripe.com that must complete and
// then bounce back to compninja.co, and breaking out to a browser mid-payment
// would strand the return trip in the wrong place.
function inAppHost(rawUrl) {
  let host;
  try { host = new URL(rawUrl).hostname; } catch { return false; }
  const appHost = new URL(APP_URL).hostname;
  return (
    host === appHost || host.endsWith("." + appHost) ||
    host === "compninja.co" || host.endsWith(".compninja.co") ||
    host === "stripe.com" || host.endsWith(".stripe.com")
  );
}

let win = null;
let active = null;  // the view on screen
let pending = null; // { entry, url, timer }: a click waiting on a view still loading
const pool = POOL.createPool({ max: POOL.MAX_VIEWS });

function fullBounds() {
  const [width, height] = win.getContentSize();
  return { x: 0, y: 0, width, height };
}

function closeView(view) {
  try { win && win.contentView.removeChildView(view); } catch (_) {}
  try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch (_) {}
}

function makeView(hidden) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden view is not throttled while it builds: throttled, its timers
      // and animation frames wait, and the workspace then did its deferred
      // drawing at the moment of the swap (13-80 ms; 12-18 ms unthrottled,
      // measured). swapTo() turns throttling back on once it is on screen.
      ...(hidden ? { backgroundThrottling: false } : {}),
    },
  });
  view.setBackgroundColor(PAPER);
  const wc = view.webContents;
  wc.setUserAgent(`${wc.getUserAgent()} ${UA_TOKEN}`);

  wc.setWindowOpenHandler(({ url }) => {
    if (inAppHost(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (event, url) => {
    if (!inAppHost(url) && !url.startsWith("file:")) {
      event.preventDefault();
      shell.openExternal(url);
      return;
    }
    if (view === active) trySwap(event, url);
  });

  // No network at launch (or the site unreachable) must show OUR page with a
  // Try again button, not Chromium's grey error text inside a CompNinja frame.
  // -3 (ABORTED) fires on ordinary in-app redirects/cancelled loads; it is
  // not an outage and reloading on it would interrupt real navigation. A
  // hidden view that fails is simply thrown away.
  wc.on("did-fail-load", (_event, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (view === active) wc.loadFile(path.join(__dirname, "offline.html"), { query: { to: APP_URL } });
    else {
      const entry = pool.values().find((e) => e.view === view);
      if (entry) discard(entry);
    }
  });

  wc.on("page-title-updated", (_event, title) => {
    if (view === active && win) win.setTitle(title);
  });

  view.setBounds(fullBounds());
  return view;
}

// --- The hidden views --------------------------------------------------------

function discard(entry) {
  pool.remove(entry);
  clearTimeout(entry.timer);
  if (pending && pending.entry === entry) navigatePendingNormally();
  closeView(entry.view);
}

function discardAll() {
  for (const entry of pool.values()) discard(entry);
}

function expireIn(entry, ms) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => discard(entry), ms);
}

function build(tabPath, warm) {
  if (!win || !active) return;
  const ttl = warm ? POOL.WARM_TTL_MS : POOL.TTL_MS;
  const had = pool.get(tabPath);
  if (had) {
    // Asked again, or promoted to the warm tab: it lives the longer clock.
    if (warm && !had.warm) { had.warm = true; expireIn(had, ttl); }
    return;
  }
  if (POOL.swapPath(active.webContents.getURL(), APP_ORIGIN) === tabPath) return;

  const view = makeView(true);
  view.setVisible(false);
  win.contentView.addChildView(view, 0); // beneath the page on screen
  const entry = { path: tabPath, warm, view, ready: false, timer: null };
  for (const evicted of pool.add(entry)) discard(evicted);
  expireIn(entry, ttl);

  // Ready means the site answered with the guarded page: it defines
  // window.__cnShow. A 204 (the site refusing) never gets here, and a page
  // without it is never shown from a hidden view.
  view.webContents.once("dom-ready", () => {
    view.webContents.executeJavaScript("typeof window.__cnShow === 'function'")
      .then((ok) => {
        if (pool.get(tabPath) !== entry) return;
        if (!ok) return discard(entry);
        entry.ready = true;
        if (pending && pending.entry === entry) {
          clearTimeout(pending.timer);
          pending = null;
          swapTo(entry);
        }
      })
      .catch(() => discard(entry));
  });
  view.webContents.loadURL(APP_ORIGIN + tabPath, {
    extraHeaders: `${POOL.PRELOAD_HEADER}: 1\n`,
    httpReferrer: active.webContents.getURL(),
  });
}

// --- The swap ----------------------------------------------------------------

function trySwap(event, url) {
  if (pending) { clearTimeout(pending.timer); pending = null; }
  const tabPath = POOL.swapPath(url, APP_ORIGIN);
  const entry = tabPath && pool.get(tabPath);
  if (!entry) return; // nothing built: an ordinary navigation
  event.preventDefault();
  const from = active;
  from.webContents.executeJavaScript("sessionStorage.length")
    .catch(() => -1)
    .then((n) => {
      if (from !== active) return;
      if (n !== 0 || pool.get(tabPath) !== entry) {
        // Something rides this tab's sessionStorage into the next page, which
        // a hidden view never saw: keep it, with the navigation it asked for.
        discard(entry);
        from.webContents.loadURL(url, { httpReferrer: from.webContents.getURL() });
        return;
      }
      if (entry.ready) return swapTo(entry);
      // Still loading: the page on screen stays up, as during any navigation,
      // and the built one takes over the moment it is ready.
      pending = { entry, url, timer: setTimeout(navigatePendingNormally, POOL.READY_WAIT_MS) };
    });
}

function navigatePendingNormally() {
  if (!pending) return;
  const { entry, url } = pending;
  clearTimeout(pending.timer);
  pending = null;
  if (pool.remove(entry)) { clearTimeout(entry.timer); closeView(entry.view); }
  if (active) active.webContents.loadURL(url, { httpReferrer: active.webContents.getURL() });
}

function swapTo(entry) {
  pool.remove(entry);
  clearTimeout(entry.timer);
  const old = active;
  const view = entry.view;
  // Active FIRST: the page asks for its own next tab once shown, and only
  // asks from the view on screen are acted on.
  active = view;
  view.setBounds(fullBounds());
  view.setVisible(true);
  win.contentView.addChildView(view); // re-adding raises it to the top
  view.webContents.setBackgroundThrottling(true);
  view.webContents.focus();
  win.setTitle(view.webContents.getTitle() || "CompNinja");
  view.webContents.executeJavaScript("window.__cnShow && window.__cnShow()").catch(() => {});
  if (old) closeView(old);
}

// --- The page's asks ---------------------------------------------------------

// Every POST to /api/warm is the page talking to THIS shell: cancelled here,
// so the server never builds a second copy nobody would use (the hidden
// view's own request builds the one that is used). Only the page on screen
// is listened to — a hidden page does not ask until it is shown.
function listenForAsks() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`${APP_ORIGIN}${POOL.WARM_PATH}`] },
    (details, callback) => {
      callback({ cancel: true });
      if (details.method !== "POST" || !active) return;
      if (details.webContentsId && details.webContentsId !== active.webContents.id) return;
      const part = details.uploadData && details.uploadData[0];
      const signal = POOL.parseSignal(part && part.bytes ? part.bytes.toString("utf8") : "");
      if (!signal) return;
      if (signal.drop) discardAll();
      else build(signal.path, signal.warm);
    }
  );
}

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 860,
    backgroundColor: PAPER,
    autoHideMenuBar: true,      // default menu stays reachable via Alt (reload, zoom)
    icon: path.join(__dirname, "build", "icon.png"), // Linux/dev window icon; packaged Win/mac use built resources
  });

  active = makeView();
  win.contentView.addChildView(active);

  const fit = () => {
    const bounds = fullBounds();
    if (active) active.setBounds(bounds);
    for (const entry of pool.values()) entry.view.setBounds(bounds);
  };
  win.on("resize", fit);
  win.on("focus", () => { if (active) active.webContents.focus(); });
  // A view's web contents outlive the window unless closed — and on macOS the
  // app keeps running with no window, so they would leak renderers.
  win.on("closed", () => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    for (const entry of pool.values()) {
      pool.remove(entry);
      clearTimeout(entry.timer);
      try { entry.view.webContents.close(); } catch (_) {}
    }
    try { if (active) active.webContents.close(); } catch (_) {}
    win = null;
    active = null;
  });

  active.webContents.loadURL(APP_URL);
  active.webContents.focus();
  return win;
}

// Second launch focuses the existing window instead of opening a sibling —
// double-clicking the desktop icon twice should never make two apps.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const existing = BaseWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    listenForAsks();
    createWindow();
    // macOS: clicking the dock icon with no windows open reopens one.
    app.on("activate", () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
