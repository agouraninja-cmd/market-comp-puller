# Putting CompNinja on the App Store

Written 2026-08-19. Two things are true at once and it is worth separating
them at the top:

- **CompNinja is already installable as an app**, today, on every iPhone and
  Android phone, with no Apple involvement and no fee. That shipped in this
  repo and is running.
- **Getting it into the App Store itself needs three things only the owner can
  provide**: an Apple Developer Program membership, a Mac (or a cloud Mac),
  and about a week of review latency. Everything that can be built without
  them is built.

## 1. What shipped

| Piece | State |
|---|---|
| Web app manifest, icon set, standalone launch | Live, tested |
| Service worker + offline page | Live, tested |
| `/.well-known/apple-app-site-association` route (env-gated on `IOS_APP_ID`) | Live, tested |
| iOS wrapper Swift sources | Written, **never compiled** — see `ios/README.md` |
| Xcode project | Not created; Xcode generates a correct one in a minute |

Anyone can install CompNinja right now: on iPhone, Safari → Share → **Add to
Home Screen**; on Android, the browser's install prompt. It gets its own icon,
launches without browser chrome, long-press shortcuts jump to a new report /
My Desk / the vault, and losing signal shows a CompNinja page rather than the
browser's error screen.

**That is a real answer to "make it an app", and for a product with no outside
users yet it may be the whole answer for now.** The store buys discoverability
and credibility; it costs $99/year, a Mac, review cycles on every release, and
a permanent second thing to keep in step. Section 6 is the honest comparison.

## 2. What only the owner can do

1. **Enrol in the Apple Developer Program** — $99/year, at
   developer.apple.com. As an individual it takes a day or two. As
   **CompNinja LLC** it needs a D-U-N-S number, which is free but can take up
   to two weeks, so start it before anything else. Enrol as the LLC: the
   seller name on the store listing is the entity that enrolled, and moving an
   app between accounts later is a support ticket rather than a setting.
2. **Get to a Mac.** Xcode is macOS-only and there is no way around it. Given
   the owner's machine is Windows, the realistic options are a cloud Mac
   (MacStadium, MacinCloud — roughly $25–80/month) or a CI service that builds
   and submits without you owning one at all (**Codemagic** or **Bitrise**,
   both have free tiers that cover an app this size). The CI route is the one
   worth trying first: it is cheaper, it is scriptable, and it removes the Mac
   from every future release rather than just this one.
3. **Decide the bundle id** and set `IOS_APP_ID` in Render to
   `<TeamID>.<bundle id>`.

## 3. Payments — the question that would have killed this, and did not

The obvious blocker for a product that sells $39/month subscriptions through
Stripe is **Guideline 3.1.1**, which historically forced digital subscriptions
through Apple's own in-app purchase at a 15–30% cut, and forbade even *linking*
to a web checkout.

**That changed for the US storefront in May 2025.** Following the court order
in *Epic v. Apple*, Apple amended 3.1.1(a) to state that on the United States
storefront there is no prohibition on buttons, external links or other calls
to action pointing at an outside purchase flow, and **no entitlement is
required** to include one. A US app may carry a "Subscribe on the web" button
that opens a Stripe checkout, and Apple takes no commission on it.

**What this means concretely for CompNinja:** the billing system does not have
to change at all. Stripe stays. The `$39` and `$20` buttons stay. No
StoreKit, no IAP products, no 30%, no reconciliation between two billing
systems. The wrapper opens checkout in a Safari view
(`openExternally` in `WebShell.swift`) so the purchase is unambiguously
external, and the buyer gets the URL bar and padlock they expect when typing a
card number.

Three caveats to hold onto:

- **This is the US storefront only.** Other regions still carry the old
  restrictions in various forms. Ship US-only first — it is a checkbox in App
  Store Connect and it matches where every market page and every comp source
  already is.
- **It is a live legal situation.** The rule exists because of an injunction
  under appeal. Re-read 3.1.1 before submitting rather than trusting this
  paragraph; it is the single assumption here most likely to have moved.
- **Do not also put an IAP in.** Offering both invites the reviewer to compare
  prices, and 3.1.1's price-parity questions are a fight worth not having.

## 4. Guideline 4.2 — the actual risk

The real rejection risk is not payments. It is **4.2, Minimum Functionality**:
*"Your app should include features, content, and UI that elevate it beyond a
repackaged website. If your app is not particularly useful, unique, or
'app-like,' it doesn't belong on the App Store."*

A plain WKWebView pointed at a URL is rejected, reliably. The canonical
failure a reviewer looks for is turning off the network and getting a white
screen.

The wrapper answers this deliberately, and every item below is code that
exists rather than a plan:

| Native capability | Why it is genuinely native |
|---|---|
| **Face ID / Touch ID over the vault** | A broker's private book — off-market deals, client addresses, prices under NDA. On the web it is protected by nothing but an unlocked phone with a live session. The web app *cannot* do this. |
| **Native offline screen** | The exact case 4.2 reviewers test. Branded, retryable, reachable when the web view is what failed. |
| **Universal Links** | A shared report link opens the app on a device that has it, the browser everywhere else. Same link either way. |
| **System share sheet** | A report goes to Messages, Mail, AirDrop — the way a broker actually sends one to a client. |
| **External-link routing** | Comp citations and Stripe checkout open in Safari, so it is clear whose page you are on. |
| **Pull to refresh, back/forward gestures, safe areas** | The app-like handling reviewers check by feel. |

**Strengthen it further before submitting if review pushes back.** The
strongest remaining addition is **push notifications for the watchlist
digest** — that digest currently only goes by email, brokers watch markets
they cannot check daily, and "your Boise industrial watchlist has 3 new comps"
is exactly the kind of thing a phone is for. It is deliberately not built
here: it needs an APNs sending path on the server, a device-token table, and a
migration, and half-building it would have meant client code registering with
a server that cannot answer. It is the first thing to build if 4.2 comes back.

## 5. Submission checklist

Requirements CompNinja already meets — worth knowing, because each is a
common rejection:

- **In-app account deletion** (required since 2022 for any app with accounts).
  `DELETE /api/account` exists and is reachable from the account UI. ✅
- **Sign in with Apple** is *not* required: it is only triggered by offering
  third-party sign-in, and CompNinja is email + password only. ✅
- **Privacy policy URL** — `/privacy` exists and already names the cookies. ✅
- **Support URL** — compninja.co. ✅

Still to do at submission time:

- **A demo account.** App Review will hit the account wall on the first
  screen. Give them credentials in App Store Connect's review notes, on an
  account comped to Pro **and** the vault with a few real reports and vault
  comps already in it — a reviewer who signs in to an empty workspace has
  nothing to evaluate and reaches for 4.2. `TESTER_PASSKEY` and
  `VAULT_PASSKEY` are exactly the right tools; hand over the account, not the
  codes.
- **App Privacy labels.** Declare honestly: email address (account), search
  address history (linked to the user, in the portfolio), and analytics. The
  broker vault is user content stored on the server. Nothing is sold, nothing
  is used for tracking across apps, so **do not** tick the tracking box — that
  one triggers App Tracking Transparency and a whole extra surface.
- **Screenshots** for 6.7" and 6.5" iPhone. A report hero, the comp table, the
  map, My Desk, the vault.
- **Age rating** 4+. **Category** Business, secondary Finance.
- **Storefront: United States only** at first (see §3).
- **Export compliance** is pre-answered by `ITSAppUsesNonExemptEncryption` in
  `Info.plist`.

## 6. Whether to do this at all

The roadmap's own "Now" item is that as of 2026-08-06 the product had **zero
real outside users**, and that "can anyone find this" is the binding
constraint. Read against that, the App Store is a distribution bet, and it is
worth being clear-eyed about which parts of it are real:

**What the store genuinely buys.** Credibility with brokers — an app in the
store reads as a real company in a way a web app does not. Search presence in
a second place. Push notifications, once built, which is the one capability
that would bring somebody back weekly rather than when they remember.

**What it costs.** $99/year plus a Mac or CI. Review latency on every release,
against a codebase that currently ships several times a day. A second artifact
to keep in step. And the wrapper is only ever as good as the web app inside
it, so it competes for time with the thing it displays.

**The sequencing that follows from that:** the installable web app is live and
cost nothing, so let it do the work while the D-U-N-S number and the developer
enrolment go through — both are slow and neither needs a decision about
priorities. If a broker actually asks for it, or push notifications become the
retention answer, the wrapper is written and the submission is a week. If
nobody asks, that is information too, and no money was spent finding out.

## Sources

- [App Review Guidelines — Apple Developer](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Updates App Store Rules to Allow External Purchase Links in US — iClarified](https://www.iclarified.com/97192/apple-updates-app-store-rules-to-allow-external-purchase-links-in-us)
- [How to Add External Purchase Links to Your iOS App in 2026 — Stora](https://stora.sh/blog/2026-05-16-apple-app-store-external-purchase-links-implementation-guide)
- [App Store Review Guidelines: Will Your Webview App Be Rejected? — MobiLoud](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)
- [App Store Rejection 4.2: How to Get Your WebView App Approved — Code2Native](https://code2native.com/blog/fix-app-store-rejection-42-webview)
