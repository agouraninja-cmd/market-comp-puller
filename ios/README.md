# CompNinja for iOS

A native SwiftUI client for the CompNinja API. Not a web view around
compninja.co — see "Why native" below, which is a review requirement, not a
preference.

## Status

| Piece | State |
|---|---|
| `CompNinjaKit` — models, API client, progress stream, offline store, share export | **Written and tested.** 56 tests, `swift test`, green |
| `CompNinja` — the SwiftUI screens | **Compiles and runs.** Verified on the iPhone and iPad simulators 2026-08-28 |
| Xcode project | Generated from `project.yml` by XcodeGen 2.46 (installed) |
| Xcode | **Installed.** 26.6, iOS 26.5 SDK |
| Apple Developer Program account | **Jacob's enrollment is in flight** (notice received 2026-08-28). Nothing ships until the Team ID and the Admin invite arrive |
| App icon | Done — 1024x1024, generated from the brand mark |
| App Store Connect record, screenshots, listing copy, privacy answers | Not started |

Checked 2026-08-28 on Owen's Mac: `swift test` is green (56), the simulator
build succeeds, and `xcodebuild archive` fails on **nothing but the missing
team**. Signing is the last thing standing between this and an upload.

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

One thing: **the Apple Developer Program account**. Jacob is enrolling
COMPNINJA LLC as an organization (his to do — Owen is not on the LLC and
cannot make Apple's binding-authority attestation). Two things come back from
that and both are needed here:

- the **Team ID**, from developer.apple.com → Membership; and
- an **Admin** invite to okb336@gmail.com in App Store Connect (Admin, not App
  Manager — signing certificates expire annually and App Manager cannot
  regenerate them without a round trip through Jacob).

## When the Team ID arrives

Everything below is already set up and verified; this is the whole remaining
sequence.

1. Put the ten-character ID in **`ios/Team.xcconfig`** (one line) and in the
   `teamID` key of **`ios/ExportOptions.plist`**.
2. Sign in to Xcode once: Xcode → Settings → Accounts → the Apple ID that
   accepted Jacob's Admin invite.
3. Register the bundle id `co.compninja.ios` (Xcode does this itself the first
   time it provisions with `-allowProvisioningUpdates`).
4. Archive and export:

   ```
   cd ios && xcodegen generate
   xcodebuild -project CompNinja.xcodeproj -scheme CompNinja \
     -sdk iphoneos -destination 'generic/platform=iOS' \
     -archivePath build/CompNinja.xcarchive archive -allowProvisioningUpdates
   xcodebuild -exportArchive -archivePath build/CompNinja.xcarchive \
     -exportOptionsPlist ExportOptions.plist -exportPath build/export \
     -allowProvisioningUpdates
   ```

5. Upload the `.ipa` with `xcrun altool --upload-app` (or Xcode's Organizer),
   then create the App Store Connect record and fill in the listing.

Without the team, step 4 fails with `Signing for "CompNinja" requires a
development team`. With a team but no signed-in account it fails with
`No profiles for 'co.compninja.ios' were found` — both were reproduced on
2026-08-28, which is how we know nothing else is in the way.

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

None of these need the Apple account, so they can all be done while enrollment
is being verified.

- **Screenshots.** One iPhone size, 6.9" (the iPhone 17 Pro Max simulator).
  No iPad set is needed; see the iPad note below.
- **Listing copy**: name, subtitle, description, keywords, promotional text.
- **A privacy policy URL and a support URL.** compninja.co/privacy exists;
  support has no page yet.
- **Privacy nutrition labels**: the app collects an email address (account) and
  uses location (not stored, not linked to identity).
- **A test account for App Review**, with the credentials in the review notes,
  plus a note explaining the 3.1.3(b) multiplatform position (see the purchase
  rule above) so a reviewer is not left guessing why Pro cannot be bought here.

Two things previously on this list are **done**: the 1024×1024 app icon, and
in-app account deletion (Guideline 5.1.1(v)) — `AccountView.swift` has it.

**No privacy manifest is needed.** `PrivacyInfo.xcprivacy` is required only for
apps calling a required-reason API; the only candidates here are
`FileManager.urls`/`createDirectory`/`removeItem` in `SavedReports.swift`,
none of which are on Apple's list. There is no `UserDefaults` use and no file
timestamp read.

Sign in with Apple is required by 4.8 only if third-party sign-in is offered;
CompNinja uses its own email/password, so this does not apply today.

### iPhone only, decided 2026-08-28

`TARGETED_DEVICE_FAMILY` is `"1"`. Owen's call, and the reason is worth keeping
because the setting looks like a limitation to remove: universal obliges a 13"
iPad screenshot set in App Store Connect and puts the iPad layout in front of
review. Launched on the iPad Pro 13" simulator that layout runs correctly but
reads as a stretched phone, full-width form fields with the bottom two thirds
empty.

Widening back to `"1,2"` later is one line here plus a real iPad layout pass.
Shipping iPhone-only first does not block it.

## Testing it without tapping

Two techniques carried the whole first session, because `simctl` can take
screenshots but cannot inject taps or typing, and the simulator MCP tool
refuses with "Xcode is installed but not selected".

**That refusal has a real cause, found 2026-08-28.** `xcode-select -p` answers
`/Applications/Xcode.app/Contents/Developer`, but that is a fallback: the
persisted link at `/var/db/xcode_select_link` does not exist, and Command Line
Tools are also installed at `/Library/Developer/CommandLineTools`. Writing the
link fixes it, and needs a password:

```
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Until that is run, taps and typing have to go through the two techniques below.

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
