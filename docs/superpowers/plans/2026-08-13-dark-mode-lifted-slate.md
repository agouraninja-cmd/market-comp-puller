# Dark Mode Lifted Slate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retune dark mode off near-black slate onto a lifted charcoal floor, without touching light mode, layout, or accents.

**Architecture:** `theme.js` is already the source of truth. Change the `dark` fields in `THEME_TOKENS`, copy the same block into `index.html`, and retarget the three dark `theme-color` metas. Server-rendered pages pick the new values up through `${THEME_CSS}`. No new tokens, no bridge rules, no Tailwind regen.

**Tech Stack:** Plain Node (no dependencies), `node --test`, existing `theme.js` / `test/theme.test.js`.

**Spec:** `docs/superpowers/specs/2026-08-13-dark-mode-lifted-slate-design.md`

## Global Constraints

- **Zero npm dependencies.** This repo has none and must keep none.
- **No Tailwind regen.** Do not run the regen command. If the Claude Code hook regenerates `tailwind.css` after an `index.html` edit, verify `git diff tailwind.css` is empty before committing.
- **The light theme must not change.** Every token's `light` value stays verbatim. A changed light hex is a bug in this work.
- **No new tokens. No accent changes.** `--red`, `--green`, and the status chips stay. `--ink-faint` and `--ink-4` stay. `--wash-2` stays `#334155`.
- **`--ink-3` on `--card` is 4.5:1 exactly.** Do not dim `--ink-3` further than `#7D8B9C`.
- **`--slab` dark equals `--wash` dark** (`#243044`). Already-dark-in-light-mode surfaces must keep lifting with washed panels.
- **`node --check server.js && npm test` must pass before every commit.** Portable Node is at `%LOCALAPPDATA%\node-portable\node-v24.16.0-win-x64`. Prepend it to PATH if `node` is missing.
- **Editing `server.js` or `vault-page.js` requires restarting the process.** Editing `index.html` or `theme.js` does not for a refresh of `index.html`; server-rendered pages need a restart after `theme.js` / `server.js` / `vault-page.js`.
- **`devlog.json` must be written as clean UTF-8.** Never with a PowerShell redirect lacking `-Encoding utf8`.
- **Shared checkout.** Never `git add -A`. Stage explicit paths. `git status --short` immediately before staging. Leave `docs/superpowers/specs/2026-08-13-homepage-look-design.md` untracked if it is still sitting there — not this work.
- Out of scope: `/admin`, `/dev`, `/hq`, `/contacts`, `email-shell.js`, print, PNG export, map tiles, Figma.

### File map

| File | Responsibility |
|---|---|
| `theme.js` | Dark hexes in `THEME_TOKENS`; header comment that currently names `#020617` as live paper |
| `test/theme.test.js` | Pin the lifted table; index.html dark-block regex; theme-color allowlist |
| `index.html` | Mirrored dark block; dark `theme-color`; token comment |
| `server.js` | `THEME_META` dark `theme-color` (covers `marketShell` + `/how-it-works`) |
| `vault-page.js` | Its own dark `theme-color` copy |
| `devlog.json` | One `improvement` entry |

---

### Task 1: Token table — `theme.js` + `index.html` mirror

**Files:**
- Modify: `test/theme.test.js` (add `DARK_LIFT` pin; update the index.html dark-block regex)
- Modify: `theme.js` (`THEME_TOKENS` dark fields + header comment)
- Modify: `index.html` (literal dark block + token comment)

**Interfaces:**
- Consumes: existing `THEME_TOKENS` shape `{ [name: string]: { light: string, dark: string } }`.
- Produces: the lifted dark values below. Later tasks rely on `--paper` dark being `#121826` (theme-color must match it).

Lifted dark values (copy verbatim; unlisted tokens keep today's dark value):

```
paper        #121826
card         #1A2433
wash         #243044
wash-2       #334155   (unchanged)
slab         #243044
edge         #3D4B5F
line         #2A3648
hair         #1E2938
ink          #C9D3E0
ink-body     #A8B4C4
ink-2        #9AABC0
ink-mute     #8A97A8
ink-3        #7D8B9C
ink-faint    #7C8899   (unchanged)
ink-4        #475569   (unchanged)
```

- [ ] **Step 1: Write the failing pin**

In `test/theme.test.js`, immediately after the existing `EXISTING` object and its light-value test (around line 18–24), add:

```js
// The 2026-08-13 lift. Light values stay on EXISTING above; these are the
// dark floor the owner picked (charcoal, not near-black). A silent revert
// to slate-950 would still satisfy "has a dark hex" and the index.html
// mirror (if both copies moved together), so this table is the lock.
const DARK_LIFT = {
  paper: "#121826", card: "#1A2433", wash: "#243044",
  "wash-2": "#334155", slab: "#243044",
  edge: "#3D4B5F", line: "#2A3648", hair: "#1E2938",
  ink: "#C9D3E0", "ink-body": "#A8B4C4", "ink-2": "#9AABC0",
  "ink-mute": "#8A97A8", "ink-3": "#7D8B9C",
  "ink-faint": "#7C8899", "ink-4": "#475569",
};

test("dark tokens match the lifted-slate table", () => {
  for (const [name, dark] of Object.entries(DARK_LIFT)) {
    assert.ok(THEME_TOKENS[name], `missing token --${name}`);
    assert.equal(THEME_TOKENS[name].dark, dark, `--${name} dark value moved`);
  }
});
```

Also in the same file, change the index.html dark-block regex from `#020617` to `#121826`:

```js
    /:root\{--paper:#FBFBF9[^]*?\}\s*@media screen\{\s*\[data-theme="dark"\]\{--paper:#121826/,
```

Leave the `content:#020617` allowlist alone in this task — that is Task 2.

- [ ] **Step 2: Run the pin and confirm it fails**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/theme.test.js
```

Expected: FAIL `dark tokens match the lifted-slate table` with `--paper dark value moved` (`#020617` !== `#121826`). The index.html regex may still pass (old `#020617` is still in `index.html`).

- [ ] **Step 3: Update `theme.js`**

Replace the dark values in `THEME_TOKENS` with the table above. Brand and status tokens (`red`, `red-deep`, `red-fill`, `red-fill-hover`, `green`, `ok-*`, `warn-*`, `err-*`) are not in that table and must not change.

Replace the header comment that currently names slate-950 `#020617` as the live bookend (the three lines above `const THEME_TOKENS`) with:

```js
// Dark values are the 2026-08-10 slate ramp lifted one step off near-black
// (spec 2026-08-13-dark-mode-lifted-slate): paper #121826, card #1A2433,
// wash/slab #243044, hover #334155. Same cool personality, charcoal not
// black. No new brand colours.
```

Do not change any `light` field.

- [ ] **Step 4: Run tests — the pin passes, the index.html mirror fails**

Same command as Step 2.

Expected: `dark tokens match the lifted-slate table` PASS. `index.html declares the same token values theme.js does` FAIL (index.html still has `--paper:#020617`). Possibly also the dark-block regex FAIL once theme.js is no longer relevant to that regex — the regex reads `index.html`, so it still matches `#020617` until Step 5. That's fine; do not "fix" it by reverting the regex.

- [ ] **Step 5: Update `index.html`'s literal dark block and token comment**

The dark block (inside `@media screen`, the `[data-theme="dark"]{...}` that declares variables, NOT the bridge rules below it) must become:

```css
    [data-theme="dark"]{--paper:#121826;--card:#1A2433;--wash:#243044;--wash-2:#334155;--slab:#243044;
      --edge:#3D4B5F;--line:#2A3648;--hair:#1E2938;
      --ink:#C9D3E0;--ink-body:#A8B4C4;--ink-2:#9AABC0;--ink-mute:#8A97A8;--ink-3:#7D8B9C;
      --ink-faint:#7C8899;--ink-4:#475569;
      --red:#F87171;--red-deep:#FCA5A5;--red-fill:#DC2626;--red-fill-hover:#B91C1C;
      --green:#34D399;--ok-text:#6EE7B7;--ok-bg:#0C2B21;--ok-rule:#155E43;
      --warn-text:#FCD34D;--warn-bg:#2A2410;--warn-rule:#5B4A16;
      --err-text:#F87171;--err-bg:#2A1517;--err-rule:#C27070}
```

Keep the existing wrapping `@media screen{ ... }` and the `:root{...}` light block byte-identical.

Replace the "Dark surfaces (slate only): slate-950 `#020617`..." comment in the same `<style>` block with:

```css
       Dark surfaces (cool slate, lifted 2026-08-13): #121826 paper · #1A2433
         cards · #243044 lifted (table header, already-dark slabs; hover =
         #334155).
```

Do **not** change the dark `theme-color` meta in this task.

- [ ] **Step 6: Run the suite**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --check server.js
npm test
```

Expected: all tests PASS. If `tailwind.css` was regenerated, `git diff tailwind.css` must be empty — restore it if not.

- [ ] **Step 7: Commit**

```powershell
git status --short
git add -- theme.js test/theme.test.js index.html
git diff --cached
git commit -m @'
Lift dark mode off near-black slate.

Paper moves to #121826 and body ink to #C9D3E0 so the page is charcoal rather than an IDE invert. Light values and accents are unchanged.
'@
```

Stage only those three paths. Leave any untracked homepage spec alone.

---

### Task 2: Dark `theme-color` matches the new paper

**Files:**
- Modify: `test/theme.test.js` (allowlist `content:#020617` → `content:#121826`)
- Modify: `index.html` (the dark `<meta name="theme-color">`)
- Modify: `server.js` (`THEME_META`)
- Modify: `vault-page.js` (its own meta pair)

**Interfaces:**
- Consumes: `--paper` dark `#121826` from Task 1.
- Produces: mobile browser chrome that tracks OS-dark with `#121826`. The pairing with `prefers-color-scheme` (not `data-theme`) is existing behaviour — do not retie it.

- [ ] **Step 1: Point the allowlist at the new paper**

In `test/theme.test.js`, in the `ALLOWLIST` set of `raw colour literal(s) in in-scope server.js generated markup`, change:

```js
    "content:#fbfbf9", "content:#020617",
```

to:

```js
    "content:#fbfbf9", "content:#121826",
```

Keep the comment above it (`<meta name="theme-color">` paired with `prefers-color-scheme`).

- [ ] **Step 2: Run the test and confirm it fails**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --test test/theme.test.js
```

Expected: FAIL `raw colour literal(s) in in-scope server.js generated markup` naming `content:#020617` (still emitted by `THEME_META`).

- [ ] **Step 3: Update the three write sites**

`index.html` (near the top of `<head>`):

```html
  <meta name="theme-color" content="#121826" media="(prefers-color-scheme: dark)" />
```

`server.js`, the `THEME_META` constant (the only server copy; `marketShell` and `renderHowItWorksHTML` both interpolate it):

```js
  `<meta name="theme-color" content="#121826" media="(prefers-color-scheme: dark)"/>\n`;
```

`vault-page.js` (its own pair, not `THEME_META`):

```html
<meta name="theme-color" content="#121826" media="(prefers-color-scheme: dark)"/>
```

Do not touch the four admin dashboards' light-only `theme-color` (`content="#FBFBF9"` with no media attribute).

- [ ] **Step 4: Run the suite**

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node --check server.js
npm test
```

Expected: PASS. Grep after: `rg "#020617" --glob "*.{js,html}"` must return **zero hits in the four files this task touches**. Hits remaining only in the historical 2026-08-10 spec/plan (and possibly comments in `test/theme.test.js` that talk about the old print-isolation example `--ink:#E2E8F0`) are fine. If `test/theme.test.js` still mentions `#020617` only in a comment about the old print bug, leave that comment — it describes a historical failure mode, not a live value.

- [ ] **Step 5: Commit**

```powershell
git status --short
git add -- test/theme.test.js index.html server.js vault-page.js
git diff --cached
git commit -m @'
Point dark theme-color at the lifted paper.

Mobile browser chrome was still slate-950 after the page itself moved to #121826.
'@
```

---

### Task 3: Changelog and a real-browser look

**Files:**
- Modify: `devlog.json` (one `improvement` entry, prepended)

**Interfaces:**
- Consumes: Tasks 1–2 already on the branch.
- Produces: a changelog line a `/dev` reader would care about, plus a visual check that the suite cannot do.

- [ ] **Step 1: Prepend the devlog entry**

`devlog.json` is a guaranteed collision in this checkout. Rebuild the staged version: take `git show HEAD:devlog.json`, prepend only this entry, `git add` that, then restore the full working file so anyone else's unstaged entry is not destroyed.

The entry:

```json
{
  "date": "2026-08-13",
  "type": "improvement",
  "title": "Dark mode is charcoal, not near-black",
  "details": "The page was slate-950 with near-white text (16:1) and read like an IDE invert. Paper lifts to #121826 and body ink dims to #C9D3E0 (11.7:1). Same cool slate, no layout change, light mode untouched. Print and PNG stay light."
}
```

Write the file as clean UTF-8. Do not use a PowerShell redirect without `-Encoding utf8`. After staging, `git show :devlog.json` must contain this title and must not contain a double-encoding pattern (`Ã`, `â€`, `Â`).

- [ ] **Step 2: Restart the server and look**

Kill whatever is on port 3000, then:

```powershell
$env:Path = "$env:LOCALAPPDATA\node-portable\node-v24.16.0-win-x64;" + $env:Path
node server.js
```

In a real browser, with `data-theme="dark"` (toggle or `localStorage.theme = "dark"` then refresh), open:

1. The search form on `/desk` (or `/` if signed in)
2. A rendered report, if one is in history — at least the hero, a table, and the header
3. A market page (`/markets` or any `/market/<slug>`)
4. `/vault`
5. A shared report `/r/<id>` if one exists; skip if none
6. Print preview on the report — ink must be the **light** theme (dark `#1A2433` on cream paper), not `#C9D3E0` on white

Also flip to light mode once on the search form and confirm it looks as it did this morning.

- [ ] **Step 3: Commit**

```powershell
git status --short
git add -- devlog.json
git diff --cached
git commit -m @'
Note the dark-mode lift in the changelog.
'@
```

If the visual check found a leftover near-black surface that is a token miss (not a map tile, not a photo, not an admin page), fix it in `theme.js` / the `index.html` mirror **before** this commit, re-run `npm test`, and do not bury the fix only in the changelog.

---

## Self-review (author)

1. **Spec coverage.** §4 token table → Task 1. §5.3 theme-color three write sites → Task 2. §6 tests → Tasks 1–2. §6 browser look + print preview → Task 3. §8 files → all listed. Light mode / accents / admin / print / PNG / map / Figma → Global Constraints, never tasked.
2. **Placeholders.** None. Exact hexes, exact regex, exact commit messages.
3. **Type consistency.** Token names match `theme.js` (no leading `--` in the JS object, `--` in CSS). `--paper` dark `#121826` is what Task 2's theme-color copies.
