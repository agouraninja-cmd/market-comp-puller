// The site's shared components (2026-11-10): the BUTTON and the TABS, each
// defined once, and one rule for form fields on a phone. Pure like theme.js: no I/O, no clock, no requires, so
// `npm test` exercises all of it with nothing running.
//
// Why this file exists. Until now every page wrote its own button and its own
// tabs: nine button families (.btn, .hm-btn, .mc-btn, .pw-btn, .msg-btn,
// .bd-btn, .bs-btn, and two copies of them) and five tab families, each a
// complete set of rules in its own page's stylesheet. They had drifted the way
// copies do: a compact button was 7px 11px with an 8px corner on Home, 7px
// 12px with 6px on Permits and 6px 11px on Messages, and nobody had chosen any
// of those differences.
//
// How it works. A component is a small table: what it IS (the canon), and the
// families that predate it, each listing only where it still DIFFERS. The CSS
// is generated from that table, one rule set per family under the family's own
// class names, so no page's markup, script or test had to change and nothing
// moved on screen the day this shipped (checked element by element). What
// changed is where the values live: here, once.
//
//   - NEW work uses the canonical classes: `.btn` (the action button),
//     `.btn.sm` (compact), `.btn.ghost` (secondary); `.tabs` / `.tab` for
//     underlined tabs and `.seg` for a segmented control. Never a new family.
//   - A `differs` entry is debt, not a feature. Deleting one makes that
//     family look like the canon, which is a visible change on its pages
//     (before and after pictures, CLAUDE.md's standing rule).
//     componentCss({ unified: true }) emits the CSS with every `differs`
//     ignored: it is what the site would look like with none left, for a
//     preview and for the tests. Nothing serves it.
//   - test/components.test.js pins the canon, refuses a new family and
//     refuses a new `differs`, so the list can only shrink.
//
// Who gets it. server.js interpolates COMPONENT_CSS into MARKET_CSS (every
// server-rendered page) and into index.html at its COMPONENT_CSS marker (the
// app). The admin pages and the deal-room hub draw their own documents and
// their own buttons, and do not take it.
//
// Every value is a theme.js token (a colour, or a size from the scale), so
// dark mode needs nothing here. The one literal is #fff, the text on a filled
// red button, which must not follow the theme (theme.js's --red-fill note).
"use strict";

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

const BUTTON = {
  // Three sizes. `action` is a page's main call to action; `compact` is a
  // control inside a working page (a toolbar, a row, a form's submit);
  // `large` is the one big button a marketing page leads with. Every size has
  // the same 8px corner and the same line height, so a button is one height
  // on every page whatever its row's own leading is.
  sizes: {
    action:  { pad: "10px 24px", size: "var(--text-compact)",  radius: "var(--r-lg)", weight: "600" },
    compact: { pad: "7px 12px",  size: "var(--text-small)", radius: "var(--r-lg)", weight: "600" },
    large:   { pad: "12px 26px", size: "var(--text-lead)" },
  },
  lineHeight: "1.4",
  // Two looks. Primary is the filled red; secondary is an outlined card.
  // Every button carries a 1px border in BOTH looks, so a red one and an
  // outlined one side by side are the same size.
  looks: {
    // The hover restates the ink in both looks: a button is often a link, and
    // a page's own `a:hover` colour would otherwise out-rank the class and
    // recolour its label (it did, on /sites, the day the families moved here).
    primary:   { bg: "var(--red-fill)", ink: "#fff", edge: "var(--red-fill)",
                 hover: "background:var(--red-fill-hover);border-color:var(--red-fill-hover);color:#fff" },
    secondary: { bg: "var(--card)", ink: "var(--ink)", edge: "var(--edge)",
                 hover: "background:var(--wash);border-color:var(--ink-3);color:var(--ink)" },
  },
  disabled: "opacity:.6;cursor:default",
  // Keyboard focus, the same ring on every button.
  focus: "outline:2px solid var(--red);outline-offset:2px",
  // Hover fades rather than snaps. Colours only: nothing here moves a box.
  transition: "background-color .12s,border-color .12s,color .12s",
};

// The families that predate the canon. Each is drawn under its own class
// names. `sel` is the button, `primary` the modifier that makes it the red
// one (a family with `look: "primary"` is always red and has no outlined
// form). `reset` and `layout` are structure, not looks: how the family clears
// the browser's own button font, and how it sits in its row. `small` is a
// family's own smaller size, where it has one. `differs` is where its LOOK
// departs from the canon above. Since 2026-11-10 none does: every family is
// the compact button.
const BUTTON_FAMILIES = [
  { sel: ".hm-btn", primary: ".red", where: "Home and Sites (index.html, home-sites.js, sites-page.js)",
    reset: "font:inherit",
    layout: "flex:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none",
    differs: {} },
  { sel: ".mc-btn", primary: ".pri", where: "the member card in Firm settings (index.html)",
    reset: "font:inherit", layout: "white-space:nowrap", differs: {} },
  { sel: ".pw-btn", primary: ".pri", where: "Permits (permits-page.js)",
    reset: "appearance:none;font:inherit", layout: "white-space:nowrap;display:inline-block", differs: {} },
  { sel: ".msg-btn", primary: ".primary", where: "Messages (messages-page.js)",
    reset: "appearance:none;font:inherit", layout: "",
    small: { pad: "4px 9px", size: "var(--text-label)" }, differs: {} },
  { sel: ".bd-btn", where: "The Board on /markets (board.js)",
    reset: "font:inherit", layout: "display:inline-block;text-decoration:none", differs: {} },
  { sel: ".bs-btn", look: "primary", where: "the building sheet (buildings-page.js)",
    reset: "appearance:none;font:inherit", layout: "align-self:flex-start", differs: {} },
];

// Which `differs` keys are a LOOK (and so are dropped when unified).
const BUTTON_LOOK_KEYS = ["pad", "radius", "weight", "lineHeight", "hover", "primaryHover", "border", "disabledStyle"];

function buttonFamilyCss(f, unified) {
  const d = unified ? {} : (f.differs || {});
  const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
  const size = BUTTON.sizes.compact;
  const look = BUTTON.looks[f.look || "secondary"];
  const pri = BUTTON.looks.primary;
  const weight = has("weight") ? d.weight : size.weight;
  const border = has("border") ? d.border : `1px solid ${look.edge}`;
  const base = [
    f.reset,
    `font-size:${size.size}`,
    weight ? `font-weight:${weight}` : "",
    `line-height:${has("lineHeight") ? d.lineHeight : BUTTON.lineHeight}`,
    `padding:${has("pad") ? d.pad : size.pad}`,
    `border:${border}`,
    `border-radius:${has("radius") ? d.radius : size.radius}`,
    `background:${look.bg}`,
    `color:${look.ink}`,
    "cursor:pointer",
    f.layout,
    `transition:${BUTTON.transition}`,
  ].filter(Boolean).join(";");
  const hover = has("hover") ? d.hover : look.hover;
  const out = [`${f.sel}{${base}}`];
  if (hover) out.push(`${f.sel}:hover{${hover}}`);
  if (f.primary) {
    out.push(`${f.sel}${f.primary}{background:${pri.bg};border-color:${pri.edge};color:${pri.ink}}`);
    const ph = has("primaryHover") ? d.primaryHover : pri.hover;
    if (ph) out.push(`${f.sel}${f.primary}:hover{${ph}}`);
  }
  // Every family dims when disabled (three of the six did before).
  out.push(`${f.sel}[disabled]{${has("disabledStyle") ? d.disabledStyle : BUTTON.disabled}}`);
  out.push(`${f.sel}:focus-visible{${BUTTON.focus}}`);
  if (f.small) out.push(`${f.sel}.sm{padding:${f.small.pad};font-size:${f.small.size}}`);
  return out.join("\n");
}

function buttonCss(opts) {
  const unified = !!(opts && opts.unified);
  const a = BUTTON.sizes.action, c = BUTTON.sizes.compact, l = BUTTON.sizes.large;
  const p = BUTTON.looks.primary, s = BUTTON.looks.secondary;
  // The canonical button. A link or a <button>; filled red unless .ghost.
  // Its border is transparent rather than red, so a page that paints the
  // button another red (the dark bands' brighter one) need not repaint an
  // edge as well; the fill shows through it.
  const canon = [
    `.btn{display:inline-block;background:${p.bg};color:${p.ink};border:1px solid transparent;font-weight:${a.weight};padding:${a.pad};border-radius:${a.radius};font-size:${a.size};line-height:${BUTTON.lineHeight};text-align:center;transition:${BUTTON.transition}}`,
    `.btn:hover{background:var(--red-fill-hover);color:${p.ink}}`,
    `button.btn{cursor:pointer;font-family:inherit}`,
    `.btn.sm{padding:${c.pad};font-size:${c.size}}`,
    `.btn.lg{padding:${l.pad};font-size:${l.size}}`,
    // Secondary. Outlined, so it states its hover whole: .btn:hover above
    // would otherwise turn it red.
    `.btn.ghost{background:${s.bg};color:${s.ink};border-color:${s.edge}}`,
    `.btn.ghost:hover{${s.hover}}`,
    `.btn[disabled]{${BUTTON.disabled}}`,
    `.btn:focus-visible{${BUTTON.focus}}`,
  ].join("\n");
  return canon + "\n" + BUTTON_FAMILIES.map((f) => buttonFamilyCss(f, unified)).join("\n");
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

// Underlined tabs: a row of words on a hairline, the current one in ink with
// a 2px red line under it. The canon is `.tabs` holding `.tab`s, the current
// one marked aria-selected="true" (or aria-current="page" on a link).
//
// The hairline is an inset shadow on the row and the red line is the tab's
// own bottom border, drawn over it. No negative margin anywhere: a row that
// scrolls sideways on a phone (overflow-x) would otherwise also scroll 1px
// up and down.
const TABS = {
  list: { gap: "4px", rule: "var(--line)" },
  tab: { pad: "10px 12px", size: "var(--text-compact)", weight: "500", ink: "var(--ink-mute)",
         hover: "color:var(--ink)", line: "var(--red)", focusOffset: "-2px", gap: "6px" },
  // The small figure beside a label. It sits a flex gap from the label, so an
  // empty one is taken out rather than left holding the gap open.
  count: { ink: "var(--ink-3)", weight: "500", size: "var(--text-label)" },
};

// `list` and `tab` are the family's own selectors; `on` is how it marks the
// current tab; `count` is the small figure beside a label, where it has one.
// `differs` is where a family's LOOK departs from the canon. Since 2026-11-10
// none does.
const TAB_FAMILIES = [
  { list: ".vt-tabs", tab: ".vt-tab", on: ".vt-tab.on", count: ".vt-tab b", where: "Comps and Pipeline (vault-page.js)",
    listLayout: "align-items:flex-end;padding-right:200px",
    // A hot count is red in both states.
    extra: ".vt-tab b.hot{color:var(--red);font-weight:600}",
    differs: {} },
  { list: ".pt-tabs", tab: ".pt-tab", on: '.pt-tab[aria-selected="true"]', count: ".pt-tab .n", where: "Permits (permits-page.js)",
    listLayout: "margin-top:20px;overflow-x:auto;scrollbar-width:none", tabReset: "appearance:none",
    differs: {} },
  { list: ".hm-tabs", tab: ".hm-tabs button", on: '.hm-tabs button[aria-selected="true"]', count: ".hm-tabs button b", where: "Home (index.html)",
    listLayout: "margin-top:16px;overflow-x:auto;scrollbar-width:none", tabLayout: "flex:none",
    extra: ".hm-tabs::-webkit-scrollbar{display:none}",
    differs: {} },
];

const TAB_LOOK_KEYS = ["gap", "rule", "pad", "size", "weight", "ink", "hover", "line", "focus"];

function tabRule(reset, layout, v) {
  const t = TABS.tab;
  return [
    reset,
    "border:0",
    "border-bottom:2px solid transparent",
    "background:none",
    "font:inherit",
    `font-size:${v("size", t.size)}`,
    `font-weight:${v("weight", t.weight)}`,
    `color:${v("ink", t.ink)}`,
    `padding:${v("pad", t.pad)}`,
    `display:inline-flex;align-items:baseline;gap:${t.gap}`,
    "white-space:nowrap",
    "cursor:pointer",
    layout,
    "transition:color .12s,border-color .12s",
  ].filter(Boolean).join(";");
}

function tabCountCss(sel) {
  const c = TABS.count;
  return `${sel}{font-size:${c.size};font-weight:${c.weight};color:${c.ink};font-variant-numeric:tabular-nums}\n${sel}:empty{display:none}`;
}

function tabFamilyCss(f, unified) {
  const d = unified ? {} : (f.differs || {});
  const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
  const v = (k, canon) => (has(k) ? d[k] : canon);
  const t = TABS.tab;
  const list = [`display:flex`, `gap:${v("gap", TABS.list.gap)}`, `box-shadow:inset 0 -1px 0 ${v("rule", TABS.list.rule)}`, f.listLayout].filter(Boolean).join(";");
  const out = [`${f.list}{${list}}`, `${f.tab}{${tabRule(f.tabReset, f.tabLayout, v)}}`];
  if (f.count) out.push(tabCountCss(f.count));
  const hover = v("hover", t.hover);
  if (hover) out.push(`${f.tab}:hover{${hover}}`);
  out.push(`${f.on}{color:var(--ink);font-weight:600;border-bottom-color:${v("line", t.line)}}`);
  if (v("focus", true)) out.push(`${f.tab}:focus-visible{outline:2px solid var(--red);outline-offset:${t.focusOffset}}`);
  if (f.extra) out.push(f.extra);
  return out.join("\n");
}

// A segmented control: a few choices side by side, the current one filled.
// The canon is `.seg`, a bordered pill holding links or buttons.
const SEGMENTED = {
  list: { gap: "2px", pad: "3px", radius: "var(--r-pill)", rule: "var(--line)", bg: "var(--card)", size: "var(--text-compact)" },
  item: { pad: "6px 14px", radius: "var(--r-pill)", ink: "var(--ink-mute)", weight: "500",
          hover: "color:var(--ink)", on: "background:var(--ink);color:var(--paper);font-weight:600" },
};

const SEGMENTED_FAMILIES = [
  { list: ".cs-tabs", item: ".cs-tabs a", on: '.cs-tabs a[aria-current="page"]', where: "the Comps section's two tabs (server.js compsSectionTabs)",
    listLayout: "margin:0 0 24px;max-width:100%;line-height:1.4", differs: {} },
  { list: ".msg-views", item: ".msg-views button", on: '.msg-views button[aria-selected="true"]', where: "Messages' Chats / Reports switch (messages-page.js)",
    listLayout: "min-width:0", itemReset: "appearance:none;border:0;background:none;font:inherit;cursor:pointer",
    itemLayout: "display:inline-flex;align-items:center;gap:6px",
    // Not a pill at all yet: no frame, squarer, heavier, and the current
    // one is a wash rather than ink.
    differs: { frame: false, listDisplay: "flex", radius: "var(--r-md)", pad: "6px 10px", size: "var(--text-compact)", weight: "600",
               ink: "var(--ink-3)", hover: "color:var(--ink);background:var(--wash)", on: "color:var(--ink);background:var(--wash-2)", focus: true } },
];

const SEGMENTED_LOOK_KEYS = ["frame", "listDisplay", "radius", "pad", "size", "weight", "ink", "hover", "on", "focus"];

function segmentedFamilyCss(f, unified) {
  const d = unified ? {} : (f.differs || {});
  const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
  const v = (k, canon) => (has(k) ? d[k] : canon);
  const L = SEGMENTED.list, I = SEGMENTED.item;
  const framed = v("frame", true);
  const list = [
    `display:${v("listDisplay", "inline-flex")}`,
    `gap:${L.gap}`,
    framed ? `padding:${L.pad};border:1px solid ${L.rule};border-radius:${L.radius};background:${L.bg};font-size:${L.size}` : "",
    f.listLayout,
  ].filter(Boolean).join(";");
  const item = [
    f.itemReset,
    `padding:${v("pad", I.pad)}`,
    `border-radius:${v("radius", I.radius)}`,
    has("size") ? `font-size:${d.size}` : "",
    `font-weight:${v("weight", I.weight)}`,
    `color:${v("ink", I.ink)}`,
    "white-space:nowrap",
    f.itemLayout,
  ].filter(Boolean).join(";");
  const out = [`${f.list}{${list}}`, `${f.item}{${item}}`, `${f.item}:hover{${v("hover", I.hover)}}`, `${f.on}{${v("on", I.on)}}`];
  if (v("focus", false)) out.push(`${f.item}:focus-visible{outline:2px solid var(--red);outline-offset:-2px}`);
  return out.join("\n");
}

function tabsCss(opts) {
  const unified = !!(opts && opts.unified);
  const t = TABS.tab, L = SEGMENTED.list, I = SEGMENTED.item;
  // The canonical classes, for new work.
  const canon = [
    `.tabs{display:flex;gap:${TABS.list.gap};box-shadow:inset 0 -1px 0 ${TABS.list.rule}}`,
    `.tab{${tabRule("", "text-decoration:none", (k, x) => x)}}`,
    tabCountCss(".tab b"),
    `.tab:hover{${t.hover}}`,
    `.tab[aria-selected="true"],.tab[aria-current="page"]{color:var(--ink);font-weight:600;border-bottom-color:${t.line}}`,
    `.tab:focus-visible{outline:2px solid var(--red);outline-offset:${t.focusOffset}}`,
    `.seg{display:inline-flex;gap:${L.gap};padding:${L.pad};border:1px solid ${L.rule};border-radius:${L.radius};background:${L.bg};font-size:${L.size}}`,
    `.seg>a,.seg>button{padding:${I.pad};border:0;border-radius:${I.radius};background:none;font:inherit;font-weight:${I.weight};color:${I.ink};white-space:nowrap;cursor:pointer;text-decoration:none}`,
    `.seg>a:hover,.seg>button:hover{${I.hover}}`,
    `.seg>[aria-selected="true"],.seg>[aria-current="page"]{${I.on}}`,
    `.seg>:focus-visible{outline:2px solid var(--red);outline-offset:-2px}`,
  ].join("\n");
  return canon + "\n" + TAB_FAMILIES.map((f) => tabFamilyCss(f, unified)).join("\n") + "\n" +
    SEGMENTED_FAMILIES.map((f) => segmentedFamilyCss(f, unified)).join("\n");
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Form fields on a phone
// ---------------------------------------------------------------------------

// An iPhone zooms the whole page in when you tap a field whose text is under
// 16px, and does not zoom back out. Most fields here are 13px or 14px, which
// is right on a desktop, so on a phone (a narrow window, or a touch screen)
// every text field, select and textarea is 16px. !important because it has to
// beat each page's own field rule, wherever that sits and whatever it weighs;
// it is the one !important in this file. Checkboxes, radios and the button
// kinds of <input> are left alone. One line, on purpose: test/vault-shell
// reads rules by the line they start on, and this one is not a component.
const FIELD_PHONE = "@media (max-width:640px),(pointer:coarse){" +
  "input" + ["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image", "hidden"].map((t) => ":not([type=" + t + "])").join("") + ",select,textarea" +
  "{font-size:var(--text-input)!important}}";

function fieldCss() {
  return FIELD_PHONE;
}

// ---------------------------------------------------------------------------

// Everything, as one stylesheet. Every in-scope stylesheet is a JS template
// literal, so this must never contain a backtick or a ${ sequence (a test
// pins that, as it does for theme.js's rootCss).
function componentCss(opts) {
  return buttonCss(opts) + "\n" + tabsCss(opts) + "\n" + fieldCss();
}

// Every place a family's look still departs from the canon, as
// "<selector>: <key>" strings. The test freezes this list: it may shrink.
function deviations() {
  const out = [];
  const add = (families, keys, name) => {
    for (const f of families) for (const k of Object.keys(f.differs || {})) if (keys.includes(k)) out.push(`${f[name]}: ${k}`);
  };
  add(BUTTON_FAMILIES, BUTTON_LOOK_KEYS, "sel");
  add(TAB_FAMILIES, TAB_LOOK_KEYS, "list");
  add(SEGMENTED_FAMILIES, SEGMENTED_LOOK_KEYS, "list");
  return out;
}

module.exports = {
  BUTTON, BUTTON_FAMILIES, TABS, TAB_FAMILIES, SEGMENTED, SEGMENTED_FAMILIES,
  buttonCss, tabsCss, fieldCss, componentCss, deviations,
};
