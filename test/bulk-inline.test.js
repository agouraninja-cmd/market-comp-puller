// Bulk valuation's run view is rendered ONCE, in bulk-page.js, and shipped to
// two pages: /bulk renders it directly, index.html receives it at a
// <!--BULK_RUN--> marker replaced at serve time. These tests pin the parts of
// that arrangement which fail SILENTLY — a deleted marker, a hand-copy, a
// browser module that throws only on the page without a form.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shared = require("./helpers/boot");

const ROOT = path.join(__dirname, "..");
const INDEX = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const BULKPAGE = fs.readFileSync(path.join(ROOT, "bulk-page.js"), "utf8");
const MOD = require("../bulk-page");

// Built rather than written, so this file does not itself contain the literal
// marker — a test that greps index.html for a string it also contains is a
// test that passes when someone greps the wrong file.
const D = String.fromCharCode(45);
const MARKER = "<!" + D + D + "BULK_RUN" + D + D + ">";

test("index.html carries the marker and none of the run view", () => {
  // Half one: the marker is there, exactly once. String.replace swaps only the
  // first occurrence, so a second one would ship raw to the browser.
  assert.equal(INDEX.split(MARKER).length - 1, 1,
    "index.html must contain the BULK_RUN marker exactly once");

  // Half two: and index.html authors NO part of the run view itself. This is
  // the rule the marker exists to enforce — a hand-copy here would drift from
  // /bulk and the two pages would quote different totals for one run.
  for (const id of ["bkRows", "bkTotals", "bkJobDeck", "bkJobTitle", "bkJobMeta", "bkCancel", "bkDl"]) {
    assert.equal(INDEX.includes('id="' + id + '"'), false,
      "index.html hand-copies the run view's " + id + " — it must come from the marker");
  }
  // BULKRUN itself is likewise never authored here.
  assert.equal(INDEX.includes("var BULKRUN"), false,
    "index.html carries its own copy of BULKRUN");
});

test("server.js replaces the marker in the / handler", () => {
  assert.ok(SERVER.includes('const BULK_RUN_MARKER = "' + MARKER + '";'),
    "server.js no longer declares BULK_RUN_MARKER");
  assert.ok(SERVER.includes(".replace(BULK_RUN_MARKER, renderBulkInlineBlock())"),
    "the / handler no longer replaces BULK_RUN_MARKER");
  assert.ok(SERVER.includes("renderBulkInlineBlock") && SERVER.includes('require("./bulk-page")'),
    "server.js no longer imports renderBulkInlineBlock from bulk-page");
});

test("the run view has ONE source, and both pages get the same bytes", () => {
  // bulk-page.js is the only file that writes this markup...
  assert.equal(BULKPAGE.split('id="bkRows"').length - 1, 1,
    "bulk-page.js writes the rows table more than once — it must come from renderBulkRunMarkup");

  // ...and the deck both pages render is byte-identical, not merely similar.
  const page = MOD.renderBulkPageBody({
    s: 200,
    j: { types: ["Industrial"], jobs: [], maxAddresses: 50, leftToday: 200, dailyLimit: 200 },
  });
  const inline = MOD.renderBulkInlineBlock();
  const between = (html, from, to) => {
    const a = html.indexOf(from);
    assert.notEqual(a, -1, "missing markup: " + from);
    const b = html.indexOf(to, a);
    assert.notEqual(b, -1, "missing markup: " + to);
    return html.slice(a, b);
  };
  // The deck header and the totals strip, byte for byte.
  assert.equal(
    between(inline, '<div class="deck hide" id="bkJobDeck">', '<p class="acts">'),
    between(page, '<div class="deck hide" id="bkJobDeck">', '<p class="acts">'),
    "/bulk and index.html render different run-view markup");
  // And the rows table itself.
  assert.equal(
    between(inline, '<div style="overflow-x:auto">', "</table>"),
    between(page, '<div style="overflow-x:auto">', "</table>"),
    "/bulk and index.html render different rows tables");
  // The action row is the ONE place they may differ, and only by the link the
  // homepage carries because it does not list earlier runs itself. Strip that
  // one line and the two must be identical again; anything else diverging is
  // a hand-copy creeping back in.
  // Anchored INSIDE the deck: /bulk has a second .acts row up in its form
  // (the Run button), and matching that one compares two unrelated things.
  const acts = (html) =>
    between(html.slice(html.indexOf('id="bkJobDeck"')), '<p class="acts">', "</p>");
  assert.equal(
    acts(inline).replace(/\s*<a class="lnk" href="\/bulk">Earlier runs [^<]*<\/a>/, ""),
    acts(page),
    "the run view's action row differs by more than the Earlier runs link");
});

test("the two surfaces differ only in how earlier runs are reached", () => {
  const page = MOD.renderBulkPageBody({ s: 200, j: { types: [], jobs: [] } });
  const inline = MOD.renderBulkInlineBlock();
  // /bulk lists them; the homepage links to /bulk instead. renderPast() guards
  // on #bkPast, so the homepage must NOT have it or the guard is untested.
  assert.ok(page.includes('id="bkPast"'), "/bulk lost its Earlier runs list");
  assert.equal(inline.includes('id="bkPast"'), false,
    "the inline block renders the Earlier runs LIST — it should link to /bulk");
  assert.ok(inline.includes('href="/bulk"'), "the inline block has no way back to /bulk");
});

test("the injected block is self-sufficient: its own CSS, with fallbacks", () => {
  const inline = MOD.renderBulkInlineBlock();
  assert.ok(inline.includes("<style>"), "the inline block ships no CSS of its own");
  // index.html never receives MARKET_CSS, so a bare var(--ink) would paint
  // nothing there. Every colour must carry a fallback.
  const bare = [...MOD.BULK_RUN_CSS.matchAll(/var\(--[a-z-]+\)/g)].map((m) => m[0]);
  assert.deepEqual(bare, [],
    "BULK_RUN_CSS uses vars with no fallback: " + bare.join(" ") + " — index.html has no :root tokens");
  // And it ships hidden: the entitlement is enforced by /api/bulk, so what
  // lands on an anonymous homepage must be invisible.
  assert.ok(/id="bkInline"[^>]*\shidden/.test(inline),
    "the inline run view does not ship hidden");
});

test("BULKRUN reads no form, so it cannot throw on the homepage", () => {
  // The bug this prevents: renderJob() used to call refreshCount(), which
  // dereferences $("bulkText") and $("run") unguarded. Fine on /bulk; a thrown
  // error on a page that has neither.
  for (const id of ["bulkText", "run", "count", "cost", "capNote", "bulkType", "bulkMonths"]) {
    assert.equal(MOD.BULK_RUN_JS.includes('$("' + id + '")'), false,
      "BULK_RUN_JS reads the /bulk form's #" + id + " — it must not know a form exists");
  }
  // It reports state through the callback instead.
  assert.ok(MOD.BULK_RUN_JS.includes("if(onState)onState("),
    "BULK_RUN_JS no longer reports state through the injected callback");
});

// One address is a report (owner's, 2026-09-04 evening): /bulk is the
// comp-report tool now that the single-property form is in no nav, so a
// one-address run started on the page opens its report instead of leaving a
// one-row table. Scoped to runs THIS page started, guarded on a finished row
// with a report behind it, and it never redirects a failure.
test("a one-address run opens its report; a list, a failure, and an old run do not", () => {
  const js = MOD.BULK_JS;
  const runAt = js.indexOf("function run(){");
  const run = js.slice(runAt, js.indexOf("function fillTypes", runAt));
  assert.ok(run.includes("d.job.total===1"), "run() decides on the job's own total, not the pasted count");
  assert.ok(run.includes("singleJob=one?d.job.id:null"), "only a one-address run is remembered");
  const hookAt = js.indexOf("function onRunState(job,items){");
  assert.ok(hookAt > -1, "the onState hook is gone");
  const hook = js.slice(hookAt, js.indexOf("\n}", hookAt));
  assert.ok(hook.includes("job.id!==singleJob"), "an earlier run re-opened from the list must not redirect");
  assert.ok(hook.includes('job.status==="running"'), "no redirect while the job is still running");
  assert.ok(hook.includes('it.status==="done"&&it.recent_item_id'), "a failed row stays on screen with its reason");
  assert.ok(hook.includes('location.href="/?recent="+encodeURIComponent(id)'),
    "the report opens through index.html's own user-scoped ?recent= door");
  assert.ok(js.includes("BULKRUN.init({max:MAX,onState:onRunState,onList:loadList})"),
    "the hook is what BULKRUN reports state through");
  // The copy follows: the button and the lede say one address is a report.
  const page = MOD.renderBulkPageBody({ s: 200, j: { types: [], jobs: [] } });
  assert.match(page, /One address opens its comp report\. A list becomes a portfolio/);
  assert.ok(js.includes('parsedCount===1?"Run the report"'), "one address is 'Run the report', not 'Run 1 valuation'");
  // The foot's door to the single-property form went with the inputs it
  // pointed at (2026-09-04 evening): this page asks for all of them now, so
  // /run-report is linked from nowhere.
  assert.equal(page.includes("/run-report"), false, "the bulk page still links the single-property form");
});

// Nothing on the bulk page is dim (owner's, 2026-09-04): no faded disabled
// button, no muted grey text. An empty box answers a click with a message.
test("no part of the bulk page is dimmed", () => {
  assert.ok(!/opacity:\s*\.\d/.test(MOD.BULK_CSS), "the disabled button must not fade");
  assert.ok(!MOD.BULK_CSS.includes("--ink-mute"), "the page's own styles use full ink");
  assert.ok(!MOD.BULK_RUN_CSS.includes("--ink-mute"), "the run view's styles use full ink");
  const js = MOD.BULK_JS;
  assert.ok(!js.includes("busy||parsedCount===0"), "an empty box no longer disables the button");
  const runAt = js.indexOf("function run(){");
  assert.ok(js.slice(runAt, runAt + 300).includes('"Type or paste at least one address first."'),
    "an empty click is answered with a message, not a dead control");
});

// The bulk page carries the single form's inputs (2026-09-04). Its per-type
// field map is a MIRROR of index.html's TYPE_SUBJECT_FIELDS — this file
// cannot require index.html — so the two literals are evaluated and compared,
// and a field added to the form through the add-comp-field skill fails here
// until the bulk page names it too.
test("the bulk page's subject fields are index.html's, field for field", () => {
  const idx = INDEX.match(/const TYPE_SUBJECT_FIELDS = (\{[\s\S]*?\n  \});/);
  assert.ok(idx, "index.html's TYPE_SUBJECT_FIELDS literal not found");
  const blk = MOD.BULK_JS.match(/var BULK_SUBJECT_FIELDS=(\{[\s\S]*?\});\/\*END_SUBJECT_FIELDS\*\//);
  assert.ok(blk, "bulk-page.js's BULK_SUBJECT_FIELDS literal not found");
  // JSON round-tripped: objects from two vm contexts have two Object
  // prototypes, and strict deepEqual compares those too.
  const a = JSON.parse(JSON.stringify(vm.runInNewContext("(" + idx[1] + ")")));
  const b = JSON.parse(JSON.stringify(vm.runInNewContext("(" + blk[1] + ")")));
  assert.deepEqual(b, a, "bulk-page.js's per-type fields drifted from index.html's");
  // And the form's other inputs are all on the page, under the folded line.
  const page = MOD.renderBulkPageBody({ s: 200, j: { types: [], jobs: [] } });
  for (const id of ["bulkFocus", "bulkSize", "bulkAsking", "bulkNoi", "bulkCap", "bulkNote", "bulkLabel", "bulkSubjectFields", "moreLine", "perAddress", "listNote"]) {
    assert.ok(page.includes('id="' + id + '"'), "/bulk lost #" + id);
  }
  assert.match(page, /<option value="both" selected>Sales &amp; leases<\/option>/);
  // The subject rides ONLY for a one-address run; the focus rides always.
  assert.ok(MOD.BULK_JS.includes("if(parsedCount===1)body.subject=readSubject();"));
  assert.ok(MOD.BULK_JS.includes('txFocus:$("bulkFocus").value'));
});

test("both browser modules compile, on both pages", () => {
  for (const name of ["BULK_RUN_JS", "BULK_JS"]) {
    assert.doesNotThrow(() => new vm.Script(MOD[name]), name + " does not parse");
  }
  // And as they are actually emitted — the </script> escaping included.
  const surfaces = {
    "/bulk": MOD.renderBulkPageBody({ s: 200, j: { types: [], jobs: [] } }),
    inline: MOD.renderBulkInlineBlock(),
  };
  for (const [label, html] of Object.entries(surfaces)) {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(blocks.length > 0, label + " emitted no script");
    blocks.forEach((src, i) => {
      assert.doesNotThrow(() => new vm.Script(src), label + " script " + i + " does not parse");
    });
  }
});

test("a paste opens a form and never spends money", () => {
  // The standing rule every handoff in this app obeys: arriving text is data,
  // not consent. index.html's landing-address and shared-address blocks are
  // pinned the same way (test/index-html.test.js).
  const at = INDEX.indexOf('.addEventListener("paste"');
  assert.notEqual(at, -1, "the address paste listener is gone — bulk has no door left");
  // Bounded to the listener itself. A fixed character window would drift into
  // whatever happens to follow it and pass or fail for the wrong reason.
  const end = INDEX.indexOf('bkEl("bkListText").addEventListener', at);
  assert.notEqual(end, -1, "could not find the end of the paste listener");
  const listener = INDEX.slice(at, end);
  assert.equal(/requestSubmit|compForm\.submit/.test(listener), false,
    "the paste listener submits a search — a paste is not consent to spend");

  // enterListMode opens the panel; it must not run anything either.
  const enterAt = INDEX.indexOf("function enterListMode(");
  assert.notEqual(enterAt, -1, "enterListMode vanished");
  const enter = INDEX.slice(enterAt, INDEX.indexOf("function exitListMode(", enterAt));
  assert.equal(/requestSubmit|compForm\.submit/.test(enter), false,
    "enterListMode submits the form");
  assert.equal(enter.includes('"POST"'), false,
    "enterListMode POSTs — opening the panel must not start a run");

  // The billed call lives only behind the click.
  const runAt = INDEX.indexOf("async function runBulkList(");
  assert.notEqual(runAt, -1, "runBulkList vanished");
  assert.ok(INDEX.slice(runAt, runAt + 2000).includes('"POST", "/api/bulk"'),
    "runBulkList no longer starts the run");
});

test("a visitor who cannot run a list is sent through the one sanctioned door", () => {
  const at = INDEX.indexOf('.addEventListener("paste"');
  const listener = INDEX.slice(at, INDEX.indexOf('bkEl("bkListText").addEventListener', at));
  assert.ok(listener.includes("canBulkValue"),
    "the paste listener does not check the entitlement");
  assert.ok(listener.includes("openUpgradePrompt()"),
    "the non-entitled branch does not use openUpgradePrompt — never a second prompt");
  // The paste is not thrown away: it still yields a usable single search.
  assert.ok(listener.includes("firstAddress("),
    "the non-entitled branch discards the paste instead of keeping its first address");
});

test("list mode and a report are mutually exclusive, and the poll is stopped", () => {
  // A hidden run view whose 4s poll is still armed keeps requesting for the
  // life of the tab, which is why hiding alone is not enough.
  const hideAt = INDEX.indexOf("function hideBulkRun(");
  assert.notEqual(hideAt, -1, "hideBulkRun vanished");
  const hide = INDEX.slice(hideAt, hideAt + 400);
  assert.ok(hide.includes("BULKRUN.stop()"), "hideBulkRun leaves the poll running");

  // And a single-address search calls it before taking the viewport.
  const loadAt = INDEX.indexOf("hideBulkRun();\n    setLoading(true);");
  assert.notEqual(loadAt, -1,
    "a single-address search no longer hides the run view before rendering");

  // The run view takes the viewport from the report, not beside it.
  const showAt = INDEX.indexOf("function showBulkRun(");
  const show = INDEX.slice(showAt, showAt + 400);
  assert.ok(show.includes('getElementById("results").classList.add("hidden")'),
    "showBulkRun leaves the report visible underneath");
});

test("a real server actually replaces the marker", async (t) => {
  // The tests above read files. This one is the only thing that proves the
  // wiring: a marker left unreplaced ships as an HTML comment and the feature
  // is simply absent, with nothing failing anywhere.
  const srv = await shared.boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/")).text();

  assert.equal(html.includes(MARKER), false,
    "the BULK_RUN marker shipped to the browser unreplaced");
  assert.ok(html.includes('id="bkInline"'), "the run view did not mount");
  assert.ok(html.includes('id="bkRows"'), "the rows table did not ship");
  assert.ok(html.includes("var BULKRUN"), "BULKRUN did not ship");
  assert.ok(html.includes("var(--ink,#1A2433)"),
    "the run view's CSS shipped without its fallbacks — index.html has no tokens");
  assert.ok(/id="bkInline"[^>]*\shidden/.test(html), "the run view did not ship hidden");
  assert.ok(html.includes('id="bkListPanel"'), "list mode's panel is missing");
  assert.equal(html.includes('id="bulkLink"'), false,
    "the retired bulkLink is still being served");

  // And everything the browser would run parses — BULK_RUN_JS is a string in
  // bulk-page.js with no compiler in front of it until exactly here.
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).filter((s) => s.trim());
  assert.ok(blocks.length >= 2, "expected index.html's own script plus the injected one");
  blocks.forEach((src, i) => {
    assert.doesNotThrow(() => new vm.Script(src), "served inline script " + i + " does not parse");
  });
});

test("list mode does not disturb the single-address form's type machinery", () => {
  // A run needs ONE explicit type and has no confirm dialog to resolve it, so
  // it uses its own select. Calling setTypeProgrammatic would reset the
  // lookback and rebuild the subject fields — state that belongs to the
  // single-address form and must survive a trip through list mode.
  const enterAt = INDEX.indexOf("function enterListMode(");
  const enter = INDEX.slice(enterAt, INDEX.indexOf("function exitListMode(", enterAt));
  assert.equal(enter.includes("setTypeProgrammatic"), false,
    "enterListMode calls setTypeProgrammatic — it must not touch the single-address form");
  // An assignment, not `===` — reading typeResolution is exactly what it
  // should do; writing it is what would leak list mode into the other form.
  assert.equal(/typeResolution\s*=(?!=)/.test(enter), false,
    "enterListMode assigns typeResolution");
  assert.ok(enter.includes('typeResolution === "explicit"'),
    "the type is preselected from something other than an explicit resolution");
});
