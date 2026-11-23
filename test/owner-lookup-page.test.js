// test/owner-lookup-page.test.js
// The page half of the owner lookup, read from the source: the rules whose
// failure nobody would see on screen. A search is billed and counted against
// the member's month, so nothing but a press may start one; an answer is text
// a stranger wrote, so none of it may reach the page as markup; and an
// address never rides a link.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const sheet = fs.readFileSync(path.join(__dirname, "..", "buildings-page.js"), "utf8");

// One function's source, from its declaration to its closing brace at the
// script's two-space indent.
function fn(name) {
  const m = html.match(new RegExp(`\\n  (?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(m, `${name} is gone from index.html`);
  return m[0];
}
const block = (() => {
  const from = html.indexOf("// ---- Find a property's owner (2026-11-23");
  const to = html.indexOf("// Chunked because String.fromCharCode.apply", from);
  assert.ok(from > 0 && to > from, "the owner lookup's block is gone from index.html");
  return html.slice(from, to);
})();

test("a search starts only from a press: one POST, in one function, behind three doors", () => {
  assert.equal((html.match(/fetch\("\/api\/owner-lookup", \{\s*method: "POST"/g) || []).length, 1,
    "the lookup is posted from exactly one place");
  assert.match(fn("runOwnerLookup"), /fetch\("\/api\/owner-lookup", \{\s*method: "POST"/);
  // Its callers: the form's submit, "Look again", and an earlier lookup's row.
  const calls = block.match(/runOwnerLookup\(/g) || [];
  assert.equal(calls.length, 4, "the declaration and three callers; a new caller is a new way to spend a lookup");
  assert.match(block, /getElementById\("ownerForm"\)\.addEventListener\("submit"[\s\S]*?runOwnerLookup\(/);
  assert.match(fn("drawOwnerRecent"), /addEventListener\("click", \(\) => runOwnerLookup\(r\.address, r\.type, false\)\)/);
  assert.match(fn("drawOwnerResult"), /addEventListener\("click", \(\) => runOwnerLookup\(out\.address, out\.type, true\)\)/);
  // Arriving with an address filled in runs nothing.
  for (const quiet of ["hmFindOwner", "takeOwnerAsk", "syncOwnerFind", "loadOwnerState"]) {
    assert.doesNotMatch(fn(quiet), /runOwnerLookup\(/, `${quiet} must not start a search`);
  }
});

test("reading the allowance is a GET, asked once the tab is open and the page is shown", () => {
  const load = fn("loadOwnerState");
  assert.match(load, /hmWhenShown\(async \(\) => \{/, "never from a page built ahead of a click");
  assert.match(load, /await fetch\("\/api\/owner-lookup"\)/);
  assert.match(fn("syncOwnerFind"), /if \(hmTab === "people"\) loadOwnerState\(\);/);
});

test("nothing a search returned reaches the page as markup, and a link must be http", () => {
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  const link = fn("ownerLink");
  assert.match(link, /if \(!\/\^https\?:\\\/\\\/\/i\.test\(String\(url \|\| ""\)\)\) return null;/);
  assert.match(link, /a\.rel = "noopener noreferrer"/);
});

test("the address rides the request body or sessionStorage, never a link", () => {
  assert.match(fn("runOwnerLookup"), /body: JSON\.stringify\(\{ address, type: type \|\| "", fresh: fresh === true \}\)/);
  assert.doesNotMatch(block, /owner-lookup\?/, "no query string on the lookup");
  // The building sheet's door: a plain link to People, the address handed over out of band.
  assert.match(sheet, /<a class="bs-lnk" id="bsFindOwner" href="\/desk#people">Find the owner<\/a>/);
  assert.match(sheet, /sessionStorage\.setItem\("cnOwnerAsk",JSON\.stringify\(\{address:building\.address,type:building\.type\|\|""\}\)\)/);
  const take = fn("takeOwnerAsk");
  assert.match(take, /if \(document\.prerendering \|\| !currentUser\) return;/, "a page built ahead of a click must not spend the note");
  assert.match(take, /sessionStorage\.removeItem\("cnOwnerAsk"\)/, "read once");
});

test("the door from a property is never on the member's own building or a home", () => {
  assert.match(html, /if \(hmCanVault\(\) && r\.group !== "owned" && r\.type !== "Residential" && typeof hmFindOwner === "function"\) \{/);
});

test("a found person is saved only by its own button, as a looked-up contact", () => {
  const save = fn("saveOwnerContact");
  assert.match(save, /await postContacts\(\{/);
  assert.match(save, /source: "lookup", source_url: p\.source_url \|\| owner\.record_url \|\| ""/);
  assert.equal((block.match(/saveOwnerContact\(/g) || []).length, 2, "the declaration and the one Save button");
  assert.match(fn("drawOwnerResult"), /save\.addEventListener\("click", \(\) => saveOwnerContact\(p, out, save\)\)/);
});

test("the form shows to a plan that has it, the invitation to everyone else, and a sign-out clears it", () => {
  const sync = fn("syncOwnerFind");
  assert.match(sync, /const can = hmCanVault\(\);/);
  assert.match(sync, /getElementById\("ownerPro"\)\.classList\.toggle\("hidden", can\)/);
  assert.match(html, /id="ownerForm" class="hidden /, "the form ships hidden");
  const reset = fn("resetOwnerFind");
  assert.match(reset, /contactsScope = "";/);
  assert.match(reset, /\["ownerResult", "ownerRecent"\]\.forEach/);
  assert.match(html, /if \(typeof resetOwnerFind === "function"\) resetOwnerFind\(\);/, "hideAll calls it");
});

test("People is every member's tab, and an empty account can reach it", () => {
  assert.match(html, /getElementById\("hmTabPeople"\)\.hidden = false;/);
  assert.doesNotMatch(html, /getElementById\("hmTabPeople"\)\.hidden = !firm;/);
  assert.match(html, /hmFirstShow\(nothing && !hmFirstGone && hmTab !== "people"\);/);
  assert.match(html, /id="hmFirstPeople"/);
  assert.match(fn("hmOpenPeople"), /hmFirstGone = true;\s*drawHomeMap\(\);\s*setHomeTab\("people"\);/);
});
