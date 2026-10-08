// report-inbox.js — what Messages' Reports view lists (2026-10-08).
//
// These are the rules the Sharing card on Home's Reports tab was held to,
// carried over when its three lists moved into Messages (the shelf's tests
// in test/org-desk.test.js, retired the same day, are restated here against
// the pure module). Every row is a claim about who sent what to whom, so the
// rules are tested rather than eyeballed.

const test = require("node:test");
const assert = require("node:assert");
const RI = require("../report-inbox.js");

const REPORT = (o) => Object.assign({
  id: "s1", address: "1210 N 17th St, Boise, ID", type: "Industrial", from: "Brad Keller",
  url: "/r/s1", invitedAt: "2026-10-02T10:00:00Z", viewedAt: "2026-10-03T10:00:00Z",
}, o);
// A deal room as GET /api/messages lists it under External.
const ROOM = (o) => Object.assign({
  id: "h1", owner: false, title: "1210 N 17th St, Boise, ID", label: "Brad Keller",
  people: [{ email: "brad@foothill.example", name: "Brad Keller" }], closed: false,
}, o);
const LINK = (o) => Object.assign({
  id: "l1", address: "77 E Fairview Ave", type: "Retail", visibility: "public", orgId: "",
  firm: "", createdAt: "2026-09-27T00:00:00Z", url: "/r/l1", viewers: [],
}, o);
const ITEM = (o) => Object.assign({
  id: "f1", address: "500 Warehouse Way", market: "Boise, ID", type: "Industrial",
  sharedBy: "Brad", mine: false, url: "/r/abc", createdAt: "2026-03-14T00:00:00Z",
}, o);

// ---- Sent to you -------------------------------------------------------------

test("a report sent to you and the deal room opened from it are ONE row, with two doors", () => {
  const rows = RI.received([REPORT({}), REPORT({ id: "s2", address: "2750 S Cole Rd, Boise, ID", invitedAt: "2026-09-24T10:00:00Z" })],
    [ROOM({})]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, "1210 N 17th St, Boise, ID");
  assert.deepEqual(rows[0].room, { id: "h1", closed: false }, "one row, both doors");
  assert.equal(rows[1].room, null);
  // The address match ignores punctuation and case.
  assert.ok(RI.received([REPORT({})], [ROOM({ title: "1210 n. 17th st boise id" })])[0].room);
  // A different sender is a different conversation.
  assert.equal(RI.received([REPORT({})], [ROOM({ people: [{ name: "Erin Walsh" }] })])[0].room, null, "two senders, no merge");
  // A room the reader opened themselves cannot have come from a report sent to them.
  assert.equal(RI.received([REPORT({})], [ROOM({ owner: true })])[0].room, null);
  // One room joins one report.
  const twice = RI.received([REPORT({}), REPORT({ id: "s9" })], [ROOM({})]);
  assert.equal(twice.filter((r) => r.room).length, 1);
});

test("a deal room with no report is a chat, and is not listed among the reports", () => {
  const rows = RI.received([], [ROOM({ title: "Overland co-broke" })]);
  assert.deepEqual(rows, [], "Chats lists it already; a second row here would be the same room twice");
});

test("New means a report not yet opened, and an answer without the field never lights a row", () => {
  assert.equal(RI.received([REPORT({ viewedAt: null })], [])[0].isNew, true, "never opened");
  assert.equal(RI.received([REPORT({})], [])[0].isNew, false, "opened");
  assert.equal(RI.received([REPORT({ viewedAt: undefined })], [])[0].isNew, false,
    "an older answer without the field must not light every row up");
});

test("Sent to you is newest first and says who sent each one", () => {
  const rows = RI.received([REPORT({ id: "old", invitedAt: "2026-09-01T00:00:00Z" }), REPORT({ id: "new", invitedAt: "2026-10-05T00:00:00Z", from: "Erin Walsh" })], []);
  assert.deepEqual(rows.map((r) => r.id), ["new", "old"]);
  assert.equal(rows[0].from, "Erin Walsh");
  assert.deepEqual(RI.received(null, null), []);
});

// ---- Sent by you ---------------------------------------------------------------

test("Sent by you lists what this member sent, minus the shares on the shelf they can see", () => {
  const rows = RI.sent([
    LINK({ id: "a", address: "500 Warehouse Way", visibility: "org", orgId: "o1", firm: "Foothill Commercial", createdAt: "2026-10-04T00:00:00Z" }),
    LINK({ id: "b", address: "9 Old Firm Rd", visibility: "org", orgId: "o-old", firm: "Basin Partners", createdAt: "2026-10-03T00:00:00Z" }),
    LINK({ id: "c", address: "1210 N 17th St", visibility: "invited", createdAt: "2026-10-02T00:00:00Z",
      viewers: [{ email: "j@acme.com", firstViewedAt: "2026-10-03T00:00:00Z" }, { email: "o@acme.com" }] }),
    LINK({ id: "d" }),
    LINK({ id: "e", address: "6200 W Emerald St", revokedAt: "2026-09-10T00:00:00Z", createdAt: "2026-09-06T00:00:00Z" }),
  ], "o1");
  assert.deepEqual(rows.map((r) => r.id), ["b", "c", "d", "e"], "a share on this member's own shelf is listed there, not twice; newest first");
  assert.equal(rows[0].audience.label, "Shared with Basin Partners", "a left firm's share stays: the only place left to turn it off");
  assert.deepEqual(rows[1].audience, { label: "2 people", sub: "1 opened it" });
  assert.equal(rows[2].audience.label, "Anyone with the link");
  assert.equal(rows[3].audience.label, "Turned off", "turned off wins over who it was for");
  assert.equal(rows[3].revoked, true);
  assert.deepEqual(rows[1].viewers, [{ email: "j@acme.com", openedAt: "2026-10-03T00:00:00Z" }, { email: "o@acme.com", openedAt: "" }]);
});

test("a member of no firm sees their firm shares in Sent by you, named for the firm", () => {
  const rows = RI.sent([LINK({ visibility: "org", orgId: "o1", firm: "Foothill Commercial" })], "");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].audience.label, "Shared with Foothill Commercial");
  assert.equal(RI.audience({ visibility: "org" }).label, "Shared with your firm");
  assert.deepEqual(RI.audience({ visibility: "invited", viewers: [{ email: "a@b.co" }] }), { label: "1 person", sub: "Not opened yet" });
  assert.deepEqual(RI.audience({ visibility: "invited", viewers: [] }), { label: "0 people", sub: "" });
  assert.equal(RI.audience({ visibility: "public" }).label, "Anyone with the link",
    "never a firm share reading as public, never a public link reading as private");
});

// ---- The firm's shelf ----------------------------------------------------------------

test("the shelf's header count describes the WHOLE shelf, never the filtered view", () => {
  const items = [ITEM({}), ITEM({ id: "f2", address: "2 B St", market: "Meridian, ID" })];
  const all = RI.shelf(items);
  assert.equal(all.total, 2, "the heading counts the whole shelf");
  assert.equal(all.count, "", "nothing is being filtered, so nothing is counted");
  const some = RI.shelf(items, { q: "warehouse" });
  assert.equal(some.total, 2, "the heading count must not follow the filter");
  assert.equal(some.count, "1 of 2", "the filtered count is stated separately, so nothing is silently hidden");
  assert.equal(some.rows.length, 1);
});

test("an empty shelf and a search with no hits are told apart", () => {
  const miss = RI.shelf([ITEM({})], { q: "nothing like this" });
  assert.equal(miss.noMatch, true);
  assert.equal(miss.total, 1, "a search with no hits must not read as the firm having shared nothing");
  const empty = RI.shelf([], { q: "anything" });
  assert.equal(empty.noMatch, false);
  assert.equal(empty.total, 0);
});

test("the type filter and the search box narrow together", () => {
  const items = [ITEM({ type: "Land", address: "40 acres, Kuna", market: "Kuna, ID" }),
    ITEM({ id: "f2", type: "Land", address: "80 acres, Nampa", market: "Nampa, ID" }), ITEM({ id: "f3" })];
  const v = RI.shelf(items, { q: "nampa", type: "Land" });
  assert.equal(v.rows.length, 1);
  assert.equal(v.count, "1 of 3");
  assert.equal(RI.shelf(items, { q: "nothing here", type: "Land" }).noMatch, true);
  assert.equal(RI.shelf(items, { q: "brad" }).rows.length, 3, "the sharer's name is searchable");
});

test("your own share is on the shelf, and marked as yours", () => {
  const [row] = RI.shelf([ITEM({ mine: true, sharedBy: "Brad" })]).rows;
  assert.equal(row.mine, true, "the page says 'shared by you', and offers Take down on this row only");
});

test("the shelf's filter is furniture under six reports", () => {
  assert.equal(RI.MIN_FILTER, 6);
  assert.equal(RI.shelf([ITEM({}), ITEM({ id: "f2" })]).filters, false);
  assert.equal(RI.shelf(Array.from({ length: 6 }, (_, i) => ITEM({ id: "f" + i }))).filters, true);
});

test("the shelf opens on the firm's saved view only while its filter shows, and never over a reader's own pick", () => {
  // A development shop's saved view is Land (org-access.js SHOP_COPY).
  assert.equal(RI.shelfType({ total: 6, saved: "Land" }), "Land", "§6's saved view");
  assert.equal(RI.shelfType({ total: 6, saved: "" }), "", "a broker shop (or a withdrawn kind) opens on everything");
  assert.equal(RI.shelfType({ total: 3, saved: "Land" }), "",
    "cleared, not merely hidden: a hidden control quietly hiding rows would make a small shelf look like it lost something");
  assert.equal(RI.shelfType({ total: 6, saved: "Land", touched: true, picked: "" }), "",
    "a default that undoes a person's own click is not a default, it is a fight");
  assert.equal(RI.shelfType({ total: 6, saved: "", touched: true, picked: "Retail" }), "Retail");
  // And the view it opens on says how much it is not showing.
  const six = Array.from({ length: 6 }, (_, i) => ITEM({ id: "f" + i, type: i < 2 ? "Land" : "Industrial" }));
  const v = RI.shelf(six, { type: RI.shelfType({ total: six.length, saved: "Land" }) });
  assert.equal(v.rows.length, 2);
  assert.equal(v.total, 6);
  assert.equal(v.count, "2 of 6");
});

// ---- Search and Discuss --------------------------------------------------------------

test("the search box finds a report by address, type, sender or the people it went to", () => {
  const [inRow] = RI.received([REPORT({})], []);
  assert.equal(RI.matches(inRow, "17th"), true);
  assert.equal(RI.matches(inRow, "brad industrial"), true);
  assert.equal(RI.matches(inRow, "kuna"), false);
  assert.equal(RI.matches(inRow, "  "), true);
  const [outRow] = RI.sent([LINK({ visibility: "invited", viewers: [{ email: "dana@acme.example" }] })], "");
  assert.equal(RI.matches(outRow, "dana@acme"), true);
  assert.equal(RI.matches(outRow, "1 person"), true, "the audience reads as it is shown");
});

test("Discuss sends the report as its LINK, never a copy of it", () => {
  const [row] = RI.shelf([ITEM({ url: "https://compninja.co/r/abc" })]).rows;
  assert.equal(RI.discussText(row), "About the Industrial report on 500 Warehouse Way: https://compninja.co/r/abc",
    "the link, so report-access.js stays the sole decider of who may read it");
  assert.equal(RI.discussText({ address: "1 A St", url: "/r/x" }), "About the report on 1 A St: /r/x");
});
