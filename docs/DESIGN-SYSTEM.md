# CompNinja Design System

The brand in one place: fonts, colours, numbers, styles, logos.

**Who this is for.** Chuck, and anyone else who needs to change how the site
looks without reading 850KB of `index.html`. Everything visual on CompNinja
comes from a small set of values documented here. Change the value, and every
page that uses it changes with it.

**How the site is built, in one paragraph.** There is no build step, no design
tool, and no CMS. The site is plain HTML and CSS written directly into a few
files. Colours are the exception — they are named tokens (`--red`, `--ink`)
defined centrally, so changing one changes every page at once. Sizes, spacing
and fonts are not yet tokenised; those are written into each stylesheet, so
changing one means finding each place it appears.

**For the non-visual half of the brand** — name, legal entity, voice, and the
language rules that are promises rather than style choices — see
[BRAND.md](BRAND.md).

Read §1 before changing a colour. It is the shortest section and the only one
with a trap in it.

---

## 1. The one rule

**Colours are named, never typed.** A page says `var(--red)`, not `#B91C1C`.
The names and their values live in `theme.js`.

This matters because the site has a **dark mode**. Every colour has two values —
one for light, one for dark — and the token is what picks between them. A raw
hex code typed into a page is the same colour on both, which is how you get
black text on a black background.

So: to change a colour, change the token. Do not hunt for hex codes in the page
files. If you find one, it is either a deliberate exception (documented in §7)
or a bug.

### ⚠ Two things about changing a colour

**1. Every value is written twice.** `theme.js` is the source of truth, but
`index.html` is a static file the server never templates, so it carries a
hand-copied mirror of the whole table (lines 77–98). A colour change must be
made in **both**:

- `theme.js` — the `THEME_TOKENS` table (`light` and `dark`)
- `index.html` — the `:root{...}` block *and* the `[data-theme="dark"]{...}`
  block

`test/theme.test.js` compares the two character for character and fails the
build if they disagree.

**2. The core colours are deliberately locked.** The test also pins the exact
values of the main surface, rule, ink and red tokens — because five shipped
pages were built on them, and a silent drift restyles all five. Changing one of
those on purpose means updating the expected value in `test/theme.test.js` too.

That is not a hoop to jump through, it is the safety rail: it means nobody can
move the brand's core palette by accident. **Locked tokens:** `paper`, `card`,
`wash`, `wash-2`, `slab`, `edge`, `line`, `hair`, the whole `ink` ramp, `red`,
`red-deep`, and `green`. The status and badge colours are not pinned by value
and can be changed in the two files alone.

Get this wrong and `npm start` refuses to boot — the test suite runs before the
server does, on purpose. Better to fail on your machine than in production.

---

## 2. Logos

The mark is a **navy rounded rectangle crossed by a red diagonal band**. It is
drawn in code (SVG), not stored as an image file, so it stays sharp at any size
and can change colour with the theme.

<img src="brand-logos.svg" alt="The CompNinja mark in its three shipped appearances: header light, header dark, and the footer slab." width="920">

All three appearances above are the same two shapes; only the fills differ.

| | Where | Name | Lives in | Notes |
|---|---|---|---|---|
| | Site header | `CN_LOGO` | `server.js` (~line 5410) | Themed — card is `--ink`, sweep is `--red-fill` |
| | Dark footer | `CN_LOGO_LIGHT` | `server.js` (~line 5423) | Card is **always** white, never themed |
| <img src="../favicon.svg" width="28"> | Browser tab | `favicon.ico`, `favicon.svg`, `favicon.png` | repo root | |
| <img src="../apple-touch-icon.png" width="28"> | iOS home screen | `apple-touch-icon.png` | repo root | 180×180 |
| <img src="../og-image.png" width="64"> | Link previews | `og-image.png` | repo root | 1200×630, shown when the site is shared |
| <img src="../icon-192.png" width="28"> | Installed app | `icon-192.png` | repo root | 192×192, PWA install |
| <img src="../icon-512.png" width="28"> | Installed app | `icon-512.png` | repo root | 512×512, PWA install |
| <img src="../icon-maskable-512.png" width="28"> | Android adaptive | `icon-maskable-512.png` | repo root | 512×512, safe-zone padded |

**The wordmark** is set beside the mark, not part of it: `Comp` in ink and
`Ninja` in red, uppercase, 15px, weight 600, letter-spacing `.14em`.

**Two logos, on purpose.** The header mark inverts with the theme. The footer
mark sits on a navy slab that is dark in *both* themes, so it must stay white
always. They differ by exactly one fill colour and cannot be merged — whichever
one you merged into would break in the other context.

**Geometry** (both marks, 30×30 viewBox):
- Card: `rect` at 2,4 · 26×22 · corner radius 2
- Sweep: `polygon` 3.5,26 → 28,5.5 → 28,10 → 8,26

Changing the artwork means editing those two shapes in both places, plus
regenerating the eight image files above from the new shape. The three PWA
icons are easy to forget — they are pinned against `manifest.webmanifest` by
`test/manifest.test.js`, so a stale one survives every check the suite makes
and only shows up on somebody's installed copy.

---

## 3. Fonts

Two typefaces, with a clear division of labour.

| Role | Font | Used for |
|---|---|---|
| **Display** | Georgia (fallback: Times New Roman, serif) | Headings, and **every dollar figure** |
| **Interface** | Inter (fallback: system UI stack) | Body copy, labels, tables, buttons, navigation |
| **Code** | ui-monospace / SF Mono / Menlo / Consolas | Rare — admin pages only |

**The rule worth knowing:** serif means *this is the answer*. Headings and the
valuation figures are Georgia; everything that helps you read them is Inter. A
dollar amount set in Inter reads as interface chrome rather than the number the
whole page exists to deliver.

Inter is loaded from Google Fonts (`index.html` lines 49–51) at weights
400, 500, 600, 700, 800. Georgia is not loaded at all — it ships with every OS.

**Weights in use:** 400 body · 500 serif headings and figures · 600 labels,
buttons, table headers, emphasis · 700/800 rare.

Figures use `font-variant-numeric: tabular-nums` so digits align in columns.
Keep that on anything showing money.

---

## 4. Colours

All values below are the live tokens in `theme.js`. Light value first, dark
second. Use the **name**, never the hex.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#FBFBF9` | `#121826` | The page itself |
| `--card` | `#ffffff` | `#1A2433` | A card sitting on the page |
| `--wash` | `#F5F4EF` | `#243044` | Lifted panel, table headers |
| `--wash-2` | `#F5F4EF` | `#334155` | Hover, or a tile inside a card |
| `--slab` | `#1A2433` | `#243044` | Surfaces that are dark in *both* themes (the footer) |

`--wash` and `--wash-2` share a light value on purpose: in light mode a hover
*darkens*, in dark mode it *lightens*. One token cannot say both.

### Rules and borders

| Token | Light | Dark | Use |
|---|---|---|---|
| `--edge` | `#D8D4C9` | `#3D4B5F` | Primary border — cards, buttons, inputs |
| `--line` | `#E4E2DA` | `#2A3648` | Secondary border |
| `--hair` | `#F0EFE9` | `#1E2938` | Hairline divider between rows |

### Ink (text)

Seven steps, dark to light. `--ink-3` is the workhorse for muted text.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ink` | `#1A2433` | `#D5DDE8` | Headings, figures, emphasis |
| `--ink-body` | `#374253` | `#B6C1CF` | Body copy |
| `--ink-2` | `#4C5665` | `#A8B6C6` | Secondary copy |
| `--ink-mute` | `#5A6473` | `#96A3B4` | Navigation, captions |
| `--ink-3` | `#68707E` | `#8B98A8` | Labels, table headers, fine print |
| `--ink-faint` | `#9AA2AD` | `#7C8899` | Faintest readable text |
| `--ink-4` | `#C7CBD2` | `#475569` | Outlines, disabled states |

### Brand red

Four tokens, because a red **link** and a red **button** need opposite
treatment in dark mode. Text has to lighten to stay readable; a filled button
must not, because white text sits on it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--red` | `#B91C1C` | `#F87171` | Links, accents, red text |
| `--red-deep` | `#991B1B` | `#FCA5A5` | Link hover |
| `--red-fill` | `#B91C1C` | `#DC2626` | Button background, logo sweep |
| `--red-fill-hover` | `#991B1B` | `#B91C1C` | Button hover |

The Tailwind config (`tailwind.config.js`) also carries the full red ramp
50–900 for utility classes. `500` is `#EF4444`, `600` `#DC2626`, `700`
`#B91C1C`.

### Status

Each status is a triad — text, background, rule — so a message block is one
consistent colour family.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--green` | `#15803D` | `#34D399` | Positive figures |
| `--ok-text` / `--ok-bg` / `--ok-rule` | `#06603A` / `#E7F5EE` / `#BFE5D2` | `#6EE7B7` / `#0C2B21` / `#155E43` | Verified badge, success |
| `--warn-text` / `--warn-bg` / `--warn-rule` | `#8A6D1A` / `#FBF3DC` / `#EDDFB0` | `#FCD34D` / `#2A2410` / `#5B4A16` | Listing badge, caution |
| `--err-text` / `--err-bg` / `--err-rule` | `#7F1D1D` / `#FCF1EF` / `#F0C7C7` | `#F87171` / `#2A1517` / `#C27070` | Errors |
| `--est-text` / `--est-bg` | `#9A3412` / `#F8E9DC` | `#FDBA74` / `#2A1C12` | Estimate badge (sienna) |
| `--bv-text` / `--bv-bg` | `#4C3A8C` / `#EDE9F8` | `#C4B5FD` / `#1C1730` | "From your vault" badge (purple) |

Estimate and vault keep their own identities rather than borrowing warn/ok —
otherwise Estimate collapses into Listing, and vault comps look Verified.

### Elevation

`--lift` is a shadow that is `none` in light mode and a soft inset highlight
plus drop shadow in dark. Cards apply `box-shadow: var(--lift)` — a no-op on
light paper, and the thing that separates a card from charcoal in dark.

---

## 5. Numbers

### Type scale

| Size | Font | Use |
|---|---|---|
| 9–10px | Inter | Photo credits, finest print |
| **10.5px** | Inter 600, uppercase, `.07–.12em` tracking | The micro-label — table headers, tile labels, badges |
| 12–12.5px | Inter | Captions, footnotes |
| **13–13.5px** | Inter | Navigation, tables, small buttons |
| **14.5px** | Inter | Body copy |
| 15px | Inter 600 | Wordmark |
| 16px | Inter | Form inputs — **never smaller** (iOS Safari zooms below 16px and stays zoomed) |
| 17–19px | Georgia 500 | Card headings |
| 20–24px | Georgia 500 | Section headings, ledger figures |
| 22px | Georgia 500 | CTA headings |
| **26px / 32px** | Georgia 500 | **The valuation hero** — Low and High at 26px, Likely at 32px |
| 27–29px | Georgia 500 | Landing sub-headings, emphasised ledger figure |
| **28 → 34px** | Georgia 500, line-height 1.15 | Page H1 (28px, lifting to 34px at ≥640px) |
| 38 → 42px | Georgia 500, line-height 1.12 | Marketing headline (landing page and `/how-it-works`) |

Uppercase micro-labels always carry letter-spacing. Serif headings carry
none (or a hair negative: `-.005em` on H1).

### Corner radius

| Value | Use |
|---|---|
| 3px | Badges |
| 4px | Buttons, chips, filter pills |
| **6px** | Cards, panels, tables, inputs — the default |
| 8px | Dropdown menus |
| 999px | Full pills (rare) |

### Spacing and layout

- **Page width:** 1024px max, 16px side padding
- **Main content:** 32px top, 64px bottom
- **Card padding:** 22px (28px for a CTA block)
- **Table cells:** 10px; headers 9px 10px
- **Button padding:** 11px 26px (small: 7px 14px)
- **Gaps:** 8px tight · 12px grid · 18px header items
- **Card margin:** 18px between stacked cards

Common step: 4 · 6 · 8 · 10 · 12 · 16 · 18 · 22 · 26 · 28.

### Line height and measure

- Body: **1.6**
- Headings and figures: **1.15–1.2**
- Reading width caps: `52ch` CTA copy · `68–72ch` legal and footer prose ·
  `70ch` page subtitles

### Breakpoints

There is no single grid system — breakpoints were added where a specific
layout broke. In rough order of how often they appear:

| Width | What changes |
|---|---|
| 560px | App layout adjustments |
| 620px | |
| **640px** (min-width) | H1 lifts 28 → 34px, header nav gap widens, footer goes horizontal |
| **700px** (max-width) | Ledger stacks vertically, market hero shortens 340 → 240px and its H1 drops to 24px |
| 900px / 920px | Wide-layout adjustments |

If you are adding one, reach for 640px or 700px before inventing a new value.

---

## 6. Styles

The recurring components, and what they are made of.

**Button** — `.btn`. Red fill (`--red-fill`), white text, weight 600, 14.5px,
11px 26px padding, 4px radius. Hover darkens to `--red-fill-hover`. White text
stays white on hover. `.btn.sm` is the header size: 7px 14px, 13px.

**Card** — `.card`. White (`--card`) on a 1px `--edge` border, 6px radius,
22px padding, 18px vertical margin, `--lift` shadow. Heading is Georgia 500 at
19px, sentence case — never the uppercase micro-label, because these headings
are sentence-length.

**Ledger** — `.ledger` / `.lcell` (`.rd-ledger` / `.rd-lcell` in the app). The
headline-figures strip: equal cells divided by hairlines inside one bordered
box. The emphasised cell (`.mid`) gets `--wash-2` behind it, a red label, and a
larger figure. This is the house pattern for presenting a valuation — used on
the report hero, market pages, and the vault.

| Where | Normal cell | Emphasised cell |
|---|---|---|
| Report hero (Low / **Likely** / High) | 26px | 32px |
| Market page | 24px | 29px |
| Auxiliary strip | 20px | — |

Below 700px it stacks vertically and the cell dividers move from right edges to
bottom edges.

**Badge** — `.badge`. 10.5px, weight 600, 3px radius, 1.5px 7px padding.
Neutral by default; `.v` is green Verified, `.li` is amber Listing. Estimate
and vault badges use their own tokens (§4). `.bv` is the vault chip —
`--bv-text` on `--bv-bg`, reading "From your vault". It is an *ownership*
statement, never provenance: it must never be `.v`, because green Verified is a
public claim the server awards when a named broker vouches, and a private row
has not earned it.

**Vault sheet** — `.vault` / `.vrow` / `.vout`. HOW_CSS only; the landing
page's hero exhibit. Same shell recipe as `.exhibit` (1px `--edge`, `--card`,
6px, `--lift`) because a broker should read them as two views of one product,
but a separate class: the landing page is allowed exactly one `.exhibit` and a
test counts them. Hairline `--hair` rows, address left with the rate right in
Georgia, and a `--wash-2` foot strip carrying the redaction line. Deliberately
**not** animated — it is above the fold.

**Audience panes** — `.three` / `.pane` / `.pane.r`. A 3-up of the same record
shown to different readers. `.pane.r` is the redacted one and fills with
`--wash-2`, the one token that darkens in light and lightens in dark, so "less
is shown here" reads at a glance in both themes.

**Table** — 13.5px, tabular figures, 640px minimum width inside a horizontally
scrolling `.scroll` wrapper. Headers are the 10.5px uppercase micro-label on
`--wash`. Rows separate with `--hair`.
The statement variant (`table.stmt`) drops the header fill for a 2px ink rule
and closes with a double rule under the total — the accounting look.

**Input** — 16px, 6px radius, 1px `--edge`, 10px 12px padding. Focus turns the
border red and adds a 1px red ring.

**Tile** — `.tile`. Micro-label above a Georgia figure above a 12.5px note.
The three-part unit that most numbers on the site are presented in.

---

## 7. Where things live

| What | File |
|---|---|
| **Colours — source of truth** | `theme.js` |
| **Colours — mirror copy (must match)** | `index.html` lines 77–98 |
| Server-rendered page styles | `MARKET_CSS` in `server.js` (~line 5630) |
| Landing page styles | `HOW_CSS` in `server.js` |
| App styles | `<style>` block in `index.html` (~line 330) |
| Vault page | `vault-page.js` |
| Hub page | `hub-page.js` |
| Logos | `server.js` (~line 5410) |
| Tailwind red ramp | `tailwind.config.js` |
| Generated Tailwind CSS | `tailwind.css` — **generated, never hand-edit** |

**Two headers, not three.** `/how-it-works` kept a hand-copied third header
until 2026-08-20, when it was folded into `marketBar` (the two had drifted to
within one `aria-current`). What remains is `index.html`'s own header and
`marketBar` in `server.js`, which every server-rendered page shares. A change
to one must be made to both, or the header shifts as you move between pages.
Same for the footer, which is `MARKET_FOOTER` on every server-rendered page
including the landing one.

**`.bk` / `.bkrow` / `.bklag` are declared TWICE**, and they are not shared:
`MARKET_CSS` (for `/brokers`) and `HOW_CSS` (for the landing page). Editing one
copy does not change the other — which is convenient right up until someone
assumes it does. The landing page uses the ledger twice on its own (the firm
layer and the broker trades), so a change there moves two sections and leaves
`/brokers` untouched. Shoot `/brokers` as well when you touch it.

**Two deliberate exceptions to the no-hex rule.** Both are places where a
colour must *not* follow the theme:
1. **The footer logo and wordmark** — always white, on a slab that is dark in
   both themes.
2. **Photographs and their overlays** — market hero images, Street View, aerial
   thumbnails. A picture of a place does not have a dark mode; the gradient and
   caption over it stay literal dark/white so the title reads on any photo.

---

## 8. Changing something

**A colour** — edit it in `theme.js` **and** in `index.html`'s two token blocks
(lines 77–98), light and dark in both. If it is one of the locked core tokens,
update `test/theme.test.js` as well. See the warning in §1 — this is the one
change with a real trap in it.

**A number** (size, spacing, radius) — find it in the relevant stylesheet from
§7. If it appears in more than one file, change all of them.

**A font** — the family is written into each stylesheet's `body` rule and into
every Georgia heading rule. There is no font token yet; this is the one change
that means a find-and-replace across files. Worth adding tokens for if it comes
up more than once.

**The logo** — both SVGs in `server.js`, plus regenerating the five image
assets in §2.

### Before you commit

Run the test suite. It takes about two seconds and requires nothing running:

```bash
npm test
```

There is a test (`test/theme.test.js`) that checks every colour token is a
valid hex value and that the stylesheets do not contain characters that would
break them. It will catch a typo'd colour immediately.

**If you touched `index.html` and added a new Tailwind utility class**, the
vendored CSS must be regenerated or the class silently does nothing:

```bash
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
```

Commit the updated `tailwind.css` alongside the HTML change. Classes already
used anywhere in the file are covered — only genuinely new ones need this.

**Seeing your change:** editing `index.html` or any stylesheet inside
`server.js`? The HTML file is read from disk on every request, so just refresh.
`server.js` is loaded once at startup, so restart the server:

```bash
npm start
```

### Check both themes

Every visual change needs looking at in light **and** dark. The site follows
the operating system setting; switch your OS appearance to see the other one.
This is the single most common way a change looks finished and is not.
