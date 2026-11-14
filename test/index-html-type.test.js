// The app page sets no Georgia (2026-11-14).
//
// The owner took the signed-in app to one typeface in four steps: Home's
// list, Home's greeting, the member pages' titles, headings and figures, and
// last "make the comp report Inter too". index.html is the comp report, the
// search form, Home, and every dialog over them, so after that step nothing
// in it may name a serif: a heading is the page's own face at 600.
//
// The public pages (the server-rendered home page, pricing, FAQ, the market
// pages) are other documents and keep their Georgia.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// Comments out: several explain what USED to be Georgia.
const code = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

test("nothing in the app page is set in a serif face", () => {
  // The token stays defined (the scale is shared with theme.js) and is used
  // by nothing.
  assert.match(code, /--serif:Georgia,'Times New Roman',serif;/);
  assert.equal((code.match(/var\(--serif\)/g) || []).length, 0, "a rule in index.html uses --serif again");
  // No rule names a serif face directly either. `sans-serif` is not one.
  const faces = [...code.matchAll(/font-family\s*:\s*([^;}"]+)/g)].map((m) => m[1].trim());
  assert.ok(faces.length > 5, "the page's font-family declarations were not read");
  for (const f of faces) {
    assert.ok(!/Georgia|Times|(^|[\s,])serif\b/.test(f.replace(/sans-serif/g, "")), `a rule sets ${f}`);
  }
  // Drawn text (the charts) is Inter too.
  for (const m of code.matchAll(/font-family="([^"]+)"/g)) assert.match(m[1], /^Inter\b/);
});

test("the report's headings and figures are the heading weight", () => {
  const rule = (sel) => {
    const at = code.indexOf("\n    " + sel + " {");
    assert.notEqual(at, -1, `no ${sel} rule`);
    return code.slice(at, code.indexOf("}", at));
  };
  // What was Georgia at 400 or 500: Inter at 500 reads as body text.
  for (const sel of [".font-brand", ".rd-h", ".pr-fig", ".pr-stmt tfoot .fig", ".dk-mname", ".dk-addr", ".mc-name", ".hm-first-h", ".hm-pop-b > b"]) {
    assert.match(rule(sel), /font-weight: 600/, `${sel} is not the heading weight`);
  }
});
