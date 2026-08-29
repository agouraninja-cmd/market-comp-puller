# Firm-First Rail Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the firm the frame the product sits in. A public front door for firm accounts (`/firms`, `/pricing` with a Firm tier), then a persistent left rail on every signed-in page with the Workspace as home.

**Design:** Approved on the canvas at https://claude.ai/code/artifact/b5081469-ca2d-49c2-88af-f7c61165cd6a (page "Direction A — the rail"). Alternate B — tabs on the desk — was drawn at the same fidelity and rejected: it leaves the vault, market pages and reports with no sign a firm exists.

**Ordering (owner's call, 2026-08-28):** the **front door ships first**. The driver is a broker pitch, and what a pitched broker touches after the meeting is a link — one that today cannot be sent, because `/firms` does not exist, `/pricing` has no URL, and buying seats is a `window.prompt()`. Tasks 1–2 are independent of the shell (both are new `marketShell` bodies), so nothing is reworked by shipping them early. The vault/hub chrome fold moved **last**: it is the riskiest task, the least required, and it touches the page holding brokers' private books.

**Architecture:** The rail is **not a new component**. Every surface already renders the same header shape — brand, `<nav>`, account slots, inside a centered container. One class on `<html>` re-lays that element out at ≥900px: fixed, vertical, 224px, `border-right` instead of `border-bottom`, plus `padding-left:224px` on the body. **No content wrapper moves** — the centered bands (`.wrap` at 1120px, `max-w-5xl mx-auto` in the app) re-center inside the padded body on their own. Below 900px the class does nothing and today's wrapping bar returns, so the phone answer costs no drawer. Markup is byte-identical in both modes, which is what keeps the existing header tests green.

**Tech Stack:** `server.js`, `index.html`, `vault-page.js`, `hub-page.js`, `node:test`, zero npm deps.

## Global Constraints

- Zero npm dependencies; `npm test` is `node --test`. Every task ends green.
- **`NAV_SHELL` is the rollback lever**: `rail` (default once shipped) or `bar` (today's chrome exactly). Unrecognized value **exits at boot**, per the `SEARCH_PROVIDER` / `THINKING_LEVEL` no-fallthrough rule. It gates a CSS class only — never a second markup branch.
- The rail is for **signed-in visitors only**. Anonymous marketing pages keep the top bar. Decide on cookie presence, never `getSessionUser()` (these render synchronously); the affected routes already send `vary: cookie`.
- **Theme tokens only** in server stylesheets — `theme.test.js` allows one raw hex (`color:#fff`) and requires every `var(--x)` to be a `theme.js` key. The 224px rail width is a **literal**, not a new `--rail-w` token.
- **One `id="themeToggle"` in all of server.js** and **exactly two `${FOOTER_DARK_CSS}` interpolations**. The rail reuses `accountNavSlots`; it never adds a second toggle or a third footer stylesheet.
- **`THEME_BOOT` must stay inside `marketShell`'s first 2000 characters** — a class on the `<html>` tag is fine, markup above the `<style>` is not.
- New utility classes in `index.html` require regenerating the vendored `tailwind.css`. **Do not** — hand-write the shell in index.html's `<style>` block, the precedent set by `.rd-appbar`, `.rd-desk` and `.rd-heroband`. Hand-written CSS also sidesteps the dark-bridge rule that demands a `[data-theme="dark"]` selector per new colour utility.
- The rail carries `no-print no-capture`; `body{padding-left:0}` inside `@media print`.
- **Verify against `origin/main`, not memory.** The header changed on 2026-08-28 (a `Home` link now leads `marketBar`'s nav, inside a new `.hleft` wrapper) and both footers moved from TikTok to LinkedIn. Re-read before editing.
- Shared checkout: never `git add -A`; stage explicit paths. This work has its own worktree (`cn-firm-front-door`, branch `feat/firm-front-door`).
- Show a before/after per the standing rule: `node scripts/shot.js / /vault /markets --before`.

---

## Phase 1 — the front door

### Task 1: `/firms`, the public pitch

**Files:**
- Create: `firms-page.js` (a marketShell **body**, the `bulk-page.js` pattern)
- Modify: `server.js` (route, `sendShellPage`, `sitemap.xml`, footer + anonymous nav)
- Create: `test/firms-page.test.js`

- [ ] Write failing tests first: the route answers 200 and is in the sitemap; the three shop-kind panels quote `ORG.SHOP_COPY`'s real `arrivals` strings and are pinned to `org-access.js` so they cannot drift; the compliance strings appear (automated estimate never an appraisal, CompNinja is not a brokerage, "we connect **you** with a local broker") and the forbidden ones do not; an anonymous visitor gets both auth doors and a signed-in one gets neither.
- [ ] Build the body: hero, three shop-kind panels, a shelf exhibit, a "what stays private" section, seat teaser, compliance strip. **Check each privacy claim against the code before shipping it as a public promise** — they restate what the product actually does.
- [ ] Reference `brandGraph()`'s `ORG_ID` / `WEBSITE_ID`; never inline a second Organization node.
- [ ] Add to `sitemap.xml`, both footers, and the anonymous nav.
- [ ] Run `npm test` — green.

### Task 2: `/pricing` and the Firm tier

Pricing is a modal in one file today, so it can never be linked, indexed, or sent in an email — and the firm has no tier on it at all, though `firm_monthly` per-seat billing already exists on the backend.

**Files:**
- Create: `pricing-page.js`
- Modify: `server.js` (route, `sitemap.xml`), `index.html` (seat purchase UI)
- Create: `test/pricing-page.test.js`

- [ ] Server-render `/pricing`: Free / Pro / **Firm — per seat, monthly**, Founding demoted to a footnote. The modal stays as the in-app shortcut; the page is the linkable surface. Tier facts come from `entitlements.js`' real numbers, not prose invented here.
- [ ] **The seat price is not yet set.** Render the Firm tile with a placeholder price and **no buy control** — the Buy-button rule: a control that can only fail never renders. A test pins that no checkout call is wired until a price exists.
- [ ] Replace the `window.prompt()` seat purchase in `index.html` with a real control, keeping every existing rule: owner-only, seats-below-headcount refused by name and number, the webhook writes seats from the subscription rather than the request.
- [ ] `/api/checkout`'s `PLANS` map has **no fallthrough** — do not restore a default.
- [ ] Run `npm test` — green.

## Phase 2 — the shell

### Task 3: Close the nav parity gap that already exists

`APP_NAV_LINK_CLASS` ↔ `#pricingLink` parity is enforced by prose alone and **has already drifted** — Pricing moved out of the dropdown on 2026-08-21 and those utilities now survive the purge only incidentally. Land the guardrail before touching the nav.

**Files:**
- Modify: `test/index-html.test.js`

- [ ] Add a test that every class in `APP_NAV_LINK_CLASS` (read from `server.js`) exists as a selector in the vendored `tailwind.css`, copying the escaping pattern already in that file.
- [ ] Run `npm test` — green.

### Task 4: The shell, on the server-rendered pages

**Files:**
- Modify: `server.js` (`NAV_SHELL`, `MARKET_CSS`, `HOW_CSS`, `marketShell`, `renderHowItWorksHTML`, `accountNavSlots`, `ACCOUNT_NAV_JS`)
- Modify: `test/routes.test.js`, `test/theme.test.js`

- [ ] Failing tests: a signed-in `/markets` carries `class="nav-rail"` on `<html>`; an anonymous one does not; `NAV_SHELL=bar` never emits it; an unrecognized value exits at boot; the eight-page header assertions still pass unchanged.
- [ ] Add `NAV_SHELL` beside the other flags, with a boot banner line and the no-fallthrough exit.
- [ ] Add the rail block to `MARKET_CSS`, scoped `@media (min-width:900px){ html.nav-rail … }`, and mirror it into `HOW_CSS`.
- [ ] **The Explore `<details>` is hidden in rail mode** — its links move to the footer. Do not try to flatten a closed `<details>` with CSS; the UA hides non-summary children and overriding that is engine-fragile.
- [ ] `accountNavSlots` gains a `#navRailEmail` span, shipped `hidden`, unhidden by `ACCOUNT_NAV_JS` only in rail mode. Arrange the existing cluster with CSS `order` — do not reorder the markup, or the theme test's slice of the toggle handler breaks.
- [ ] Run `npm test` — green.

### Task 5: The rail's item list, and the footer that absorbs the rest

**Files:**
- Modify: `server.js` (`NAV_LINKS` consumers, `MARKET_FOOTER`, `marketBar`)
- Modify: `test/routes.test.js`, `test/inapp-nav.test.js`

- [ ] Rail items: **Workspace · Markets · Vault · Bulk valuation**, then the red **Value a building** CTA. Vault and Bulk keep today's `canUseVault` / `canBulkValue` hydration and ship `hidden`; the rail is a fixed width so their arrival never reflows the page.
- [ ] **Reconcile `Home` with `Workspace`.** `marketBar` gained a `Home` link on 2026-08-28 pointing at `/`. Under this model a signed-in member's `/` **is** the Workspace, so the two are one destination: the rail carries Workspace and suppresses Home for signed-in visitors. Anonymous top-bar mode keeps Home exactly as it ships today — that link solved a real reported bug and must not regress.
- [ ] Move the `NAV_LINKS` entries into `MARKET_FOOTER`, which **fixes the standing gap that `/download` appears in neither footer**. The `nav-dl` class travels with the link so `INAPP_BOOT` still hides it in-app; `inapp-nav.test.js` pins the `NAV_LINKS` entry byte-exactly and keeps passing because the data is unchanged.
- [ ] Reconcile the two footers, which have drifted despite a keep-in-step comment.
- [ ] Run `npm test` — green.

### Task 6: The app's rail

**Files:**
- Modify: `index.html` (the `<style>` block; header markup untouched), `server.js` (`authBoot`)
- Modify: `test/auth-boot.test.js`, `test/index-html.test.js`

- [ ] Add `nav-rail` to the classes `authBoot` appends to `documentElement`, alongside `cn-in` / `cn-locked`. It runs before first paint, so the rail never flashes.
- [ ] Hand-write the shell rules in index.html's `<style>` block, mirroring Task 4's geometry against `.rd-appbar` and `body`. **No new Tailwind utilities.**
- [ ] Verify the four `max-w-5xl mx-auto px-4` bands need **no edit**. If one does, the shell is wrong, not the band.
- [ ] Keep the rail below `z-[1100]` so the eight body-level modals still cover it.
- [ ] Run `npm test` — green, then verify in the browser at desktop and 375px.

### Task 7: The Workspace — home becomes the firm

**Files:**
- Modify: `index.html` (`#deskView` decks, the view machine, `showDeskView`/`showHomeView`), `server.js` (path allowlist, `/desk` redirect)
- Modify: `test/routes.test.js`, `test/index-html.test.js`

- [ ] Invert the two-state machine's default: `/` renders the Workspace for a signed-in visitor; the valuation form becomes its own view at **`/value`** (add it to the path allowlist — the handler matches on path, not raw URL). `/desk` 302s to `/`, and the Stripe return `/desk?checkout=success` follows.
- [ ] Reorder `#deskView`'s decks so firm content leads: **firm shelf → deal board → your properties**.
- [ ] Add the **address launcher** at the top of the Workspace. This replaces the tools strip from the earlier draft: with the rail carrying Markets/Vault/Bulk, a strip repeating those links is redundant, so the space holds the tool itself.
- [ ] Solo members: personal shelf plus the firm-creation card. The page is never empty.
- [ ] Run `npm test` — green.

### Task 8: The copy sweep

**Files:**
- Modify: `index.html`, `server.js` (`marketBar`, `accountNavSlots`, digest + invite emails), `vault-page.js`, `bulk-page.js`
- Modify: `test/routes.test.js`, `test/account-wall.test.js`

- [ ] "My Desk" → "Workspace" everywhere a person reads it, including the watchlist digest emails that link to `/desk`, the org invite email, and `/bulk`'s "Open My Desk" link.
- [ ] The tests asserting exactly one `>My Desk<` on `/how-it-works` and `/vault` become `>Workspace<`, keeping the no-double-link invariant.
- [ ] Run `npm test` — green.

## Phase 3 — cleanup, deliberately last

### Task 9: Fold the two stray shells onto the shared chrome

`vault-page.js` and `hub-page.js` bypass `marketShell` and `MARKET_CSS` entirely. **This is the riskiest task in the plan and the least required** — the rail works without it if you accept one more copy of the chrome CSS. Do it only once Phases 1–2 are shipped and steady.

**Before starting:** `vault-page.js` had uncommitted changes in the main checkout on 2026-08-28. Confirm nobody is mid-edit.

**Files:**
- Modify: `vault-page.js`, `hub-page.js`, `server.js`
- Modify: `test/vault-page.test.js`, `test/hub-page.test.js`

- [ ] Port `/vault` to render a **body** through `marketShell`, retiring its hand-written header — including its drifted Explore menu (Markets and "Run a report", missing Download) and its truncated Escape script.
- [ ] `hub-page.js` is **client-facing** — recommend it does **not** get the rail: a hub is shown to someone else's client, who is not inside your product.
- [ ] Run `npm test` — green.

### Task 10: Docs

**Files:**
- Modify: `CLAUDE.md`, `devlog.json`
- Modify: `docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md`

- [ ] CLAUDE.md: a section for the rail shell and `NAV_SHELL`; update the `NAV_LINKS` / `marketBar` / footer prose, the `/desk` → `/` route change, and the chrome-copies note.
- [ ] `devlog.json`: one entry per shipped task, clean UTF-8, never Windows-1252.
- [ ] Point the enterprise spec at this plan and the canvas.
- [ ] Run `npm test` again.

---

## Open decisions

1. **The firm seat price.** Blocks only Task 2's buy control; the page ships without it.
2. **Locked tools in the rail** — resolved: show Vault and Bulk greyed with a Pro chip. Bulk has one door today (the account dropdown), which is why nobody finds it.
3. **The landing hero** — resolved: "Put your whole shop on the same page."

## What this plan deliberately does not do

- **No SPA rewrite.** Markets, guides, legal and hub pages keep server rendering; only their chrome's layout changes.
- **No router.** Markets, Vault and Bulk are real navigations. Only Workspace ↔ Value-a-building stays client-side, so the existing two-state machine survives, renamed.
- **No mobile drawer.** Below 900px the rail is simply not applied.
- **No change to any report, valuation, comp or entitlement rule.** This is chrome, navigation and two new public pages. If a task finds itself editing `valuation.js`, `entitlements.js` or `comp-gate.js`, it has gone wrong.
