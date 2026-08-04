# Legal Pages: Terms of Service, Privacy Policy, LLC Footer

**Date:** 2026-08-03
**Status:** Approved by owner (design conversation, this date)

## Why

CompNinja LLC is filed (Idaho #6928558, EIN obtained) but the site has no Terms
of Service, no Privacy Policy, and the footers still say "© 2026 CompNinja"
without the LLC. The ToS disclaimer (automated estimate, not an appraisal, no
reliance for lending) is the site's main liability shield and currently exists
only as scattered copy. The site stores PII (leads, accounts, portfolios with
private financials), which warrants a privacy policy. Stripe checkout is about
to go live and expects ToS and privacy URLs.

Owner decisions locked during design:

- **Refunds:** cancel anytime, no refunds; access runs through the paid period.
- **Disputes:** Idaho governing law, Ada County (Idaho) courts. No arbitration
  clause.
- **Address:** email-only contact (info@compninja.co) plus the Idaho LLC file
  number. No street address on the pages (the principal address on file is
  personal; the SOS registry already publishes it for anyone who truly needs
  it).

## What

### 1. Two new server-rendered routes

- `GET /terms` and `GET /privacy` in server.js, rendered through
  `marketShell()` (same vehicle as `/brokers`: `MARKET_CSS` / `MARKET_BAR` /
  `MARKET_FOOTER`, no tailwind.css dependency).
- Route matching is **path-only** (`req.url.split("?")[0]` style), per the
  existing lesson about query strings on page routes.
- Both pages indexed (`index, follow`), canonical URLs, added to
  `sitemap.xml`.
- Each page carries a "Last updated: August 3, 2026" line under the H1.
- Content lives as template literals in server.js, like `/brokers` and
  `/how-it-works`. Prose style: plain English, calm tone, sentence-case
  headings, no em dashes (owner's writing rule).

### 2. Terms of Service content (`/terms`)

Sections, in order:

1. **Who we are.** CompNinja LLC, an Idaho limited liability company (file
   #6928558), operating compninja.co. Contact: info@compninja.co.
2. **What the service is.** Automated commercial real estate comp reports and
   value estimates built from publicly available data and AI-assisted search.
3. **What the service is not** (the load-bearing section, placed early, not
   buried):
   - Every valuation is an automated estimate, not an appraisal.
   - CompNinja is not a licensed brokerage and does not provide broker
     opinions of value; it connects users with local brokers.
   - Nothing on the site is financial, investment, legal, or tax advice.
   - Estimates must not be relied on for lending, underwriting, or any
     transaction decision without independent verification.
   - Data comes from public sources and AI-assisted search; accuracy and
     completeness are not guaranteed.
4. **Accounts.** Accurate information, keep credentials safe, one person per
   account, CompNinja may suspend or terminate accounts for abuse.
5. **Acceptable use.** No scraping, bulk extraction, or resale of report
   data; no circumventing rate limits, caps, or access controls; no unlawful
   use.
6. **Paid subscriptions.** Billing handled by Stripe; CompNinja never sees
   card numbers. Cancel anytime; access continues through the end of the paid
   period; **no refunds**, whole or partial. Prices may change with advance
   notice; changes apply from the next billing period. Founding-member
   pricing is honored for as long as the subscription remains continuously
   active.
7. **User submissions.** Broker-submitted comps and similar contributions:
   the submitter warrants they have the right to share the data; CompNinja
   may review, approve, display, and credit submissions (the Verified badge
   and contributor attribution); CompNinja may decline or remove any
   submission.
8. **Intellectual property.** Site content, branding, and report formats
   belong to CompNinja LLC. Users may use reports they generate for their own
   business purposes.
9. **Third-party services.** The service depends on third-party data and
   infrastructure providers; CompNinja is not responsible for their outages
   or errors.
10. **Disclaimer of warranties.** Service provided "as is" and "as
    available", to the maximum extent permitted by law.
11. **Limitation of liability.** Total liability capped at the greater of
    the fees the user paid in the 12 months before the claim or $100. No
    indirect, incidental, or consequential damages.
12. **Termination.** Either side may end the relationship; sections that by
    their nature survive (disclaimers, liability, IP) survive.
13. **Governing law and disputes.** Idaho law; exclusive venue in the state
    and federal courts of Ada County, Idaho.
14. **Changes to these terms.** May be updated; the "Last updated" date
    changes; continued use is acceptance.
15. **Contact.** info@compninja.co.

### 3. Privacy Policy content (`/privacy`)

Honest to how the app actually works. Sections:

1. **Who we are.** Same identity block as the ToS.
2. **What we collect.**
   - Search inputs: property address, property type, optional public building
     attributes (size, units, clear height, and similar), lookback window.
   - Lead and BOV forms: name, email, phone, company, plus the searched
     address and type.
   - Accounts: email address and a hashed password (passwords are stored
     only as scrypt hashes, never in plain text).
   - Saved work: portfolio items and watchlists, including any private
     financial inputs the user enters (NOI, debt terms, rent roll, gross
     income).
   - Broker comp submissions: broker contact details and comp data.
   - Operational data: IP addresses for rate limiting, server logs, and
     PII-free analytics events (property type, city/state, source; never
     names, emails, or full addresses).
3. **The private-financials promise** (its own short section): NOI, debt
   terms, rent rolls, and gross income never leave the browser except into
   the user's own signed-in portfolio. They are never sent to the AI model,
   never included in shared report links (stripped server-side before a
   share is stored), and never shown to anyone else.
4. **How we use information.** Generate reports; connect BOV requesters with
   local brokers; send transactional email (lead confirmations, password
   resets, broker notifications); process subscription billing; operate,
   secure, and improve the service.
5. **Service providers** (named): Anthropic (AI search receives the address,
   property type, and public building attributes only), Supabase (database),
   Render (hosting), Stripe (payments; card data goes directly to Stripe and
   never touches CompNinja's servers), Resend (email delivery), Google
   (Street View imagery for map photos), Esri / OpenStreetMap / CARTO (map
   tiles), US Census Bureau and Nominatim (address geocoding), cdnjs (script
   delivery).
6. **What we don't do.** No selling of personal data, no advertising
   trackers, no third-party analytics cookies.
7. **Cookies and local storage.** One essential session cookie
   (`cn_session`, httpOnly, for signed-in accounts). Browser localStorage
   holds preferences, report history, and map caches on the user's own
   device.
8. **Shared report links.** Publishing a share link makes that report
   readable by anyone who has the link; private financial inputs are
   stripped before publishing. Share links do not expire.
9. **Retention and deletion.** Accounts are deletable in-app (Delete account
   in My Desk), which removes the account and its saved data. Lead and
   submission data deletion requests: email info@compninja.co.
10. **Security.** HTTPS everywhere, hashed passwords, access-controlled
    database.
11. **Children.** The service is for business use and not directed to
    children under 13 (COPPA floor; business-use framing keeps this simple).
12. **Changes and contact.** Same pattern as the ToS.

### 4. Footer updates (four places)

- **index.html footer:** `© 2026 CompNinja` → `© 2026 CompNinja LLC`; add
  `Terms` (`/terms`) and `Privacy` (`/privacy`) links to the link list.
- **`MARKET_FOOTER` (server.js):** same © change, same two links. This
  covers `/markets`, every `/market/<slug>`, and `/brokers`.
- **`/how-it-works` footer (its own copy in server.js):** same © change,
  same two links.
- **`/admin` and `/dev` trimmed footers:** © change only (private pages, no
  legal links needed).

### 5. Consent notices (two one-liners)

- Signup form (index.html account modal): "By creating an account you agree
  to the [Terms of Service](/terms) and [Privacy Policy](/privacy)." Small,
  muted text under the submit button. Display only; no checkbox, no
  server-side enforcement.
- Pricing modal (index.html, near the buy buttons): "Subscriptions are
  governed by our [Terms](/terms)." Same styling register.
- Both use existing utility classes where possible. If a genuinely new
  Tailwind class is needed, the auto-regen hook rebuilds tailwind.css (do
  not regen manually, per standing setup).

### 6. Housekeeping

- `sitemap.xml`: add `/terms` and `/privacy` entries.
- `devlog.json`: one `feature` entry in the same commit ("Terms of Service,
  Privacy Policy, and CompNinja LLC footer").
- **No attorney-review disclaimer on the public pages** (it would weaken
  them). The standing follow-up that an attorney should review these drafts
  is tracked in the owner's memory/notes, not on the site.

## Out of scope (deliberate)

- Cookie consent banner: the only cookie is essential, nothing to consent to.
- Refund self-service UI: policy is no-refunds; Stripe's portal handles
  cancellation.
- ToS-acceptance checkbox with server-side enforcement: display-only notice
  is the chosen scope.
- CCPA/GDPR-specific machinery (data-export endpoints, DPO contacts): US
  small-business posture for now; an attorney can extend later.
- Any restyling beyond adding links to existing footers (calm-UI rule).

## Testing / verification

- `node --test` still passes (no entitlement changes expected, but it's
  free to run).
- Local server: `/terms` and `/privacy` render through marketShell with nav
  and footer; footers on `/`, `/markets`, a market page, `/brokers`,
  `/how-it-works` all show the LLC line and the two links; sitemap.xml lists
  both new URLs; `/terms?utm_source=x` still resolves (path-only match).
- Signup modal and pricing modal show the consent lines without layout
  breakage.
- No tailwind regen needed unless the hook fires.
