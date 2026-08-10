// The dark-mode token table. Pure like entitlements.test.js: no server, no
// database, no clock. The light values here are copied verbatim from the
// :root block vault-page.js and the four dashboards already share, so a
// changed light value is a regression in the theme that already ships.
const test = require("node:test");
const assert = require("node:assert");
const { THEME_TOKENS, rootCss } = require("../theme.js");

// The vocabulary that already exists in five shipped pages. If any light
// value here drifts, those pages restyle silently.
const EXISTING = {
  ink: "#1A2433", "ink-2": "#4C5665", "ink-3": "#68707E", "ink-4": "#C7CBD2",
  red: "#B91C1C", "red-deep": "#991B1B", green: "#15803D",
  paper: "#FBFBF9", line: "#E4E2DA", hair: "#F0EFE9",
  wash: "#F5F4EF", edge: "#D8D4C9",
};

test("the pre-existing token vocabulary keeps its exact light values", () => {
  for (const [name, light] of Object.entries(EXISTING)) {
    assert.ok(THEME_TOKENS[name], `missing token --${name}`);
    assert.equal(THEME_TOKENS[name].light, light, `--${name} light value moved`);
  }
});

test("every token declares both a light and a dark value", () => {
  for (const [name, v] of Object.entries(THEME_TOKENS)) {
    assert.equal(typeof v.light, "string", `--${name} has no light value`);
    assert.equal(typeof v.dark, "string", `--${name} has no dark value`);
    assert.match(v.light, /^#[0-9A-Fa-f]{3,8}$/, `--${name} light is not a hex`);
    assert.match(v.dark, /^#[0-9A-Fa-f]{3,8}$/, `--${name} dark is not a hex`);
  }
});

test("the text/fill split exists, because a filled button must stay saturated", () => {
  // --red lightens for contrast as TEXT on a dark page; --red-fill stays
  // saturated because white text sits on top of it.
  assert.notEqual(THEME_TOKENS["red"].dark, THEME_TOKENS["red-fill"].dark);
  assert.equal(THEME_TOKENS["red-fill"].light, THEME_TOKENS["red"].light);
});

test("surfaces already dark in light mode lift rather than stay put", () => {
  // --slab is #1A2433 on light paper. If its dark value equalled --paper it
  // would dissolve into the page and the emphasis would vanish.
  assert.notEqual(THEME_TOKENS["slab"].dark, THEME_TOKENS["paper"].dark);
});

test("rootCss emits both blocks with every token", () => {
  const css = rootCss();
  assert.match(css, /^:root\{/);
  assert.match(css, /\[data-theme="dark"\]\{/);
  for (const [name, v] of Object.entries(THEME_TOKENS)) {
    assert.ok(css.includes(`--${name}:${v.light}`), `light --${name} missing`);
    assert.ok(css.includes(`--${name}:${v.dark}`), `dark --${name} missing`);
  }
});

test("rootCss is safe to interpolate into a template literal", () => {
  // Every in-scope stylesheet is a JS template literal. A backtick or a
  // ${ in this string would end it and break the module that embeds it.
  const css = rootCss();
  assert.equal(css.includes("`"), false);
  assert.equal(css.includes("${"), false);
});
