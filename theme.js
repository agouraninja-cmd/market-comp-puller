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
// Dark values come from the slate ramp index.html's own token comment
// already documents (slate-950 #020617 bookends, slate-900 #0F172A ink,
// slate-800 #1E293B lifted, slate-700 #334155 hover). No new brand colours.
const THEME_TOKENS = {
  // --- surfaces ---------------------------------------------------------
  paper:            { light: "#FBFBF9", dark: "#020617" }, // page
  card:             { light: "#ffffff", dark: "#0F172A" }, // card, above paper
  wash:             { light: "#F5F4EF", dark: "#1E293B" }, // lifted panel
  // Same light value as --wash on purpose: in light mode a hover above a
  // washed surface DARKENS, in dark mode it must LIGHTEN. One token cannot
  // express both directions, so this one changes nothing today.
  "wash-2":         { light: "#F5F4EF", dark: "#334155" },
  // Surfaces that are ALREADY dark in light mode (bg-[#1A2433], bg-slate-900,
  // the footer). Left equal to --paper they would dissolve into the page and
  // the emphasis they carry would vanish. They lift instead.
  slab:             { light: "#1A2433", dark: "#1E293B" },

  // --- rules ------------------------------------------------------------
  edge:             { light: "#D8D4C9", dark: "#334155" }, // primary border
  line:             { light: "#E4E2DA", dark: "#273244" },
  hair:             { light: "#F0EFE9", dark: "#1E293B" }, // hairline/divider

  // --- ink --------------------------------------------------------------
  ink:              { light: "#1A2433", dark: "#E2E8F0" },
  "ink-body":       { light: "#374253", dark: "#CBD5E1" },
  "ink-2":          { light: "#4C5665", dark: "#C2CCDA" },
  "ink-mute":       { light: "#5A6473", dark: "#AEBACB" },
  "ink-3":          { light: "#68707E", dark: "#94A3B8" }, // the workhorse
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
  "err-bg":         { light: "#FCF1EF", dark: "#2A1517" },
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
function rootCss() {
  const decl = (key) =>
    Object.entries(THEME_TOKENS).map(([n, v]) => `--${n}:${v[key]}`).join(";");
  return `:root{${decl("light")}}@media screen{[data-theme="dark"]{${decl("dark")}}}`;
}

module.exports = { THEME_TOKENS, rootCss };
