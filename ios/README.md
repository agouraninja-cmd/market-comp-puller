# CompNinja for iOS

A native SwiftUI client for the CompNinja API. Not a web view around
compninja.co — see "Why native" below, which is a review requirement, not a
preference.

## Status

| Piece | State |
|---|---|
| `CompNinjaKit` — models, API client, progress stream, offline store, share export | **Written and tested.** 36 tests, `swift test`, green |
| `CompNinja` — the SwiftUI screens | **Written, never compiled.** Needs Xcode |
| Xcode project | Generated from `project.yml`; needs XcodeGen |
| Apple Developer Program account | **Missing.** Nothing ships without it |
| App Store Connect record, icon, screenshots, privacy answers | Not started |

## Build it

```
brew install xcodegen
cd ios && xcodegen generate && open CompNinja.xcodeproj
```

Without Xcode installed you can still run the core suite, which is most of the
logic and all of the risk:

```
cd ios/CompNinjaKit && swift test
```

## What is blocking a submission

1. **Xcode is not installed on this Mac** — only Command Line Tools. Xcode is a
   ~15 GB install from the Mac App Store and needs an Apple ID. Until it is
   there, nothing can be compiled for a device, run in a simulator, or
   archived. `swift test` on the kit works without it.
2. **No Apple Developer Program membership.** $99/year, and enrollment takes a
   few days for identity verification (longer for an organization, which also
   needs a D-U-N-S number). This has to be a person with the payment method and
   the legal identity — the same shape as the Render access Jacob holds.
3. Once both exist: bundle id `co.compninja.ios` gets registered, the team goes
   into `project.yml`, and the app can be archived and uploaded.

## Why native, and not a web view

App Store Review Guideline **4.2 (Minimum Functionality)** rejects apps that
are a repackaged website. An app that loads compninja.co in a `WKWebView` is
the fast path and the most likely rejection, and each round trip with review is
about a week.

The features below are the ones that make this app not-the-website. They are
the argument in the review notes, so removing one is a submission decision, not
a code cleanup:

- **Saved reports work offline.** Every report the phone has run is stored on
  device and opens with no connection. The website cannot do this at all.
- **A real MapKit map** of the comparables, with the subject property marked —
  not the site's map in a frame.
- **Run comps where you're standing.** CoreLocation plus reverse geocoding
  fills in the address of the building you're in front of. Coordinates never
  leave the device: only the resolved street address is sent.
- **The share sheet** hands a full, cited report to anyone in Messages, Mail,
  or Files.
- **The one-minute wait is narrated natively** from the server's progress
  stream — the live web query, comps appearing as they're found.

## The purchase rule — read before adding any button

CompNinja sells Pro for $39 through Stripe. **Guideline 3.1.1** requires
in-app purchases to use Apple's IAP, at 15–30%.

This app takes the **3.1.3(b) multiplatform** route instead: a person who
bought Pro on the web signs in here and gets everything Pro gives them, and the
app never sells the upgrade and **never links out to buy it**. Not a button,
not a "learn more", not a URL in a footer. That is the rule, and it is the
single most common way an app in this position gets rejected.

Two places already implement this and both carry a comment saying so:

- `ReportView.swift` — the locked-comp count is stated, with no upgrade call to
  action beneath it.
- `AccountView.swift` — a free account is told only that "Pro is managed on
  your CompNinja account."

If the business wants to sell Pro inside the app later, that is an IAP
integration and a StoreKit purchase flow, plus a server-side receipt check that
joins the existing entitlement — a real piece of work, not a link.

## Still to do before submitting

- App icon (1024×1024) and screenshots for 6.7" and 5.5" displays
- Privacy nutrition labels: the app collects an email address (account) and
  uses location (not stored, not linked to identity)
- A privacy policy URL and a support URL on the App Store listing
- Account deletion reachable in-app — **required** by Guideline 5.1.1(v) for
  any app with account creation. The web app has this; the iOS app does not yet
  expose it
- Sign in with Apple is required by 4.8 only if third-party sign-in is offered;
  CompNinja uses its own email/password, so this does not apply today
- A test account for App Review, in the review notes

## Testing it without tapping

Two techniques carried the whole first session, because `simctl` can take
screenshots but cannot inject taps or typing, and the simulator MCP tool was
stuck on a stale `xcode-select` check throughout.

**Read the device's own state.** The app writes its store where you can go and
look at it:

```
C=$(xcrun simctl get_app_container booted co.compninja.ios data)
cat "$C/Library/Application Support/saved-reports.json"
```

That is how "the search worked, the app just never navigated to the report"
was diagnosed, and it turns real reports into test data.

**Compile the kit into a throwaway harness.** The kit is plain Swift with no
iOS dependencies, so it runs on the Mac:

```
swiftc -O ios/CompNinjaKit/Sources/CompNinjaKit/*.swift main.swift -o harness
```

Top-level code has to live in a file literally named `main.swift`. This drives
`APIClient` and `ReportExport` directly against a running server, and it is
what exercised the streaming path end to end and found the progress-bar
defect that 52 passing tests had not.

Two things to know before pointing a harness at a server. Production answers
`signin_required` after the single free guest search, so use a local one. And
`.env` carries no `GEMINI_API_KEY` while the server defaults to `gemini`, so a
local run needs `SEARCH_PROVIDER=anthropic`:

```
PORT=3250 ACCOUNT_WALL=off SEARCH_PROVIDER=anthropic node server.js
```

Note that this exercises a different search provider than production, so the
report CONTENT differs. The stream shape does not, which is the part under test.

## How this talks to the server

No server changes were needed. The client uses the same endpoints the browser
does:

| Call | Endpoint |
|---|---|
| Run a report (SSE progress) | `POST /api/comps` with `stream: true` |
| Session | `POST /api/account/login`, `/signup`, `/logout`, `GET /api/account/me` |

Auth is the existing `cn_session` cookie — HttpOnly, SameSite=Lax, 90 days —
carried by `URLSession`'s own cookie store, so the app never holds the token.

Error copy is the **server's**, never a local rewrite: `APIError` carries
whatever sentence the server sent, and the guest search cap's `signin_required`
answer opens sign-in with the server's own wording. Two clients telling
different stories about the same failure is a bug report waiting to happen.
