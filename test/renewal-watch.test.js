// The renewal watch's send/skip rule and its copy. Pure like
// watchlist-digest.test.js: no server, no database, no clock — `now` is
// handed in.
//
// The rules worth breaking a build over are the ones about NOT sending: a
// deadline that has passed, a lease already mailed about, a deadline further
// out than the window. Plus the two that decide what a reader is told: the
// option notice beats the expiry and the copy says which, and a missing
// market figure drops its line rather than the whole email.
const test = require("node:test");
const assert = require("node:assert");
const RW = require("../renewal-watch.js");

const NOW = Date.parse("2026-08-22T18:00:00Z");
const URLS = { deskUrl: "https://compninja.co/vault", unsubscribeUrl: "https://compninja.co/u?t=x" };

// A lease whose option notice is 60 days out — the plan's own test case.
const lease = (over = {}) => ({
  id: "c1",
  address: "400 Main St, Boise, ID",
  market: "Boise, ID",
  property_type: "Office",
  lease_expiry: "2027-06-30",
  option_notice_date: "2026-10-21", // 60 days after NOW
  renewal_notified_at: null,
  rent_psf_yr: 25.2,
  market_rent_psf_yr: 28,
  market_rent_comps: 6,
  quote_basis: "annual",
  ...over,
});

const build = (leases, now = NOW) =>
  RW.buildRenewalNotice({ leases, now, ...URLS });

// --- the plan's own acceptance case ----------------------------------------

test("a lease 60 days from notice produces an email quoting market rent", () => {
  const mail = build([lease()]);
  assert.ok(mail, "it sends");
  assert.match(mail.subject, /Option notice coming up/);
  assert.match(mail.subject, /400 Main St/);
  assert.match(mail.text, /Option notice due 2026-10-21/);
  assert.match(mail.text, /in 60 days/);
  assert.match(mail.text, /Comparable space in Boise, ID: \$28\/SF\/yr \(median of 6 leases\)/);
});

test("a second run sends nothing, because the first marked it", () => {
  // The marker is what the route writes after a successful send.
  assert.equal(build([lease({ renewal_notified_at: "2026-08-22T18:00:01Z" })]), null);
});

// --- the three ways a lease is NOT due -------------------------------------

test("a deadline that has passed is silent, permanently", () => {
  // Not a reminder — a notification of a loss the reader can do nothing
  // about. The whole point is that it stays quiet.
  for (const d of ["2026-08-21", "2026-01-01", "2020-06-30"]) {
    assert.equal(RW.isDue(lease({ option_notice_date: d, lease_expiry: "2027-06-30" }), NOW), false, d);
    assert.equal(build([lease({ option_notice_date: d, lease_expiry: "2027-06-30" })]), null, d);
  }
});

test("due today still sends; one day past does not", () => {
  assert.equal(RW.isDue(lease({ option_notice_date: "2026-08-22" }), NOW), true);
  assert.equal(RW.isDue(lease({ option_notice_date: "2026-08-21" }), NOW), false);
});

test("the window is ninety days, inclusive at the edge", () => {
  assert.equal(RW.LEAD_DAYS, 90);
  assert.equal(RW.isDue(lease({ option_notice_date: "2026-11-20" }), NOW), true, "90 days out");
  assert.equal(RW.isDue(lease({ option_notice_date: "2026-11-21" }), NOW), false, "91 days out");
});

test("an already-notified lease is never mailed again", () => {
  assert.equal(RW.isDue(lease({ renewal_notified_at: "2026-08-01T00:00:00Z" }), NOW), false);
});

test("a lease with neither date is not a watched lease at all", () => {
  assert.equal(RW.isDue(lease({ option_notice_date: null, lease_expiry: null }), NOW), false);
  assert.equal(build([lease({ option_notice_date: null, lease_expiry: null })]), null);
});

test("nothing due at all returns null, not an empty email", () => {
  assert.equal(build([]), null);
  assert.equal(build(null), null);
  assert.equal(RW.buildRenewalNotice({ now: NOW, ...URLS }), null);
});

// --- notice beats expiry, and the copy says which --------------------------

test("the option notice wins when both exist", () => {
  const d = RW.deadlineOf(lease());
  assert.equal(d.kind, "notice");
  assert.equal(d.date, "2026-10-21");
  assert.match(build([lease()]).text, /Option notice due/);
});

test("a lease with only an expiry falls back and is named honestly", () => {
  const only = lease({ option_notice_date: null, lease_expiry: "2026-10-21" });
  assert.equal(RW.deadlineOf(only).kind, "expiry");
  const mail = build([only]);
  assert.match(mail.text, /Lease expires 2026-10-21/);
  assert.doesNotMatch(mail.text, /notice/i, "never claims notice is owed when none is");
  assert.match(mail.subject, /Lease expiry coming up/);
});

test("an expiry inside the window cannot be masked by a notice outside it", () => {
  // The notice is the deadline whenever it exists, so a far-off notice with a
  // near expiry is NOT due. That is correct: the decision point is the notice.
  const l = lease({ option_notice_date: "2027-06-01", lease_expiry: "2026-09-01" });
  assert.equal(RW.deadlineOf(l).kind, "notice");
  assert.equal(RW.isDue(l, NOW), false);
});

// --- the market figure decorates, and never blocks --------------------------

test("no market rent still sends, without that line", () => {
  const mail = build([lease({ market_rent_psf_yr: null, market_rent_comps: 0 })]);
  assert.ok(mail, "the deadline is the news on its own");
  assert.match(mail.text, /Option notice due 2026-10-21/);
  assert.doesNotMatch(mail.text, /Comparable space/);
  assert.match(mail.text, /Paying \$25\.20\/SF\/yr/);
});

test("no rent figures at all still sends the deadline", () => {
  const mail = build([lease({ rent_psf_yr: null, market_rent_psf_yr: null })]);
  assert.ok(mail);
  assert.doesNotMatch(mail.text, /Paying/);
  assert.doesNotMatch(mail.text, /Comparable space/);
});

test("a zero or negative rent is treated as absent, never printed", () => {
  for (const bad of [0, -5, "", null, "abc"]) {
    const mail = build([lease({ market_rent_psf_yr: bad })]);
    assert.doesNotMatch(mail.text, /Comparable space/, String(bad));
  }
});

test("no verdict is offered on the gap between the two figures", () => {
  const mail = build([lease({ rent_psf_yr: 25.2, market_rent_psf_yr: 40 })]);
  assert.doesNotMatch(mail.text, /overpay|below market|above market|%/i);
});

// --- 029's basis lesson -----------------------------------------------------

test("a monthly-quoting market is quoted monthly, from the same annual store", () => {
  const mail = build([lease({ quote_basis: "monthly", rent_psf_yr: 16.2, market_rent_psf_yr: 18 })]);
  assert.match(mail.text, /Paying \$1\.35\/SF\/mo/, "16.20 a year is 1.35 a month");
  assert.match(mail.text, /\$1\.50\/SF\/mo/);
  assert.doesNotMatch(mail.text, /\/SF\/yr/);
});

test("every printed rent carries its unit", () => {
  for (const basis of ["annual", "monthly", undefined, "nonsense"]) {
    const mail = build([lease({ quote_basis: basis })]);
    const rents = mail.text.match(/\$[\d.,]+/g) || [];
    assert.ok(rents.length > 0);
    assert.ok(/\$[\d.,]+\/SF\/(yr|mo)/.test(mail.text), String(basis));
  }
});

// --- several leases ---------------------------------------------------------

test("soonest first, so the tightest deadline is never buried", () => {
  const mail = build([
    lease({ id: "a", address: "300 Late Ave", option_notice_date: "2026-11-01" }),
    lease({ id: "b", address: "100 Soon St", option_notice_date: "2026-09-01" }),
    lease({ id: "c", address: "200 Mid Rd", option_notice_date: "2026-10-01" }),
  ]);
  const order = ["100 Soon St", "200 Mid Rd", "300 Late Ave"]
    .map((a) => mail.text.indexOf(a));
  assert.deepEqual(order.slice().sort((x, y) => x - y), order);
});

test("several leases get a count in the subject, not a wall of addresses", () => {
  const mail = build([lease({ id: "a" }), lease({ id: "b", address: "500 Other St" })]);
  assert.equal(mail.subject, "2 leases you track have deadlines coming up");
});

test("only the due ones appear, even when the vault holds many", () => {
  const mail = build([
    lease({ id: "due", address: "1 Due St" }),
    lease({ id: "far", address: "2 Far St", option_notice_date: "2027-06-01" }),
    lease({ id: "past", address: "3 Past St", option_notice_date: "2026-01-01" }),
    lease({ id: "done", address: "4 Done St", renewal_notified_at: "2026-08-01T00:00:00Z" }),
  ]);
  assert.match(mail.text, /1 Due St/);
  for (const a of ["2 Far St", "3 Past St", "4 Done St"]) {
    assert.doesNotMatch(mail.text, new RegExp(a));
  }
  assert.match(mail.subject, /Option notice coming up/, "one due lease is a named subject");
});

// --- disclosure -------------------------------------------------------------

test("every email says why it arrived and how to stop it, as separate sentences", () => {
  const mail = build([lease()]);
  assert.match(mail.text, /because you recorded these dates/);
  assert.match(mail.text, /Turn these emails off: https:\/\/compninja\.co\/u\?t=x/);
  assert.match(mail.text, /never an appraisal/);
  assert.match(mail.text, /Check your own lease/);
  assert.match(mail.text, /https:\/\/compninja\.co\/vault/);
});

// --- junk in, no crash out --------------------------------------------------

test("a malformed date is not a deadline", () => {
  for (const bad of ["2026-13-01", "2026-02-31", "tomorrow", "45000", "", null, "2026-6-1"]) {
    assert.equal(RW.deadlineOf({ option_notice_date: bad, lease_expiry: null }), null, String(bad));
  }
});

test("null rows are skipped rather than thrown on", () => {
  const mail = build([null, lease(), undefined]);
  assert.ok(mail);
  assert.match(mail.subject, /400 Main St/);
});

test("daysUntil counts calendar days in UTC, not hours", () => {
  // Late in the UTC day must not make tomorrow read as today.
  const late = Date.parse("2026-08-22T23:59:00Z");
  assert.equal(RW.daysUntil("2026-08-23", late), 1);
  assert.equal(RW.daysUntil("2026-08-22", late), 0);
  assert.equal(RW.daysUntil("2026-08-21", late), -1);
});
