// The site's colour tokens, light and dark. Pure: no I/O, no clock, no
// requires -- which is what lets `npm test` exercise the whole table with
// nothing running.
//
// The NAMES and every light value below are copied verbatim from the :root
// block vault-page.js and the four admin dashboards already share. That is
// deliberate and load-bearing: adopting the existing vocabulary means those
// pages inherit dark mode by swapping one block, and it makes it impossible
// for this work to shift a colour in the theme that already ships.
//
// Tokens added for site-wide coverage use ROLE names (--ink-body,
// --ink-mute, --ink-faint) rather than extending the --ink-N ramp, because
// --ink-2 is already #4C5665 and renumbering it would restyle five pages.
//
// Dark values are the 2026-08-10 slate ramp lifted one step off near-black
// (spec 2026-08-13-dark-mode-lifted-slate): paper #121826, card #1A2433,
// wash/slab #243044, hover #334155. Same cool personality, charcoal not
// black. No new brand colours.
//
// Ink was lifted a hair on 2026-08-14: the charcoal floor plus the original
// dimmed ramp made labels and body copy read as one grey fog. Paper/card/
// wash do not move. --ink-3 on --card goes 4.50:1 → 5.32:1, and on --slab
// (table heads, already-dark chips) 3.82:1 → 4.52:1, which is the AA floor
// that workhorse muted text actually sits on.
const THEME_TOKENS = {
  // --- surfaces ---------------------------------------------------------
  paper:            { light: "#FBFBF9", dark: "#121826" }, // page
  card:             { light: "#ffffff", dark: "#1A2433" }, // card, above paper
  wash:             { light: "#F5F4EF", dark: "#243044" }, // lifted panel
  // Same light value as --wash on purpose: in light mode a hover (or an
  // inner tile) above a washed surface DARKENS, in dark mode it must
  // LIGHTEN. One token cannot express both directions. Dark #334155 is
  // also the inner-panel step (rd-tile, ledger mid-cell) so a tile on a
  // card reads as a second surface rather than the same charcoal.
  "wash-2":         { light: "#F5F4EF", dark: "#334155" },
  // Surfaces that are ALREADY dark in light mode (bg-[#1A2433], bg-slate-900,
  // the footer). Left equal to --paper they would dissolve into the page and
  // the emphasis they carry would vanish. They lift instead.
  slab:             { light: "#1A2433", dark: "#243044" },

  // --- rules ------------------------------------------------------------
  edge:             { light: "#D8D4C9", dark: "#3D4B5F" }, // primary border
  line:             { light: "#E4E2DA", dark: "#2A3648" },
  hair:             { light: "#F0EFE9", dark: "#1E2938" }, // hairline/divider

  // --- ink --------------------------------------------------------------
  ink:              { light: "#1A2433", dark: "#D5DDE8" },
  "ink-body":       { light: "#374253", dark: "#B6C1CF" },
  "ink-2":          { light: "#4C5665", dark: "#A8B6C6" },
  "ink-mute":       { light: "#5A6473", dark: "#96A3B4" },
  "ink-3":          { light: "#68707E", dark: "#8B98A8" }, // the workhorse
  "ink-faint":      { light: "#9AA2AD", dark: "#7C8899" },
  "ink-4":          { light: "#C7CBD2", dark: "#475569" }, // outlines, disabled

  // --- brand ------------------------------------------------------------
  // The split that a naive inversion gets wrong. #B91C1C fails contrast as
  // TEXT on a dark page, so links lighten to brand-400. A FILLED button must
  // NOT lighten, because white text sits on it -- it stays saturated.
  red:              { light: "#B91C1C", dark: "#F87171" },
  "red-deep":       { light: "#991B1B", dark: "#FCA5A5" },
  "red-fill":       { light: "#B91C1C", dark: "#DC2626" },
  "red-fill-hover": { light: "#991B1B", dark: "#B91C1C" },

  // --- status -----------------------------------------------------------
  green:            { light: "#15803D", dark: "#34D399" },
  "ok-text":        { light: "#06603A", dark: "#6EE7B7" },
  "ok-bg":          { light: "#E7F5EE", dark: "#0C2B21" },
  "ok-rule":        { light: "#BFE5D2", dark: "#155E43" },
  "warn-text":      { light: "#8A6D1A", dark: "#FCD34D" },
  "warn-bg":        { light: "#FBF3DC", dark: "#2A2410" },
  "warn-rule":      { light: "#EDDFB0", dark: "#5B4A16" },
  // err-text/err-rule complete the triad err-bg started alone (only a
  // background existed until the vault's .msg.bad needed all three, 2026-08-10
  // fix round 1). Light values are the exact literals vault-page.js already
  // used, so light mode does not move. err-text's dark value reuses --red's
  // dark value outright (6.23:1 against err-bg dark) rather than inventing a
  // new red -- the message IS an error, so borrowing the brand's own error
  // red keeps the palette from growing a second one. err-rule's dark value
  // was chosen to clear 4.5:1 (4.80:1) as asked, which is a stricter bar than
  // its siblings actually clear: --ok-rule and --warn-rule measure only
  // ~1.9:1 and ~1.8:1 against their own dark backgrounds (they read as
  // subtle hairlines, not text). Held here to 4.5:1 as instructed, so
  // --err-rule renders visibly brighter/more saturated than --ok-rule/
  // --warn-rule side by side -- worth a look if that inconsistency reads as
  // odd next to them in practice.
  "err-text":       { light: "#7F1D1D", dark: "#F87171" },
  "err-bg":         { light: "#FCF1EF", dark: "#2A1517" },
  "err-rule":       { light: "#F0C7C7", dark: "#C27070" },
  // Estimate and vault-comp badges. Light values are the literals those
  // chips already used, so light mode does not move. Dark values keep the
  // sienna / purple identities rather than borrowing --warn-* or --ok-*,
  // which would collapse Estimate into Listing and From-your-vault into
  // Verified.
  "est-text":       { light: "#9A3412", dark: "#FDBA74" },
  "est-bg":         { light: "#F8E9DC", dark: "#2A1C12" },
  "bv-text":        { light: "#4C3A8C", dark: "#C4B5FD" },
  "bv-bg":          { light: "#EDE9F8", dark: "#1C1730" },
};

// Emits both custom-property blocks as one line. Every in-scope stylesheet
// is a JS template literal, so this must never contain a backtick or a
// ${ sequence -- a test pins that.
//
// The dark block is wrapped in @media screen and :root is left unscoped --
// load-bearing, not decoration. Custom properties resolve by CASCADE, not by
// media type, so every var()-driven rule in the codebase (not just the
// Tailwind-utility bridge, which is separately wrapped in @media screen in
// index.html) would otherwise keep reading the dark value during a print
// run: --ink would still resolve to #E2E8F0 and print light text onto
// forced-white paper. Scoping the DARK override to screen, rather than the
// consuming rules, fixes every current and future var()-driven rule at the
// source with one change, and :root must stay unscoped or print loses all
// colour (nothing would define the light values a print run needs).
// Dark-only card elevation. Not a colour token (the hex test on
// THEME_TOKENS would reject a box-shadow), and --lift is `none` on :root
// so applying `box-shadow: var(--lift)` in light mode is a no-op — light
// stays byte-identical. The inset highlight is what actually separates a
// card from charcoal paper; the drop is a whisper so a stack of report
// cards does not look like a lightbox.
const DARK_LIFT =
  "0 1px 0 rgba(213,221,232,.14) inset,0 10px 28px -10px rgba(0,0,0,.55)";

// Dark-only chrome that is not a colour token: native autofill, the caret,
// scrollbar thumb, and font smoothing. Light mode must not gain any of
// these -- they are a second @media screen block after the dark token
// block, so print stays light. Interpolated via rootCss() into every
// server-rendered in-scope page; index.html hand-copies the same rules
// (it is static and never templates this file).
const DARK_CHROME =
  "@media screen{[data-theme=\"dark\"]{scrollbar-color:var(--wash-2) var(--paper);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}" +
  "[data-theme=\"dark\"] input,[data-theme=\"dark\"] textarea,[data-theme=\"dark\"] select{caret-color:var(--ink)}" +
  "[data-theme=\"dark\"] input:-webkit-autofill,[data-theme=\"dark\"] textarea:-webkit-autofill,[data-theme=\"dark\"] select:-webkit-autofill{" +
  "-webkit-text-fill-color:var(--ink);caret-color:var(--ink);box-shadow:0 0 0 1000px var(--card) inset;transition:background-color 9999s ease-out}}";

function rootCss() {
  const decl = (key) =>
    Object.entries(THEME_TOKENS).map(([n, v]) => `--${n}:${v[key]}`).join(";");
  return `:root{${decl("light")};--lift:none}@media screen{[data-theme="dark"]{${decl("dark")};color-scheme:dark;--lift:${DARK_LIFT}}}${DARK_CHROME}`;
}

module.exports = { THEME_TOKENS, DARK_LIFT, DARK_CHROME, rootCss };
