# Dark mode: lifted slate

Date: 2026-08-13
Status: agreed
Touches: `theme.js`, `index.html`, `server.js`, `vault-page.js`,
`test/theme.test.js`, `devlog.json`

Source: owner review of live dark mode on 2026-08-13 — too harsh, near-black
page, high contrast, tiring to look at. Direction chosen from a three-up
mock (Today / A lifted slate / B warm charcoal): **A**.

This amends the dark values in
`docs/superpowers/specs/2026-08-10-dark-mode-design.md`. It does not replace
that spec. The token names, the Tailwind bridge, print isolation, PNG
stripping, the two-state toggle, and the light theme are unchanged.

## 1. The problem

Dark mode shipped 2026-08-10 as a straight map onto the slate ramp already
documented in `index.html`: page `--paper` `#020617` (slate-950), body text
`--ink` `#E2E8F0` (slate-200). That pair measures **16.4:1**. It is
technically excellent and visually tiring — an IDE invert, not a reading
surface.

Light mode is warm cream (`#FBFBF9`). Dark mode did not inherit that
softness; it inherited Tailwind's cool near-black. The architecture is
fine. The floor is wrong.

## 2. What this is not

- **Not a redesign.** No layout, spacing, type, or component changes. The
  light theme must come out byte-identical.
- **Not a new personality.** Warm charcoal (olive/brown paper matching the
  cream light theme) was mocked as option B and declined. Keep the cool
  slate. Lift it.
- **Not a Figma pass.** The work is a retune of hex values in one table.
  Figma cannot see print isolation, PNG export, or the class-name bridge.
- **Not softening the accents.** `--red`, `--green`, and the status chips
  stay. The owner declined the mixed option (A's surfaces + B's red/green).
- **Not pulling `/admin`, `/dev`, `/hq`, `/contacts` in.** Still out of
  scope, same as 2026-08-10 §1.
- **Not changing print, PNG export, email, favicons, Street View, aerials,
  or the Carto `dark_all` map tiles.**

## 3. Decisions locked during brainstorming

1. **The complaint is harshness, not coldness or flatness.** Near-black page
   plus near-white text. Raise the floor and dim the ink.
2. **Direction A: lifted slate.** Same cool personality, charcoal not black.
3. **Token-only.** No extra card-elevation pass, no per-surface exceptions
   that dim only the hero number.
4. **Light mode does not move.** Every token's light value stays verbatim.

## 4. The token table (dark values)

`theme.js` remains the source of truth. `index.html`'s literal `:root` /
`[data-theme="dark"]` block remains the one hand-copy, still pinned by
`test/theme.test.js`.

Unlisted tokens keep today's dark value. Light values are not in this table
because none of them change.

| Token | Today | A (ship this) | Role |
|---|---|---|---|
| `--paper` | `#020617` | `#121826` | page |
| `--card` | `#0F172A` | `#1A2433` | card, above paper |
| `--wash` | `#1E293B` | `#243044` | lifted panel |
| `--wash-2` | `#334155` | `#334155` | hover above wash — already light enough |
| `--slab` | `#1E293B` | `#243044` | already-dark-in-light-mode surfaces; must keep lifting with wash |
| `--edge` | `#334155` | `#3D4B5F` | primary border |
| `--line` | `#273244` | `#2A3648` | border |
| `--hair` | `#1E293B` | `#1E2938` | hairline |
| `--ink` | `#E2E8F0` | `#C9D3E0` | primary text |
| `--ink-body` | `#CBD5E1` | `#A8B4C4` | secondary text |
| `--ink-2` | `#C2CCDA` | `#9AABC0` | tertiary text |
| `--ink-mute` | `#AEBACB` | `#8A97A8` | muted text |
| `--ink-3` | `#94A3B8` | `#7D8B9C` | workhorse muted |
| `--ink-faint` | `#7C8899` | `#7C8899` | leave — dimming this fails 4.5:1 |
| `--ink-4` | `#475569` | `#475569` | outlines, disabled — leave |

Brand and status tokens (`--red`, `--red-deep`, `--red-fill`,
`--red-fill-hover`, `--green`, `--ok-*`, `--warn-*`, `--err-*`) are
unchanged.

### 4.1 Contrast, measured

Against `--paper` `#121826`:

| Pair | Ratio | Bar |
|---|---|---|
| `--ink` | 11.7:1 | AAA (was 16.4:1) |
| `--ink-body` | 8.4:1 | AAA |
| `--ink-3` | 5.1:1 | AA |
| `--ink-faint` | 4.9:1 | AA |
| `--red` | 6.4:1 | AA |

`--ink-3` on `--card` `#1A2433` is **4.5:1** exactly — the AA floor for
small text. Do not dim `--ink-3` further.

`--slab` equals `--wash` on purpose, same as today: a surface that was
already dark in light mode has to lift with the washed panels or it
dissolves into the page. The 2026-08-10 rule still holds; only the hex
moved.

## 5. How it is applied

No new mechanism. The 2026-08-10 plumbing already swaps these custom
properties site-wide:

1. **`theme.js`** — change the `dark` fields in `THEME_TOKENS`. `rootCss()`
   emits them. Server-rendered pages (`MARKET_CSS`, `HOW_CSS`,
   `ACCOUNT_NAV_CSS`, `vault-page.js`) pick the new values up because they
   interpolate `${THEME_CSS}`.
2. **`index.html`** — copy the dark block character-for-character. The
   Tailwind bridge already points utilities at `var(--paper)` etc., so it
   does not gain rules.
3. **`<meta name="theme-color">`** — the dark half is currently `#020617`
   in three write sites: `index.html`, `server.js`'s `THEME_META` (shared
   by `marketShell` and `/how-it-works`), and `vault-page.js`. Change it
   to `#121826` so mobile browser chrome matches the new paper. The pairing
   with `prefers-color-scheme` (not `data-theme`) is existing behaviour;
   do not retie it. The four admin dashboards carry a light-only
   `theme-color` and stay out of this diff.

Comments in `theme.js` and `index.html` that still describe slate-950
`#020617` as the live bookend must be updated so they do not document the
old floor as current. The 2026-08-10 spec and plan stay historical.

## 6. Testing

`test/theme.test.js` already pins every dark hex, the `index.html` mirror,
and the theme-color pair. Update those expected values to this table.
Coverage, print isolation, and the `--red` split assertions do not change.

After the suite is green, look at it in a real browser, both themes, on:
the search form, a rendered report, a market page, `/vault`, and a shared
report — plus a print preview, so a dark session still prints light ink on
white paper.

## 7. Rollback

Unchanged from 2026-08-10 §11: short-circuit the boot script and
`data-theme` is never set. Or revert the token commit. Light mode cannot
regress because its values are not in the diff.

## 8. Files

| File | Change |
|---|---|
| `theme.js` | dark values in `THEME_TOKENS`; comments that name `#020617` as the live paper |
| `index.html` | mirrored dark block; dark `theme-color`; token comment |
| `server.js` | dark `theme-color` in the shared meta snippet |
| `vault-page.js` | dark `theme-color` |
| `test/theme.test.js` | pinned dark hexes and the theme-color assertion |
| `devlog.json` | one `improvement` entry |

No migration. No env var. No Tailwind regen. No new tokens.
