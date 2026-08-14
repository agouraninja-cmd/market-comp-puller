# /brokers Two Stacked Ledgers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-card offer on `/brokers` with two stacked hairline ledgers (Contribute, then Pro) so a broker reads trades, not a feature list.

**Architecture:** `renderBrokersPageHTML` stops emitting `.grid` + two `.card`s. It emits two `div.bk` blocks (three `.bkrow` each) built from a small array, same shape as How it works, without copying How it works' `html.anim` observer. Ledger CSS is added to `MARKET_CSS` (the only stylesheet this page has). Hero, proof, Submit CTA, 1031 card, and compliance stay.

**Tech Stack:** `server.js` (zero-dep Node HTTP, template-literal CSS), `node:test` via `npm test`.

## Global Constraints

- Zero npm dependencies. `npm test` is `node --test`.
- `MARKET_CSS` is a template literal: no backticks anywhere in the new CSS, including comments.
- One Submit door: the bottom `/?submit=comp` button. Nothing above it links to the form.
- Chip is `span.badge` with inline `color:var(--ok-text);background:var(--ok-bg)`. Never `class="badge v"` (`.v` collides with `.tile .v` in this stylesheet).
- No `.steps`. No `html.anim`. Rows visible on first paint.
- Copy locked in spec §5. No em dashes in page copy. Never "appraisal". Never claim CompNinja is a broker.
- Do not edit `renderHowItWorksHTML` or `HOW_CSS` in this work.
- Shared checkout: never `git add -A`; this branch is `feat/brokers-page-ledger` off `origin/main`.
- Spec: `docs/superpowers/specs/2026-08-13-brokers-page-ledger-design.md`

---

### Task 1: Failing `/brokers` ledger tests

**Files:**
- Modify: `test/public-pages.test.js` (nest under the existing `the broker contribution path is not a dead end` test that already boots a server)

**Interfaces:**
- Consumes: `boot` from `./helpers/boot`, `fetch(srv.base + "/brokers")`
- Produces: assertions the current two-card markup will fail

- [ ] **Step 1: Write the failing test**

Add this nested test immediately after the existing `"/brokers points its CTA at a door the wall actually opens"` case (same `t`, same `srv`):

```js
  await t.test("/brokers is two stacked ledgers, not two cards", async () => {
    // Spec: docs/superpowers/specs/2026-08-13-brokers-page-ledger-design.md
    // Contribute vs Pro must stay two statements. One list makes the vault
    // look like it comes with a submitted comp.
    const html = await (await fetch(srv.base + "/brokers")).text();
    const offer = html.split("<h1>")[1].split('class="cta"')[0];
    assert.equal((offer.match(/class="bk"/g) || []).length, 2,
      "/brokers should show two ledgers");
    const contribute = offer.split("For submitting a comp.")[1].split("With Pro.")[0];
    const pro = offer.split("With Pro.")[1];
    assert.ok(contribute && pro, "both ledger headings must exist");
    assert.equal((contribute.match(/class="bkrow"/g) || []).length, 3,
      "contribute ledger is three trades");
    assert.match(contribute, /class="bklag">CREDIT</);
    assert.match(contribute, /class="bklag">INTROS</);
    assert.match(contribute, /class="bklag">PROFILE</);
    assert.equal((contribute.match(/Verified &middot; via Your Firm/g) || []).length, 1,
      "the credit chip is shown on Credit, once");
    assert.ok(!/class="badge v"/.test(contribute),
      "MARKET_CSS .v collides with .tile .v; the chip stays inline-styled");
    assert.equal((pro.match(/class="bkrow"/g) || []).length, 3,
      "Pro ledger is three trades");
    assert.match(pro, /class="bklag">BOOK</);
    assert.match(pro, /class="bklag">PIPELINE</);
    assert.match(pro, /class="bklag">PRIVATE</);
    assert.ok(!/Verified &middot; via Your Firm/.test(pro),
      "the chip belongs on Credit, not on the vault");
    assert.equal((html.match(/href="\/\?submit=comp"/g) || []).length, 1,
      "exactly one Submit door");
    assert.ok(!/class="steps"/.test(html), "do not reuse Method's 3-up");
    assert.ok(!/class="grid"/.test(offer), "the offer is not a two-card grid");
    assert.match(html, /Working a 1031 exchange\?/);
    assert.match(html, /CompNinja is not a licensed brokerage/);
    assert.match(html, /id="upgradeProLink"/);
  });
```

Do not change the How-it-works tests in this file. They pin a different page.

- [ ] **Step 2: Run the test and confirm it fails**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/public-pages.test.js
```

Expected: FAIL on `class="bk"` count (current markup has zero).

- [ ] **Step 3: Commit**

```powershell
git add -- test/public-pages.test.js
git commit -m "Fail /brokers until the offer is two stacked ledgers."
```

---

### Task 2: Ledger CSS in MARKET_CSS, then the markup

**Files:**
- Modify: `server.js` (`MARKET_CSS` around the `.card` rules ~5457 and the `min-width:640px` block ~5579; `renderBrokersPageHTML` from the standing comment at ~7218 through the two-card `body` at ~7251–7292)

**Interfaces:**
- Consumes: Task 1 assertions; existing `proof`, `escHtml`, `#upgradeProLink`
- Produces: `/brokers` HTML with two `.bk` ledgers matching spec §4–§5

- [ ] **Step 1: Add ledger CSS to MARKET_CSS**

Insert after the `.card` block (after `.card li{...}`), before the market-trend SVG rules. Comment must not contain a backtick:

```css
/* /brokers offer — two stacked ledgers. Do not reuse .steps (sequence) or
   .grid (the old two-card band). /markets still uses .grid; this page does
   not. Rows are visible on first paint: this sheet has no html.anim. */
.bkhead{font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:19px;color:var(--ink);
  margin:28px 0 0;letter-spacing:normal;text-transform:none}
.sub + .bkhead{margin-top:8px}
.bk{border:1px solid var(--edge);border-radius:6px;overflow:hidden;background:var(--card);margin-top:12px}
.bkrow{display:grid;grid-template-columns:1fr;gap:8px;padding:22px 24px;border-bottom:1px solid var(--hair)}
.bkrow:last-child{border-bottom:0}
.bklag{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--red);padding-top:2px}
.bk h3{font-size:14.5px;font-weight:600;color:var(--ink);margin:0 0 8px}
.bk p{font-size:13.5px;color:var(--ink-mute);margin:0}
.bk .badge{margin:0 0 8px}
.bklinks{margin:14px 0 0}
```

Inside `MARKET_CSS`'s existing `@media (min-width:640px)` block, add:

```css
  .bkrow{grid-template-columns:7.5rem 1fr;gap:20px;align-items:start}
```

Do not add opacity/transition rules. Do not copy HOW_CSS's `.anim .bk` block.

- [ ] **Step 2: Replace the two-card body in `renderBrokersPageHTML`**

Rewrite the standing comment so it matches the page:

```js
  // Reworked 2026-08-13 (two stacked ledgers). Standing rules:
  //   - ONE submit door: the bottom CTA. Nothing above it links to the form.
  //   - Compliance line stays: we connect, we never broker.
  //   - The Verified chip is SHOWN (inline green on span.badge — NOT
  //     class="badge v", whose .v collides with .tile .v in MARKET_CSS).
  //   - Contribute and Pro are two ledgers, not one list, so the vault does
  //     not read as free. Proof line is real MARKET_CREDIT or nothing.
```

Keep the `credits` / `proof` loop unchanged. Replace the `.grid` + two `.card`s (from `// Owner 2026-08-10: no step band` through `` `</div>` + proof ``) with:

```js
  const contributeRows = [
    ["CREDIT", "Submitted comps carry your name",
     "Every report that uses one of your comps shows a green Verified badge and your firm's name.",
     `<span class="badge" style="color:var(--ok-text);background:var(--ok-bg)">Verified &middot; via Your Firm</span>`],
    ["INTROS", "Owners in your markets",
     "When an owner in your market wants a broker's opinion of value, we introduce them to you.",
     ""],
    ["PROFILE", "A public page with your comps",
     "A public profile page with your verified comps.",
     ""],
  ];
  const proRows = [
    ["BOOK", "Upload and organize your book",
     "Upload and organize your comp book.", ""],
    ["PIPELINE", "Watch your markets",
     "Watch your markets for leads.", ""],
    ["PRIVATE", "Exclusively yours",
     "Exclusively private to you.", ""],
  ];
  const ledgerHtml = (rows) => rows.map(([lab, h, p, chip]) =>
    `<div class="bkrow"><div class="bklag">${lab}</div><div>` +
    `<h3>${escHtml(h)}</h3>` +
    (chip ? chip : "") +
    `<p>${escHtml(p)}</p></div></div>`).join("");

  const body =
    `<h1>Your comps, your name, on every report that uses them.</h1>` +
    `<p class="sub">We build valuation reports from public data. Comps confirmed by a local ` +
    `broker rank highest, and they carry that broker's name.</p>` +

    `<h2 class="bkhead">For submitting a comp.</h2>` +
    `<div class="bk">${ledgerHtml(contributeRows)}</div>` +
    proof +

    `<h2 class="bkhead">With Pro.</h2>` +
    `<div class="bk">${ledgerHtml(proRows)}</div>` +
    `<p class="bklinks"><a href="/vault">Open your vault &rarr;</a>` +
    `<span id="upgradeProLink"> &nbsp;&middot;&nbsp; ` +
    `<a href="/?pricing=1">Upgrade to Pro &rarr;</a></span></p>` +

    `<div class="cta"><h2>Have a comp we should know about?</h2>` +
    `<p>It takes about a minute: the address, date, price, and size. We handle the review.</p>` +
    `<a class="btn" href="/?submit=comp">Submit a comp</a></div>` +
```

Leave the 1031 card and compliance `p.disc` exactly as they are today (they already follow the CTA). `escHtml` on headlines and bodies so apostrophes become `&#39;` — the INTROS test matches labels and chip, not the apostrophe form. Do not put `/?submit=comp` anywhere except the CTA.

- [ ] **Step 3: Run tests**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/public-pages.test.js
```

Expected: PASS, including the existing CTA-door, `#upgradeProLink`, and `/brokers?utm=` cases (those last two live in `test/routes.test.js`; run `npm test` if you touched routing, which you should not have).

Then:

```powershell
npm test
```

The Windows `PRO-BILLING-SETUP.md` CRLF failure is pre-existing on main. Do not "fix" it here. Everything else must pass.

- [ ] **Step 4: Commit**

```powershell
git add -- server.js
git commit -m "Draw the /brokers offer as two stacked ledgers."
```

---

### Task 3: Docs stay in step with the page

**Files:**
- Modify: `CLAUDE.md` (the `GET /brokers` bullet, currently ~1055)
- Modify: `devlog.json` (prepend one entry)

**Interfaces:**
- Consumes: the shipped markup from Task 2
- Produces: docs that name two stacked ledgers and the real Submit door

- [ ] **Step 1: Update the CLAUDE.md `/brokers` bullet**

Replace the current two-card / `/#submit-comp` description with:

```
- `GET /brokers` — the broker-facing page (`renderBrokersPageHTML`), nav label
  **"Brokers"**. Hero payoff, then two stacked ledgers: Contribute (CREDIT /
  INTROS / PROFILE, Verified chip shown inline) and Pro (BOOK / PIPELINE /
  PRIVATE). One Submit door at the bottom (`/?submit=comp` — a query the
  account wall can see; a `/#submit-comp` hash never reaches the server).
  Unlike `/how-it-works` it carries no CSS of its own: it renders through
  `marketShell()`, so `MARKET_CSS` / `MARKET_BAR` / `MARKET_FOOTER` style it
  and it likewise does NOT depend on `tailwind.css`. Listed in `sitemap.xml`.
  Do not confuse this with `GET /broker/<slug>`, the per-contributor public
  profile.
```

- [ ] **Step 2: Prepend a `devlog.json` entry**

First object in the array (keep the rest of the file byte-identical). UTF-8, no Windows-1252, no `Ã` / `â€` sequences:

```json
{"date": "2026-08-13", "type": "improvement", "title": "The brokers page is two ledgers, not two cards", "details": "What you get for submitting comps and Pro: the Broker Vault sat as peer bullet cards, so the page still read as a feature list after How it works had already drawn those trades as a statement. They are now two stacked hairline ledgers — Contribute (Credit with the Verified chip, Intros, Profile) then With Pro (Book, Pipeline, Private) — so the vault does not look like it comes with a submitted comp. The one Submit button, the 1031 card, and the compliance line are unchanged."}
```

Validate: `node -e "JSON.parse(require('fs').readFileSync('devlog.json','utf8'))"`

- [ ] **Step 3: Run tests once more, then commit**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/public-pages.test.js
git add -- CLAUDE.md devlog.json
git commit -m "Describe /brokers as two ledgers, matching the page."
```
