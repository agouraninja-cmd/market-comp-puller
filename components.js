// The site's shared components (2026-11-10): the BUTTON and the TABS, each
// defined once. Pure like theme.js: no I/O, no clock, no requires, so
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
  // Two sizes. `action` is a page's main call to action; `compact` is a
  // control inside a working page (a toolbar, a row, a form's submit).
  sizes: {
    action:  { pad: "11px 26px", size: "var(--text-body)",  radius: "var(--r-sm)", weight: "600" },
    compact: { pad: "7px 12px",  size: "var(--text-small)", radius: "var(--r-md)", weight: "600" },
  },
  // Two looks. Primary is the filled red; secondary is an outlined card. A
  // compact button carries a 1px border in BOTH looks, so a red one and an
  // outlined one side by side are the same size.
  looks: {
    primary:   { bg: "var(--red-fill)", ink: "#fff", edge: "var(--red-fill)",
                 hover: "background:var(--red-fill-hover);border-color:var(--red-fill-hover)" },
    // The hover restates the ink: a secondary button is often a link, and a
    // page's own `a:hover` colour would otherwise out-rank the class and turn
    // its label red (it did, on /sites, the day the families moved here).
    secondary: { bg: "var(--card)", ink: "var(--ink)", edge: "var(--edge)",
                 hover: "border-color:var(--ink-3);color:var(--ink)" },
  },
  disabled: "opacity:.6;cursor:default",
};

// The families that predate the canon. Each is drawn under its own class
// names. `sel` is the button, `primary` the modifier that makes it the red
// one (a family with `look: "primary"` is always red and has no outlined
// form). `reset` and `layout` are structure, not looks: how the family clears
// the browser's own button font, and how it sits in its row. `differs` is
// where its LOOK departs from the canon above; an empty one is on the canon.
const BUTTON_FAMILIES = [
  { sel: ".hm-btn", primary: ".red", where: "Home and Sites (index.html, home-sites.js, sites-page.js)",
    reset: "font:inherit",
    layout: "flex:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-decoration:none",
    differs: { pad: "7px 11px", radius: "var(--r-lg)", primaryHover: "background:var(--red-fill-hover)" } },
  { sel: ".mc-btn", primary: ".pri", where: "the member card in Firm settings (index.html)",
    reset: "font:inherit", layout: "white-space:nowrap", disabled: true,
    differs: { pad: "7px 13px", radius: "var(--r-lg)", weight: "500", hover: "", primaryHover: "" } },
  { sel: ".pw-btn", primary: ".pri", where: "Permits (permits-page.js)",
    reset: "appearance:none;font:inherit", layout: "white-space:nowrap;display:inline-block", disabled: true,
    // No weight of its own: it reads its row's. And it restates the white
    // text on hover, which changes nothing but was there.
    differs: { weight: null, lineHeight: "1.2",
               primaryHover: "background:var(--red-fill-hover);border-color:var(--red-fill-hover);color:#fff" } },
  { sel: ".msg-btn", primary: ".primary", where: "Messages (messages-page.js)",
    reset: "appearance:none", layout: "", disabled: true, disabledSel: ":disabled",
    small: { pad: "4px 9px", size: "var(--text-label)" },
    differs: { pad: "6px 11px", weight: "500", lineHeight: "1.4", hover: "background:var(--wash)", disabledStyle: "opacity:.5;cursor:default" } },
  { sel: ".bd-btn", where: "The Board on /markets (board.js)",
    reset: "font:inherit", layout: "display:inline-block;text-decoration:none",
    differs: { pad: "6px 12px" } },
  { sel: ".bs-btn", look: "primary", where: "the building sheet (buildings-page.js)",
    reset: "appearance:none;font:inherit", layout: "align-self:flex-start",
    // Always red, and with no border at all, so it is 2px smaller each way
    // than a bordered compact button.
    differs: { radius: "var(--r-lg)", border: "0", hover: "background:var(--red-fill-hover)" } },
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
    has("lineHeight") ? `line-height:${d.lineHeight}` : "",
    `padding:${has("pad") ? d.pad : size.pad}`,
    `border:${border}`,
    `border-radius:${has("radius") ? d.radius : size.radius}`,
    `background:${look.bg}`,
    `color:${look.ink}`,
    "cursor:pointer",
    f.layout,
  ].filter(Boolean).join(";");
  const hover = has("hover") ? d.hover : look.hover;
  const out = [`${f.sel}{${base}}`];
  if (hover) out.push(`${f.sel}:hover{${hover}}`);
  if (f.primary) {
    out.push(`${f.sel}${f.primary}{background:${pri.bg};border-color:${pri.edge};color:${pri.ink}}`);
    const ph = has("primaryHover") ? d.primaryHover : pri.hover;
    if (ph) out.push(`${f.sel}${f.primary}:hover{${ph}}`);
  }
  if (f.disabled) out.push(`${f.sel}${f.disabledSel || "[disabled]"}{${has("disabledStyle") ? d.disabledStyle : BUTTON.disabled}}`);
  if (f.small) out.push(`${f.sel}.sm{padding:${f.small.pad};font-size:${f.small.size}}`);
  return out.join("\n");
}

function buttonCss(opts) {
  const unified = !!(opts && opts.unified);
  const a = BUTTON.sizes.action, c = BUTTON.sizes.compact;
  const p = BUTTON.looks.primary, s = BUTTON.looks.secondary;
  // The canonical button. A link or a <button>; filled red unless .ghost.
  // `color` is restated on hover because a page's own `a:hover` colour
  // otherwise out-ranks it and greys the label.
  const canon = [
    `.btn{display:inline-block;background:${p.bg};color:${p.ink};font-weight:${a.weight};padding:${a.pad};border-radius:${a.radius};font-size:${a.size}}`,
    `.btn:hover{background:var(--red-fill-hover);color:${p.ink}}`,
    `button.btn{border:0;cursor:pointer;font-family:inherit}`,
    // Compact. 7px 14px where the families below are 7px 12px: it is the
    // header's "Run a report" button, and the one `differs` the canon has.
    `.btn.sm{padding:${unified ? c.pad : "7px 14px"};font-size:${c.size}}`,
    // Secondary. Outlined, so it states its hover whole: .btn:hover above
    // would otherwise turn it red.
    `.btn.ghost{background:${s.bg};color:${s.ink};border:1px solid ${s.edge}}`,
    `.btn.ghost:hover{background:${s.bg};${s.hover}}`,
  ].join("\n");
  return canon + "\n" + BUTTON_FAMILIES.map((f) => buttonFamilyCss(f, unified)).join("\n");
}

// ---------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------

// Underlined tabs: a row of words on a hairline, the current one in ink with
// a 2px red line under it. The canon is `.tabs` holding `.tab`s, the current
// one marked aria-selected="true" (or aria-current="page" on a link).
const TABS = {
  list: { gap: "2px", rule: "var(--line)" },
  tab: { pad: "10px 14px", size: "var(--text-compact)", weight: "400", ink: "var(--ink-2)",
         hover: "color:var(--ink)", line: "var(--red)", focusOffset: "-2px" },
  count: { ink: "var(--ink-3)", weight: "600", gap: "3px" },
};

// `list` and `tab` are the family's own selectors; `on` is how it marks the
// current tab; `count` is the small figure beside a label, where it has one.
const TAB_FAMILIES = [
  { list: ".vt-tabs", tab: ".vt-tab", on: ".vt-tab.on", count: ".vt-tab b", where: "Comps and Pipeline (vault-page.js)",
    listLayout: "align-items:flex-end;padding-right:200px",
    // A hot count stays red in both states.
    extra: ".vt-tab b.hot{color:var(--red)}\n.vt-tab.on b{color:var(--ink)}\n.vt-tab.on b.hot{color:var(--red)}",
    differs: { rule: "var(--edge)" } },
  { list: ".pt-tabs", tab: ".pt-tab", on: '.pt-tab[aria-selected="true"]', where: "Permits (permits-page.js)",
    listLayout: "margin-top:20px;overflow-x:auto;scrollbar-width:none",
    tabReset: "appearance:none", tabLayout: "display:inline-flex;align-items:baseline;gap:6px",
    extra: ".pt-tab .n{font-size:var(--text-note);font-weight:400;color:var(--ink-3);font-variant-numeric:tabular-nums}",
    // Its line is ink, drawn as a shadow, and its tabs have no side padding:
    // they are spaced by the row's gap instead. Its focus ring is its page's.
    differs: { gap: "28px", pad: "10px 0 11px", size: "var(--text-body)", underline: "shadow", line: "var(--ink)", focus: false } },
  { list: ".hm-tabs", tab: ".hm-tabs button", on: '.hm-tabs button[aria-selected="true"]', count: ".hm-tabs button b", where: "Home (index.html)",
    listLayout: "margin-top:16px;overflow-x:auto;scrollbar-width:none", tabLayout: "flex:none",
    extra: ".hm-tabs::-webkit-scrollbar{display:none}",
    differs: { pad: "10px 10px 12px", weight: "500", ink: "var(--ink-3)", hover: "", line: "var(--red-fill)", countGap: "2px" } },
];

const TAB_LOOK_KEYS = ["gap", "rule", "pad", "size", "weight", "ink", "hover", "line", "underline", "focus", "countGap"];

function tabFamilyCss(f, unified) {
  const d = unified ? {} : (f.differs || {});
  const has = (k) => Object.prototype.hasOwnProperty.call(d, k);
  const v = (k, canon) => (has(k) ? d[k] : canon);
  const t = TABS.tab;
  const shadow = v("underline", "border") === "shadow";
  const weight = v("weight", t.weight);
  const list = [`display:flex`, `gap:${v("gap", TABS.list.gap)}`, `border-bottom:1px solid ${v("rule", TABS.list.rule)}`, f.listLayout].filter(Boolean).join(";");
  const tab = [
    f.tabReset,
    "border:0",
    // The line is a transparent border the current tab colours in, pulled
    // down 1px so it sits ON the row's hairline.
    shadow ? "" : "border-bottom:2px solid transparent;margin-bottom:-1px",
    "background:none",
    "font:inherit",
    `font-size:${v("size", t.size)}`,
    weight !== "400" ? `font-weight:${weight}` : "",
    `color:${v("ink", t.ink)}`,
    `padding:${v("pad", t.pad)}`,
    "white-space:nowrap",
    "cursor:pointer",
    f.tabLayout,
  ].filter(Boolean).join(";");
  const line = v("line", t.line);
  const out = [`${f.list}{${list}}`, `${f.tab}{${tab}}`];
  if (f.count) out.push(`${f.count}{font-weight:${TABS.count.weight};color:${TABS.count.ink};margin-left:${v("countGap", TABS.count.gap)}}`);
  const hover = v("hover", t.hover);
  if (hover) out.push(`${f.tab}:hover{${hover}}`);
  out.push(`${f.on}{color:var(--ink);font-weight:600;${shadow ? `box-shadow:inset 0 -2px 0 ${line}` : `border-bottom-color:${line}`}}`);
  if (v("focus", true)) out.push(`${f.tab}:focus-visible{outline:2px solid var(--red);outline-offset:${t.focusOffset}}`);
  if (f.extra) out.push(f.extra);
  return out.join("\n");
}

// A segmented control: a few choices side by side, the current one filled.
// The canon is `.seg`, a bordered pill holding links or buttons.
const SEGMENTED = {
  list: { gap: "2px", pad: "3px", radius: "var(--r-pill)", rule: "var(--line)", bg: "var(--card)", size: "var(--text-ui)" },
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
    differs: { frame: false, listDisplay: "flex", radius: "var(--r-md)", pad: "6px 10px", size: "var(--text-body)", weight: "600",
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
    `.tabs{display:flex;gap:${TABS.list.gap};border-bottom:1px solid ${TABS.list.rule}}`,
    `.tab{border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;font:inherit;font-size:${t.size};color:${t.ink};padding:${t.pad};white-space:nowrap;cursor:pointer;text-decoration:none}`,
    `.tab b{font-weight:${TABS.count.weight};color:${TABS.count.ink};margin-left:${TABS.count.gap}}`,
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

// Everything, as one stylesheet. Every in-scope stylesheet is a JS template
// literal, so this must never contain a backtick or a ${ sequence (a test
// pins that, as it does for theme.js's rootCss).
function componentCss(opts) {
  return buttonCss(opts) + "\n" + tabsCss(opts);
}

// Every place a family's look still departs from the canon, as
// "<selector>: <key>" strings. The test freezes this list: it may shrink.
function deviations() {
  const out = [".btn.sm: pad"];
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
  buttonCss, tabsCss, componentCss, deviations,
};
