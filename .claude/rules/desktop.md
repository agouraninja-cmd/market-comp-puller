---
paths:
  - "desktop.js"
  - "desktop-app/**"
  - "manifest.webmanifest"
  - "scripts/install-desktop-shortcut.ps1"
  - "test/desktop.test.js"
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
