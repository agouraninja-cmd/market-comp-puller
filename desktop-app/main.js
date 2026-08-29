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
// required by, imported by, or tested by the site.
//
// Security posture: the window renders REMOTE content, so it is locked down
// like a browser tab, not a Node app — sandbox on, no nodeIntegration, no
// preload, contextIsolation on. There is no IPC surface at all.

const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

const APP_URL = process.env.COMPNINJA_URL || "https://compninja.co/";

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#FBFBF9", // the site's paper — no white flash before first paint
    autoHideMenuBar: true,      // default menu stays reachable via Alt (reload, zoom)
    icon: path.join(__dirname, "build", "icon.png"), // Linux/dev window icon; packaged Win/mac use built resources
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ${UA_TOKEN}`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inAppHost(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!inAppHost(url) && !url.startsWith("file:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // No network at launch (or the site unreachable) must show OUR page with a
  // Try again button, not Chromium's grey error text inside a CompNinja frame.
  win.webContents.on("did-fail-load", (_event, code, _desc, _url, isMainFrame) => {
    // -3 (ABORTED) fires on ordinary in-app redirects/cancelled loads; it is
    // not an outage and reloading on it would interrupt real navigation.
    if (isMainFrame && code !== -3) {
      win.loadFile(path.join(__dirname, "offline.html"), { query: { to: APP_URL } });
    }
  });

  win.loadURL(APP_URL);
  return win;
}

// Second launch focuses the existing window instead of opening a sibling —
// double-clicking the desktop icon twice should never make two apps.
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    // macOS: clicking the dock icon with no windows open reopens one.
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
