# CompNinja for iOS

The native shell that puts CompNinja on the App Store. It is a WKWebView onto
compninja.co plus the native layer that App Review's Guideline 4.2 requires —
offline handling, a Face ID lock over the broker vault, the system share
sheet, Universal Links, and correct routing of external links.

**The submission plan, including what only the owner can do, is in
[`docs/IOS-APP-STORE.md`](../docs/IOS-APP-STORE.md). Read that first.**

## Status — read this before trusting a line of it

**This code has never been compiled.** It was written in a Linux container
with no macOS, no Xcode and no Swift toolchain, so nothing here has been
through a compiler, a simulator or a device. Treat it as a reviewed first
draft that encodes the design decisions, not as working software. Expect to
fix small things on first build; the comments explain *why* each piece is
shaped the way it is, which is the part that survives a compiler error.

Everything on the **server** side is different: the `/.well-known/apple-app-site-association`
route, the web app manifest, the service worker and the offline page are all
built, tested and running in the repo's suite.

## Files

| File | What it is |
|---|---|
| `CompNinja/CompNinjaApp.swift` | Entry point. Owns the origin, the vault lock, and Universal Link delivery. |
| `CompNinja/WebShell.swift` | The web view and the native layer around it: external-link routing, pull to refresh, offline detection, the share bridge. |
| `CompNinja/VaultLock.swift` | Face ID / Touch ID over `/vault`. Off until the broker turns it on. |
| `CompNinja/OfflineView.swift` | The native no-connection screen. Not a white screen — that is the classic 4.2 rejection. |
| `CompNinja/Info.plist` | The keys to **merge** into Xcode's generated plist, not a file to drop in. |
| `CompNinja/CompNinja.entitlements` | Associated domains for Universal Links. |

## Creating the Xcode project

There is deliberately **no `.xcodeproj` in this repo.** The format is
generated, fiddly, and impossible to validate without Xcode; a hand-written
one that fails to open would cost more time than it saves. Xcode makes a
correct one in under a minute:

1. **File → New → Project → iOS → App.** Product Name `CompNinja`, Interface
   **SwiftUI**, Language **Swift**. Set the bundle identifier to
   `co.compninja.app` (or your own — just keep it consistent with `IOS_APP_ID`
   on the server).
2. Delete the generated `ContentView.swift` and the generated `<App>.swift`,
   then drag in the four `.swift` files from `CompNinja/`.
3. Merge the keys from `Info.plist` into the target's Info settings.
   `NSFaceIDUsageDescription` is **not optional** — an app that calls
   LocalAuthentication without it is killed by the system the first time the
   vault is opened, which looks exactly like a crash.
4. **Signing & Capabilities → + Capability → Associated Domains**, then add
   `applinks:compninja.co` and `applinks:www.compninja.co`.
5. Add an **App Icon** from `../icons/icon-1024.png`, and two colour assets
   the code names: `LaunchBackground` and an `OfflineMark` image (use
   `../icons/icon-192.png`).
6. Set the deployment target to **iOS 16.0** or later. The code uses
   `UIButton.Configuration` and async `evaluatePolicy`, both of which want a
   modern floor, and iOS 16 covers effectively the whole install base of the
   phones brokers carry.

## Turning Universal Links on

Two halves, and both are required:

- **App:** the Associated Domains capability above.
- **Server:** set `IOS_APP_ID` to `<TeamID>.<bundle id>`
  (e.g. `A1B2C3D4E5.co.compninja.app`) in Render. `server.js` then serves
  `/.well-known/apple-app-site-association`. Unset or malformed, the route
  404s on purpose — an association file naming the wrong team silently breaks
  every link into the app, so no file is better than a wrong one.

Verify with `curl https://compninja.co/.well-known/apple-app-site-association`
and check the startup log line (`📱 iOS Universal Links live for …`). Apple's
CDN caches the file, so append `?mode=developer` while testing on a device
with Developer Mode enabled.

## The share bridge

`WebShell.swift` registers a `share` message handler. Nothing in `index.html`
calls it yet — that is one of the deliberate follow-ups in the plan doc, best
done once the app exists and the call can be tested. When it is wired up, the
web side is:

```js
if (window.webkit?.messageHandlers?.share) {
  window.webkit.messageHandlers.share.postMessage({ title, url });
} else {
  // existing copy-link path
}
```

Feature-detected, so the same code keeps working in every browser.
