// Report-first outreach: which buildings get written about, and what the
// message says.
//
// Both sides of this are unusually costly to get wrong. A bad target means a
// real message to a real person about a building that is not theirs, and the
// copy carries the two claims this project is most careful about everywhere
// else: that we are not a brokerage, and that a figure is an estimate rather
// than an appraisal.

const test = require("node:test");
const assert = require("node:assert");

const { addressKeyOf, isTargetable, selectTargets, reportLine, renderEmail, dealDateValue } = require("../outreach-draft");

const row = (over = {}) => ({
  market: "Boise, ID",
  property_type: "Industrial",
  address: "1210 N 17th St, Boise, ID",
  deal_date: "2026-03-01",
  source_type: "public_record",
  ...over,
});

// --- who is worth writing to --------------------------------------------

test("a modelled row is never a target", () => {
  // estimate/news are exactly the provenance corpus retrieval and the backtest
  // already refuse. A guess is not a building somebody owns.
  assert.equal(isTargetable(row({ source_type: "estimate" })), false);
  assert.equal(isTargetable(row({ source_type: "news" })), false);
  assert.equal(isTargetable(row({ source_type: "public_record" })), true);
  assert.equal(isTargetable(row({ source_type: "listing" })), true);
});

test("a submarket statistic is never a target", () => {
  for (const address of [
    "Financial District (general submarket estimate)",
    "Downtown Boise industrial submarket",
    "West Valley average",
  ]) {
    assert.equal(isTargetable(row({ address })), false, address);
  }
});

test("an address naming one unit of a site is never a target", () => {
  // Writing to "Suite 200" writes to a tenant, not the owner. Same reason
  // index.html refuses to measure or photograph these.
  for (const address of [
    "500 Market St Ste 200, Boise, ID",
    "42 Oak Blvd SPC 12, Boise, ID",
    "1234 Main St #45, Boise, ID",
    "6728 W Fairview Ave Trailer 51, Boise, ID",
  ]) {
    assert.equal(isTargetable(row({ address })), false, address);
  }
  assert.equal(isTargetable(row({ address: "6728 W Fairview Ave, Boise, ID" })), true);
});

test("market and type are matched exactly, never loosely", () => {
  // `market` is canonicalized by marketOf() on both sides, so an exact match
  // is the contract. A fuzzy match here would write to Meridian owners about
  // a Boise campaign.
  const rows = [
    row(),
    row({ address: "1 A St, Meridian, ID", market: "Meridian, ID" }),
    row({ address: "2 B St, Boise, ID", property_type: "Office" }),
  ];
  const out = selectTargets(rows, { market: "Boise, ID", type: "Industrial" });
  assert.deepEqual(out.map((r) => r.address), ["1210 N 17th St, Boise, ID"]);
});

test("one building that traded twice is one target, and it is the newer deal", () => {
  const rows = [
    row({ deal_date: "2024-01-01", source_url: "old" }),
    row({ address: "1210 n 17th st, boise, id", deal_date: "2026-03-01", source_url: "new" }),
  ];
  const out = selectTargets(rows, { market: "Boise, ID", type: "Industrial" });
  assert.equal(out.length, 1, "the same building under different casing is still one message");
  assert.equal(out[0].source_url, "new", "the owner remembers the recent deal");
});

test("an already-contacted address is skipped", () => {
  const rows = [row(), row({ address: "77 Vista Ave, Boise, ID" })];
  const out = selectTargets(rows, {
    market: "Boise, ID", type: "Industrial",
    seen: ["1210 N 17TH ST, BOISE, ID"],   // same building, different casing
  });
  assert.deepEqual(out.map((r) => r.address), ["77 Vista Ave, Boise, ID"]);
});

test("targets come back newest first and respect the limit", () => {
  const rows = [
    row({ address: "1 A St, Boise, ID", deal_date: "2024-05-01" }),
    row({ address: "2 B St, Boise, ID", deal_date: "2026-05-01" }),
    row({ address: "3 C St, Boise, ID", deal_date: "2025-05-01" }),
  ];
  const out = selectTargets(rows, { market: "Boise, ID", type: "Industrial", limit: 2 });
  assert.deepEqual(out.map((r) => r.address), ["2 B St, Boise, ID", "3 C St, Boise, ID"]);
});

test("garbage in produces an empty list, not a throw", () => {
  assert.deepEqual(selectTargets(null, { market: "Boise, ID" }), []);
  assert.deepEqual(selectTargets([null, undefined, {}], { market: "Boise, ID" }), []);
  assert.equal(isTargetable(null), false);
  assert.equal(addressKeyOf(null), "");
});

// --- what the message says ----------------------------------------------

const report = {
  comps: [
    { transaction: "Sale" }, { transaction: "Sale" }, { transaction: "Sale" },
    { transaction: "Lease" },
  ],
};

test("the message describes the report that was actually run", () => {
  // Counted from the report in hand, never estimated: the entire premise is
  // that the thing being described already exists.
  assert.equal(reportLine(report), "3 sales and 1 lease");
  assert.equal(reportLine({ comps: [{ transaction: "Sale" }] }), "1 sale");
  assert.equal(reportLine({ comps: [] }), "");
  assert.equal(reportLine(null), "");
});

test("the draft leads with the link and says it opens without a signup", () => {
  const { subject, body } = renderEmail({
    address: "1210 N 17th St, Boise, ID", city: "Boise", type: "Industrial",
    url: "https://compninja.co/r/abc123", report, from: "Owen",
  });
  assert.match(subject, /1210 N 17th St/);
  assert.match(body, /https:\/\/compninja\.co\/r\/abc123/);
  assert.match(body, /without a signup/, "a link that looks like a signup wall does not get clicked");
  assert.match(body, /3 sales and 1 lease/);
  assert.ok(body.indexOf("https://compninja.co/r/abc123") < body.indexOf("wrong"),
    "say what it is before asking for anything");
});

test("the draft asks for a correction, not a meeting", () => {
  const { body } = renderEmail({ address: "1 A St", url: "u", report, from: "Owen" });
  assert.match(body, /which one/, "a question answerable in one line by someone who knows the market");
  assert.equal(/call|meeting|demo|hop on|15 minutes/i.test(body), false,
    "asking for time is a bigger ask than asking for a correction");
});

test("the draft never claims a brokerage or an appraisal", () => {
  // The site's standing rule reaches outbound mail exactly as it reaches every
  // page: we connect owners with brokers, and every figure is an estimate.
  const { body } = renderEmail({ address: "1 A St", city: "Boise", type: "Industrial", url: "u", report });
  assert.match(body, /automated estimate/);
  assert.match(body, /not an appraisal/);
  assert.equal(/\bmy brokerage\b|\bour brokerage\b|\bwe are brokers\b|\bappraised\b/i.test(body), false);
});

test("a report with no comps still produces a truthful message", () => {
  const { body } = renderEmail({ address: "1 A St", city: "Boise", type: "Industrial", url: "u", report: { comps: [] } });
  assert.equal(/\b0 sales\b|\bundefined\b|\bNaN\b/.test(body), false,
    "an empty report must not describe itself with a zero or a blank");
  assert.match(body, /recent Boise industrial activity/);
});

// --- the two things the live corpus broke on ------------------------------

test("the same building written two ways is one target", () => {
  // Both pairs are real rows in the Boise industrial corpus on 2026-08-13.
  // Without the ZIP strip, two of the top ten targets were duplicates of the
  // other two: two messages to one owner about one building.
  assert.equal(
    addressKeyOf("873 E Citation Ct, Boise, ID 83716"),
    addressKeyOf("873 E. Citation Ct., Boise, ID"));
  assert.equal(
    addressKeyOf("1002 Avenue of the Oaks, Boise, ID 83709"),
    addressKeyOf("1002 Avenue of the Oaks, Boise, ID"));
  // A ZIP+4 too, and only at the END — a street number must survive.
  assert.equal(addressKeyOf("1 A St, Boise, ID 83702-1234"), "1 a st boise id");
  assert.equal(addressKeyOf("83702 N Main St, Boise, ID"), "83702 n main st boise id");
});

test("deal dates sort by when the deal happened, not alphabetically", () => {
  // The corpus stores display forms. As strings, "Sep 2025" beats "Nov 2025"
  // and every 2026 deal sorts below every 2025 one, which is exactly what the
  // first live run printed.
  assert.ok(dealDateValue("Nov 2025") > dealDateValue("Sep 2025"));
  assert.ok(dealDateValue("Jun 2026") > dealDateValue("Nov 2025"));
  assert.ok(dealDateValue("2026-04-01") > dealDateValue("Dec 2025"));
  assert.ok(dealDateValue("Q3 2025") > dealDateValue("Q1 2025"));
  assert.ok(dealDateValue("9/2025") > dealDateValue("3/2025"));
  // Unparseable sorts LAST rather than reading as ancient or throwing.
  assert.equal(dealDateValue(""), -Infinity);
  assert.equal(dealDateValue("undisclosed"), -Infinity);
  const rows = [
    { market: "Boise, ID", property_type: "Industrial", address: "1 A St, Boise, ID", deal_date: "Sep 2025", source_type: "listing" },
    { market: "Boise, ID", property_type: "Industrial", address: "2 B St, Boise, ID", deal_date: "Jun 2026", source_type: "listing" },
    { market: "Boise, ID", property_type: "Industrial", address: "3 C St, Boise, ID", deal_date: "Nov 2025", source_type: "listing" },
  ];
  assert.deepEqual(
    selectTargets(rows, { market: "Boise, ID", type: "Industrial" }).map((r) => r.address),
    ["2 B St, Boise, ID", "3 C St, Boise, ID", "1 A St, Boise, ID"]);
});

// ---------------------------------------------------------------------------
// The unit-designator rule, in BOTH directions
//
// The copy that used to live in outreach-draft.js was written loose — a keyword
// followed by any word — so it refused "500 Lot Ave", "900 Building Materials
// Way" and "100 Space Center Blvd", and because FL is a state abbreviation it
// refused EVERY Florida address in the corpus. Silently: a refusal here only
// means a building is never written to, so nothing reported it.
//
// The must-PASS half is the half that was missing. CLAUDE.md records that
// index.html's copy needed exactly this, after "Roomy", "Lotus" and "United
// Nations" all parsed as unit designators on the first pass.
// ---------------------------------------------------------------------------

const { unitDesignatorOf, UNIT_KEYWORDS } = require("../outreach-draft");

test("an ordinary property is targetable, whatever its street or state is called", () => {
  const ordinary = [
    // FL is a state, not a floor. This is the whole of Florida.
    "873 E Citation Ct, Miami, FL 33101",
    "1450 NW 20th St, Fort Lauderdale, FL 33311",
    "900 Building Materials Way, Tampa, FL 33602",
    // Street names that merely start with a keyword.
    "500 Lot Ave, Dallas, TX 75201",
    "100 Space Center Blvd, Houston, TX 77058",
    "100 Roomy Lane, Boise, ID",
    "12 Lotus Dr, Miami, FL 33101",
    "3 Ste Genevieve Ave, St Louis, MO 63101",
    "873 E Citation Ct, Boise, ID 83716",
  ];
  for (const address of ordinary) {
    assert.equal(unitDesignatorOf(address), null, address);
    assert.equal(isTargetable(row({ address })), true, address);
  }
});

test("an address naming one unit of a site is still refused", () => {
  const units = [
    ["6728 W Fairview Ave Trailer 51, Boise, ID", "Trailer 51"],
    ["123 Main St Apt 3B, Boise, ID 83702", "Apt 3B"],
    ["500 Oak Ave Ste 200, Dallas, TX 75201", "Ste 200"],
    ["77 Bay St #45, Miami, FL 33101", "#45"],
    // A real floor still matches once the state/ZIP tail is gone — which is
    // what makes stripping the tail safe rather than a blanket FL exemption.
    ["500 Main St Fl 3, Miami, FL 33101", "Fl 3"],
  ];
  for (const [address, want] of units) {
    assert.equal(String(unitDesignatorOf(address)).toLowerCase(), want.toLowerCase(), address);
    assert.equal(isTargetable(row({ address })), false, address);
  }
});

test("the two copies of the unit vocabulary agree", () => {
  // index.html cannot require this module and this module cannot be served to
  // the browser, so the pair is kept honest by a test — the ORG.SHOP_COPY
  // precedent. Drift here means a building we photograph but never write to,
  // or the reverse.
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = /var UNIT_KEYWORDS = ([\s\S]*?);\n/.exec(html);
  assert.ok(m, "index.html should still declare UNIT_KEYWORDS");
  // Evaluate the concatenation rather than string-matching its line breaks.
  const theirs = new Function("return " + m[1])();
  assert.equal(UNIT_KEYWORDS, theirs,
    "outreach-draft.js and index.html must name the same unit keywords");

  // And the regex literal in this file must actually use that list.
  const src = fs.readFileSync(path.join(__dirname, "..", "outreach-draft.js"), "utf8");
  const re = /const UNIT_DESIGNATOR_RE =\s*\n?\s*\/([\s\S]*?)\/i;/.exec(src);
  assert.ok(re, "outreach-draft.js should still declare UNIT_DESIGNATOR_RE as a literal");
  assert.ok(re[1].includes(UNIT_KEYWORDS),
    "the regex literal must embed UNIT_KEYWORDS verbatim, or the two drift inside one file");
});
