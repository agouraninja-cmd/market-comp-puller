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
//
// The ENDS of that ramp were opened up on 2026-08-21. The 08-14 notch fixed
// the middle and left the extremes bunched: dark spanned 2.14x (--ink 11.41:1
// down to --ink-3 5.32:1) where light spans 3.13x (15.62:1 down to 4.99:1).
// Everything landed in one mid-grey band, so headings did not out-rank body
// copy and captions did not whisper. --ink goes #D5DDE8 -> #E4E9F0 (11.41:1
// -> 12.81:1) and --ink-faint goes #7C8899 -> #5E6978 (4.34:1 -> 2.80:1,
// matching light's 2.58:1). The four middle steps do NOT move -- body copy
// and the workhorse grey stay exactly where 08-14 put them.
//
// Note what --ink-faint's drop means: it is a whisper token again, below AA
// by design, exactly as it already is in light. Anything that needs to be
// READ must not use it, and a sweep of every consumer on 2026-08-21 turned
// up two places that did.
//
// The FOOTER is the important one, and the reason is a trap worth naming
// once: --slab is dark in BOTH themes (#1A2433 light, #243044 dark), so on
// that one surface the whole ink ramp runs backwards. It is built to lighten
// as the page darkens, and the footer never lightened. Measured on /brokers:
// footer links (--ink-4) 9.60:1 in light and 1.75:1 in dark; the legal small
// print (--ink-faint) 6.06:1 and 2.38:1. index.html survived it because its
// bridge already redirects .text-[#B8C0CC] and .text-[#D5DAE2] to --ink-3 for
// exactly this reason -- but the three SERVER-RENDERED footers write
// var(--ink-4) directly, where no class bridge can reach them. They take
// FOOTER_DARK_CSS in server.js now, one shared constant rather than a fourth
// copy of a block that already says "keep the three in step".
//
// The other was index.html's .text-[#8F99A8] (also the footer's small print,
// also on the slab, 5.42:1 in light), remapped to --ink-3 in the bridge.
//
// What the sweep deliberately did NOT change: .text-[#9AA2AD] and the nav's
// disclosure caret. Both measure BETTER in dark than in light (2.80:1 vs
// 2.58:1, and 3.18:1 vs 2.58:1), because they sit on surfaces that really do
// invert. They are whispers in both themes, which is the intent. The caret is
// a UI affordance rather than text, so 3:1 is its bar and dark clears it
// while light does not -- a light-mode finding, not a dark-mode one.
//
// Rules: dark sits on light's own ladder. That is the whole rule, and every
// number below is derived from it rather than chosen.
//
//   token   light (on --card)   dark (on --card)
//   hair          1.15                1.15
//   line          1.30                1.28
//   edge          1.48                1.45
//
// Getting there took four moves over 2026-08-21, and the order matters
// because three of them were corrections of the one before:
//
//   hair #1E2938 -> #253346  (1.06 -> 1.22)  the comp tables had no dividers
//   line #2A3648 -> #2F3D51  (1.28 -> 1.42)  reverted, see below
//   edge #3D4B5F -> #333E4F  (1.76 -> 1.45)  never touched before this
//   hair #253346 -> #222F40  (1.22 -> 1.15)  the app's search card
//
// --hair started at 1.06:1, which is not a visible line: the comp tables' row
// dividers were genuinely absent. It over-corrected to 1.22, above light's own
// weight, and the surface that showed it was the app's search card -- eight
// rules on one small card (the pane divider, two headings, three rows, two
// cell dividers), invisible before and a drawn grid after. It sits at light's
// 1.15 now, so those rules are exactly as heavy as the same card's are in
// light, and the table dividers it was raised for are still there.
//
// MEASURE BEFORE MOVING ANY OF THESE. Which token draws the lines on a given
// page is not guessable, and was guessed wrong twice here. By painted border
// length in dark, --edge was 80% of every line on a market page and 90% on a
// report, against --line's 2% and 7% -- so reverting --line, the obvious fix
// when the pages were called too ruled, would have been a change nobody could
// see. Meanwhile the app's search card uses --hair for all eight of its rules
// and --line for none at all. Three surfaces, three different answers.
//
// --edge had never been touched by the dark-mode work: it shipped at 1.76:1
// against light's 1.48:1, so dark had always drawn its boxes about 19%
// heavier. What separates a card from the page in dark is --lift and the
// card's own fill; --edge is the hairline around it, not the thing doing the
// work. If cards ever read as undefined, reach for --lift first.
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
  edge:             { light: "#D8D4C9", dark: "#333E4F" }, // primary border
  line:             { light: "#E4E2DA", dark: "#2A3648" },
  hair:             { light: "#F0EFE9", dark: "#222F40" }, // hairline/divider

  // --- ink --------------------------------------------------------------
  ink:              { light: "#1A2433", dark: "#E4E9F0" },
  "ink-body":       { light: "#374253", dark: "#B6C1CF" },
  "ink-2":          { light: "#4C5665", dark: "#A8B6C6" },
  "ink-mute":       { light: "#5A6473", dark: "#96A3B4" },
  "ink-3":          { light: "#68707E", dark: "#8B98A8" }, // the workhorse
  "ink-faint":      { light: "#9AA2AD", dark: "#5E6978" },
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
  // was originally held at 4.5:1 (#C27070, 4.80:1) on instruction, and the
  // note here flagged that its siblings clear only ~1.96:1 (--ok-rule) and
  // ~1.79:1 (--warn-rule) against their own dark backgrounds. Side by side
  // that read exactly as odd as predicted: the error box wore a bright
  // saturated outline while success and warning wore hairlines. Resolved
  // 2026-08-21 by bringing err DOWN to the siblings (#943F3F, 2.50:1)
  // rather than dragging the other two up. These are BORDERS, not text --
  // no contrast floor applies to them, and 4.5:1 outlines make an alert
  // shout over its own message. The error TEXT is untouched and still
  // clears 6.23:1, which is the part a reader actually has to read.
  "err-text":       { light: "#7F1D1D", dark: "#F87171" },
  "err-bg":         { light: "#FCF1EF", dark: "#2A1517" },
  "err-rule":       { light: "#F0C7C7", dark: "#943F3F" },
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

// Dark-only chrome that is not a colour token: the field background, native
// autofill, the caret, scrollbar thumb, and font smoothing. Light mode must
// not gain any of these -- they are a second @media screen block after the
// dark token block, so print stays light. Interpolated via rootCss() into
// every server-rendered in-scope page; index.html hand-copies the same rules
// (it is static and never templates this file).
//
// The field background is the one that looked broken. NOT ONE input on this
// site carries a bg-* class (18 in index.html, 38 in vault-page.js, 21 in
// server.js, zero with a background). In light that was invisible luck: the
// UA default is white, which is exactly --card, so a white field on a white
// card separated by its --edge border was the intended design all along. In
// dark, color-scheme:dark hands those same fields Chrome's own #3B3B3B --
// a NEUTRAL grey, off-palette against cool slate, sitting at 1.39:1 against
// --card. Every text field on the site read as muddy and slightly warm.
//
// They take --paper (one step DOWN from the card they sit on) rather than
// --card. That deliberately diverges from light's white-on-white: on
// charcoal a 1.76:1 border alone is too thin to read as an edge, and a
// field recessed below its surface is what dark UIs use to say "type here".
// Selector is by ELEMENT, so it is specificity 0,1,1 -- any input that ever
// does get a bg-* class still wins through the bridge at 0,2,0.
const DARK_CHROME =
  "@media screen{[data-theme=\"dark\"]{scrollbar-color:var(--wash-2) var(--paper);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}" +
  "[data-theme=\"dark\"] input,[data-theme=\"dark\"] textarea,[data-theme=\"dark\"] select{caret-color:var(--ink)}" +
  "[data-theme=\"dark\"] input:not(.rd-in):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset])," +
  "[data-theme=\"dark\"] textarea:not(.rd-in),[data-theme=\"dark\"] select:not(.rd-in){background-color:var(--paper)}" +
  "[data-theme=\"dark\"] input:-webkit-autofill,[data-theme=\"dark\"] textarea:-webkit-autofill,[data-theme=\"dark\"] select:-webkit-autofill{" +
  "-webkit-text-fill-color:var(--ink);caret-color:var(--ink);box-shadow:0 0 0 1000px var(--paper) inset;transition:background-color 9999s ease-out}" +
  // The Research Desk's fields are the one exception, and .rd-in lives only
  // in index.html -- but the exemption is carried here too so the two copies
  // of this block stay readable as one rule. On that form the CELL is the
  // field: .rd-cell draws the box and the focus ring, .rd-in is borderless
  // and transparent, so recessing it one step below the card put a dark slab
  // under Property address, Focus, Lookback and Property SF (2026-08-23).
  // Autofill covers with --card, the cell's own colour, rather than --paper.
  "[data-theme=\"dark\"] .rd-in:-webkit-autofill,[data-theme=\"dark\"] .rd-in:-webkit-autofill:hover," +
  "[data-theme=\"dark\"] .rd-in:-webkit-autofill:focus{box-shadow:0 0 0 1000px var(--card) inset}}";

// Chrome paints a light-blue sheet on autofill, including when someone
// pastes a street address it recognises. background-color cannot override
// it (UA !important); an inset shadow the size of the field can. var(--card)
// is the LIGHT field colour, so the field stays the colour it already is.
// Intentionally NOT inside DARK_CHROME: that block is dark-only, and the
// blue sheet is a light-mode bug. Dark restates the same rule with
// var(--paper) inside DARK_CHROME, at a higher specificity (0,2,1 beats
// 0,1,1) so it wins here regardless of source order -- if the dark field
// colour ever moves, BOTH copies move. :hover/:focus are the states Chrome
// restyles after the paste.
const AUTOFILL_COVER =
  "input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus," +
  "textarea:-webkit-autofill,textarea:-webkit-autofill:hover,textarea:-webkit-autofill:focus," +
  "select:-webkit-autofill,select:-webkit-autofill:hover,select:-webkit-autofill:focus{" +
  "-webkit-text-fill-color:var(--ink);caret-color:var(--ink);" +
  "box-shadow:0 0 0 1000px var(--card) inset;transition:background-color 9999s ease-out}";

function rootCss() {
  const decl = (key) =>
    Object.entries(THEME_TOKENS).map(([n, v]) => `--${n}:${v[key]}`).join(";");
  return `:root{${decl("light")};--lift:none}@media screen{[data-theme="dark"]{${decl("dark")};color-scheme:dark;--lift:${DARK_LIFT}}}${DARK_CHROME}${AUTOFILL_COVER}`;
}

module.exports = { THEME_TOKENS, DARK_LIFT, DARK_CHROME, AUTOFILL_COVER, rootCss };
