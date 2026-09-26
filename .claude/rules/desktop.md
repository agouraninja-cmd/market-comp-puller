---
paths:
  - "desktop.js"
  - "desktop-app/**"
  - "manifest.webmanifest"
  - "scripts/install-desktop-shortcut.ps1"
  - "test/desktop.test.js"
  - "test/desktop-app.test.js"
  - "test/inapp-nav.test.js"
  - "test/manifest.test.js"
  - "test/download-page.test.js"
---
# The desktop app and the installable web app

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

### Desktop app (`desktop.js`)

```bash
npm run desktop                          # local server + chromeless app window
node desktop.js --url https://compninja.co   # hosted site as an app window, no local server
```

A zero-dependency launcher, **deliberately not Electron** — the no-npm-deps
rule covers it, and every target machine already ships a Chromium (Edge is
preinstalled on Windows). It boots the ordinary `server.js` on a **free
port, never 3000** (so it can run beside `npm start`), waits for `/healthz`,
then opens a Chromium-family browser in `--app` mode. Three rules from its
header comment: children spawn from `process.execPath`, never the string
`"node"` (the owner's portable Node is not on PATH); the app window gets its
**own `--user-data-dir`** (`~/.compninja/desktop-profile`) — without one
Chromium hands the URL to an existing instance and exits, leaving no process
to wait on, so the server would die under an open window; and closing the
window stops the server. Flags are refused, never guessed (`--ur`, a
non-http `--url`, `--port` combined with `--url` are all errors). Pure
helpers are tested in `test/desktop.test.js`, and requiring the module
starts nothing (`require.main` guard).
`scripts/install-desktop-shortcut.ps1` creates the Windows shortcut (repo
favicon as icon, portable-Node lookup, `-Url` for the hosted variant,
`-StartMenu` for a Start Menu copy).

**The standalone downloadable app lives in `desktop-app/`** (2026-08-20) —
an Electron shell around https://compninja.co with its own installer,
icon, and process: no visible browser anywhere, which is what the owner
asked for after the PWA still carried Chrome's chrome. It holds NO product
code (every deploy of the site reaches installed copies instantly) and is
**the one folder in the repo with npm dependencies** — dev-only build
tools, in their own package.json; the site's zero-dep rule is about
server.js and stands, and root `npm test`/`npm start` never touch this
folder. The window is locked down like a browser tab (sandbox, no
nodeIntegration, no preload, no IPC); navigation stays in-window only for
compninja.co and *.stripe.com (checkout must complete and return),
everything else opens the system browser; an unreachable site shows the
branded `offline.html`, never Chromium's grey error. Installers build on a
`desktop-v*` tag via `.github/workflows/desktop-release.yml` (create the
release once, then a 3-OS matrix attaches `CompNinja-Setup.exe` /
`CompNinja.dmg` / `CompNinja.AppImage` — version-less artifact names on
purpose, so `releases/latest/download/…` URLs are stable; keep them in
step with the /download page). Cut a release:
`git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`. The installers
are **unsigned** until the owner buys a Windows code-signing cert and
Apple notarization ($99/yr) — first-run SmartScreen/Gatekeeper warnings
are expected and the /download page says so honestly.

**Instant tabs in the app (1.1.0, 2026-09-26; `desktop-app/tab-pool.js`,
`test/desktop-app.test.js`).** Electron has no prerendering: measured on
Electron 43, a speculation rule makes it fetch the HTML and stop (never
`prerendered`, even after a 1.5 s hover), so the site's instant tab
switching gave the app only a head start (~370-465 ms a switch). The shell
now prerenders by hand, and measured the same way a switch takes 12-18 ms.
How it fits together (the site's half is instant-nav.js, THE DESKTOP APP):
- **The window is a `BaseWindow` and every page a `WebContentsView`**, one
  factory (`makeView`) so no view skips the lockdown. Still no preload and
  no IPC. The default menu keeps working: its roles act on the focused web
  contents (measured), and the view on screen always has focus.
- **The page asks; the shell builds.** In the app the page takes the warm
  path (its script sees the UA token), so pointing at a tab or the likely
  next tab POSTs `{path, warm}` to `/api/warm`. The shell intercepts that
  request (`webRequest.onBeforeRequest`, cancelled so the server never
  builds an unused copy), loads the tab in a hidden view with
  `x-cn-desktop-preload: 1`, and on `will-navigate` to that tab swaps the
  view in. After a write the page sends `{"drop": true}` and the shell
  throws every built view away; each also dies at the page's TTL; at most
  `MAX_VIEWS` (3) are held, pointed-at tabs evicted before the warm one.
- **A hidden view only ever holds the guarded page.** The site answers the
  header only through its warm store, with a script first in `<head>` that
  makes `document.prerendering` true until the shell calls
  `window.__cnShow()` — so writes, read/seen stamps and the visit wait for
  the swap exactly as in Chrome — and with an empty 204 otherwise. The shell
  swaps in only a view whose page defines `__cnShow`.
- **The swap happens only when the page on screen has an empty
  sessionStorage.** Each view is its own tab to Chromium, so a hidden page
  booted with none; a page carrying something across the navigation (a
  market page's pending address, an app password) gets an ordinary
  navigation instead. A click on a tab still loading keeps the old page up
  (as any navigation would) and swaps when it is ready, or navigates
  normally after 5 s.
- **Hidden views build unthrottled** (`backgroundThrottling: false`, back on
  once shown): throttled, the workspace did its deferred drawing at the
  moment of the swap (13-80 ms instead of 12-18).
- **Testing it:** `npx electron desktop-app/main.js` with `COMPNINJA_URL` at a
  local server works under `xvfb-run`; as with Chrome, measure with no
  DevTools attached. An installed copy only gets this from a new installer:
  the app has no auto-update, and `desktop-v1.1.0` is the first release
  with it.

**A door you are already through is hidden** (2026-08-20; `INAPP_BOOT` /
`INAPP_UA_TOKEN` in server.js, `test/inapp-nav.test.js`). Inside the desktop
app or an installed PWA, the Explore menu drops "Download the app". Nothing
detects an app INSTALLED on the machine — browsers refuse to answer that and
any attempt is a guess; what is knowable is whether THIS page is being viewed
from inside the app. **Two signals, because one is not enough**: an installed
PWA matches `display-mode: standalone`, but Electron reports
`display-mode: browser` (measured via CDP, Electron 43) and is identifiable
only by the UA token `desktop-app/main.js` appends — the test fails the build
if the two spellings drift, since a rename on one side alone just quietly
brings the link back inside the shipped app. One constant carries the script
AND its CSS into all three surfaces (marketShell, the landing render, and
index.html via an `<!--INAPP_BOOT-->` marker replaced at serve time like
NAV_LINKS — never a hand-copy, THEME_BOOT being the cautionary tale). It runs
inline in `<head>` so the link is never painted then snatched away, and
`!important` is load-bearing for the `.hdr nav [hidden]` reason: `.hdr nav
.dd a` sets `display:block` at higher specificity, as does the app menu's
Tailwind `block`. Presentation only — `/download` itself stays reachable.

**Users can also install from the site itself** (2026-08-20) — `desktop.js`
is the owner/dev door; the site is an installable web app (PWA).
`manifest.webmanifest` + `icon-192/512/icon-maskable-512.png` (all on the
`STATIC_FILES` allowlist, served without a session so the wall never blocks
install) make Chrome/Edge offer "Install CompNinja" from the address bar,
and index.html's footer carries an "Install the desktop app" button that
ships `hidden` and is revealed only by `beforeinstallprompt` — the
Buy-button rule: a control that can only fail (already installed,
Safari/Firefox) never renders. There is **deliberately NO service worker**:
installability no longer requires one, and a SW cache could serve
`/valuation.js` stale relative to index.html — the exact failure that
file's `max-age: 0` rule exists to prevent; `test/manifest.test.js` pins
that, the manifest fields, the icon sizes against their real PNG bytes, and
the allowlist entries. There is no installer to host or code-sign anywhere:
"where do users download it" is answered by compninja.co, and installed
copies update themselves because the app IS the live site. (A Microsoft
Store listing can wrap this same manifest via PWABuilder later; nothing
here would change.)
