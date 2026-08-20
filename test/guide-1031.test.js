// The 1031 guide page module. Pure — string in, string out — so the whole
// page, its compliance promises, and its inline widget are testable with no
// server and no browser. The widget test executes the REAL emitted script
// against a DOM stub, the same pattern test/vault-page.test.js uses.

const test = require("node:test");
const assert = require("node:assert");

const G = require("../guide-1031");

const SITE = "https://compninja.co";

// --- module surface --------------------------------------------------------

test("exports the names server.js wires", () => {
  assert.equal(typeof G.TITLE, "string");
  assert.ok(G.TITLE.length <= 60, "title must survive Google's ~60-char cut");
  assert.equal(typeof G.DESCRIPTION, "string");
  assert.ok(G.DESCRIPTION.length <= 160, "description should fit the snippet");
  assert.equal(typeof G.GUIDE_CSS, "string");
  assert.ok(Array.isArray(G.GUIDE_1031_FAQ) && G.GUIDE_1031_FAQ.length >= 6);
  assert.equal(typeof G.renderGuide1031Body, "function");
  assert.equal(typeof G.webPageNode, "function");
  assert.equal(typeof G.faqPageNode, "function");
});

// --- compliance: the strings that must and must not appear ------------------

test("the education-not-advice box and funnel copy are present", () => {
  const body = G.renderGuide1031Body();
  for (const must of [
    "educational",
    "not tax, legal, or investment advice",
    "qualified intermediary",
    "tax advisor",
    "automated estimate",
    "connect you with a local broker",
  ]) {
    assert.ok(body.toLowerCase().includes(must.toLowerCase()),
      "page must contain: " + must);
  }
});

test("the choosing-a-QI section educates and disclaims in the same breath", () => {
  const body = G.renderGuide1031Body();
  for (const must of [
    "Choosing a qualified intermediary",
    "not a qualified intermediary and does not hold funds",
    "segregated qualified escrow",
    "fidelity bond",
  ]) {
    assert.ok(body.includes(must), "QI section must contain: " + must);
  }
});

test("no copy claims broker, QI, or advisor status", () => {
  const body = G.renderGuide1031Body().toLowerCase();
  for (const never of [
    "compninja is a broker", "compninja is a brokerage",
    "we are a broker", "we are a brokerage", "our brokerage",
    "we are a qualified intermediary", "compninja is a qualified intermediary",
    "we provide tax advice", "we provide legal advice",
    "appraisal of your",
    // The QI section is a vetting checklist, never a referral service: the
    // page may say what to verify about an intermediary, and must never offer
    // one, hold money, or take a cut for the introduction.
    "our qualified intermediary", "we can act as your qualified intermediary",
    "we hold your funds", "we will hold your funds", "referral fee",
  ]) {
    assert.ok(!body.includes(never), "page must never contain: " + never);
  }
  // The one place "not" matters: the page may only mention being a
  // brokerage/QI in a negation, which the must-contain test already pins.
});

test("the widget computes dates and nothing about money", () => {
  const body = G.renderGuide1031Body();
  const script = scriptOf(body);
  for (const never of ["gain", "basis", "tax rate", "$"]) {
    assert.ok(!script.toLowerCase().includes(never),
      "widget script must not touch: " + never);
  }
});

// --- FAQ: one array feeds both surfaces -------------------------------------

test("visible FAQ count equals the JSON-LD question count", () => {
  const body = G.renderGuide1031Body();
  const visible = (body.match(/<details class="faq"/g) || []).length;
  const node = G.faqPageNode(SITE);
  assert.equal(node["@type"], "FAQPage");
  assert.equal(node.mainEntity.length, G.GUIDE_1031_FAQ.length);
  assert.equal(visible, G.GUIDE_1031_FAQ.length,
    "accordions and JSON-LD must both render every FAQ entry");
});

test("the JSON-LD nodes serialize and reference the shared brand ids", () => {
  const wp = G.webPageNode(SITE);
  assert.equal(wp["@type"], "WebPage");
  assert.equal(wp.url, SITE + "/1031-exchange");
  assert.equal(wp.isPartOf["@id"], SITE + "/#website");
  assert.equal(wp.publisher["@id"], SITE + "/#organization");
  // Never a second Organization: the standing brandGraph rule.
  const all = JSON.stringify([wp, G.faqPageNode(SITE)]);
  assert.ok(!all.includes('"Organization"'),
    "page nodes must reference ORG_ID, not restate the Organization");
  assert.doesNotThrow(() => JSON.parse(all));
});

// --- the page is self-contained ---------------------------------------------

test("no external scripts and no template-literal leakage", () => {
  const body = G.renderGuide1031Body();
  assert.ok(!/<script[^>]*src=/.test(body), "page must be self-contained");
  assert.ok(!body.includes("${"), "unescaped template-literal leakage");
});

// --- the widget, executed for real ------------------------------------------

function scriptOf(body) {
  const m = body.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "the deadline widget script must be inline in the body");
  return m[1];
}

// Minimal DOM stub: just what the widget touches.
function runWidget(closingDateValue) {
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    value: "", textContent: "", innerHTML: "", className: "",
    handlers: {}, addEventListener(ev, fn) { this.handlers[ev] = fn; },
  });
  const document = { getElementById: el };
  const body = G.renderGuide1031Body();
  new Function("document", scriptOf(body))(document);
  const input = els["q1031close"];
  assert.ok(input && input.handlers.input, "script must listen on #q1031close");
  input.value = closingDateValue;
  input.handlers.input();
  return els;
}

test("45 and 180 day dates: month and year rollover", () => {
  const out = runWidget("2026-08-20")["q1031out"];
  assert.match(out.innerHTML, /Oct 4, 2026/);   // +45 crosses a month
  assert.match(out.innerHTML, /Feb 16, 2027/);  // +180 crosses the year
});

test("45 and 180 day dates: leap year", () => {
  const out = runWidget("2027-12-17")["q1031out"];
  assert.match(out.innerHTML, /Jan 31, 2028/);
  assert.match(out.innerHTML, /Jun 14, 2028/);  // counts Feb 29, 2028
});

test("an empty or invalid date clears the output rather than guessing", () => {
  assert.equal(runWidget("")["q1031out"].innerHTML, "");
  assert.equal(runWidget("not-a-date")["q1031out"].innerHTML, "");
  // Trailing garbage past a valid-looking prefix must not parse: the widget
  // has no regex end anchor (a literal $ is banned from the script by the
  // no-money test above), so it guards on exact length instead.
  assert.equal(runWidget("2026-08-20x")["q1031out"].innerHTML, "");
});

// --- the calendar export -----------------------------------------------------

test("the deadlines export as a calendar file built from the typed date", () => {
  const ics = runWidget("2026-08-20")["q1031ics"];
  assert.equal(ics.hidden, false, "link must show once a valid date is typed");
  assert.match(String(ics.href), /^data:text\/calendar/,
    "a data: URI, so the date never touches a server");
  const cal = decodeURIComponent(String(ics.href).split(",").slice(1).join(","));
  assert.ok(cal.includes("BEGIN:VCALENDAR"));
  assert.equal((cal.match(/BEGIN:VEVENT/g) || []).length, 2, "both deadlines");
  // All-day events on the same dates the visible output shows.
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20261004"), "day 45");
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20270216"), "day 180");
  assert.ok(cal.includes("\r\n"), "RFC 5545 wants CRLF line endings");
  // Deterministic: same closing date, same file (DTSTAMP derives from the
  // closing, never the clock).
  assert.equal(String(ics.href), String(runWidget("2026-08-20")["q1031ics"].href));
});

test("an invalid date hides the calendar link rather than serving a stale file", () => {
  assert.equal(runWidget("not-a-date")["q1031ics"].hidden, true);
  assert.equal(runWidget("")["q1031ics"].hidden, true);
});

// --- the 1031 lead marker ----------------------------------------------------

test("reading the guide leaves the marker lead attribution reads", () => {
  const script = scriptOf(G.renderGuide1031Body());
  // index.html reads this exact key at BOV submit to tag the lead's source
  // "1031"; the two must not drift.
  assert.ok(script.includes("cnRef1031.v1"));
  assert.ok(/try\{localStorage/.test(script.replace(/\s/g, "")),
    "the marker write must be guarded — the harness has no localStorage");
});
