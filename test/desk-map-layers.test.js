// Home's map shows what the member switches on (2026-10-08), and Home no
// longer runs comp reports or holds the shared reports.
//
// The owner's ask that day: Home should "show where the properties, comps and
// permits are, and you can filter what you want to see" (the layer switch
// Draft C drew and the build left out); "the home and report sections are
// literally the exact same thing", so the Reports tab and its rail row went,
// the rest of the reports moved into Messages, and "the run a comp report
// section" came off Home because the comp report went back to Tools. The
// next day (2026-10-09) the owner said "Remove Comps from the Homepage", so
// the Comps tab, the Comps layer, the "Add comps" start card and the comps
// read left Home too; a member's comps are on /vault. What each layer holds
// is home-map.js (test/home-map.test.js); these pin how index.html wires it,
// by reading the source the way test/org-desk.test.js does.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const fnOf = (sig) => {
  const at = html.indexOf(sig);
  assert.ok(at > 0, `index.html must define ${sig}`);
  return html.slice(at, html.indexOf("\n  }\n", at));
};

test("the map's switch is two toggles over the map, Properties and Permits", () => {
  const at = html.indexOf('id="hmLayers"');
  assert.ok(at > 0, "the layer switch is gone");
  const box = html.slice(at, html.indexOf("</div>", at));
  assert.match(box, /role="group" aria-label="Show on the map"/);
  assert.match(box, /data-layer="properties" aria-pressed="true"/, "Properties is on before anything is read");
  assert.match(box, /data-layer="permits" aria-pressed="false"/);
  assert.equal((box.match(/data-layer="/g) || []).length, 2, "a third toggle is back on the map");
  assert.doesNotMatch(box, /data-layer="comps"/, "the Comps toggle is back on Home's map");
  // The switch sits over the map, not in the list.
  assert.ok(at > html.indexOf('class="hm-mapw"') && at > html.indexOf('id="hmMap"'), "the switch is not on the map");
});

test("one writer keeps the switch, this browser's copy and the pins in step, and storage can fail", () => {
  assert.match(html, /let hmLayers = HOMEMAP\.LAYER_DEFAULT;\n  try \{ hmLayers = HOMEMAP\.readLayers\(localStorage\.getItem\(HM_LAYER_KEY\)\); \} catch \(_\) \{/);
  const set = fnOf("function hmSetLayer(layer, on, { draw = true } = {}) {");
  assert.match(set, /try \{ localStorage\.setItem\(HM_LAYER_KEY, JSON\.stringify\(hmLayers\)\); \} catch \(_\)/);
  assert.match(set, /if \(on && layer === "permits"\) hmLoadPermits\(\);/);
  // Only hmSetLayer assigns the record (the initial read aside).
  assert.equal((html.match(/\bhmLayers = /g) || []).length, 3, "something else writes hmLayers");
  // A layer is on when the record says so; the record only ever holds
  // HOMEMAP.LAYERS (readLayers drops an old stored Comps).
  assert.match(html, /const hmLayerOn = \(layer\) => Boolean\(hmLayers\[layer\]\);/);
  assert.match(set, /if \(!HOMEMAP\.LAYERS\.includes\(layer\)\) return;/);
});

test("opening a tab turns its layer on once, on arrival, never on a redraw", () => {
  const tab = fnOf("function setHomeTab(tab, { quiet } = {}) {");
  assert.match(tab, /if \(tab !== hmLayerTab\) \{\s*hmLayerTab = tab;\s*const need = HOMEMAP\.tabLayer\(tab\);\s*if \(need && !hmLayers\[need\]\) hmSetLayer\(need, true, \{ draw: false \}\);/);
});

test("permits are read only once the layer is on and the page is showing, and only ever with a GET", () => {
  const load = fnOf("function hmLoadPermits() {");
  assert.match(load, /hmWhenShown\(async \(\) => \{/, "a prerendered Home must not ask for permits nobody saw");
  assert.match(load, /fetch\("\/api\/permits\/map", \{ credentials: "same-origin" \}\)/);
  assert.doesNotMatch(load, /method:/);
  assert.match(load, /if \(hmPermits == null\) hmPermits = false;/, "a failed read is a failure, never an empty layer");
  // Not in Home's boot: a Home that never shows permits never pays for them.
  const list = server.match(/const DESK_BOOT_URLS = \[[\s\S]*?\n\];/)[0];
  assert.ok(!list.includes("/api/permits/map"));
});

test("a switched-on layer is drawn around the tab's subject, never fitted to, so a switch never yanks the map", () => {
  const draw = fnOf("function hmDrawPins() {");
  assert.match(draw, /const fitTo = subject\.length \? subject : pts;/);
  assert.match(draw, /if \(hmLayerOn\("permits"\) && Array\.isArray\(hmPermits\)\) \{[\s\S]*?put\(p, false\);/, "permits are never the subject");
  assert.match(draw, /if \(showProps\) located\.forEach\(\(\{ r, ll \}\) => \{\s*put\(ll, true\);/, "the properties are the subject on every tab");
  // Today's numbered pins are its rows: drawn whatever the switch says.
  assert.match(draw, /if \(hmTab === "today"\) \{\s*hmItems\.forEach/);
  assert.match(draw, /hmSyncLayerNote\(\);/, "a layer with nothing to show here must say so");
  // The note is asked again whenever the view moves.
  assert.match(html, /hmMap\.on\("moveend", hmSyncLayerNote\);/);
});

test("a permit's card is text a person or a portal wrote, so it is built with textContent", () => {
  const sel = fnOf("function hmSelect(key, { item, permit, from } = {}) {");
  const branch = sel.slice(sel.indexOf("if (permit) {"), sel.indexOf("} else if (item && hmTab === \"today\") {"));
  assert.ok(branch.length > 100, "the permit branch moved");
  assert.doesNotMatch(branch, /innerHTML/);
  assert.match(branch, /rec\.target = "_blank"; rec\.rel = "noopener noreferrer";/, "the city's record opens away from Home");
  assert.match(branch, /a\.href = "\/permits";/);
});

test("Home runs no comp report: no start card, no find-box offer, no Reports tab", () => {
  const start = html.slice(html.indexOf('id="hmStart"'), html.indexOf('id="hmPaneToday"'));
  assert.doesNotMatch(start, /Run a comp report|href="\/bulk"/, "the start cards still run a comp report");
  const find = fnOf("function hmFindResults(q) {");
  assert.doesNotMatch(find, /Run a comp report on|\/bulk\?address=/, "the find box still offers to run a report");
  // An address that matches nothing is pointed at the Tools row instead.
  assert.match(find, /go\.href = "\/bulk";/);
  assert.ok(!html.includes('data-tab="reports"'), "Home's Reports tab is back");
  // The day-old rail link /desk#reports lands on Messages' Reports view.
  assert.match(html, /else if \(h === "reports" && \/\^\\\/desk\\\/\?\$\/\.test\(location\.pathname\) && !document\.prerendering\) location\.replace\("\/messages#reports"\);/);
});

test("Home holds no comps: no tab, no layer, no start card, no read of the book (2026-10-09)", () => {
  // The owner's call: "Remove Comps from the Homepage". A member's comps are
  // on their own page, /vault, and Home no longer lists, pins or reads them.
  // What a member sees, so the history in the markup's comments is skipped.
  const home = html.slice(html.indexOf('id="homeMap"'), html.indexOf('id="hmMapEmpty"')).replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(home.length > 1000, "Home's markup moved");
  for (const id of ["hmTabComps", "hmPaneComps", "hmCompRows", "hmStartComps", "hmLayerComps", "hmLegendComps", "hmNComps"]) {
    assert.ok(!html.includes(`id="${id}"`), `#${id} is back on Home`);
  }
  assert.ok(!html.includes('data-tab="comps"'), "Home's Comps tab is back");
  assert.doesNotMatch(home, /Add comps|Your comps/, "Home offers comps again");
  // Nothing on Home reads the member's book: GET /api/vault was the Comps
  // tab's read, and HOMEMAP no longer builds a comp row.
  const js = html.slice(html.indexOf("let deskSites = null;"), html.indexOf("async function renderHomeFirm() {"));
  assert.ok(js.length > 5000, "Home's script moved");
  assert.doesNotMatch(js, /fetch\("\/api\/vault"/, "Home reads the member's comps again");
  assert.doesNotMatch(js, /HOMEMAP\.compRow|hmLoadComps|hmComps\b/, "Home's comps code is back");
  assert.ok(html.includes('const HM_TAB_IDS = { today: ["hmTabToday", "hmPaneToday"], properties: ["hmTabProps", "hmPaneProps"],\n    people: ["hmTabPeople", "hmPanePeople"] };'));
  // The find box finds properties, people and permits, and says so.
  assert.match(html, /placeholder="Find a property or person" aria-label="Find a property or person on Home"/);
  assert.match(html, /aria-label="Map of your properties and permits"/);
  // A saved /desk#comps (the tab's address for two days) lands on the comps' own page.
  assert.match(html, /else if \(h === "comps" && \/\^\\\/desk\\\/\?\$\/\.test\(location\.pathname\) && !document\.prerendering\) location\.replace\("\/vault#book"\);/);
  // BOV requests keep the vault's own gate, which the Comps tab used to share.
  assert.ok(html.includes('const hmCanLeads = () => hmCanVault() && !(myFirm() && myFirm().kind === "development");'));
});
