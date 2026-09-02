// buildings-page.js — the /buildings body (Three Spaces, slice 4): the whole
// list of a firm's buildings, filtered in the browser, with the header count
// always describing the whole set. The route and the gate are proved in
// test/buildings-page-run.test.js; this file proves the page itself.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderBuildingsBody, FILTER_AT } = require("../buildings-page");
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "buildings-page.js"), "utf8");

const scriptOf = (html) => {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, "the page emits no script block");
  return m[1];
};

const BLDG = (o) => Object.assign({
  id: "b1", address: "500 Warehouse Way, Boise, ID", addressKey: "500 warehouse way boise id",
  verifiedKey: "", market: "Boise, ID", type: "Industrial", sizeSqft: 40000, yearBuilt: 1994,
  addedBy: "Mike", mine: false,
}, o);
const OK = (buildings, extra) => ({ s: 200, j: Object.assign({
  firm: { id: "o1", name: "Colliers Boise" }, truncated: false,
  summary: `${buildings.length} buildings`, buildings,
}, extra || {}) });

// A four-line stand-in DOM: every id the script reaches for auto-vivifies,
// listeners are recorded, and textContent/innerHTML/value/className are plain
// properties — which is all the page's script uses.
function makeDom() {
  const els = new Map();
  function el() {
    const on = {};
    return {
      textContent: "", innerHTML: "", value: "", className: "", disabled: false,
      addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); },
      fire(t, ev) { (on[t] || []).forEach((fn) => fn(ev || {})); },
    };
  }
  const document = { getElementById(id) { if (!els.has(id)) els.set(id, el()); return els.get(id); } };
  return { document, el: (id) => document.getElementById(id), hidden: (id) => /\bhide\b/.test(document.getElementById(id).className) };
}
function run(boot) {
  const dom = makeDom();
  const ctx = vm.createContext({ document: dom.document, console, fetch: () => Promise.reject(new Error("no fetch in this test")) });
  new vm.Script(scriptOf(renderBuildingsBody(boot)), { filename: "buildings-page.js" }).runInContext(ctx);
  return dom;
}

test("the page's own client script actually parses, in every boot state", () => {
  for (const boot of [OK([]), { s: 401, j: {} }, { s: 403, j: { error: "no firm", code: "no_firm" } }, { s: 503, j: {} }, null]) {
    new vm.Script(scriptOf(renderBuildingsBody(boot)));
  }
});

test("the page literal contains exactly one backtick — its own opener", () => {
  const at = SOURCE.indexOf("return `<style>");
  assert.notEqual(at, -1, "the page literal has moved; this guard now checks nothing");
  const literal = SOURCE.slice(at, SOURCE.lastIndexOf("`;"));
  assert.equal((literal.match(/`/g) || []).length, 1,
    "a backtick inside the page literal closes it early — the page will render and do nothing");
});

test("the boot payload cannot close the script tag or carry a raw control byte", () => {
  const html = renderBuildingsBody({ s: 200, j: { error: "</script><img onerror=alert(1)>" } });
  assert.ok(!html.includes("</script><img"), "the boot payload closed the script tag");
  assert.match(html, /\\u003c\/script/);
  new vm.Script(scriptOf(html));
  const stray = [...SOURCE].filter((c) => { const n = c.charCodeAt(0); return (n < 32 && n !== 10 && n !== 9) || n === 127; });
  assert.equal(stray.length, 0, "buildings-page.js holds a raw control character");
});

test("the stylesheet is emitted in the BODY, not handed to the shell's head, and carries no Tailwind utilities", () => {
  const html = renderBuildingsBody(OK([]));
  assert.ok(html.startsWith("<style>"), "the page must open with its own <style>, after MARKET_CSS in document order");
  // The classes a body page must not use: tailwind.css is purged against
  // index.html alone, so a utility here styles nothing, silently.
  assert.doesNotMatch(html, /class="[^"]*\b(?:mt-\d|text-sm|hidden|flex|underline|rounded-lg)\b/);
  // And every custom property it reads is a theme token.
  const { THEME_TOKENS } = require("../theme.js");
  for (const m of html.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
    assert.ok(Object.prototype.hasOwnProperty.call(THEME_TOKENS, m[1]), `--${m[1]} is not a theme token`);
  }
});

test("the header count is the whole set's line, whatever the filter shows", () => {
  const seven = Array.from({ length: 7 }, (_, i) => BLDG({ id: "b" + i, address: (i + 1) * 100 + (i % 2 ? " Oak Ave, Meridian, ID" : " Main St, Boise, ID"), market: i % 2 ? "Meridian, ID" : "Boise, ID", type: i % 3 ? "Industrial" : "Retail" }));
  const dom = run(OK(seven, { summary: "7 buildings · 5 Industrial · 2 Retail" }));
  assert.equal(dom.el("blCount").textContent, "7 buildings · 5 Industrial · 2 Retail");
  assert.equal(dom.el("blTitle").textContent, "Colliers Boise’s buildings");
  assert.equal(dom.hidden("blTools"), false, "seven rows earn the search box");
  assert.equal((dom.el("blRows").innerHTML.match(/class="bl-row"/g) || []).length, 7);
  dom.el("blSearch").value = "meridian";
  dom.el("blSearch").fire("input");
  assert.equal((dom.el("blRows").innerHTML.match(/class="bl-row"/g) || []).length, 3);
  assert.equal(dom.el("blShown").textContent, "3 of 7", "the filtered count is stated separately");
  assert.equal(dom.el("blCount").textContent, "7 buildings · 5 Industrial · 2 Retail", "the header count followed the filter");
  dom.el("blSearch").value = "nothing like this";
  dom.el("blSearch").fire("input");
  assert.equal(dom.hidden("blNone"), false, "a search with no hits says so");
  assert.equal(dom.hidden("blEmpty"), true, "and is not confused with an empty board");
  dom.el("blClear").fire("click");
  assert.equal(dom.el("blSearch").value, "");
  assert.equal((dom.el("blRows").innerHTML.match(/class="bl-row"/g) || []).length, 7);
});

test("the type select and the search box narrow together", () => {
  const rows = [BLDG({ id: "a", type: "Retail", address: "1 Broadway Ave, Boise, ID" }), BLDG({ id: "b", type: "Industrial" }),
    BLDG({ id: "c", type: "Industrial", address: "9 Linder Rd, Meridian, ID", market: "Meridian, ID" }),
    BLDG({ id: "d" }), BLDG({ id: "e" }), BLDG({ id: "f" })];
  const dom = run(OK(rows));
  assert.match(dom.el("blType").innerHTML, /<option value="Industrial"/);
  assert.match(dom.el("blType").innerHTML, /<option value="Retail"/);
  dom.el("blType").value = "Industrial";
  dom.el("blType").fire("change");
  assert.equal((dom.el("blRows").innerHTML.match(/class="bl-row"/g) || []).length, 5);
  dom.el("blSearch").value = "linder";
  dom.el("blSearch").fire("input");
  assert.equal((dom.el("blRows").innerHTML.match(/class="bl-row"/g) || []).length, 1);
  assert.equal(dom.el("blShown").textContent, "1 of 6");
});

test("the search box is furniture under six rows", () => {
  const dom = run(OK([BLDG({}), BLDG({ id: "b2", address: "7 Linder Rd, Meridian, ID" })]));
  assert.equal(dom.hidden("blTools"), true);
  assert.equal(FILTER_AT, 6, "the firm shelf's number, for the same question");
});

test("each row is attributed, and your own row reads 'you'", () => {
  const dom = run(OK([BLDG({}), BLDG({ id: "b2", address: "7 Linder Rd, Meridian, ID", mine: true, addedBy: "Brad", sizeSqft: null, yearBuilt: null })]));
  const rows = dom.el("blRows").innerHTML;
  assert.match(rows, /Industrial · Boise, ID · 40,000 SF · built 1994 · added by Mike/);
  assert.match(rows, /added by you/);
  assert.doesNotMatch(rows, /added by Brad/);
  assert.match(rows, /data-rm="b1"/, "a Remove per row");
});

test("a truncated list says so, and an empty one is an invitation", () => {
  let dom = run(OK([BLDG({})], { truncated: true }));
  assert.equal(dom.hidden("blTrunc"), false);
  dom = run(OK([]));
  assert.equal(dom.hidden("blEmpty"), false);
  assert.equal(dom.hidden("blTools"), true);
});

test("the three refusals are three different sentences, and none is an empty list", () => {
  let dom = run({ s: 401, j: {} });
  assert.match(dom.el("blWall").innerHTML, /Sign in/);
  assert.match(dom.el("blWall").innerHTML, /href="\/\?auth=signin"/);
  dom = run({ s: 403, j: { error: "no firm", code: "no_firm" } });
  assert.match(dom.el("blWall").innerHTML, /not in one yet/);
  assert.match(dom.el("blWall").innerHTML, /href="\/desk"/);
  for (const boot of [{ s: 503, j: {} }, null]) {
    dom = run(boot);
    assert.match(dom.el("blWall").innerHTML, /Nothing has been lost/, "an outage is reported as an outage");
    assert.equal(dom.hidden("blEmpty"), true, "never as an empty board");
  }
});

test("addresses are escaped — a building name is text a person typed", () => {
  const dom = run(OK([BLDG({ address: '<img src=x onerror=alert(1)> "Main" St, Boise, ID' })]));
  assert.doesNotMatch(dom.el("blRows").innerHTML, /<img/);
  assert.match(dom.el("blRows").innerHTML, /&lt;img/);
});
