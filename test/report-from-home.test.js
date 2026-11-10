// A report opened from Home stands alone (2026-11-10).
//
// The owner: "when you click on a property it will have the comp search with
// the value a building card and stuff above it which I thought we removed".
// Every report door left the desk through leaveDesk() -> showHomeView(), the
// search view: the pitch, the "Value a building" chamber and the market
// explorer. renderResults hid the pitch and left the chamber standing over
// the report. The comp search left Home on 2026-10-08, and this was the one
// place it still came back.
//
// The functions are EXECUTED against a stand-in document, because the failure
// is a class on an element and a source scan cannot see which way it ended up.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function fnSource(head) {
  const from = html.indexOf(head);
  assert.ok(from > 0, head + " should still exist");
  return html.slice(from, html.indexOf("\n  }\n", from) + 4);
}

// A page with the desk showing, the way a member's "/" boots.
function page({ signedIn = true, wall = true } = {}) {
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      const set = new Set();
      els[id] = {
        id,
        classList: {
          add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
          toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); },
        },
        hidden: () => set.has("hidden"),
      };
    }
    return els[id];
  };
  ["hero", "searchSection", "homeInfo", "historyDeck", "searchLock", "editDetailsBtn", "results"].forEach((id) => el(id).classList.add("hidden"));
  el("deskView");
  const pushed = [];
  const calls = [];
  const src = [
    "let reportOnly = false;",
    "const accountWall = " + JSON.stringify(wall) + ";",
    "const looksSignedIn = () => " + JSON.stringify(signedIn) + ";",
    'const onDesk = () => !document.getElementById("deskView").classList.contains("hidden");',
    fnSource("  function applySearchLock() {"),
    fnSource("  function setReportOnly(on) {"),
    fnSource("  function showHomeView() {"),
    fnSource("  function leaveDesk() {"),
    fnSource("  function leaveDeskForReport() {"),
    "return { leaveDesk, leaveDeskForReport, showHomeView, setReportOnly, applySearchLock, reportOnly: () => reportOnly };",
  ].join("\n");
  const api = new Function("document", "location", "history", "showSharedStatus", "markNavCurrent", "renderHistory", src)(
    { getElementById: el },
    { pathname: "/" },
    { pushState: (s, t, url) => pushed.push(url) },
    () => calls.push("shared"), () => calls.push("nav"), () => calls.push("history"),
  );
  return { ...api, el, pushed, calls, shown: (id) => !el(id).hidden() };
}

test("a report door hides Home and shows no search chamber, pitch or recent searches", () => {
  const p = page();
  p.leaveDeskForReport();
  assert.equal(p.shown("deskView"), false, "Home yields to the report");
  assert.equal(p.shown("searchSection"), false, "the Value a building chamber stays hidden");
  assert.equal(p.shown("hero"), false, "and so does the pitch");
  assert.equal(p.shown("homeInfo"), false);
  assert.equal(p.shown("historyDeck"), false);
  assert.equal(p.shown("editDetailsBtn"), true, "the report offers the way back to the form");
  assert.equal(p.reportOnly(), true);
  assert.ok(p.calls.includes("nav"), "the rail stops marking Home");
});

test("the door brings the form back, and the report keeps it until the next view", () => {
  const p = page();
  p.leaveDeskForReport();
  p.setReportOnly(false);   // what #editDetailsBtn's handler calls
  assert.equal(p.shown("searchSection"), true, "the form is back, with its size, price and NOI boxes");
  assert.equal(p.shown("editDetailsBtn"), false, "and the door is gone with its reason");
});

test("the search view itself is untouched: leaveDesk still opens the whole stack", () => {
  const p = page();
  p.leaveDeskForReport();
  p.el("deskView").classList.remove("hidden");   // the member went back Home...
  p.leaveDesk();                                  // ...and a search door opened the search view
  assert.equal(p.reportOnly(), false, "a view swap clears the report-only state");
  for (const id of ["hero", "searchSection", "homeInfo", "historyDeck"]) assert.equal(p.shown(id), true, id + " shows on the search view");
  assert.equal(p.shown("editDetailsBtn"), false);
});

test("a report opened from the search view keeps the form it was opened under", () => {
  // Recent searches sits under the chamber on the search view (/run-report,
  // a member kept there by a pending address). Opening one of its rows is
  // not leaving Home, so nothing hides.
  const p = page();
  p.leaveDesk();
  p.leaveDeskForReport();
  assert.equal(p.reportOnly(), false);
  assert.equal(p.shown("searchSection"), true);
});

test("leaving /desk for a report still moves the address to /", () => {
  const p = page();
  const src = fnSource("  function leaveDeskForReport() {");
  assert.match(src, /if \(location\.pathname === "\/desk"\) history\.pushState\(\{\}, "", "\/"\);/);
  p.leaveDeskForReport();
  assert.deepEqual(p.pushed, [], "and never mints a history entry at /");
});

test("the wall still wins: a locked visitor never gets the form or the door", () => {
  const p = page({ signedIn: false, wall: true });
  p.el("deskView").classList.add("hidden");
  p.setReportOnly(true);
  assert.equal(p.shown("searchSection"), false);
  assert.equal(p.shown("editDetailsBtn"), false);
  assert.equal(p.shown("searchLock"), true);
});

test("both saved-report doors leave Home through the report door, not the search view", () => {
  for (const fn of ["async function openHistoryReport(r) {", "async function openPortfolioItem(id) {"]) {
    const body = fnSource("  " + fn);
    assert.ok(body.includes("leaveDeskForReport();"), fn + " must open the report alone");
    assert.ok(!/\bleaveDesk\(\);/.test(body), fn + " must not open the search view over the report");
  }
});

test("both views clear the state, and the desk never shows the door", () => {
  const desk = html.slice(html.indexOf("  function showDeskView() {"), html.indexOf("  function showHomeView() {"));
  assert.match(desk, /reportOnly = false;[\s\S]*applySearchLock\(\);/, "showDeskView clears it before applySearchLock re-reads it");
  const p = page();
  p.leaveDeskForReport();
  p.el("deskView").classList.remove("hidden");
  p.applySearchLock();
  assert.equal(p.shown("editDetailsBtn"), false, "no door while Home is showing");
});

test("the door is in the report's toolbar, ships hidden, and opens the property details", () => {
  const tools = html.slice(html.indexOf('<div class="rd-tools '), html.indexOf('id="imgBtn"'));
  assert.match(tools, /<button id="editDetailsBtn" type="button"[^>]*\n\s*class="hidden /, "ships hidden, inside the no-print toolbar");
  assert.ok(tools.includes("Edit property details"));
  const handler = html.match(/getElementById\("editDetailsBtn"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(handler, "the door has a click handler");
  assert.ok(handler[0].includes("setReportOnly(false);"));
  assert.ok(handler[0].includes('getElementById("subjectDetails")') && handler[0].includes(".open = true"));
});

test("Escape closes a report opened from Home back to Home, and Home is not escaped from", () => {
  const close = html.match(/if \(reportOnly\) \{[\s\S]*?\n    \}\n/);
  assert.ok(close, "the report's Escape handler knows a report opened from Home");
  assert.ok(close[0].includes("e.preventDefault();"), "or the desk's Escape listener sees the same key");
  assert.ok(close[0].includes("enterDesk();") && close[0].includes("return;"));
  const deskEsc = html.slice(html.indexOf("// Escape leaves My Desk"), html.indexOf("// Market Explorer: lives in"));
  assert.ok(deskEsc.indexOf("if (looksSignedIn()) return;") > -1, "a member's Home does not close to the search view");
  assert.ok(deskEsc.indexOf("if (looksSignedIn()) return;") < deskEsc.indexOf("leaveDesk();"));
});
