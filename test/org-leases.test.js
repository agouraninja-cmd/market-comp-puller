// org-leases.js — what may be filed as a firm's lease, and which dates matter
// next. Pure, so every refusal is proved here with no database; the routes
// are proved in test/org-leases-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const L = require("../org-leases");
const RENEWAL = require("../renewal-watch");

const ok = (input, existing) => {
  const r = L.validateLease(input, existing);
  assert.deepEqual(r.errors, [], JSON.stringify(r));
  return r.row;
};
const refused = (input, re, existing) => {
  const r = L.validateLease(input, existing);
  assert.equal(r.row, null, "expected a refusal, got " + JSON.stringify(r.row));
  assert.ok(r.errors.some((e) => re.test(e)), `no error matching ${re}: ${JSON.stringify(r.errors)}`);
};
const BASE = { tenant: "Acme Logistics", leaseExpiry: "2027-06-30" };

test("a lease is a tenant and an expiry; everything else is optional and normalized", () => {
  const row = ok({ ...BASE, tenant: "  Acme   Logistics ", suite: " 200 ", sizeSqft: "12,500 SF", termStart: "2022-07-01",
    optionNoticeDate: "2027-03-31", rentPsf: "$18.50/SF", rentBasis: "yr", leaseType: "triple net", status: "Active", notes: " good tenant " });
  assert.deepEqual(row, {
    tenant: "Acme Logistics", suite: "200", size_sqft: 12500, term_start: "2022-07-01", lease_expiry: "2027-06-30",
    option_notice_date: "2027-03-31", rent_psf: 18.5, rent_basis: "annual", lease_type: "NNN", status: "active", notes: "good tenant",
  });
  assert.equal(ok(BASE).status, "active", "status defaults to active");
  refused({ leaseExpiry: "2027-06-30" }, /tenant is required/);
  refused({ tenant: "Acme" }, /expiry is required/);
});

test("dates are YYYY-MM-DD and on the calendar, nothing else", () => {
  refused({ ...BASE, leaseExpiry: "6/30/2027" }, /YYYY-MM-DD/);
  refused({ ...BASE, leaseExpiry: "2027-02-30" }, /YYYY-MM-DD/, undefined);
  refused({ ...BASE, optionNoticeDate: "March 2027" }, /Option notice must be a date/);
  refused({ ...BASE, termStart: "2027-07-01" }, /Term start .* is after the lease expiry/);
});

test("an option notice after the expiry is refused by name as transposed — the vault's rule, restated", () => {
  refused({ ...BASE, optionNoticeDate: "2027-09-30" }, /after the lease expiry .* look swapped/);
  assert.equal(ok({ ...BASE, optionNoticeDate: "2027-06-30" }).option_notice_date, "2027-06-30", "the same day is allowed");
});

test("a rent needs its basis and the basis is never guessed — 029's rule, restated", () => {
  refused({ ...BASE, rentPsf: "1.35" }, /annual or monthly — it is not guessed/);
  assert.equal(ok({ ...BASE, rentPsf: "1.35", rentBasis: "monthly" }).rent_basis, "monthly");
  refused({ ...BASE, rentPsf: "1.2M", rentBasis: "annual" }, /Rent must be a number/);
  refused({ ...BASE, rentPsf: "18", rentBasis: "weekly" }, /annual or monthly/);
  const noRent = ok({ ...BASE, rentBasis: "annual" });
  assert.equal(noRent.rent_psf, null);
  assert.equal(noRent.rent_basis, "annual", "a basis without a rent is harmless and kept");
});

test("lease type and status are vocabularies", () => {
  for (const [v, want] of [["nnn", "NNN"], ["Full service", "FS"], ["modified gross", "MG"], ["", null]]) {
    assert.equal(ok({ ...BASE, leaseType: v }).lease_type, want);
  }
  refused({ ...BASE, leaseType: "absolute" }, /NNN, FS or MG/);
  for (const s of L.LEASE_STATUSES) assert.equal(ok({ ...BASE, status: s }).status, s);
  refused({ ...BASE, status: "pending" }, /Status must be one of/);
});

test("an edit is validated as the whole row it would become", () => {
  const existing = { tenant: "Acme", suite: null, size_sqft: 12500, term_start: null, lease_expiry: "2027-06-30",
    option_notice_date: "2027-03-31", rent_psf: 18.5, rent_basis: "annual", lease_type: "NNN", status: "active", notes: null };
  const row = ok({ status: "renewed" }, existing);
  assert.equal(row.status, "renewed");
  assert.equal(row.tenant, "Acme", "untouched fields keep their stored value");
  assert.equal(row.rent_psf, 18.5);
  // Moving the expiry BEFORE the stored notice is the transposition again,
  // reached from the other side.
  refused({ leaseExpiry: "2027-01-31" }, /look swapped/, existing);
  // Clearing the basis while a rent stays is refused: the stored rent would
  // become a guess.
  refused({ rentBasis: "" }, /not guessed/, existing);
});

test("criticalDates: the next twelve months, soonest first, with renewal-watch's own arithmetic injected", () => {
  const now = Date.UTC(2026, 8, 2); // 2026-09-02
  const leases = [
    { id: "l1", building_id: "b1", tenant: "Acme", status: "active", lease_expiry: "2027-06-30", option_notice_date: "2026-12-31" },
    { id: "l2", building_id: "b1", tenant: "Beta", status: "active", lease_expiry: "2026-10-01", option_notice_date: null },
    { id: "l3", building_id: "b2", tenant: "Gone", status: "vacated", lease_expiry: "2026-09-15", option_notice_date: null },
    { id: "l4", building_id: "b2", tenant: "Far", status: "active", lease_expiry: "2028-01-01", option_notice_date: null },
    { id: "l5", building_id: "b2", tenant: "Past", status: "active", lease_expiry: "2026-08-01", option_notice_date: null },
    { id: "l6", building_id: "b2", tenant: "Undated", status: "active", lease_expiry: null, option_notice_date: null },
  ];
  const out = L.criticalDates(leases, now, RENEWAL.deadlineOf, RENEWAL.daysUntil, [{ id: "b1", address: "1 A St" }, { id: "b2", address: "2 B St" }]);
  assert.deepEqual(out.map((c) => [c.tenant, c.kind, c.date, c.days]), [
    ["Beta", "expiry", "2026-10-01", 29],
    ["Acme", "notice", "2026-12-31", 120],
  ], "vacated, past, beyond the window and undated are all out; notice beats expiry as the deadline");
  assert.equal(out[0].address, "1 A St");
  assert.equal(out[1].buildingId, "b1");
});

test("criticalDates without the injected arithmetic answers nothing rather than inventing a deadline", () => {
  assert.deepEqual(L.criticalDates([{ id: "l1", tenant: "A", lease_expiry: "2026-10-01" }], Date.now()), []);
});

test("the wire shape is an allowlist and the module is pure", () => {
  const w = L.toLease({ id: "l1", org_id: "o1", building_id: "b1", tenant: "Acme", size_sqft: "12500", lease_expiry: "2027-06-30",
    rent_psf: "18.5", rent_basis: "annual", status: "active", added_by_user_id: "u1", added_by_name: "Brad", secret: "no" }, "u1");
  assert.equal(w.mine, true);
  assert.equal(w.sizeSqft, 12500);
  assert.equal(w.rentPsf, 18.5);
  assert.equal(Object.prototype.hasOwnProperty.call(w, "org_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(w, "secret"), false);
  assert.equal(L.WINDOW_DAYS, 365);
  const src = require("node:fs").readFileSync(require.resolve("../org-leases"), "utf8");
  assert.doesNotMatch(src, /require\(/, "pure: renewal-watch's arithmetic is injected, never required");
  assert.doesNotMatch(src, /Date\.now|new Date\(\)/, "pure: the caller passes now");
});
