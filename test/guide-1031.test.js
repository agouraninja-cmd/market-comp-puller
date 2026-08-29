// The 1031 worksheet page module. Pure — string in, string out — so the whole
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
  assert.ok(G.TITLE.toLowerCase().includes("worksheet"),
    "the title should name the worksheet, not only the explainer");
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
    "not a written identification",
  ]) {
    assert.ok(body.toLowerCase().includes(must.toLowerCase()),
      "page must contain: " + must);
  }
});

test("no copy claims broker, QI, advisor status, or that CompNinja created an exchange", () => {
  const body = G.renderGuide1031Body().toLowerCase();
  for (const never of [
    "compninja is a broker", "compninja is a brokerage",
    "we are a broker", "we are a brokerage", "our brokerage",
    "we are a qualified intermediary", "compninja is a qualified intermediary",
    "we provide tax advice", "we provide legal advice",
    "appraisal of your",
    "your 1031 exchange is ready",
    "created your exchange",
    "compninja created",
  ]) {
    assert.ok(!body.includes(never), "page must never contain: " + never);
  }
});

test("the explainer stays on this URL, below the worksheet", () => {
  const body = G.renderGuide1031Body();
  const wsAt = body.indexOf("id=\"worksheet\"");
  const eduAt = body.indexOf("What a 1031 exchange is");
  const faqAt = body.indexOf("id=\"faq\"");
  assert.ok(wsAt >= 0 && eduAt > wsAt, "worksheet above the explainer");
  assert.ok(faqAt > eduAt, "FAQ stays with the explainer");
  assert.match(body, /class="steps1031"/);
  assert.match(body, /id="wsSell"/);
  assert.equal((body.match(/id="wsR\d"/g) || []).length, 3,
    "exactly three replacement slots — the three-property rule");
});

test("the widget computes dates and nothing about money", () => {
  const body = G.renderGuide1031Body();
  const script = scriptOf(body);
  for (const never of ["gain", "basis", "tax rate", "$"]) {
    assert.ok(!script.toLowerCase().includes(never),
      "widget script must not touch: " + never);
  }
});

test("a signed-in render does not send Value through the signup door", () => {
  const anon = G.renderGuide1031Body(false);
  const member = G.renderGuide1031Body(true);
  assert.match(scriptOf(anon), /\/\?auth=signup/,
    "anonymous Value handoff uses the wall's door");
  assert.ok(!scriptOf(member).includes("auth=signup"),
    "a member Value must not contain the signup door");
  assert.match(scriptOf(member), /VALUE_DEST = "\/"/);
});

test("Value hands the address through sessionStorage, never a query string", () => {
  const script = scriptOf(G.renderGuide1031Body());
  assert.match(script, /pendingLandingAddress\.v1/);
  assert.ok(!/location\.(search|href)\s*=\s*[^;]*wsSell/.test(script),
    "the selling address must not be written onto the URL");
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

test("every PROPERTY_TYPES value is a select option", () => {
  const body = G.renderGuide1031Body();
  for (const t of G.PROPERTY_TYPES) {
    assert.match(body, new RegExp(`<option value="${t}">${t}</option>`));
  }
});

// --- packet helpers (Node half; the script has its own copy, round-tripped below)

test("serialize/parse round-trips a worksheet and refuses junk", () => {
  const src = {
    v: 1,
    s: "  9020 Center Ave, Rancho Cucamonga, CA  ",
    st: "Industrial",
    c: "2026-03-03",
    r: [
      { a: "11215 4th St", t: "Industrial" },
      { a: "not-a-type-check", t: "Warehouse" },
      { a: "", t: "" },
    ],
  };
  const parsed = G.parsePacket(G.serializePacket(src));
  assert.equal(parsed.s, "9020 Center Ave, Rancho Cucamonga, CA");
  assert.equal(parsed.st, "Industrial");
  assert.equal(parsed.c, "2026-03-03");
  assert.equal(parsed.r.length, 3);
  assert.equal(parsed.r[0].a, "11215 4th St");
  assert.equal(parsed.r[1].t, "", "unknown types are dropped, not guessed");
  assert.equal(G.parsePacket("%%%not-base64%%%"), null);
  const v2 = Buffer.from(JSON.stringify({ v: 2, s: "x" }), "utf8").toString("base64url");
  assert.equal(G.parsePacket(v2), null,
    "unknown packet versions refuse rather than guess");
});

test("a fourth replacement is dropped and overlong addresses are cut", () => {
  const long = "A".repeat(G.MAX_ADDRESS + 40);
  const parsed = G.parsePacket(G.serializePacket({
    s: long,
    r: [{ a: "one" }, { a: "two" }, { a: "three" }, { a: "four" }],
  }));
  assert.equal(parsed.s.length, G.MAX_ADDRESS);
  assert.equal(parsed.r.length, 3);
  assert.equal(parsed.r[2].a, "three");
});

// --- the widget, executed for real ------------------------------------------

function scriptOf(body) {
  const m = body.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "the worksheet script must be inline in the body");
  return m[1];
}

function bootPage(opts) {
  opts = opts || {};
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    value: "", textContent: "", innerHTML: "", className: "",
    handlers: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
  });
  const location = {
    href: "https://compninja.co/1031-exchange",
    pathname: "/1031-exchange",
    search: "",
    hash: opts.hash || "",
  };
  const history = {
    replaceState(_s, _t, url) {
      url = String(url || "");
      const i = url.indexOf("#");
      if (i >= 0) {
        location.hash = url.slice(i);
        if (i > 0) location.pathname = url.slice(0, i).split("?")[0] || location.pathname;
      } else {
        location.hash = "";
        location.pathname = url.split("?")[0] || location.pathname;
      }
      location.href = "https://compninja.co" + location.pathname + location.search + location.hash;
    },
  };
  function mem() {
    const store = Object.assign({}, opts.store || {});
    return {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
      _store: store,
    };
  }
  const localStorage = mem();
  const sessionStorage = mem();
  const copied = [];
  const navigator = {
    clipboard: {
      writeText(s) { copied.push(s); return Promise.resolve(); },
    },
  };
  const printed = { n: 0 };
  const window = { print() { printed.n++; } };
  const document = { getElementById: el };
  new Function(
    "document", "location", "history", "localStorage", "sessionStorage",
    "navigator", "window", "btoa", "atob", "unescape", "escape",
    scriptOf(G.renderGuide1031Body(opts.signedIn))
  )(
    document, location, history, localStorage, sessionStorage,
    navigator, window, btoa, atob, unescape, escape
  );
  return { els, location, localStorage, sessionStorage, copied, printed, fire(id, ev) {
    const node = els[id];
    assert.ok(node && node.handlers[ev], id + " must listen for " + ev);
    node.handlers[ev]();
  } };
}

test("45 and 180 day dates: month and year rollover", () => {
  const page = bootPage();
  page.els.q1031close.value = "2026-08-20";
  page.fire("q1031close", "input");
  assert.match(page.els.q1031out.innerHTML, /Oct 4, 2026/);
  assert.match(page.els.q1031out.innerHTML, /Feb 16, 2027/);
});

test("45 and 180 day dates: leap year", () => {
  const page = bootPage();
  page.els.q1031close.value = "2027-12-17";
  page.fire("q1031close", "input");
  assert.match(page.els.q1031out.innerHTML, /Jan 31, 2028/);
  assert.match(page.els.q1031out.innerHTML, /Jun 14, 2028/);
});

test("an empty or invalid date clears the output rather than guessing", () => {
  const page = bootPage();
  page.els.q1031close.value = "";
  page.fire("q1031close", "input");
  assert.equal(page.els.q1031out.innerHTML, "");
  page.els.q1031close.value = "not-a-date";
  page.fire("q1031close", "input");
  assert.equal(page.els.q1031out.innerHTML, "");
  page.els.q1031close.value = "2026-08-20x";
  page.fire("q1031close", "input");
  assert.equal(page.els.q1031out.innerHTML, "");
});

test("editing the worksheet writes a hash packet, not a query string", () => {
  const page = bootPage();
  page.els.wsSell.value = "9020 Center Ave, Rancho Cucamonga, CA";
  page.els.wsSellType.value = "Industrial";
  page.els.q1031close.value = "2026-03-03";
  page.els.wsR0.value = "11215 4th St";
  page.fire("wsSell", "input");
  assert.match(page.location.hash, /^#p=[A-Za-z0-9_-]+$/);
  assert.ok(!page.location.search.includes("Center"),
    "the address must not land in the query string");
  const token = page.location.hash.slice(3);
  const parsed = G.parsePacket(token);
  assert.ok(parsed, "Node parsePacket must read the browser's encoding");
  assert.equal(parsed.s, "9020 Center Ave, Rancho Cucamonga, CA");
  assert.equal(parsed.st, "Industrial");
  assert.equal(parsed.c, "2026-03-03");
  assert.equal(parsed.r[0].a, "11215 4th St");
});

test("opening a hash fills the worksheet and a Value click hands off the address", () => {
  const token = G.serializePacket({
    s: "9020 Center Ave",
    st: "Industrial",
    c: "2026-03-03",
    r: [{ a: "11215 4th St", t: "Office" }],
  });
  const page = bootPage({ hash: "#p=" + token });
  assert.equal(page.els.wsSell.value, "9020 Center Ave");
  assert.equal(page.els.wsSellType.value, "Industrial");
  assert.equal(page.els.q1031close.value, "2026-03-03");
  assert.equal(page.els.wsR0.value, "11215 4th St");
  assert.equal(page.els.wsT0.value, "Office");
  assert.match(page.els.q1031out.innerHTML, /Apr 17, 2026/);

  const hrefBefore = page.location.href;
  page.fire("wsV0", "click");
  assert.equal(page.sessionStorage.getItem("pendingLandingAddress.v1"), "11215 4th St");
  assert.match(page.location.href, /auth=signup/);
  assert.match(page.location.href, /type=Office/);
  assert.ok(!page.location.href.includes("11215"),
    "the replacement address must not ride the destination URL");
  assert.ok(page.location.href !== hrefBefore);
});

test("Value on an empty row does not navigate", () => {
  const page = bootPage();
  const href = page.location.href;
  page.fire("wsSellVal", "click");
  assert.equal(page.location.href, href);
  assert.equal(page.sessionStorage.getItem("pendingLandingAddress.v1"), null);
});

test("a member Value goes to the app, not signup", () => {
  const token = G.serializePacket({ s: "9020 Center Ave", st: "Retail" });
  const page = bootPage({ hash: "#p=" + token, signedIn: true });
  page.fire("wsSellVal", "click");
  assert.equal(page.sessionStorage.getItem("pendingLandingAddress.v1"), "9020 Center Ave");
  assert.ok(!page.location.href.includes("auth=signup"));
  assert.match(page.location.href, /type=Retail/);
});

// --- what today's guide work contributes, on the worksheet page -------------
//
// The calendar export, the lead-attribution marker and the choose-a-QI section
// shipped on 2026-08-20 against the pre-worksheet page. They are re-applied on
// top of the worksheet here, so these pin that the worksheet did not quietly
// drop them.

test("the deadlines still export as a calendar file built from the typed date", () => {
  const page = bootPage();
  page.els.q1031close.value = "2026-08-20";
  page.fire("q1031close", "input");
  const ics = page.els.q1031ics;
  assert.equal(ics.hidden, false, "the link shows once a valid date is typed");
  assert.match(String(ics.href), /^data:text\/calendar/,
    "a data: URI, so the closing date never touches a server");
  const cal = decodeURIComponent(String(ics.href).split(",").slice(1).join(","));
  assert.equal((cal.match(/BEGIN:VEVENT/g) || []).length, 2, "both deadlines");
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20261004"), "day 45");
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20270216"), "day 180");
  assert.ok(cal.includes("\r\n"), "RFC 5545 wants CRLF");

  // Deterministic: DTSTAMP derives from the closing date, never the clock.
  const again = bootPage();
  again.els.q1031close.value = "2026-08-20";
  again.fire("q1031close", "input");
  assert.equal(String(again.els.q1031ics.href), String(ics.href));
});

test("an invalid date hides the calendar link rather than serving a stale file", () => {
  const page = bootPage();
  page.els.q1031close.value = "2026-08-20";
  page.fire("q1031close", "input");
  assert.equal(page.els.q1031ics.hidden, false);
  page.els.q1031close.value = "not-a-date";
  page.fire("q1031close", "input");
  assert.equal(page.els.q1031ics.hidden, true, "a stale file must not stay downloadable");
  assert.equal(page.els.q1031out.innerHTML, "");
});

test("reading the page leaves the marker lead attribution reads", () => {
  // index.html reads this exact key at BOV submit to tag the lead's source
  // "1031". The two strings must not drift.
  const page = bootPage();
  const v = page.localStorage.getItem("cnRef1031.v1");
  assert.ok(v, "the marker must be written on load");
  assert.ok(Number(v) > 0, "the marker is a timestamp, so the signal can expire");
});

test("the choosing-a-QI section survives on the worksheet page", () => {
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
