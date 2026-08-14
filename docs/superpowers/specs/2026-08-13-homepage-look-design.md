# Homepage look: a building, one report, not a methodology page

Date: 2026-08-13
Status: agreed
Touches: `server.js` (`HOW_CSS`, `renderHowItWorksHTML`), `index.html`
(address handoff from the landing form), `test/public-pages.test.js`,
`test/account-wall.test.js`, `devlog.json`, `CLAUDE.md`

Source: visual critique of production `/` (the account-wall landing). The
research-desk identity is the right genre. The page currently looks like
`/how-it-works` wearing a homepage's URL: the same sample report twice, no
address to type, every section the same bordered card.

This does **not** replace the 2026-07-14 Research Desk direction, the
2026-08-05 account wall, or Direction E (hero claim + exhibit). It reshapes
the shared landing those specs put at `/`.

## 1. The problem

Under `ACCOUNT_WALL`, a logged-out visitor at `/` gets
`renderHowItWorksHTML({ home: true })`. That render is a proof page: a
headline about handing someone a report, a "Create a free account" button,
a compact sample, a stat strip, then the **same** sample again, larger,
then Method, FAQ, a three-up Brokers clone of Method, and a closing card.

Five look failures, in order of damage:

1. **The product is shown twice.** Hero mini-exhibit and the "The Report"
   section quote the same Rancho Cucamonga industrial, the same
   $4,580,000–$5,140,000, the same five comps. After the first card the
   page has nothing new to look at.
2. **There is no address on the homepage.** The most characteristic object
   in this product is a building you type. The 2026-07-14 landing had that
   form as the hero. The wall moved `/` onto a different HTML document, and
   the form did not come with it. The hero is a locked door.
3. **The left hero column is empty.** 42px Georgia, a short lead, a button,
   then a cream void. The interesting object is the card on the right.
4. **Every section is the same card.** Mini exhibit, full exhibit, Method,
   FAQ, Brokers, closing CTA: 6px radius, 1px edge, kicker + serif h2. The
   gray Method band is too shy to count as a change of register.
5. **Brokers is Method with different labels.** Same three-up. `/brokers`
   already does this job; the landing only needs a path there.

The identity is not the problem. Cream paper, Georgia headlines, hairline
rules, one red, arithmetic that checks out: keep all of that.

## 2. What this is not

- Not a new visual identity. Tokens, type pairing, cut-card mark, and
  "would a broker trust this with a $4M building?" stay as 2026-07-14
  approved them. No webfonts, no gradients, no dark hero, no second
  accent.
- Not splitting `/` from `/how-it-works`. While the wall is on they stay
  the same bytes, `/how-it-works` still canonicalizes to `/`, and the
  sitemap still lists `/` only. This spec restyles the shared render.
- Not lowering the wall. Anonymous visitors still cannot search. The
  landing form hands off to `/?auth=signup` (or `/` when already signed
  in). `/api/comps` is untouched.
- Not putting the real `#compForm` on the landing. The landing is a
  different HTML document. Type is still resolved at verification inside
  the app. The landing asks for an address only.
- Not a map, Street View, or live report on this page. The sample exhibit
  stays illustrative, captioned, and arithmetically honest.
- Not restyling market pages, `/brokers`, the app, or the footer.
- Not a new endpoint, table, or migration.

## 3. Decisions

1. **The page's job is "type a building, see that we show our work."**
   Not "here is exactly how a report gets built." Method and FAQ stay
   below, as proof, not as the hero.
2. **One sample report, in the hero, the full exhibit.** Drop `.exmini`
   and drop the below-fold "The Report" section. The hero right column
   carries today's full exhibit (title block, ledger, drivers, five comps,
   badge legend). The figures stay the current honest set (median of those
   five $/SF × 21,600 SF).
3. **The left column is an address field.** Bordered research-desk cell,
   uppercase micro-label, red submit **"Run a report"**. Fine print names
   the free account and the automated-estimate rule. Header "Create
   account" stays for visitors who do not want to type yet.
4. **The street address never rides in the URL.** `GET /?auth=signup&address=`
   would log every building a stranger typed. The form writes
   `sessionStorage['pendingLandingAddress.v1']` and then navigates. The
   app fills `#address` and deletes the key. Noscript degrades to the
   existing `/?auth=signup` link with no address.
5. **The stat strip goes away.** It is four muted cells between two copies
   of the same report, and "Free / To start" is a hedge. The pinned truths
   ("Up to 12", "minute") move to one proof line under the form.
6. **Brokers collapses to one block**, not a second Method. The three
   trades stay in the copy (privacy, Verified + firm name, `/brokers`
   link). The Verified chip is shown, not only described.
7. **Exactly one address field**, in the hero. The closing CTA is a
   second-chance button through the auth door, not a second form.

## 4. Architecture

Two files. The landing cannot search; the app cannot be the landing.

```
renderHowItWorksHTML          index.html
  hero: claim + address form     boot: ?auth=signup opens the modal
        + ONE full exhibit       boot: pendingLandingAddress.v1 → #address
  Method / FAQ / brokers / CTA   (then delete the key)
           |                              ^
           |  sessionStorage + navigate   |
           +------ /?auth=signup ---------+
                   (signed-in: / )
```

`HOW_CSS` restyles. `renderHowItWorksHTML` reorders the body. `index.html`
gains a ~15-line boot read next to the existing `?auth=` modal open. No
new route. The wall's door list does not grow.

### Address handoff

Landing form, anonymous render (`signedIn` false):

1. Submit (JS): trim the address; if empty, do not navigate.
2. `sessionStorage.setItem("pendingLandingAddress.v1", address)`.
3. `location.href = "/?auth=signup"`.

Landing form, signed-in render (`/how-it-works` with a `cn_session`
cookie — members who opened How it works from the app):

- Same storage key, then `location.href = "/"`. No modal. `/` is already
  the app for a cookie.

`index.html`, after the existing `?auth=` modal open:

- Read the key. If it is a non-empty string, assign it to `#address` and
  `sessionStorage.removeItem` immediately (one-shot, matching
  `pendingMarketExplore` / `closeAcctModal` discipline).
- Do **not** auto-submit. Type is still unresolved. Filling the box is
  the whole handoff.
- Missing `sessionStorage` (private mode) is a no-op; the modal still
  opens from `?auth=signup`.

A dismissed modal must not surprise-search later. Deleting the key at
fill time means the address lives only in the input, which is what the
visitor typed.

Do not add `address` to the `?auth=` query, and do not add `address` as
a new wall door. `/?auth=signup` and cookie-present `/` already serve
the app.

### Discriminator

`test/account-wall.test.js` tells landing from app by
`class="heroCta"` vs `id="compForm"`. The address form's wrapper **keeps
`class="heroCta"`**. Do not rename it.

## 5. Page, top to bottom

Keep the header, the footer, the theme toggle, and the scroll
choreography rules (hero claim does not fade; exhibit rules/rows still
draw in; `html.anim` still no-JS safe).

```
header                          unchanged
hero2
  left:  h1, lead, address form, proof line
  right: full exhibit + badge legend
Method band                     kept, the one change of register
FAQ                             kept
Brokers                         one block, not a 3-up
closing CTA                     button only
footer                          unchanged
```

### Hero, left

- **H1 stays:** "A report you can hand to someone who will argue with it."
- **Lead** drops "Here is exactly how that gets built." Replacement:
  "Every report answers the question and then shows its work: a value
  range, the comps behind it, and where each one came from."
- **Form:** one text input (label "Address", placeholder
  `e.g. 1200 W Industrial Blvd, Dallas, TX` — the same example the app
  field already uses, not "Search"). Submit label **"Run a report"**.
  The modal the wall already opens says "Create a free account to run a
  report. It's free, no card needed." so the button is allowed to name
  the product, not the gate.
- **Fine print** under the button: "Free account. Automated estimate,
  not an appraisal."
- **Proof line** (replaces the stat strip): "Up to 12 cited comps ·
  about a minute · every source disclosed." Those two pinned substrings
  (`Up to 12`, `minute`) must remain.

Desktop: the form is what fills the cream void. Do not change the h1
type scale in this spec (38px / 42px). The identity is quiet type, not
a bigger billboard.

### Hero, right — the one exhibit

Today's full exhibit, not `.exmini`:

- Caption: "Sample report · Industrial · Rancho Cucamonga, CA" /
  "Illustrative"
- Address, meta, "What This Building Is Worth" ledger (Low / Likely /
  High, same figures, Likely still named as the comp median in the full
  copy)
- "What's Driving Prices Here" (the three existing driver lines)
- Five-comp table and double-ruled median
- Badge legend + "Badges under-claim, never over-claim."

Same `SAMPLE_*` constants. Do not invent a second sample. Do not let the
hero and anything below quote different numbers; after this spec there
is only one quote.

On viewports below 900px the stack is claim, form, exhibit — same order
Direction E already uses, minus the duplicate further down.

### Method

Keep the three steps, Roman numerals, copy. This band is the page's one
change of register: it already sits on `--wash`. Raise the band
section's vertical padding from 48px to 72px so the wash reads as a
different surface, not another card in the same scroll. Do not restyle
it as a dark slab (the 2026-07-14 spec rejected a dark hero). Do not
reuse this 3-up for Brokers.

### FAQ

Unchanged. Still the single `HOW_FAQ` array that feeds the accordions
and the FAQPage JSON-LD.

### Brokers

Replace the three `.step` cells with one short block:

- Kicker `Brokers` (keep)
- H2 **"What brokers get."** (pinned)
- The Verified chip, shown
- Body that still states the privacy trade (`public records unless you
  choose to publish`) and the credit (`Verified badge` + firm name)
- `See the broker side →` to `/brokers`

### Closing CTA

Keep "See it on your own building." Anonymous: button through
`/?auth=signup`, copy may say "Run a report" to match the hero. Signed
in: `/` as today. No second address field. No `class="btn" href="/"`.

## 6. Visual rules

- **Spend the signature on the exhibit and the address field.**
  Everything else gets quieter, not busier.
- Research-desk form cell: hairline border, `--card` ground, uppercase
  micro-label, borderless input inside, red fill button. Same family as
  the 2026-07-14 hero form, one cell instead of many.
- Tokens only. No new hex that is not already a `--*` in `THEME_CSS`.
- Motion: existing exhibit choreography applies to the one remaining
  exhibit. Do not add a new animation to the address field. Reduced
  motion and no-JS still reveal the whole page.
- Copy: no em dashes; "connect you with a local broker"; "automated
  estimate," never "appraisal."

## 7. Tests

Existing pins that must still pass, some against new locations:

- `test/account-wall.test.js` — `class="heroCta"` still marks the
  landing; `/?auth=signup|signin` still serves the app; `/how-it-works`
  still canonicalizes to `/` while the wall is on; no `class="btn"
  href="/"`.
- `test/public-pages.test.js` — `Up to 12` and `minute` still appear on
  `/`; "What brokers get", `/brokers`, the privacy sentence, and the
  Verified + firm-name credit still appear on both `/` and
  `/how-it-works`; FAQ JSON-LD unchanged in substance.
- `test/theme.test.js` — `THEME_BOOT` still in this render.

New pins:

- `/` (anonymous, wall on) contains an address `<input>` and does **not**
  contain `id="compForm"`.
- `/` contains exactly one sample address `9020 Center Ave` (the
  duplicate exhibit is gone). Matching the string twice today is the
  bug; matching it once is the fix. The caption and the first table row
  may both name it — count **exhibit blocks** (`.exhibit`) === 1, not
  the string.
- `/` has no stat strip (no `.stats`, no "To start" hedge).
- `/` has no Brokers 3-up (no `.steps` inside the Brokers section).
  Method still has `.steps`.
- A small `index.html` source test: the boot path reads
  `pendingLandingAddress.v1` and writes `#address`. Do not boot a
  browser; the file is searchable the same way other index.html pins
  work.

## 8. Out of scope (follow-ups, not this spec)

- Splitting `/` and `/how-it-works` into different pages.
- A map of the sample comps, or any photo on this page.
- Auto-running a search after signup. Type confirmation stays in the app.
- Changing `ACCOUNT_WALL`, entitlements, or `/api/comps`.
- Restyling `/brokers`, market pages, or the in-app report.
- A new `?address=` query door.

## 9. Rollback

The landing is one render function and one CSS block. Reverting the
commit restores the current proof page. The `index.html` boot read is
inert without the storage key and can ship in the same commit or come
out with it. `ACCOUNT_WALL=off` still serves the app at `/` and this
layout only at `/how-it-works`.
