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
  const literal = SOURCE.slice(at, SOURCE.indexOf("`;", at));
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


// ---------------------------------------------------------------------------
// The sheet (slice 5)
// ---------------------------------------------------------------------------
const { renderBuildingSheetBody } = require("../buildings-page");
const SHEET = (over) => ({ s: 200, j: Object.assign({
  org: { id: "o1", name: "Colliers Boise" },
  building: { id: "b1", address: "1210 N 17th St, Boise, ID", market: "Boise, ID", type: "Industrial", sizeSqft: 12500, yearBuilt: 1994, addedBy: "Brad", mine: true },
  firmComps: [{ id: "f1", date: "2026-01-09", transaction: "sale", price: 1250000, sizeSqft: 12500, pricePerSqft: 100, sharedBy: "Mike" }],
  mineComps: [{ id: "m1", date: "2025-11-20", transaction: "lease", price: null, rentPsfYr: 9.5, sizeSqft: 12500, pricePerSqft: null, published: false, shared: false }],
  reports: [{ id: "r1", url: "/r/r1", type: "Industrial", sharedBy: "Mike", mine: false, createdAt: "2026-02-01T00:00:00Z" }],
  valuations: [{ ts: "2026-03-01T00:00:00Z", low: 1100000, likely: 1250000, high: 1400000, source: "yours" },
               { ts: "2026-02-01T00:00:00Z", low: 1000000, likely: 1200000, high: 1300000, source: "report", sharedBy: "Mike" }],
  contacts: [{ id: "c1", name: "Dana Wu", company: "Acme", email: "", addedBy: "Mike", mine: false }],
  notes: [{ id: "n1", body: "Roof replaced 2021", addedBy: "Brad", mine: true, createdAt: "2026-04-01T00:00:00Z" }],
}, over || {}) });
function runSheet(boot) {
  const dom = makeDom();
  // The identity cells call setAttribute/getAttribute; the stand-in grows them.
  const real = dom.document.getElementById;
  dom.document.getElementById = (id) => {
    const el = real(id);
    if (!el.setAttribute) { el._attrs = {}; el.setAttribute = (k, v) => { el._attrs[k] = String(v); }; el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null); }
    return el;
  };
  const ctx = vm.createContext({ document: dom.document, console, fetch: () => Promise.reject(new Error("no fetch in this test")), confirm: () => true });
  new vm.Script(scriptOf(renderBuildingSheetBody(boot)), { filename: "buildings-page.js#sheet" }).runInContext(ctx);
  return dom;
}

test("the sheet's script parses in every boot state, and its literal holds one backtick", () => {
  for (const boot of [SHEET(), { s: 401, j: {} }, { s: 403, j: {} }, { s: 404, j: {} }, { s: 503, j: {} }, null]) {
    new vm.Script(scriptOf(renderBuildingSheetBody(boot)));
  }
  const at = SOURCE.indexOf("function renderBuildingSheetBody");
  const lit = SOURCE.slice(SOURCE.indexOf("return `<style>", at), SOURCE.indexOf("`;", SOURCE.indexOf("return `<style>", at)));
  assert.equal((lit.match(/`/g) || []).length, 1);
  assert.equal((lit.match(/\$\{/g) || []).length, 1, "the boot JSON is the only interpolation");
  const html = renderBuildingSheetBody({ s: 200, j: { building: { address: "</script><img onerror=alert(1)>" } } });
  assert.ok(!html.includes("</script><img"));
});

test("every section the plan names is on the sheet, with its rows attributed", () => {
  const dom = runSheet(SHEET());
  for (const id of ["bsHead", "bsTxFirm", "bsTxMine", "bsReports", "bsValues", "bsContacts", "bsNotes"]) {
    assert.ok(renderBuildingSheetBody(SHEET()).includes(`id="${id}"`), id + " is missing from the sheet");
  }
  assert.equal(dom.el("bsAddr").textContent, "1210 N 17th St, Boise, ID");
  assert.match(dom.el("bsSub").textContent, /Colliers Boise’s board · added by you/);
  assert.match(dom.el("bsTxFirmRows").innerHTML, /\$1,250,000.*shared by Mike/);
  assert.match(dom.el("bsTxMineRows").innerHTML, /\$9\.50\/SF\/yr.*from your vault/);
  assert.match(dom.el("bsTxMineRows").innerHTML, /data-firm="m1" data-on="0">Share with the firm/);
  assert.match(dom.el("bsReportsRows").innerHTML, /href="\/r\/r1".*shared by Mike/);
  assert.match(dom.el("bsValuesRows").innerHTML, /\$1,250,000<\/span> likely · \$1,100,000 – \$1,400,000.*your portfolio/);
  assert.match(dom.el("bsValuesRows").innerHTML, /from Mike’s shared report/);
  assert.match(dom.el("bsContactsRows").innerHTML, /Dana Wu · Acme.*added by Mike/);
  assert.match(dom.el("bsNotesRows").innerHTML, /Roof replaced 2021.*data-note-rm="n1"/, "the author's own note carries Remove");
  assert.equal(dom.el("bsTxFirmN").textContent, "1 comp");
  assert.equal(dom.el("bsValuesN").textContent, "2 valuations");
});

test("the identity cells hold the raw figure and show the formatted one — /vault's convention", () => {
  const dom = runSheet(SHEET());
  assert.equal(dom.el("bsSize").value, "12,500");
  assert.equal(dom.el("bsSize").getAttribute("data-raw"), "12500");
  assert.equal(dom.el("bsYear").value, "1994");
  assert.equal(dom.el("bsType").value, "Industrial");
  assert.equal(dom.el("bsMarket").textContent, "Boise, ID");
});

test("an empty sheet says so section by section, never as a blank page", () => {
  const dom = runSheet(SHEET({ firmComps: [], mineComps: [], reports: [], valuations: [], contacts: [], notes: [] }));
  for (const id of ["bsTxFirmNone", "bsTxMineNone", "bsReportsNone", "bsValuesNone", "bsContactsNone", "bsNotesNone"]) {
    assert.equal(dom.hidden(id), false, id + " should show");
  }
  assert.match(renderBuildingSheetBody(SHEET()), /colleague’s portfolio never does/, "the sheet states rule 2 to the reader");
});

test("the sheet's own refusals: signed out, no firm, not on the board, outage", () => {
  assert.match(runSheet({ s: 401, j: {} }).el("bsWall").innerHTML, /Sign in/);
  assert.match(runSheet({ s: 403, j: {} }).el("bsWall").innerHTML, /not in one yet/);
  assert.match(runSheet({ s: 404, j: {} }).el("bsWall").innerHTML, /not on your firm’s list.*Back to your firm’s buildings/);
  assert.match(runSheet(null).el("bsWall").innerHTML, /Nothing has been lost/);
  assert.match(runSheet({ s: 503, j: {} }).el("bsWall").innerHTML, /Nothing has been lost/);
});

test("the sheet escapes everything a person typed", () => {
  const dom = runSheet(SHEET({ notes: [{ id: "n1", body: "<img src=x onerror=alert(1)>", addedBy: "Brad", mine: false }] }));
  assert.doesNotMatch(dom.el("bsNotesRows").innerHTML, /<img/);
  assert.match(dom.el("bsNotesRows").innerHTML, /&lt;img/);
});


// ---------------------------------------------------------------------------
// Leases (slice 6): the critical-dates strip on the list, the section on the sheet
// ---------------------------------------------------------------------------

test("the critical-dates strip renders only when there is something to act on, soonest first, linking to the building", () => {
  let dom = run(OK([BLDG({})], { critical: [] }));
  assert.equal(dom.hidden("blCrit"), true, "no deadlines, no strip — a strip announcing nothing is furniture");
  dom = run(OK([BLDG({})], { critical: [
    { leaseId: "l2", buildingId: "b1", address: "500 Warehouse Way, Boise, ID", tenant: "Beta Co", suite: "", kind: "expiry", date: "2026-10-01", days: 29 },
    { leaseId: "l1", buildingId: "b1", address: "500 Warehouse Way, Boise, ID", tenant: "Acme Logistics", suite: "200", kind: "notice", date: "2026-12-31", days: 120 },
  ] }));
  assert.equal(dom.hidden("blCrit"), false);
  const rows = dom.el("blCritRows").innerHTML;
  assert.match(rows, /class="d soon">in 29 days<\/span><span class="k">expiry<\/span><span class="t">Beta Co · <a href="\/building\/b1">500 Warehouse Way, Boise, ID<\/a>/,
    "under thirty days reads red, and the row is a door to the building");
  assert.match(rows, /class="d">in 120 days<\/span><span class="k">notice<\/span><span class="t">Acme Logistics · 200 · /);
  assert.ok(rows.indexOf("Beta Co") < rows.indexOf("Acme Logistics"), "soonest first, as the server ordered them");
  assert.match(renderBuildingsBody(OK([BLDG({})], { critical: [] })), /Critical dates · next 12 months/);
});

test("the sheet's Leases section: rows with a status select, Edit and Remove; the notice date in red; one form for add and edit", () => {
  const sheet = SHEET({ leases: [
    { id: "l1", buildingId: "b1", tenant: "Acme Logistics", suite: "200", sizeSqft: 12500, termStart: "2022-07-01", leaseExpiry: "2027-06-30",
      optionNoticeDate: "2027-03-31", rentPsf: 18.5, rentBasis: "annual", leaseType: "NNN", status: "active", notes: "", addedBy: "Brad", mine: true },
    { id: "l2", buildingId: "b1", tenant: "Beta Co", suite: "", sizeSqft: null, termStart: null, leaseExpiry: "2026-10-01",
      optionNoticeDate: null, rentPsf: 1.35, rentBasis: "monthly", leaseType: "", status: "month-to-month", notes: "", addedBy: "Mike", mine: false },
  ] });
  const dom = runSheet(sheet);
  assert.equal(dom.el("bsLeasesN").textContent, "2 leases");
  assert.equal(dom.hidden("bsLeasesNone"), true);
  const rows = dom.el("bsLeasesRows").innerHTML;
  assert.match(rows, /Acme Logistics<\/span> · Suite 200 · 12,500 SF · \$18\.50\/SF\/yr NNN · expires 6\/30\/2027 · <span class="due">notice by 3\/31\/2027<\/span>/);
  assert.match(rows, /Beta Co<\/span> · \$1\.35\/SF\/mo · expires 10\/1\/2026/, "a monthly rent says so — the basis is never dropped on screen");
  assert.match(rows, /<select class="st" data-lease-status="l1"><option selected>active<\/option>/);
  assert.match(rows, /data-lease-status="l2">(?:<option[^>]*>[^<]*<\/option>)*<option selected>month-to-month<\/option>/);
  assert.match(rows, /data-lease-edit="l1"/);
  assert.match(rows, /data-lease-rm="l2"/);
  assert.match(rows, /· you · /, "your own lease reads 'you'");
  assert.match(rows, /· Mike · /);
  const html = renderBuildingSheetBody(sheet);
  assert.match(html, /id="bsLeaseForm" class="bs-lease hide"/, "the form ships closed");
  assert.match(html, /id="bsLeaseAdd"[^>]*>Add a lease/);
  for (const id of ["bsLeaseTenant", "bsLeaseExpiry", "bsLeaseNotice", "bsLeaseRent", "bsLeaseBasis", "bsLeaseType", "bsLeaseStatus"]) {
    assert.ok(html.includes(`id="${id}"`), id + " is missing from the lease form");
  }
  assert.match(html, /id="bsLeaseBasis"><option value="">/, "the basis has NO default option selected — 029's rule");
  const empty = runSheet(SHEET({ leases: [] }));
  assert.equal(empty.hidden("bsLeasesNone"), false);
  assert.match(renderBuildingSheetBody(SHEET({ leases: [] })), /the option notice, which is the date that matters/);
});
