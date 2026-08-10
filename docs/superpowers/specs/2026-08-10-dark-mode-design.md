# Dark mode

Status: AGREED 2026-08-10. Not yet implemented.

## 1. What this is

A site-wide dark theme covering the app (`index.html` — search, report, My
Desk, shared reports) and every public server-rendered page (the landing page,
`/how-it-works`, `/markets`, `/market/<slug>`, `/brokers`, `/broker/<slug>`,
`/1031-exchange`, `/terms`, `/privacy`, `/vault`). It follows the visitor's OS
preference on first visit and can be overridden by a toggle in the header,
remembered across pages.

The admin dashboards (`/admin`, `/dev`, `/hq`, `/contacts`) are **out of
scope**. They are four more self-contained CSS blocks, and nobody outside the
team ever opens them.

## 2. What this is not

- **Not a redesign.** No layout, spacing, type or component changes. The light
  theme must come out of this byte-identical in rendered appearance.
- **Not a refactor of `index.html`'s markup.** The alternative — replacing all
  ~660 arbitrary Tailwind color utilities with semantic classes — is a cleaner
  end state and was rejected: it is a large blind diff across a 12,767-line
  file with no front-end test coverage, it needs a Tailwind regen, and its
  failure mode is silent regressions *in the theme that already works*. Adding
  a feature must not risk the one that ships today.
- **Not a `filter: invert()` hack.** Ten lines, and it turns brand red into
  cyan, wrecks the map, and inverts Street View photography.
- **Not dark email.** `email-shell.js` is untouched.

## 3. Why this is cheap here, and the measurement behind that claim

`index.html` looks hostile to theming — colors live in Tailwind *class names*
(`text-[#68707E]`), not in declarations, so they cannot be swapped by
redefining a variable. But the file is disciplined: its own token comment says
"the whole site draws from these; don't invent new values," and the counts bear
that out.

Measured 2026-08-10:

| Surface | Distinct color utilities / values |
|---|---|
| `index.html` arbitrary color utilities | 46 |
| `index.html` state variants (`hover:`, `focus:`) | 19 |
| `index.html` distinct hex values, any form | 59 |
| `MARKET_CSS` + `ACCOUNT_NAV_CSS` distinct hexes | 29 |
| `HOW_CSS` distinct hexes | 27 |
| Inline `style=` color attributes | 9 (mostly map pins) |

The decisive finding is that the server CSS blocks draw from **the same
palette** as `index.html` — `#1A2433`, `#68707E`, `#D8D4C9`, `#5A6473`,
`#B91C1C`, `#F5F4EF` dominate both. The union across every in-scope surface is
roughly 35 distinct values. One token table covers the whole site.

The site also already knows what it looks like dark. `index.html`'s token
comment documents an existing slate ramp used for the hero bookend, the footer,
the logo tile and the table header:

> Dark surfaces (slate only): slate-950 `#020617` bookends · slate-900
> `#0F172A` ink · slate-800 `#1E293B` lifted ink (hover = slate-700 `#334155`)

The dark theme is built from that ramp. It introduces no new brand colors.

## 4. The token table

`theme.js` — a new pure module, no I/O, no clock reads, no requires — is the
single source of truth. It exports `THEME_TOKENS` (semantic name → `{ light,
dark }`) and `rootCss()`, which emits the `:root` and `[data-theme="dark"]`
custom-property blocks.

### 4.0 The vocabulary already exists — adopt it, don't invent one

`vault-page.js` and all four admin dashboards already declare an identical
`:root` token block, five pages deep:

```css
--ink:#1A2433;--ink-2:#4C5665;--ink-3:#68707E;--ink-4:#C7CBD2;
--red:#B91C1C;--red-deep:#991B1B;--green:#15803D;
--paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
```

`theme.js` therefore **adopts these names and their exact light values**
rather than introducing a parallel set. Three consequences, all good:

- `vault-page.js` needs no find-and-replace at all. It swaps its literal
  `:root` block for `${THEME_CSS}` and inherits dark mode.
- The light theme provably cannot shift on those pages, because no light value
  changes.
- The out-of-scope dashboards (§1) become nearly free to add later, since they
  already consume these names. That strengthens leaving them out now rather
  than arguing for pulling them in.

New tokens are added only where the existing set has a genuine gap. They use
role names (`--ink-body`, `--ink-mute`, `--ink-faint`) rather than extending
the `--ink-N` ramp, because `--ink-2` is already `#4C5665` and renumbering it
would silently restyle five shipped pages.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--paper` | page background | `#FBFBF9` | `#020617` |
| `--card` | *new* — card surface, distinct from paper | `#fff` | `#0F172A` |
| `--wash` | lifted surface (table head, chips, hover rows) | `#F5F4EF` `#F1F0EC` `#F8FAFC` `#FCFBF8` | `#1E293B` |
| `--wash-2` | *new* — hover step above `--wash` | `#F5F4EF` | `#334155` |
| `--edge` | primary border (×100) | `#D8D4C9` | `#334155` |
| `--line` | border | `#E4E2DA` `#E7E3DA` | `#273244` |
| `--hair` | hairline / divider | `#F0EFE9` `#ECEAE3` `#EFEDE7` | `#1E293B` |
| `--ink` | primary text (×151) | `#1A2433` | `#E2E8F0` |
| `--ink-body` | *new* — secondary text (×40) | `#374253` `#46536A` | `#CBD5E1` |
| `--ink-2` | tertiary text (×22) | `#4C5665` | `#C2CCDA` |
| `--ink-mute` | *new* — muted text (×50) | `#5A6473` | `#AEBACB` |
| `--ink-3` | muted text, the workhorse (×154) | `#68707E` `#8A8577` | `#94A3B8` |
| `--ink-faint` | *new* — faint text | `#9AA2AD` `#8F99A8` `#8A93A0` | `#7C8899` |
| `--ink-4` | outlines, disabled | `#C7CBD2` `#B8C0CC` `#D5DAE2` | `#475569` |
| `--red` | link / accent **text** | `#B91C1C` | `#F87171` |
| `--red-deep` | link text hover | `#991B1B` | `#FCA5A5` |
| `--red-fill` | *new* — filled button background | `#B91C1C` | `#DC2626` |
| `--red-fill-hover` | *new* — filled button hover | `#991B1B` | `#B91C1C` |
| `--green` | positive | `#15803D` | `#34D399` |
| `--ok-text` / `--ok-bg` / `--ok-rule` | *new* — verified | `#06603A` `#E7F5EE` `#BFE5D2` | `#6EE7B7` `#0C2B21` `#155E43` |
| `--warn-text` / `--warn-bg` / `--warn-rule` | *new* — caution | `#8A6D1A` `#FBF3DC` `#EDDFB0` | `#FCD34D` `#2A2410` `#5B4A16` |
| `--err-bg` | *new* — error tint | `#FCF1EF` | `#2A1517` |
| `--slab` | *new* — surfaces already dark in light mode | `#1A2433` / slate-900 | `#1E293B` |

`theme.js` carries the **complete** enumeration; the table lists the dominant
light values per token. The remaining low-count values fold into the nearest
token above. No light value present anywhere in scope is left unmapped; §10.1
is the test that enforces that.

### 4.1a Folding shifts 15 light values, and that was measured and approved

A token system has fewer tokens than the palette had hexes, so folding is the
point rather than a side effect — but it means a folded colour renders
slightly differently in **light** mode, which the "light theme must not
change" rule would otherwise forbid. Measured on the Task 2 sweep and
approved by the owner on 2026-08-10; extended on the same terms to Task 4's
`index.html` sweep (the Research Desk CSS) during its fix round 2.

- 28 distinct hexes across `ACCOUNT_NAV_CSS`, `MARKET_CSS` and `HOW_CSS`
  reduce to the token set; **15** of them land on a token whose light value
  differs from the original. Task 4's `index.html` sweep adds **4** more
  distinct hexes at this same drift tolerance (three other folds it makes,
  `#FCFBF8`, `#E3F2EA`, `#F7EFDC`, reuse hexes already on this list at the
  same token and the same delta, so they are not new entries).
- Maximum drift is **ΔRGB 25 of a possible 441 (~6%)**, and only two values
  reach it. Everything affected is a hairline, a tint, or faint secondary
  text. No folded colour is ever rendered beside its original, which is what
  makes the difference unobservable in practice rather than merely small.
- Largest first: `#7A5B12`→`--warn-text` (25), `#8A93A0`→`--ink-faint` (25),
  `#B8C0CC`→`--ink-4` (20), `#D5DAE2`→`--line` (19), `#8F99A8` (15),
  `#F8FAFC`→`--wash` (15), `#E2E8F0` (14), `#F7F6F2`→`--hair` (13),
  `#94A3B8` (13), `#FCFBF8`→`--wash` (13), `#EAEEF4` (10), `#F1EFE8`→
  `--wash` (9), `#ECEAE3` (9), `#46536A` (8), `#E3F2EA` (6), `#F7EFDC` (6),
  `#E7E3DA` (3), `#FCFCFA`→`--paper` (2), `#F4F3EE`→`--wash` (2).
  ⚠ Two entries above are corrected, not new: `#F8FAFC` and `#FCFBF8` were
  recorded in the original Task 2 report at (4) and (1), but both fold to
  `--wash` (`#F5F4EF`), and recomputing ΔRGB against that exact value gives
  15 and 13, shown above. Found while reconciling Task 4's new deltas
  against this list (fix round 2); not investigated further back than
  Task 2. Every value here, corrected or new, is comfortably inside the 25
  bound — the correction changes the recorded number, not the conclusion.

The alternative — roughly 11 extra tokens so every hex keeps its exact
value — was considered and declined: it grows the table by 40% and adds 11
more dark values to choose, to remove differences nobody can see. Drift
outside the list above is still a defect.

`--wash-2` has the same light value as `--wash`, so it changes nothing today.
It exists because in light mode a hover above a washed surface *darkens*, while
in dark mode it must *lighten* — one token cannot express both directions.

### 4.2 The one migration `--red` forces

Splitting `--red` into text and fill is not purely additive for the pages that
already use these names. `vault-page.js` has one `background:var(--red)`, which
must become `var(--red-fill)` or a Pro upgrade button turns pale pink in dark
mode. Task 5 changes exactly that one declaration; §10 pins it with an
assertion that no in-scope stylesheet uses `var(--red)` as a background.

### 4.1 Two rules the table encodes that a naive inversion gets wrong

**Brand red splits into text and fill.** `#B91C1C` on a dark page fails
contrast as text, so links and accents lighten to brand-400 `#F87171`. But
*filled* buttons must stay saturated, because white text sits on them —
lightening the fill would put white on brand-400. The same source hex therefore
has two dark values chosen by whether it appears as `text-`/`border-`/`ring-`
or as `bg-`. The hex-keyed bridge in §5 gets this for free: those are separate
class names.

**Surfaces that are already dark must get lighter, not stay put.**
`bg-[#1A2433]` (×6), `bg-slate-900` (×7) and the slate-950 footer are dark
slabs that read as emphasis against light paper. Left unmapped they would
dissolve into a slate-950 page and the emphasis would vanish. They lift to
`--slab` (slate-800). This is the single most common way a dark mode looks
broken and it is invisible unless looked for.

## 5. How the color swap is applied

### 5.1 Server-rendered pages: variables, directly

`MARKET_CSS`, `HOW_CSS` and `ACCOUNT_NAV_CSS` are plain CSS with class
selectors and raw hex, so they consume the tokens directly: `color:#1A2433`
becomes `color:var(--ink)`. Mechanical, ~35 distinct find-and-replaces. Each
block is a template literal, so it interpolates `${THEME_CSS}` at the top — the
variable declarations cannot drift from `theme.js` because they are not copied.

`vault-page.js` is a special case and needs no find-and-replace: it is already
fully tokenized against the vocabulary in §4.0. It swaps its literal `:root`
block for `${THEME_CSS}` (passed in alongside `CN_LOGO` and `MARKET_CSS`, the
argument bag it already takes) and makes the one `--red-fill` change from §4.2.

### 5.2 `index.html`: a bridge layer

`index.html` cannot use variables for its Tailwind utilities, because the color
is in the class name. Instead a bridge block in its existing inline `<style>`
re-points each utility at a token:

```css
@media screen {
  [data-theme="dark"] .text-\[\#1A2433\]        { color: var(--ink) }
  [data-theme="dark"] .hover\:text-\[\#1A2433\]:hover { color: var(--ink) }
  [data-theme="dark"] .border-\[\#D8D4C9\]      { border-color: var(--rule-strong) }
  [data-theme="dark"] .bg-white                 { background-color: var(--card) }
  [data-theme="dark"] .bg-\[\#1A2433\]          { background-color: var(--slab) }
  /* …~75 rules total: 46 base + 19 state variants + ~10 standard-palette */
}
```

Specificity works without `!important`: `[data-theme="dark"] .bg-white` is
(0,2,0) against Tailwind's (0,1,0). State variants are matched at their own
specificity (`[data-theme="dark"] .hover\:bg-\[\#F5F4EF\]:hover` is (0,3,0)
against Tailwind's (0,2,0)), which is why the 19 variants need their own rules
rather than being covered by the base ones.

`index.html`'s inline `<style>` block also contains ordinary CSS with hex
values (skeleton, `.comp-num`, the loading ninja, `::selection`). Those use
`var(--…)` like the server blocks, and `index.html` declares the `:root` and
`[data-theme="dark"]` variable blocks literally, since it is a static file
server.js never templates.

**No Tailwind regen.** The bridge is raw CSS inside the inline `<style>`
element, not new utility classes, so the vendored `tailwind.css` is untouched
and the regen hook has nothing to do.

### 5.3 `@media screen` is load-bearing

The whole bridge is wrapped in `@media screen`. This is not cosmetic: it is
what makes the existing 70-line `@media print` block unreachable by the theme,
so printing cannot regress and that block needs no edits at all. Removing the
wrapper would make a dark-mode user print light text onto white paper. See §7.

## 6. Choosing and persisting the theme

An attribute `data-theme="dark"` on `<html>`, set before first paint by a small
inline script:

```html
<script>(function(){try{var t=localStorage.getItem("theme");
if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
if(t==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();</script>
```

Inline and render-blocking on purpose. Anything deferred or async paints the
light theme first and produces a white flash on a dark page, which is worse
than having no dark mode.

It goes in four `<head>`s: `index.html`, `marketShell()` (server.js:5162),
the `/how-it-works` render (server.js:6638), and `vault-page.js` (:256).

`<meta name="theme-color">` gets a matching pair with `media` attributes so the
mobile browser chrome agrees with the page.

**Caching is unaffected.** The theme is decided entirely client-side and never
changes a byte of server output, so market pages keep their hour cache and
`/how-it-works` keeps its `no-store` / `vary: cookie` split exactly as they are
today.

### 6.1 The toggle

A quiet icon-only button (sun/moon) in the existing nav row, styled like the
neighbouring nav links, not as a switch widget. Two states: it flips and writes
`localStorage.theme`. The OS preference is the *initial* default only; once
clicked, the explicit choice wins on every later visit. There is deliberately
no third "follow system" state — the two-state toggle is what visitors expect,
and a tri-state control on a header this calm is not worth the pixel.

It is added in **two** places, not three: `index.html`'s header
(:1044 nav), and `accountNavSlots()` / `ACCOUNT_NAV_CSS` / `ACCOUNT_NAV_JS` in
server.js, which is already shared across all seven server-rendered pages.

## 7. Surfaces that must stay light

- **Print.** Free by construction (§5.3). No edits to the `@media print` block.
- **PNG export.** `html2canvas` clones the document, so `data-theme="dark"`
  would ride along into the capture. One line in the existing `onclone` hook
  removes the attribute from the cloned root; `backgroundColor: "#FBFBF9"`
  stays. The exported PNG is byte-comparable to today's in either theme. A
  dark PNG pasted into a client's light deck reads as broken, and a dark PDF
  spends a client's toner.
- **Email, favicons, og-image, Street View photos, aerial thumbnails.**
  Untouched — real imagery and fixed brand assets.

A **shared report** at `/r/<id>` is a web page, not an export, so it follows
the *viewer's* theme. That is correct: it is the recipient's screen.

## 8. The map

`renderMap()` swaps CartoDB `light_all` → `dark_all` (index.html:6668 and
:12400). Same URL shape, keyless, same terms — a one-word change.

The pins must change with it. They are currently drawn *for* a light basemap:
the comp roundel is slate-800 `#1e293b` with a white border and the subject pin
is `#DC2626` with a white border. On a dark basemap the roundel disappears. The
4 inline pin styles invert — light roundel with a dark border, and the subject
pin keeps its red but takes a dark border. Leaflet's own attribution box and
zoom control get a dark chip.

Shipping the tile swap without the pin recolor is worse than not swapping at
all, so the two are one change.

## 9. Report branding logos

Branding profiles store the member's logo inline as a data URI, and those are
almost always drawn for white paper. A black-on-transparent mark vanishes on a
dark letterhead. In dark mode the logo slot gets a light chip with padding, so
a member's own mark cannot disappear from their own report. Nothing about the
stored profile changes; this is presentation only, in the letterhead surface.

## 10. Testing

`test/theme.test.js`, in the existing `node --test` suite (no dependencies, no
database, no server):

1. **Coverage.** Scan `index.html` for every color utility class actually used
   (base and state-variant), scan the bridge block for every class it darkens,
   and assert the first set is a subset of the second. This is the test that
   matters: the known weakness of a hex-keyed bridge is that a color added next
   month gets no dark rule and renders dark-on-dark, and the failure is silent
   because the light theme still looks fine. This turns it into a build
   failure. It follows the repo's existing habit of pinning a
   two-copies-must-agree hazard with a test (`compWeight`, `reportIdFor` /
   `exportReportKey`, `API_COMP_FIELDS`).
2. **No orphan variables.** Every `var(--…)` referenced in `MARKET_CSS`,
   `HOW_CSS`, `ACCOUNT_NAV_CSS`, `vault-page.js` and `index.html` is defined by
   `theme.js`, in both the light and dark blocks. A typo'd variable name
   silently falls back to `inherit` or nothing, which is invisible in review.
3. **`index.html`'s literal `:root` block matches `theme.js`.** It is the one
   place a token value is written twice, because `index.html` is static and
   never templated. Pin it.
4. **Print isolation.** Assert the bridge block is inside `@media screen` and
   that no `[data-theme` selector appears inside the `@media print` block.
5. **The `--red` split holds.** Assert no in-scope stylesheet uses
   `var(--red)` or `var(--red-deep)` as a `background`. This is the §4.2
   migration, and the failure is a pale-pink button that only appears in dark
   mode on one page, which is exactly the kind of thing manual review misses.

Beyond the suite, the finished UI is driven in a real browser in both themes
across: the app's search form and a rendered report, a market page,
`/how-it-works`, `/vault`, and a shared report — plus a print preview and an
actual PNG export downloaded and opened. Not "it should work."

## 11. Rollback

One line. Every dark rule is gated on `[data-theme="dark"]`, and that attribute
is only ever set by the boot snippet in §6. Short-circuiting the snippet
disables the feature on every surface at once, with no env var, no server
round-trip, and no risk to the light theme. That is a better lever than an
`ACCOUNT_WALL`-style flag here, because the flag would have to be read before
first paint and any read that is not synchronous reintroduces the flash.

If the whole thing needs to come out, the change is additive enough to revert
as one commit.

## 12. Files touched

| File | Change |
|---|---|
| `theme.js` | **new** — pure token table + `rootCss()` |
| `test/theme.test.js` | **new** — the five assertions in §10 |
| `index.html` | `:root` blocks, ~75-rule bridge, boot script, toggle, `var()` in inline CSS, `onclone` theme strip, dark tiles + pin recolor |
| `server.js` | `require("./theme")`; `MARKET_CSS`, `HOW_CSS`, `ACCOUNT_NAV_CSS` to `var()`; toggle in `accountNavSlots()` + `ACCOUNT_NAV_JS`; boot script in two `<head>`s |
| `vault-page.js` | boot script in its `<head>`; literal `:root` → `${THEME_CSS}`; one `--red-fill` fix (§4.2). Already tokenized, so no sweep |
| `devlog.json` | one `feature` entry |

No migration. No new environment variable. No npm dependency. No Tailwind
regen.
