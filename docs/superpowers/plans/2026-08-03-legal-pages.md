# Legal Pages (Terms, Privacy, LLC Footer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/terms` and `/privacy` server-rendered pages, update every footer to `© 2026 CompNinja LLC` with links to both pages, and add two small consent notices near signup and checkout.

**Architecture:** Two new render functions in server.js next to `renderBrokersPageHTML`, both going through `marketShell()` (MARKET_CSS/BAR/FOOTER, zero tailwind.css dependency). Routes match on path only (query-string safe). Content is static template literals, cached 1 hour like /brokers. Footer edits touch three files' worth of markup, all inside server.js and index.html.

**Tech Stack:** Plain Node HTTP server (no deps), server-side template literals, existing Tailwind utility classes only (no regen expected; the auto-regen hook covers surprises).

**Spec:** `docs/superpowers/specs/2026-08-03-legal-pages-design.md`

**Repo cautions (read before starting):**
- A second Claude session shares this checkout. `git add` explicit paths only; read `git diff --staged` before every commit.
- server.js edits require killing and relaunching the node process; index.html edits only need a browser refresh.
- No test infra exists for routes (only entitlements.js has tests, and this plan doesn't touch it). Verification is by running the server and curling routes; each task says exactly how.
- The owner's writing rule: no em dashes anywhere in the page copy. The copy below honors it; keep it that way if you reword anything.
- Launch the server with the portable Node path, not bare `node`:
  `& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" server.js`

---

### Task 1: `/terms` and `/privacy` render functions + routes + sitemap

**Files:**
- Modify: `server.js` (three spots: after `renderBrokersPageHTML`'s closing brace ~line 4075; after the `/brokers` route block ~line 7641; inside the sitemap handler ~line 7910)

- [ ] **Step 1: Add the two render functions after `renderBrokersPageHTML`**

Find the closing brace of `renderBrokersPageHTML()` (the function ends with `return marketShell({ title, description, canonical, body, jsonLd });` followed by `}`). Insert immediately after it:

```js

// ---------------------------------------------------------------------------
// /terms + /privacy — the legal pages. CompNinja LLC (Idaho #6928558) is the
// contracting entity. Rendered through marketShell like /brokers, so they do
// NOT depend on the purged tailwind.css. The copy is a plain-English draft
// written for later attorney review; the review note deliberately does NOT
// appear on the pages themselves (it would weaken them).
// Owner decisions locked 2026-08-03: no refunds (cancel anytime, access to
// period end), Idaho law + Ada County venue (no arbitration), email-only
// contact (no street address; the SOS registry publishes it for anyone who
// truly needs it).
// ---------------------------------------------------------------------------
const LEGAL_UPDATED = "August 3, 2026";

function renderTermsPageHTML() {
  const title = "Terms of Service | CompNinja";
  const canonical = `${SITE_URL}/terms`;
  const description =
    "The terms that govern CompNinja: what the service is, what it is not, subscriptions, and your responsibilities.";
  const body =
    `<h1>Terms of Service</h1>` +
    `<p class="sub">Last updated: ${LEGAL_UPDATED}. Questions: <a href="mailto:info@compninja.co">info@compninja.co</a>.</p>` +

    `<div class="card"><h2>Who we are and what this is</h2>` +
    `<p>CompNinja is operated by CompNinja LLC, an Idaho limited liability company (file #6928558). ` +
    `These terms are an agreement between you and CompNinja LLC. By using compninja.co you accept them.</p>` +
    `<p>The service produces automated commercial real estate comparable-sales reports and value estimates, ` +
    `built from publicly available data and AI-assisted web search.</p></div>` +

    `<div class="card"><h2>What the service is not</h2>` +
    `<ul>` +
    `<li>Every valuation is an automated estimate. It is not an appraisal and no output of the service is one.</li>` +
    `<li>CompNinja is not a licensed real estate brokerage and does not provide broker opinions of value. ` +
    `Where the site offers a broker opinion of value, it connects you with an independent local broker.</li>` +
    `<li>Nothing on the site is financial, investment, legal, or tax advice.</li>` +
    `<li>Estimates must not be relied on for lending, underwriting, or any transaction decision ` +
    `without independent verification. Comparable data comes from public sources and automated search; ` +
    `we do not guarantee its accuracy or completeness.</li>` +
    `</ul></div>` +

    `<div class="card"><h2>Accounts and acceptable use</h2>` +
    `<p>Accounts are free. Keep your credentials to yourself, give us accurate information, and use one ` +
    `account per person. We may suspend or terminate accounts that abuse the service.</p>` +
    `<p>You agree not to scrape, bulk-extract, or resell report data; not to circumvent rate limits, usage ` +
    `caps, or access controls; and not to use the service for anything unlawful.</p></div>` +

    `<div class="card"><h2>Paid subscriptions</h2>` +
    `<p>Payment is processed by Stripe; CompNinja never sees or stores your card number. You can cancel at ` +
    `any time and your access continues through the end of the period you paid for. Payments are not ` +
    `refundable, in whole or in part.</p>` +
    `<p>Prices may change with advance notice; a change applies from your next billing period. ` +
    `Founding-member pricing stays at its original rate for as long as that subscription remains ` +
    `continuously active.</p></div>` +

    `<div class="card"><h2>Your submissions</h2>` +
    `<p>If you submit a comp or other data, you confirm you have the right to share it. We may review, ` +
    `approve, display, and credit submissions (for example the Verified badge with your firm's name), and ` +
    `we may decline or remove any submission at our discretion.</p></div>` +

    `<div class="card"><h2>The legal terms</h2>` +
    `<h3>Intellectual property</h3>` +
    `<p>The site, branding, and report formats belong to CompNinja LLC. Reports you generate are yours to ` +
    `use for your own business purposes.</p>` +
    `<h3>Third-party services</h3>` +
    `<p>The service depends on third-party data and infrastructure providers. We are not responsible for ` +
    `their outages or errors.</p>` +
    `<h3>Disclaimer of warranties</h3>` +
    `<p>The service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any ` +
    `kind, to the maximum extent permitted by law.</p>` +
    `<h3>Limitation of liability</h3>` +
    `<p>To the maximum extent permitted by law, CompNinja LLC's total liability for any claim relating to ` +
    `the service is capped at the greater of the fees you paid us in the twelve months before the claim ` +
    `or $100. We are not liable for indirect, incidental, or consequential damages.</p>` +
    `<h3>Termination</h3>` +
    `<p>You can stop using the service or delete your account at any time; we can suspend or end access ` +
    `for breach of these terms. Sections that by their nature should survive (disclaimers, liability ` +
    `limits, intellectual property) survive.</p>` +
    `<h3>Governing law and disputes</h3>` +
    `<p>These terms are governed by Idaho law. Any dispute belongs exclusively in the state or federal ` +
    `courts located in Ada County, Idaho, and both sides consent to that venue.</p>` +
    `<h3>Changes to these terms</h3>` +
    `<p>We may update these terms; the date at the top changes when we do. Continuing to use the service ` +
    `after a change means you accept it.</p>` +
    `<h3>Contact</h3>` +
    `<p><a href="mailto:info@compninja.co">info@compninja.co</a></p></div>`;

  return marketShell({ title, description, canonical, body });
}

function renderPrivacyPageHTML() {
  const title = "Privacy Policy | CompNinja";
  const canonical = `${SITE_URL}/privacy`;
  const description =
    "What CompNinja collects, what never leaves your browser, which providers we use, and how to delete your data.";
  const body =
    `<h1>Privacy Policy</h1>` +
    `<p class="sub">Last updated: ${LEGAL_UPDATED}. CompNinja is operated by CompNinja LLC, an Idaho ` +
    `limited liability company (file #6928558). Questions: <a href="mailto:info@compninja.co">info@compninja.co</a>.</p>` +

    `<div class="card"><h2>What we collect</h2>` +
    `<ul>` +
    `<li><strong>Search inputs.</strong> The property address, property type, lookback window, and any ` +
    `public building attributes you enter (size, units, clear height, and similar).</li>` +
    `<li><strong>Lead and broker-opinion requests.</strong> Name, email, phone, company, and the property ` +
    `you asked about.</li>` +
    `<li><strong>Accounts.</strong> Your email address and a hashed password. Passwords are stored only as ` +
    `scrypt hashes, never as plain text.</li>` +
    `<li><strong>Saved work.</strong> Portfolio items and watchlists, including any private financial ` +
    `inputs you enter (NOI, debt terms, rent roll, gross income).</li>` +
    `<li><strong>Broker comp submissions.</strong> Broker contact details and the submitted comp.</li>` +
    `<li><strong>Operational data.</strong> IP addresses for rate limiting, server logs, and analytics ` +
    `events that carry no personal information: a property type, a city and state, and an outcome, ` +
    `never names, emails, or street addresses.</li>` +
    `</ul></div>` +

    `<div class="card"><h2>Your private financials stay in your browser</h2>` +
    `<p>NOI, debt terms, rent rolls, and gross income never leave your browser except into your own ` +
    `signed-in portfolio. They are never sent to the AI model, they are stripped on the server before a ` +
    `shared report link is stored, and they are never shown to anyone else.</p></div>` +

    `<div class="card"><h2>How we use information</h2>` +
    `<p>To generate your reports, to connect broker-opinion requesters with local brokers, to send ` +
    `transactional email (confirmations, password resets, broker notifications), to process subscription ` +
    `billing, and to operate, secure, and improve the service. We do not sell personal data, we run no ` +
    `advertising trackers, and we use no third-party analytics cookies.</p></div>` +

    `<div class="card"><h2>Service providers</h2>` +
    `<p>These providers process data on our behalf:</p>` +
    `<ul>` +
    `<li><strong>Anthropic</strong> (AI search): receives the address, property type, and public building ` +
    `attributes only. Never your financials.</li>` +
    `<li><strong>Supabase</strong> (database) and <strong>Render</strong> (hosting).</li>` +
    `<li><strong>Stripe</strong> (payments): card details go directly to Stripe and never touch our servers.</li>` +
    `<li><strong>Resend</strong> (email delivery).</li>` +
    `<li><strong>Google</strong> (Street View imagery), <strong>Esri</strong>, <strong>OpenStreetMap</strong>, ` +
    `and <strong>CARTO</strong> (map imagery and tiles).</li>` +
    `<li><strong>US Census Bureau</strong> and <strong>Nominatim</strong> (address geocoding).</li>` +
    `<li><strong>cdnjs</strong> (script delivery for exports).</li>` +
    `</ul></div>` +

    `<div class="card"><h2>Cookies, sharing, and retention</h2>` +
    `<h3>Cookies and local storage</h3>` +
    `<p>One essential cookie (<code>cn_session</code>, httpOnly) keeps you signed in. Your browser's ` +
    `local storage holds preferences, report history, and map caches on your own device.</p>` +
    `<h3>Shared report links</h3>` +
    `<p>Publishing a share link makes that report readable by anyone who has the link. Private financial ` +
    `inputs are stripped before publishing. Share links do not expire.</p>` +
    `<h3>Retention and deletion</h3>` +
    `<p>You can delete your account in the app (My Desk, Delete account), which removes the account and ` +
    `its saved data. To request deletion of lead or submission data, email ` +
    `<a href="mailto:info@compninja.co">info@compninja.co</a>.</p>` +
    `<h3>Security</h3>` +
    `<p>HTTPS everywhere, hashed passwords, and an access-controlled database.</p>` +
    `<h3>Children</h3>` +
    `<p>The service is built for business use and is not directed to children under 13.</p>` +
    `<h3>Changes and contact</h3>` +
    `<p>We may update this policy; the date at the top changes when we do. ` +
    `<a href="mailto:info@compninja.co">info@compninja.co</a></p></div>`;

  return marketShell({ title, description, canonical, body });
}
```

Note: `marketShell` is called without `jsonLd`, which it handles (renders no ld+json block). `<code>` has no MARKET_CSS rule; browser default monospace inside a 14.5px paragraph is fine.

- [ ] **Step 2: Add the routes after the `/brokers` route block**

Find this existing block (~line 7638):

```js
  if (req.method === "GET" && req.url.split("#")[0] === "/brokers") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderBrokersPageHTML());
  }
```

Insert immediately after it:

```js

  // --- Legal pages. Path-only match (split at "?") so /terms?utm_source=x
  // resolves; Stripe checkout settings and campaign links both send query
  // strings. Same hour cache as the other static pages. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/terms") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderTermsPageHTML());
  }
  if (req.method === "GET" && req.url.split("?")[0] === "/privacy") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(renderPrivacyPageHTML());
  }
```

- [ ] **Step 3: Add both URLs to the sitemap**

In the `/sitemap.xml` handler, find:

```js
      `  <url><loc>${SITE_URL}/how-it-works</loc></url>\n` +
      `  <url><loc>${SITE_URL}/brokers</loc></url>\n` +
```

Replace with:

```js
      `  <url><loc>${SITE_URL}/how-it-works</loc></url>\n` +
      `  <url><loc>${SITE_URL}/brokers</loc></url>\n` +
      `  <url><loc>${SITE_URL}/terms</loc></url>\n` +
      `  <url><loc>${SITE_URL}/privacy</loc></url>\n` +
```

- [ ] **Step 4: Syntax-check, run, and curl**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" --check server.js
```
Expected: no output (exit 0).

Start the server (background), then:

```powershell
curl.exe -s http://localhost:3000/terms | Select-String -Pattern "Terms of Service","CompNinja LLC","Ada County","not an appraisal"
curl.exe -s "http://localhost:3000/terms?utm_source=x" | Select-String -Pattern "Terms of Service"
curl.exe -s http://localhost:3000/privacy | Select-String -Pattern "Privacy Policy","scrypt","Anthropic","cn_session"
curl.exe -s http://localhost:3000/sitemap.xml | Select-String -Pattern "/terms","/privacy"
```
Expected: every pattern matches. Also open http://localhost:3000/terms in the preview browser and confirm the nav bar, cards, and ink footer render like /brokers.

- [ ] **Step 5: Commit (explicit path only; shared checkout)**

```powershell
git add server.js; git diff --staged --stat
```
Confirm the diff is only your changes, then:

```powershell
git commit -m @'
Add /terms and /privacy legal pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Footer updates in server.js (MARKET_FOOTER + /how-it-works)

The only two © lines in server.js are in these two footers. The /admin and /dev footers carry no © line and no public links; per spec they need nothing. (`GET /r/<id>` and `/desk` serve index.html, covered by Task 3.)

**Files:**
- Modify: `server.js` (`MARKET_FOOTER` ~line 3557; the /how-it-works footer inside `renderHowItWorksHTML` ~line 4243)

- [ ] **Step 1: Update MARKET_FOOTER**

Find:

```js
  `<p>&copy; 2026 CompNinja</p></div>` +
  `<div class="right"><a href="mailto:info@compninja.co">info@compninja.co</a>` +
  `<ul><li><a href="/markets">Markets</a></li><li><a href="/brokers">Brokers</a></li>` +
  `<li><a href="/how-it-works">How it works</a></li>` +
  `<li><a href="/how-it-works#faq">FAQ</a></li><li><a href="/">Run a report</a></li></ul></div>` +
```

Replace with:

```js
  `<p>&copy; 2026 CompNinja LLC</p></div>` +
  `<div class="right"><a href="mailto:info@compninja.co">info@compninja.co</a>` +
  `<ul><li><a href="/markets">Markets</a></li><li><a href="/brokers">Brokers</a></li>` +
  `<li><a href="/how-it-works">How it works</a></li>` +
  `<li><a href="/how-it-works#faq">FAQ</a></li><li><a href="/">Run a report</a></li>` +
  `<li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li></ul></div>` +
```

- [ ] **Step 2: Update the /how-it-works footer**

Find (inside `renderHowItWorksHTML`):

```
      <p>&copy; 2026 CompNinja</p>
```

Replace with:

```
      <p>&copy; 2026 CompNinja LLC</p>
```

Then in the same footer's `<ul>`, find:

```
        <li><a href="/">Run a report</a></li>
      </ul>
```

Replace with:

```
        <li><a href="/">Run a report</a></li>
        <li><a href="/terms">Terms</a></li>
        <li><a href="/privacy">Privacy</a></li>
      </ul>
```

(That `<li><a href="/">Run a report</a></li>` + `</ul>` pairing appears in both MARKET_FOOTER and this footer; MARKET_FOOTER is a single-line template so the Edit old_string above is unique to each. If an Edit reports non-unique, widen the anchor with the surrounding line.)

- [ ] **Step 3: Restart, verify all five server-rendered surfaces**

Kill and relaunch the server (server.js is loaded once at startup), then:

```powershell
curl.exe -s http://localhost:3000/markets | Select-String -Pattern "CompNinja LLC","/terms","/privacy"
curl.exe -s http://localhost:3000/brokers | Select-String -Pattern "CompNinja LLC"
curl.exe -s http://localhost:3000/how-it-works | Select-String -Pattern "CompNinja LLC","/terms"
curl.exe -s http://localhost:3000/terms | Select-String -Pattern "CompNinja LLC"
```
Expected: all match (the /terms page itself renders MARKET_FOOTER, so the new links appear there too).

- [ ] **Step 4: Commit**

```powershell
git add server.js; git diff --staged --stat
git commit -m @'
Footers: (c) CompNinja LLC + Terms/Privacy links (server pages)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: index.html footer + consent notices

**Files:**
- Modify: `index.html` (footer ~line 1642; account modal ~line 493; pricing modal ~line 560; `setAcctMode` mode toggling ~line 5541)

- [ ] **Step 1: Footer © line**

Find:

```html
          <p class="mt-3 text-[#8F99A8]">© 2026 CompNinja</p>
```

Replace with:

```html
          <p class="mt-3 text-[#8F99A8]">© 2026 CompNinja LLC</p>
```

- [ ] **Step 2: Footer links**

Find:

```html
            <li><button type="button" id="footerSubmitComp" class="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8C0CC]">Submit a comp (brokers)</button></li>
          </ul>
```

Replace with:

```html
            <li><button type="button" id="footerSubmitComp" class="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8C0CC]">Submit a comp (brokers)</button></li>
            <li><a href="/terms" class="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8C0CC]">Terms</a></li>
            <li><a href="/privacy" class="hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B8C0CC]">Privacy</a></li>
          </ul>
```

- [ ] **Step 3: Signup consent line in the account modal**

The modal is one form serving four modes; the note must show only in signup mode, mirroring how `acctName` is toggled. Find:

```html
      <p class="text-xs text-slate-400 mt-3">Free account. Your portfolio and watchlist sync across devices. No spam.</p>
```

Replace with:

```html
      <p class="text-xs text-slate-400 mt-3">Free account. Your portfolio and watchlist sync across devices. No spam.
        <span id="acctTos" class="hidden">By creating an account you agree to the <a href="/terms" target="_blank" class="underline hover:text-slate-600">Terms of Service</a> and <a href="/privacy" target="_blank" class="underline hover:text-slate-600">Privacy Policy</a>.</span></p>
```

Then find the mode-toggle line inside `setAcctMode` (search for `acctName").classList.toggle`):

```js
    document.getElementById("acctName").classList.toggle("hidden", mode !== "signup");
```

Replace with:

```js
    document.getElementById("acctName").classList.toggle("hidden", mode !== "signup");
    document.getElementById("acctTos").classList.toggle("hidden", mode !== "signup");
```

Class check: `underline` and `text-slate-600` are already used in index.html (footer link, acctInfo), so no new Tailwind utilities; `hover:text-slate-600` may be new. If the tailwind auto-regen hook fires and modifies tailwind.css, include tailwind.css in this task's commit. Do NOT regen manually.

- [ ] **Step 4: Pricing modal Terms link**

The modal already says "Cancel any time; access runs to the end of the period you paid for." per tile; the Terms link joins the shared footnote so it covers every tile with one edit. Find:

```html
      <p class="text-xs text-[#8A93A0] mt-4">
        Prices in USD. A one-off $39 unlock for a single report is coming; for now Pro is the only way to see the full list.
      </p>
```

Replace with:

```html
      <p class="text-xs text-[#8A93A0] mt-4">
        Prices in USD. Subscriptions are governed by our <a href="/terms" target="_blank" class="underline hover:text-[#5A6473]">Terms</a>.
        A one-off $39 unlock for a single report is coming; for now Pro is the only way to see the full list.
      </p>
```

(`hover:text-[#5A6473]` is an arbitrary-value class; if it is not already in tailwind.css the hook regenerates. If the hook is unavailable, fall back to `hover:text-slate-600` which Step 3 already introduces.)

- [ ] **Step 5: Verify in the browser**

index.html needs no server restart; refresh http://localhost:3000/ and check:
- Footer shows "© 2026 CompNinja LLC" with working Terms and Privacy links.
- Sign in modal (header button): no consent line in signin mode; switch to Create account: the line appears; links open the legal pages in a new tab.
- Pricing modal (if billing UI is hidden locally, verify by reading the DOM: `document.querySelector('#pricingModal a[href="/terms"]')` in the console returns the element).
- Hover the new links to confirm the hover classes actually styled (i.e., the utilities exist in tailwind.css).

- [ ] **Step 6: Commit**

```powershell
git add index.html; git diff --staged --stat
```
If the hook regenerated tailwind.css, also `git add tailwind.css` ONLY if the diff is the regen (the other session has its own tailwind.css modification pending; read the diff first, and if it contains changes you did not cause, stop and ask the owner).

```powershell
git commit -m @'
index.html: LLC footer, Terms/Privacy links, consent notices

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Devlog entry + final verification

**Files:**
- Modify: `devlog.json` (prepend to the array; file order doesn't matter but newest-first matches the file)

- [ ] **Step 1: Add the devlog entry**

Insert as the first element of the array:

```json
  { "date": "2026-08-03", "type": "feature", "title": "The site gets its legal pages: Terms of Service and Privacy Policy", "details": "CompNinja LLC is now the named contracting entity across the site. Two new pages, /terms and /privacy, carry the terms that were previously only implied: every valuation is an automated estimate and not an appraisal, CompNinja is not a brokerage, subscriptions cancel anytime with access to period end and no refunds, Idaho law governs. The privacy policy tells the true story of the architecture: private financials (NOI, debt, rent roll, gross income) never leave the browser except into your own portfolio, one essential cookie, no trackers, every service provider named. Every footer now reads (c) 2026 CompNinja LLC and links both pages, and small notices appear at account creation and in the pricing dialog. Drafted for attorney review; the pages themselves don't say so." },
```

- [ ] **Step 2: Validate the JSON**

```powershell
& "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64\node.exe" -e "JSON.parse(require('fs').readFileSync('devlog.json','utf8')); console.log('devlog ok')"
```
Expected: `devlog ok`.

- [ ] **Step 3: Full pass**

```powershell
npm test
```
Expected: all entitlements tests pass (nothing here touched them; this is the free regression check).

With the server running, walk every changed surface once: `/`, `/terms`, `/privacy`, `/terms?x=1`, `/markets`, one `/market/<slug>` page, `/brokers`, `/how-it-works`, `/sitemap.xml`, plus the two modals. Confirm `/dev` renders the new devlog entry (devlog.json is read per request, no restart needed).

- [ ] **Step 4: Commit**

```powershell
git add devlog.json; git diff --staged --stat
git commit -m @'
Devlog: legal pages entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

## After the plan

Deploy is NOT part of this plan (owner deploys via push HEAD:main per the standing deploy flow; server.js changes need the Render restart that a deploy performs anyway). Two owner follow-ups to surface at the end, not to implement:
1. Have an attorney review both pages (tracked in memory; deliberately absent from the pages).
2. Once live, paste the /terms and /privacy URLs into Stripe's checkout settings (business information) so checkout links them.
