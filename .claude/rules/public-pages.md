---
paths:
  - "home-page.js"
  - "faq-page.js"
  - "brokers-firms-page.js"
  - "docs/SEO.md"
  - "test/faq-page.test.js"
  - "test/brokers-firms-page.test.js"
  - "test/public-pages.test.js"
---
# Public pages and SEO

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `SITE_URL` — optional. Public URL used in `robots.txt`/`sitemap.xml`; defaults
  to the Render URL. index.html's canonical/`og:url`/JSON-LD tags are written
  against the default origin and rewritten to `SITE_URL` at serve time, so
  moving to a custom domain is a single env change — no HTML edits.
- `GOOGLE_SITE_VERIFICATION` — optional. The token from Google Search Console's
  **HTML file** verification method; accepts the whole `google<token>.html`
  filename or the bare token. Set, the server answers that exact path with the
  line Google expects and logs the live path at startup; unset, the route does
  not exist. **The file method, not the meta tag, on purpose**: meta-tag
  verification fetches the property root, and when this shipped `/` was a 302
  under `ACCOUNT_WALL`, so a tag placed there was never seen and verification
  failed with no stated reason. `/` answers 200 now (the landing page), but
  the file method stays — it is auth-independent by construction and Google
  re-checks it forever, so it must never ride on what `/` happens to serve.
  This path is its own route and the wall never touches
  it (the static handler is an allowlist). A DNS TXT record reaches the same
  place and is better where there is registrar access — it covers every
  subdomain and survives any redirect; the two do not conflict. **Keep the var
  set for good** — Google re-fetches the file and unverifies the property if it
  stops answering. Search Console is the only view of whether the ~38 market
  pages in `sitemap.xml` are indexed at all; `analytics_events` only ever sees
  people who already arrived.

## Architecture

- `GET /how-it-works` — the account-wall front door, reached from the footer
  and, on the landing page, the line under the hero. It LEFT the Explore menu
  on 2026-08-25 (owner’s call), along with /brokers (which merged into
  /brokers-firms on 2026-09-01). Under the wall, `/` *is*
  this render (`renderHowItWorksHTML({ home: true })`). Holds a hero (claim +
  address field + one sample exhibit), the three-step Method, the FAQ, and a
  one-block Brokers path to `/brokers-firms`. There is no stat strip. The address
  field is not `#compForm`; it stores `pendingLandingAddress.v1` and opens
  `/?auth=signup` (signed-in: `/`). **Server-rendered and
  self-contained** like the market pages (`HOW_CSS` — the Research Desk `rd-*`
  system re-expressed as plain class names — so it does NOT depend on the purged
  `tailwind.css`). Two things live here and nowhere else: `HOW_FAQ`, the single
  Q/A array feeding both the visible accordions and the **FAQPage JSON-LD** (it
  moved off `index.html`'s `<head>` with the copy it describes), and the sample
  exhibit's illustrative figures. Listed in `sitemap.xml`.
  **It renders two variants, and the caching split between them is
  load-bearing** (2026-08-08). The page is linked from inside the signed-in
  app, and while it served one static body to everyone its "Log in / Create
  account" chrome read to a member as having been silently logged out
  mid-session. It now takes `signedIn` — decided on `cn_session` **presence**,
  the wall's own cheap rule, because this renders synchronously and
  `getSessionUser()` reads the database — and swaps all **three** signup
  surfaces (header nav, hero CTA, closing CTA) for `My Desk` / `Run a report`.
  Presentation only: a forged cookie buys different buttons and nothing else.
  The headers are the half a future editor will "simplify" and thereby
  reintroduce the bug: the signed-in variant is **`no-store`** (a cached copy
  would outlive a sign-out), while the anonymous variant keeps its hour cache
  for crawlers and carries **`vary: cookie`**. That `vary` looks redundant on
  a page whose body is static and is not — without it the hour-old signed-out
  copy is re-served after signing in, so the people who just created an
  account are exactly the ones who still get told to create one.
  `test/account-wall.test.js` pins all three (chrome swap, `no-store`,
  `vary`).
- `GET /` and `GET /faq` — **the home page and the FAQ, split apart
  2026-09-01** (designs 3a/3b, handed off as `design_handoff_home_and_faq`).
  Bodies in **`home-page.js`** and **`faq-page.js`**, both marketShell BODIES
  like `brokers-firms-page.js`; server.js owns the routes, the SEO metadata and the
  structured data.

  **What changed, and why it matters more than the pixels.** `/` and
  `/how-it-works` had been ONE render since 2026-08-08: `renderHowItWorksHTML`
  answered both, /how-it-works canonicalized to `/`, and the sitemap listed
  only one of them because a URL that declares itself a duplicate is a Search
  Console soft error. That arrangement existed because `/` had no page of its
  own. It has one now, so **all three of those facts reversed**: each page
  canonicalizes to itself, both are in the sitemap, and /how-it-works is the
  methodology page it is named after (Method steps and the sample-report
  anatomy — the vault hero, firm shelf and sharing panes went to the home
  page's bands and /brokers-firms; the FAQ went to /faq; the brokers ledger
  went to /brokers-firms, which lands the same day out of design 4a and whose
  own comment says its FAQ was dropped because "the questions belong on /faq"
  — these two branches are halves of one decision).

  Four things to know before editing either page:

  - **`.heroCta` is load-bearing beyond layout.** Three suites use its
    presence to decide WHICH page answered a URL — it is how the account-wall
    tests tell the home page from index.html. It has wrapped an address form,
    then an account CTA, and now the comp finder. Keep the class name whatever
    the contents become.
  - **Both pages carry their `<style>` in the BODY, not through
    `marketShell`'s `head`.** The head is emitted BEFORE `MARKET_CSS`, so a
    rule placed there loses on equal specificity — `bulk-page.js` already
    carries its own style for this reason, and it is what lets the home page
    neutralise `main.wrap` (it is full-bleed bands, not a 1120px column). The
    bands use HOW_CSS's `box-shadow: 0 0 0 100vmax` + `clip-path` device
    rather than `100vw`, which includes the scrollbar and overflows.
  - **Every colour is a TOKEN.** The design was drawn in the light palette and
    its literals ARE theme.js's light values, so the mapping was exact and
    dark mode came free. The one exception is the home page's closing band: it
    sits on `--slab`, which is dark in BOTH themes, so its text is literal the
    way `MARKET_FOOTER`'s is — and it takes a **dark-only top border**,
    because `--wash` and `--slab` are the same `#243044` in dark and the band
    above it would otherwise be one continuous charcoal.
  - **The comp finder hands off; it does not search.** The wall forces
    `GUEST_SEARCH_LIMIT` to 0, so an anonymous POST to `/api/comps` is refused
    by design. Address and type ride `pendingLandingAddress.v1` /
    **`pendingLandingType.v1`** (new) and index.html picks them up —
    `setTypeProgrammatic`, never a bare `.value =`, or the subject fields and
    the lookback hint keep the previous type's shape. Both keys are pinned
    against index.html's reads. The placeholder option submits an EMPTY value
    on purpose: "Property type" must never arrive as Industrial.

  **/faq's ten answers are public promises, and four were corrected off the
  design before they shipped** — the design file states things the product
  does not do, and `test/faq-page.test.js` asserts each by the fact it gets
  wrong, so "restoring the design copy" fails the build. (1) It named four
  source badges; the enum has five, News included. (2) It claimed the search
  runs "rather than against a stale cache" — the exact sentence deleted from
  the landing page on 2026-08-21, because `runCompSearch` reads the cache, the
  derivable window and the corpus before anything is billed. (3) It described
  only the anonymized share; `POST /api/share` has three outcomes, and a
  public link STRIPS vault comps rather than anonymizing them. (4) It offered
  branded exports to everybody; branding is Pro and free is five a month. The
  design's closing "Write to us — a person answers" was **dropped on the
  owner's call**: there is no contact route that guarantees a human reply, and
  the handoff README asked for one to be confirmed first.

  Two known losses, both deliberate and both worth revisiting if traffic says
  so: four HOW_FAQ answers were not carried over ("What is a comp in
  commercial real estate?", the broker-submission answer, "Can I find out what
  my building is worth?", "How accurate are the reports?"), and the home page
  no longer carries a broker-facing band — the 2026-08-12 decision that put
  one there is the one promise design 3a does not keep in the body of the
  page. The intro photograph (`boise-skyline.png`, on the `STATIC_FILES`
  allowlist) is a **client-supplied asset with unconfirmed licensing** and is
  612x395 against a 940px 3:1 frame, so it upscales ~1.5x (~3x on retina);
  `market-heroes/boise-id.jpg` is the licensed 3840x800 alternative.

- `GET /brokers-firms` — **the** public pitch to the professional audience
  (2026-09-01, design 4a). Body in **`brokers-firms-page.js`**; server.js owns
  the SEO metadata and the shell. It REPLACED `/brokers` and `/firms`, which
  both **301** here — they were two pages selling to one reader (a broker
  deciding whether to bring their comp book, and the same broker deciding
  whether to bring their office), sharing an audience, a price answer and a
  privacy argument while spending two of the four Explore slots saying it
  twice. One Explore entry, one footer link, one sitemap line; a sitemap must
  never list a URL that redirects, so the two old ones came out.
  Order: hero → **One · your book** (a static picture of the import) → **Two ·
  your vault** → **Three · your firm** → price pair → dark CTA → compliance.
  Unlike the pages it replaced it carries its **own stylesheet, in the BODY**
  (the `/faq` and `/bulk` rule): the design is full-bleed alternating bands,
  which needs `main.wrap{max-width:none}` to beat MARKET_CSS, and marketShell's
  `head` is emitted BEFORE MARKET_CSS so the same rule there would silently
  lose. It still does NOT depend on the purged `tailwind.css`.
  Five standing rules, all test-pinned: **the shop copy is PASSED IN** from
  `ORG.SHOP_COPY` (the same map the invite email and the create box read; the
  design's own wording on those cards is illustrative and this rule outranks
  it, and the muted "tell us which one you are" card is the SPARE COLUMN — it
  renders only while there are fewer than three kinds); **the prices are
  PASSED IN** from `PRICING`, which `/pricing` and the FAQ answer also read;
  **every privacy claim is a promise the code keeps** — the vault's closed list
  of exactly two exits, the never-retroactive auto-share guard, the member
  setting that beats the firm's (`org_members.auto_share`'s nullable third
  state) and `blend-comps.js` refusing a firm share the un-anonymized row;
  **the upload and vault panels are illustrative markup, not UI** (nothing
  posts or reads a file, and "Import 214 deals" is a `<span>` — a
  button-shaped link that goes nowhere is worse than a picture of one); and
  **the two dark bands carry literal colours** because `--slab` is dark in
  BOTH themes, so the ink ramp runs backwards on it (the trap FOOTER_DARK_CSS
  exists for, and the reasoning MARKET_CSS already records for `.mkt-hero`).
  **What did NOT survive the merge, deliberately:** `BROKERS_FAQ` and its
  FAQPage JSON-LD (owner's call — those questions belong on `/faq`, and only
  one page should carry FAQ structured data; the three answers not already
  covered there — submitting is free, who sees an owner's contact details, how
  long review takes — are owed to that page), the `MARKET_CREDIT` proof line,
  and the `#upgradeProLink` Pro card (the hook survives, guarded, in
  `ACCOUNT_NAV_JS` with no consumer). **What DID survive is the
  `/?submit=comp` door**, in the closing band: it is the site's only public
  entrance to the comp-submission modal, broker-contributed comps are the
  whole verified-comp layer, and design 4a drew no submission link at all.
  The hero PHOTOGRAPH the design shows is deliberately absent — the handoff
  asks for an industrial aerial cropped 3.4:1, supplies none, and says to ship
  without the band rather than with stock filler. Listed in `sitemap.xml`.
  Do not confuse this with `GET /broker/<slug>`, the per-contributor profile.
- **Brand entity** (not a route — `brandGraph()` in server.js). CompNinja is
  online-only, so it is **not eligible for a Google Business Profile** (Google
  requires face-to-face customer contact and video-verifies it against a real
  address; a listing filed anyway is suspended, not merely rejected). The
  structured-data brand entity is the substitute. `brandGraph()` returns one
  canonical `Organization` node (`@id` `<SITE_URL>/#organization`, legalName
  "CompNinja LLC", logo, public contact point) plus a `WebSite` node, spread
  into the `@graph` of every server-rendered page: `/market/<slug>`,
  `/markets`, `/brokers`, `/broker/<slug>`, `/how-it-works`. Those pages
  reference it via `ORG_ID` / `WEBSITE_ID` instead of restating it — **a new
  server-rendered page should do the same, never inline its own Organization
  or WebSite**. Two standing rules: the email is the public
  `info@compninja.co`, **never `LEAD_NOTIFY_EMAIL`** (the owner's personal
  inbox, and this is public output); and `sameAs` is deliberately absent
  because it means profiles the business actually controls, so add real URLs
  only when they exist. `index.html` needs no copy — under `ACCOUNT_WALL` a
  crawler at `/` gets the landing render, which spreads `brandGraph()` like
  every other server-rendered page.
