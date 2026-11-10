// market-build.js — building a market from the /markets filter box
// (2026-10-13) and from the Market Explorer form above it (2026-11-10). The
// pure helpers: which offer a query earns, what the form was given, the
// event-stream reader, and the progress wording.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const MB = require("../market-build.js");
const { parseExploreQuery } = require("../explore-query.js");
const SNAP = require("../market-snapshot.js");

const existing = new Set(["industrial-boise-id", "office-dallas-tx"]);
const offer = (q, shown = 0) => MB.offerFor(q, parseExploreQuery, existing, shown);

test("a market with no card earns a build offer naming it", () => {
  assert.deepEqual(offer("industrial Twin Falls ID"),
    { kind: "build", type: "Industrial", city: "Twin Falls", state: "ID" });
  // The Explorer's parser, so its synonyms and full state names work here too.
  assert.deepEqual(offer("warehouse twin falls idaho"),
    { kind: "build", type: "Industrial", city: "Twin Falls", state: "ID" });
});

test("a market that already has a card earns nothing", () => {
  assert.equal(offer("industrial Boise ID", 1), null);
  assert.equal(offer("Industrial boise, id", 1), null);
});

test("a city without a type offers only the types it has no page for", () => {
  assert.deepEqual(offer("Boise ID", 1),
    { kind: "types", city: "Boise", state: "ID", types: ["Office", "Retail", "Multifamily"] });
  const all = new Set(MB.TYPES.map((t) => MB.slugFor(t, "Boise", "ID")));
  assert.equal(MB.offerFor("Boise ID", parseExploreQuery, all, 4), null);
});

test("hints show only when the filter found nothing", () => {
  assert.equal(offer("", 0), null);
  assert.equal(offer("Boise", 1), null, "a search that matched a card is a search that worked");
  assert.match(offer("industrial Twin Falls", 0).text, /add the state/);
  assert.match(offer("warehouse 83301", 0).text, /city and state/);
  assert.match(offer("land Boise ID", 0).text, /Industrial, Office, Retail and Multifamily/);
  // The filter's own example parses to no city, and must offer nothing.
  assert.equal(offer("warehouse Texas", 3), null);
  assert.equal(offer("Texas", 0), null);
});

test("no parser, no offer: it never guesses", () => {
  assert.equal(MB.offerFor("industrial Twin Falls ID", null, existing, 0), null);
});

test("slugFor matches market-snapshot.js's slugify (⚠ pair)", () => {
  for (const [t, c, s] of [["Industrial", "Twin Falls", "ID"], ["Office", "Coeur D'Alene", "ID"], ["Retail", "St. Louis", "MO"]]) {
    assert.equal(MB.slugFor(t, c, s), SNAP.slugify(t, c, s));
  }
});

test("parseSse returns whole events and keeps a partial one", () => {
  const pad = ":" + " ".repeat(20) + "\n\n";
  const a = MB.parseSse(pad + 'event: progress\ndata: {"phase":"start"}\n\nevent: res');
  assert.deepEqual(a.events, [{ event: "progress", data: { phase: "start" } }]);
  assert.equal(a.rest, "event: res");
  const b = MB.parseSse(a.rest + 'ult\ndata: {"url":"/market/x"}\n\n');
  assert.deepEqual(b.events, [{ event: "result", data: { url: "/market/x" } }]);
  assert.equal(b.rest, "");
});

test("progress wording", () => {
  assert.equal(MB.progressOf({ phase: "start" }, 0).head, "Searching recent sales…");
  assert.equal(MB.progressOf({ phase: "comp" }, 1).detail, "1 recent sale found");
  assert.equal(MB.progressOf({ phase: "comp" }, 3).detail, "3 recent sales found");
  assert.ok(MB.progressOf({ phase: "drafting", chars: 1e6 }, 0).pct <= 95);
  assert.deepEqual(MB.progressOf(null, 0), {});
});

test("the Market Explorer form reads a city and state, with the menu's type", () => {
  const look = (q, type = "Office") => MB.resolveLookup(q, type, parseExploreQuery);
  assert.deepEqual(look("Tulsa, OK"), { type: "Office", city: "Tulsa", state: "OK" });
  assert.deepEqual(look("  tulsa   oklahoma "), { type: "Office", city: "Tulsa", state: "OK" });
  assert.deepEqual(look("New York, NY", "retail"), { type: "Retail", city: "New York", state: "NY" });
  assert.deepEqual(look("coeur d'alene id", "Multifamily"), { type: "Multifamily", city: "Coeur D'Alene", state: "ID" });
  // A type typed into the box wins over the menu, as the Explorer always read it.
  assert.deepEqual(look("warehouse Tulsa OK"), { type: "Industrial", city: "Tulsa", state: "OK" });
});

test("the Market Explorer form asks again rather than guessing", () => {
  const err = (q, type = "Office") => MB.resolveLookup(q, type, parseExploreQuery).error;
  assert.match(err(""), /city and state/);
  assert.match(err("Tulsa"), /Add the state/);
  assert.match(err("Oklahoma"), /city and state/);
  assert.match(err("74103"), /zip code/);
  assert.match(err("123 Main St, Boise, ID"), /street address/);
  assert.match(err("land Tulsa OK"), /Industrial, Office, Retail and Multifamily/);
  // A type the route does not build is never passed through from the menu.
  assert.match(err("Tulsa, OK", "Land"), /Pick a property type/);
  assert.match(err("Tulsa, OK", ""), /Pick a property type/);
  // No parser, no search: the same rule as the offer.
  assert.match(MB.resolveLookup("Tulsa, OK", "Office", null).error, /Reload/);
  // Every refusal is a sentence and nothing else: no market to build.
  for (const q of ["", "Tulsa", "74103", "land Tulsa OK"]) {
    assert.deepEqual(Object.keys(MB.resolveLookup(q, "Office", parseExploreQuery)), ["error"]);
  }
});

test("the browser half builds with textContent, never innerHTML", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "market-build.js"), "utf8");
  assert.ok(!/innerHTML/.test(src));
  assert.ok(!/sendBeacon|XMLHttpRequest/.test(src), "a member page writes only through fetch (never-break rule 15)");
});
