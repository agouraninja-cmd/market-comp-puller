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

test("the map's switch is one choice of two over the map: Properties or Permits", () => {
  const at = html.indexOf('id="hmLayers"');
  assert.ok(at > 0, "the layer switch is gone");
  const box = html.slice(at, html.indexOf("</div>", at));
  assert.match(box, /role="group" aria-label="Show on the map"/);
  assert.match(box, /data-view="properties" aria-pressed="true"/, "Properties is on before anything is read");
  assert.match(box, /data-view="permits" aria-pressed="false"/);
  assert.doesNotMatch(box, /data-view="both"|<span>Both<\/span>/, "the Both choice is back");
  assert.equal((box.match(/data-view="/g) || []).length, 2, "the switch is two choices");
  assert.doesNotMatch(box, /data-(layer|view)="comps"/, "the Comps toggle is back on Home's map");
  // The switch sits over the map, not in the list.
  assert.ok(at > html.indexOf('class="hm-mapw"') && at > html.indexOf('id="hmMap"'), "the switch is not on the map");
});

test("pressing a view writes each changed layer through hmSetLayer, on before off, and draws once", () => {
  const sync = fnOf("function hmSyncLayerButtons() {");
  assert.match(sync, /const view = HOMEMAP\.layerView\(hmLayers\);/);
  assert.match(sync, /const on = b\.dataset\.view === view;/);
  const view = fnOf("function hmSetView(view, { draw = true } = {}) {");
  assert.match(view, /if \(!HOMEMAP\.VIEWS\.includes\(view\)\) return;/);
  assert.match(view, /const want = HOMEMAP\.layersFor\(view\);/);
  assert.match(view, /change\.sort\(\(a, b\) => Number\(want\[b\]\) - Number\(want\[a\]\)\)\s*\.forEach\(\(k\) => hmSetLayer\(k, want\[k\], \{ draw: false \}\)\);\s*if \(draw\) hmDrawPins\(\);/);
  assert.match(html, /const b = e\.target\.closest\("button\[data-view\]"\);\s*if \(b\) hmSetView\(b\.dataset\.view\);/);
});

test("one writer keeps the switch, this browser's copy and the pins in step, and storage can fail", () => {
  assert.match(html, /let hmLayers = HOMEMAP\.LAYER_DEFAULT;\n  try \{ hmLayers = HOMEMAP\.readLayers\(localStorage\.getItem\(HM_LAYER_KEY\)\); \} catch \(_\) \{/);
  const set = fnOf("function hmSetLayer(layer, on, { draw = true } = {}) {");
  assert.match(set, /try \{ localStorage\.setItem\(HM_LAYER_KEY, JSON\.stringify\(hmLayers\)\); \} catch \(_\)/);
  assert.match(set, /if \(on && layer === "permits"\) hmLoadPermits\(\);/);
  // A card on something that just left the map closes with it: a permit's,
  // and a property's unless Today (whose pins never leave) is showing.
  assert.match(set, /layer === "permits" && hmSel\.startsWith\("permit:"\)\) hmMap\.closePopup\(\);/);
  assert.match(set, /layer === "properties" && !hmSel\.startsWith\("permit:"\) && hmTab !== "today"\) hmMap\.closePopup\(\);/);
  // Only hmSetLayer assigns the record (the initial read aside).
  assert.equal((html.match(/\bhmLayers = /g) || []).length, 3, "something else writes hmLayers");
  // A layer is on when the record says so; the record only ever holds
  // HOMEMAP.LAYERS (readLayers drops an old stored Comps).
  assert.match(html, /const hmLayerOn = \(layer\) => Boolean\(hmLayers\[layer\]\);/);
  assert.match(set, /if \(!HOMEMAP\.LAYERS\.includes\(layer\)\) return;/);
});

test("opening a tab turns its layer on once, on arrival, never on a redraw", () => {
  const tab = fnOf("function setHomeTab(tab, { quiet } = {}) {");
  assert.match(tab, /if \(tab !== hmLayerTab\) \{\s*hmLayerTab = tab;\s*const need = HOMEMAP\.tabLayer\(tab\);\s*if \(need && !hmLayers\[need\]\) hmSetView\(need, \{ draw: false \}\);/);
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
  // A map card has no comp branch: a `comp` left behind there is a
  // ReferenceError on every card (the street-photo merge left one).
  const sel = fnOf("function hmSelect(key, { item, permit, from } = {}) {");
  assert.doesNotMatch(sel.replace(/\/\/.*$/gm, ""), /\bcomp\b/, "hmSelect still reads a comp");
  assert.ok(html.includes('const HM_TAB_IDS = { today: ["hmTabToday", "hmPaneToday"], properties: ["hmTabProps", "hmPaneProps"],\n    people: ["hmTabPeople", "hmPanePeople"] };'));
  // The find box finds properties, people and permits, and says so.
  assert.match(html, /placeholder="Find a property or person" aria-label="Find a property or person on Home"/);
  assert.match(html, /aria-label="Map of your properties and permits"/);
  // A saved /desk#comps (the tab's address for two days) lands on the comps' own page,
  // /comps since 2026-10-13.
  assert.match(html, /else if \(h === "comps" && \/\^\\\/desk\\\/\?\$\/\.test\(location\.pathname\) && !document\.prerendering\) location\.replace\("\/comps"\);/);
  // BOV requests keep the vault's own gate, which the Comps tab used to share.
  assert.ok(html.includes('const hmCanLeads = () => hmCanVault() && !(myFirm() && myFirm().kind === "development");'));
});

// Two fingers on a trackpad (2026-10-10, the owner's ask): a swipe pans and a
// pinch zooms; a mouse wheel's notch is still Leaflet's. Which is which is
// home-map.js's wheelGesture (test/home-map.test.js); this pins the wiring.
test("a trackpad swipe pans Home's map and a pinch zooms it, ahead of Leaflet's own wheel", () => {
  const ensure = fnOf("function hmEnsureMap()");
  const listen = ensure.indexOf('el.addEventListener("wheel", hmOnWheel, { passive: false })');
  assert.ok(listen > 0, "Home's map no longer reads the trackpad");
  assert.ok(listen < ensure.indexOf("L.map(el"),
    "the wheel listener must be added before L.map(), or Leaflet's runs first and zooms on a swipe");
  assert.match(ensure, /L\.map\(el, \{[^}]*scrollWheelZoom: true/, "a mouse wheel must still zoom (Leaflet's handler)");
  assert.match(ensure, /"gesturestart", "gesturechange", "gestureend"\]\.forEach\(\(t\) => el\.addEventListener\(t, hmOnGesture\)\)/,
    "Safari's pinch is its own gesture events");
  const onWheel = fnOf("function hmOnWheel(e)");
  assert.match(onWheel, /HOMEMAP\.wheelGesture\(e, hmWheelLast, e\.timeStamp\)/);
  assert.match(onWheel, /if \(kind === "wheel"\) return;\n    e\.preventDefault\(\);\n    e\.stopImmediatePropagation\(\);/,
    "a mouse notch is left to Leaflet, and only a swipe or a pinch is taken from it");
  // The pinch rides Leaflet 1.9.4's private pinch path, so the pinned version is part of the contract.
  assert.ok(html.includes("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"), "Leaflet moved off 1.9.4: re-check hmPinchStart/To/End");
  // The empty map's card lets a gesture through to the map under it.
  assert.match(html, /\.hm-map-empty \{[^}]*pointer-events: none;/, "a pinch over the empty map's card zooms the whole page");
});

test("a pin opens its card on hover where there is a real pointer, and touch keeps tap-to-open (2026-10-13)", () => {
  const pin = fnOf("function hmPin(");
  assert.match(pin, /if \(onClick\) m\.on\("click", onClick\);/, "a click (and a tap) must still open the card");
  assert.match(pin, /if \(onClick && hmCanHover\(\)\) \{/, "hover opens only where the pointer can hover");
  assert.match(html, /const hmCanHover = \(\) => window\.matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)\.matches;/);
  assert.match(pin, /t = setTimeout\(onClick, HM_HOVER_MS\);/, "a pointer crossing the map must not open every pin it passes");
  assert.match(pin, /if \(hmMoving \|\| performance\.now\(\) - hmMovedAt < HM_HOVER_SETTLE_MS\) return;/,
    "a card's own pan must not open the pin that lands under a resting pointer");
  assert.match(pin, /m\.on\("mouseout remove", \(\) => clearTimeout\(t\)\);/);
  const ensure = fnOf("function hmEnsureMap()");
  assert.ok(ensure.includes('hmMap.on("movestart zoomstart", () => { hmMoving = true; });'));
  assert.ok(ensure.includes('hmMap.on("moveend zoomend", () => { hmMoving = false; hmMovedAt = performance.now(); });'));
  // hmSelect redraws the pins, so a new pin appears under the pointer; it must
  // not rebuild (and re-pan) the card that is already up.
  const sel = fnOf("function hmSelect(key");
  assert.match(sel, /^function hmSelect\(key, \{ item, permit, from \} = \{\}\) \{\n    \/\/[^\n]*\n    \/\/[^\n]*\n    if \(from === "map" && key === hmSel && hmPopup && hmPopup\.isOpen\(\)\) return;/);
});

// The empty Home's start screen (2026-10-18; Draft C of the empty Home
// drafts, the owner's pick): an account with nothing on Home is asked for its
// first building over the whole map, instead of an empty list beside an
// empty map that said "add a property" three times.
test("an empty Home asks for its first building, and the answer goes to Properties' own form", () => {
  const at = html.indexOf('id="hmFirst"');
  assert.ok(at > html.indexOf('id="hmMap"'), "the start screen is not over the map");
  const box = html.slice(at, html.indexOf("</section>", at));
  assert.match(html.slice(at - 60, at + 40), /<section id="hmFirst" class="hidden hm-first"/, "the start screen must start hidden");
  assert.match(box, /Where’s your first building\?/);
  // The copy rules: a value is an automated estimate, never an appraisal,
  // and what a value costs is said the way the add form says it.
  assert.match(box, /Every valuation is an automated estimate, not an appraisal\./);
  assert.match(box, /One click gets it an automated value estimate\./);
  assert.doesNotMatch(box, /appraise|we are a broker|our brokers/i);
  // The form posts nowhere of its own: no action, and the submit handler
  // opens a form rather than sending anything.
  assert.doesNotMatch(box, /<form[^>]*\saction=/);
  const submit = html.slice(html.indexOf('getElementById("hmFirstForm").addEventListener("submit"'), html.indexOf('getElementById("hmFirstTeam")'));
  assert.ok(submit.length > 200, "the start screen's submit moved");
  assert.doesNotMatch(submit, /fetch\(|acctApi\(|sendBeacon/, "the start screen saves on its own");
  assert.match(submit, /hmFirstGone = true;/, "answering it does not bring the list back");
  assert.match(submit, /setHomeTab\("properties"\);/);
  assert.match(submit, /if \(toFirm\) hmOpenFirmAdd\(address\);\s*else hmOpenMineAdd\("own", address\);/);
  // One writer of the class that hides the list, and it shows the screen
  // only where a form can take the answer.
  assert.equal((html.match(/classList\.toggle\("hm-first-on"/g) || []).length, 1, "hm-first-on has more than one writer");
  const show = fnOf("function hmFirstShow(on) {");
  assert.match(show, /on = Boolean\(on && \(ways\.own \|\| ways\.firm\) && currentUser\);/);
  assert.match(fnOf("function drawHomeMap() {"), /hmFirstShow\(nothing && !hmFirstGone\);/);
  // The old start cards stand in only when the start screen cannot show.
  assert.match(html, /getElementById\("hmStart"\)\.classList\.toggle\("hidden", !nothing \|\| hmTab !== "today" \|\| hmFirstOn\);/);
  assert.match(html, /getElementById\("hmStart"\)\.classList\.toggle\("hidden", !hmNothing \|\| tab !== "today" \|\| hmFirstOn\);/);
  // Its dots are the public market list, read only once the page is shown
  // (CLAUDE.md's rule 15), and drawn non-interactive on the pin layer.
  const load = fnOf("function hmLoadMarkets() {");
  assert.match(load, /hmWhenShown\(async \(\) => \{/);
  assert.match(load, /fetch\("\/api\/markets", \{ credentials: "same-origin" \}\)/);
  assert.match(fnOf("function hmDrawFirstMap() {"), /className: "hm-mkt", radius: .+?, interactive: false \}/);
  assert.match(fnOf("function hmDrawPins() {"), /hmPinLayer\.clearLayers\(\);\s*if \(hmFirstOn\) \{ hmDrawFirstMap\(\); return; \}/);
  // The empty map's card no longer points "on the left", which a phone has not got.
  assert.ok(!html.includes("Add a property on the left"), "the empty map points at a list a phone shows below it");
});

test("Home's fixes from the empty Home drafts: words on the firm header, links and a legend that name only what is there", () => {
  // The firm header's two controls say what they do.
  const gear = html.slice(html.indexOf('<button id="hmFirmGear"'), html.indexOf("</button>", html.indexOf('<button id="hmFirmGear"')));
  assert.match(gear, /<span>Firm settings<\/span>/);
  const head = fnOf("function drawFirmHead(firm) {");
  assert.doesNotMatch(head, /hm-fh-add/, "the unlabelled red + is back on the firm's initials");
  assert.match(head, /hmEl\("button", "hm-fh-logo", "\+ Add your firm’s logo"\)/);
  // Today's links go only to lists that have something in them.
  const draw = fnOf("function drawHomeMap() {");
  assert.match(draw, /const leasesLink = !!firm && firmBuildings\.length > 0;/);
  assert.match(draw, /const msgsLink = !!firm && !!\(deskThreadsStat && deskThreadsStat\.total\);/);
  // The legend names only the kinds a pin was drawn for.
  assert.match(fnOf("function hmDrawPins() {"), /const kinds = new Set\(showProps \? located\.map\(\(\{ r \}\) => hmPipClass\(r\)\) : \[\]\);/);
  // One place opens on its neighbourhood, not at the fit's street-level ceiling.
  assert.match(html, /const HM_ONE_ZOOM = 14;/);
  // Next replaces a paragraph that repeated the status line, and is text-built.
  // Since 2026-11-13 the paragraph no longer repeats it (below), so Next
  // stands in for it only when Next is all a quiet Today has to show.
  const next = fnOf("function hmDrawNext(firm) {");
  assert.doesNotMatch(next.replace("ic.innerHTML = HM_ICON[st.icon]; // static markup, no data", ""), /innerHTML/);
  assert.match(draw, /todayEmpty\.classList\.toggle\("hidden", hmItems\.length > 0 \|\| nothing \|\| !todayEmpty\.textContent \|\| \(next && !brief\)\);/);
});

// A quiet day (2026-11-13). The owner's screenshot of Home: nine properties,
// nothing due, "Nothing needs you right now." under the greeting and again as
// the whole of Today, and an empty column beside the map. What a quiet Today
// shows is home-map.js (test/home-map.test.js); this pins how index.html
// wires it.
test("a quiet Today shows what the member holds, never the status line a second time", () => {
  const draw = fnOf("function drawHomeMap() {");
  // "Nothing needs you right now." is the status line's sentence, said once,
  // by HOMEMAP.statusLine (home-map.js). Outside its comments, the page
  // never writes it: that is what kept it from being said twice.
  const said = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(said, /Nothing needs you/, "index.html writes the status line's sentence itself");
  assert.match(require("../home-map.js").statusLine({ items: [], propertyCount: 2 }), /^Nothing needs you right now\.$/);
  assert.doesNotMatch(draw.replace(/\/\/[^\n]*/g, ""), /Nothing needs you/, "drawHomeMap says the status line itself");
  // The words under a quiet day's cards say only what can reach this member.
  assert.match(draw, /\? HOMEMAP\.landsHere\(\{ hasFirm: !!firm, firmKind: hmFirmKind\(\), leads: canLeads \}\)/);
  // The later dates are read only on a quiet day, from what Home already holds.
  assert.match(draw, /hmLater = hmItems\.length \? \[\] : HOMEMAP\.later\(\{ critical: firm && Array\.isArray\(deskCritical\) \? deskCritical : \[\],/);
  assert.match(draw, /const brief = hmDrawBrief\(\);/);
  // The brief asks the server nothing and is built from text.
  const brief = fnOf("function hmDrawBrief() {");
  assert.doesNotMatch(brief, /fetch\(|acctApi\(|bootFetch\(|innerHTML/);
  assert.match(brief, /const quiet = !hmItems\.length && hmRows\.length > 0;/, "a busy day's list is left exactly as it was");
  // At a glance starts at two properties, in the money format Properties' own headings use.
  assert.match(brief, /const cells = quiet && rows\.length >= 2\s*\? HOMEMAP\.glanceCells\(HOMEMAP\.glance\(\{ rows, next: hmLater\[0\] \|\| null \}\), \{ money: hmSitesView\(\) \? HOMESITES\.short : HOMEMAP\.money \}\)/);
  // The member's values show here only where their plan shows values: the
  // working pane's rule (billing.md: a free account's properties are an
  // address list, Pro's carry their values), read through the same flag.
  assert.match(brief, /const rows = hmShowValues\(\) \? hmRows : hmRows\.map\(\(r\) => \(r\.group === "owned" \? \{ \.\.\.r, value: null, change: null \} : r\)\);/);
  assert.ok(html.includes("const hmShowValues = () => { try { return Boolean(proConfig && proConfig.portfolioValues); } catch (_) { return false; } };"),
    "the flag is read unguarded: proConfig is declared far below, a temporal dead zone throw");
  // When the plan answers after Home drew, Home is drawn again, and no read is repeated.
  const gate = fnOf("async function initGate() {");
  assert.match(gate, /if \(typeof drawHomeMap === "function" && currentUser && hmRows\.length\) \{\s*try \{ drawHomeMap\(\); \}/);
  assert.doesNotMatch(gate.replace(/\/\/[^\n]*/g, ""), /renderMyDesk\(/, "initGate re-runs the whole desk fill again: every desk read goes out twice");
  assert.match(fnOf("function drawHomeMap() {"), /const ownMoney = mine \? HOMESITES\.short : HOMEMAP\.money;/, "Properties' Owned heading and the glance must share one formatter");
  // A value says who can see it, the way every row does.
  assert.match(brief, /if \(c\.scope\) cell\.append\(hmScope\(c\.scope\)\);/);
  assert.match(brief, /const later = quiet \? hmLater\.slice\(0, HM_LATER_MAX\) : \[\];/);
  assert.match(brief, /const moved = quiet \? HOMEMAP\.movers\(rows\) : \[\];/);
  for (const fn of ["function hmLaterRow(x) {", "function hmMovedRow(r) {"]) assert.doesNotMatch(fnOf(fn), /innerHTML/, fn);
  // A later date opens the card a Today row opens; it has no number and no pin.
  assert.match(fnOf("function hmLaterRow(x) {"), /hmSelect\(HOMEMAP\.addressKey\(x\.address\), \{ item: x \}\)/);
  assert.match(fnOf("function hmLaterRow(x) {"), /hmScope\(x\.scope\)/, "a later row says who can see it");
  // The state sits with the rest of Home's, above the functions the boot path calls.
  assert.ok(html.indexOf("let hmLater = [];") > 0 && html.indexOf("let hmLater = [];") < html.indexOf("function resetHomeMap() {"),
    "hmLater is declared below a function the boot path calls: a temporal dead zone throw on load");
  assert.match(fnOf("function resetHomeMap() {"), /hmLater = \[\];/, "a sign-out leaves the last member's dates behind");
  // Every part the script writes is in the markup, hidden until it has something to say.
  for (const id of ["hmBrief", "hmGlance", "hmLater", "hmMoved"]) {
    assert.match(html, new RegExp(`<(div|section) id="${id}" class="hidden `), `#${id} must start hidden`);
  }
  // .hm-brief sets a display, so it needs its own .hidden (the .dk-strip trap).
  assert.match(html, /\.hm-brief \{ display: grid;[^}]*\}\n\s*\.hm-brief\.hidden \{ display: none; \}/);
});

test("a property with no value yet leads a quiet Today's next steps, and the step runs nothing", () => {
  const next = fnOf("function hmDrawNext(firm) {");
  assert.match(next, /const bare = HOMEMAP\.unvalued\(hmRows\);/);
  assert.ok(next.indexOf("HOMEMAP.unvalued(hmRows)") < next.indexOf("hmRows.length <= 3"), "the value step comes before the early account's steps");
  // It opens the property's pane, where Refresh value is; a search is the member's own click.
  assert.match(next, /act: "Open", go: \(\) => hmOpenWork\(bare\[0\]\.key\) \}/);
  assert.doesNotMatch(next, /fetch\(|acctApi\(|refreshPortfolioItem|\/api\/comps/);
  assert.match(next, /if \(!hmItems\.length && hmWorkHere\(\)\) \{/, "without home-sites.js there is no pane to open");
  // Its words are the pane's own, and an estimate is never called an appraisal.
  assert.match(next, /"No value yet\. Refresh runs a search for one\."/);
  assert.doesNotMatch(next, /apprais/i);
});

test("Home's small fixes of 2026-11-13: the dark find box, the legal line's place, room for the Feedback button", () => {
  // The dark bridge paints every input --paper; the find box's frame is its parent.
  assert.match(html, /#hmFind \{ background-color: transparent; \}/);
  // Beside the rail the legal line rests at the foot of the panel.
  assert.match(html, /html\.nav-rail\.hm-page \.hm-body > \.hm-legal \{ margin-top: auto; padding-top: 26px; \}/);
  // Away from the rail the list's foot can scroll clear of the round Feedback button.
  assert.match(html, /\n    \.hm-body \{ padding: 4px 8px 84px; \}/);
});

// Pins that land on each other (2026-11-13). From across the country six
// buildings in one city were a single dot, the top pin hiding the rest, and on
// Properties one value tag covered five. How pins group is home-map.js's
// stacks (test/home-map.test.js); this pins how index.html draws them.
test("pins that would land on each other are drawn once, with their count, and a click zooms in", () => {
  const draw = fnOf("function hmDrawPins() {");
  // Every located property is still the tab's subject (the fit is unchanged);
  // only how its pin is drawn moved.
  assert.match(draw, /if \(showProps\) located\.forEach\(\(\{ r, ll \}\) => \{\s*put\(ll, true\);\s*\}\);\s*if \(showProps\) hmDrawPropertyPins\(located\);/);
  const pins = fnOf("function hmDrawPropertyPins(located) {");
  // Grouped at the map's present zoom: a round dot, or Properties' wide value tag.
  assert.match(pins, /const p = hmMap\.project\(\[ll\.lat, ll\.lng\], zoom\);/);
  assert.match(pins, /HOMEMAP\.stacks\(pts, tags \? HOMEMAP\.STACK_TAG : HOMEMAP\.STACK_DOT\)/);
  // One property is drawn exactly as it always was.
  assert.match(pins, /if \(items\.length === 1\) \{/);
  assert.match(pins, /<span class="hm-tag \$\{hmPipClass\(r\)\}\$\{on \? " on" : ""\}">\$\{HOMEMAP\.money\(r\.value\)\}<\/span>`, \[76, 28\], \(\) => hmSelect\(r\.key, \{ from: "map" \}\), on \? 900 : 100, r\.address\)/);
  assert.match(pins, /<span class="hm-pip \$\{hmPipClass\(r\)\}\$\{on \? " on" : ""\}"><\/span>`, \[14, 14\], \(\) => hmSelect\(r\.key, \{ from: "map" \}\), on \? 900 : 0, r\.address\)/);
  // A stack's markup is class names and figures; its words (a town is text a
  // person typed) are the marker's title, a DOM property.
  const stack = pins.slice(pins.indexOf("const rows = items.map"));
  assert.match(stack, /const html = `<span class="hm-stk\$\{on \? " on" : ""\}">\$\{dots\}<b>\$\{rows\.length\}<\/b>\$\{sum \? `<em>\$\{HOMEMAP\.money\(sum\)\}<\/em>` : ""\}<\/span>`;/);
  assert.doesNotMatch(stack.slice(0, stack.indexOf("hmPin(at, html")), /address|stackTitle|stackPlace/, "a stack's HTML holds something a person typed");
  assert.match(stack, /\}, on \? 900 : 200, null, HOMEMAP\.stackTitle\(rows\)\);/);
  const pin = fnOf("function hmPin(");
  assert.match(pin, /keyboard: false, \.\.\.\(still \? \{ title: still, alt: still \} : \{\}\) \}\);/);
  // A stack takes a click and never opens on hover: a hover that moved the map
  // would be worse than one that opened a card.
  assert.ok(pin.indexOf("if (still) return m.addTo(hmPinLayer);") > pin.indexOf('if (onClick) m.on("click", onClick);'), "a stack lost its click");
  assert.ok(pin.indexOf("if (still) return m.addTo(hmPinLayer);") < pin.indexOf("if (onClick && hmCanHover()) {"), "a stack opens on hover");
  // The click zooms until its properties stand apart; where zooming cannot
  // (one point, or the closest zoom) it opens the first one's card, as before.
  assert.match(stack, /if \(one \|\| hmMap\.getZoom\(\) >= hmMap\.getMaxZoom\(\)\) \{ hmSelect\(rows\[0\]\.key, \{ from: "map" \}\); return; \}/);
  assert.match(stack, /hmMap\.fitBounds\(lls, \{ \.\.\.hmFitOpts\(\), maxZoom: hmMap\.getMaxZoom\(\) \}\);/);
  // On Today a dated row is its numbered pin: its dot is not drawn or counted beside it.
  assert.match(pins, /const dated = new Set\(hmTab === "today" \? hmItems\.filter\(\(x\) => x\.num != null\)\.map\(\(x\) => HOMEMAP\.addressKey\(x\.address\)\) : \[\]\);/);
  // A stack is the zoom's, so the pins are drawn again when the zoom settles:
  // after the current task, never inside hmDrawPins' own fit.
  assert.ok(fnOf("function hmEnsureMap()").includes('hmMap.on("zoomend", hmRestack);'));
  const restack = fnOf("function hmRestack() {");
  assert.match(restack, /hmRestackTimer = setTimeout\(\(\) => \{ if \(hmPinLayer\) hmDrawPins\(\); \}, 0\);/);
  // The pill is centred on its marker like a value tag, and its dots are the legend's colours.
  assert.match(html, /\.hm-stk \{ position: absolute; left: 50%; top: 50%; transform: translate\(-50%, -50%\);/);
  for (const k of ["buy", "own", "firm"]) assert.match(html, new RegExp(`\\.hm-legend i\\.${k}, \\.hm-pip\\.${k}, \\.hm-stk i\\.${k} \\{`), `a stack's ${k} dot is not the legend's colour`);
});
