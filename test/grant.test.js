// Pure helpers of scripts/grant.js. The script itself talks to a real
// production database, so the parts that decide whether to REFUSE are the
// parts worth pinning — every one of them is a way a comp could land on the
// wrong row quietly.
//
// Requiring the module must also do nothing at all (the require.main guard):
// a tool that reached for the network on import would run against production
// the first time anything required it.

const { test } = require("node:test");
const assert = require("node:assert");

const GRANT = require("../scripts/grant.js");

test("requiring the module performs no work", () => {
  // If the file had run main() on import, loading it above would already have
  // thrown on the missing SUPABASE_URL. Reaching here is the assertion.
  assert.strictEqual(typeof GRANT.parseArgs, "function");
  assert.strictEqual(typeof GRANT.refuseIfBilled, "function");
});

test("nothing is written without --confirm", () => {
  const { opts } = GRANT.parseArgs(["firm", "Adler Industrial"]);
  assert.strictEqual(opts.confirm, false);
  assert.strictEqual(opts.revoke, false);
});

test("--confirm and --revoke are read, and the firm name survives its spaces", () => {
  const { opts, rest } = GRANT.parseArgs(["firm", "Adler Industrial", "--confirm", "--revoke"]);
  assert.strictEqual(opts.confirm, true);
  assert.strictEqual(opts.revoke, true);
  assert.deepStrictEqual(rest, ["firm", "Adler Industrial"]);
});

test("months defaults to six and is read when given", () => {
  assert.strictEqual(GRANT.parseArgs(["pro", "a@b.com"]).opts.months, 6);
  assert.strictEqual(GRANT.parseArgs(["pro", "a@b.com", "--months", "12"]).opts.months, 12);
});

test("an unusable --months is refused rather than defaulted", () => {
  // A typo'd figure must not silently become six months of free product.
  for (const bad of ["0", "-3", "notanumber", "600"]) {
    assert.throws(() => GRANT.parseArgs(["pro", "a@b.com", "--months", bad]), /months/,
      `--months ${bad} should be refused`);
  }
});

test("seats default to untouched, and a fractional or zero count is refused", () => {
  assert.strictEqual(GRANT.parseArgs(["firm", "X"]).opts.seats, null);
  assert.strictEqual(GRANT.parseArgs(["firm", "X", "--seats", "10"]).opts.seats, 10);
  for (const bad of ["0", "2.5", "-1"]) {
    assert.throws(() => GRANT.parseArgs(["firm", "X", "--seats", bad]), /seats/);
  }
});

test("an unknown flag is refused, never ignored", () => {
  // The dangerous version of this is a typo'd --confirm being dropped and the
  // run reading as a dry run that already wrote.
  assert.throws(() => GRANT.parseArgs(["pro", "a@b.com", "--confrim"]), /unknown flag/);
});

test("a subscription Stripe knows about is refused, both ways round", () => {
  assert.throws(
    () => GRANT.refuseIfBilled({ stripe_subscription_id: "sub_123" }, "Adler"),
    /Stripe/,
    "a real subscription must not be overwritten or deleted here");
  assert.throws(
    () => GRANT.refuseIfBilled({ stripe_customer_id: "cus_123" }, "Adler"),
    /Stripe/,
    "a customer id alone still means money has changed hands");
});

test("a comped row and a missing row are both fine to write", () => {
  assert.doesNotThrow(() => GRANT.refuseIfBilled(null, "Adler"));
  assert.doesNotThrow(() => GRANT.refuseIfBilled(
    { plan: "firm_monthly", status: "active", stripe_subscription_id: null }, "Adler"));
});

test("the email is normalized the way accounts are keyed", () => {
  // Identity is the email (migration 018). A grant typed with capitals must
  // land on the same row the signup created.
  assert.strictEqual(GRANT.normEmail("  Owner@AdlerIndustrial.COM "), "owner@adlerindustrial.com");
  assert.strictEqual(GRANT.normEmail(null), "");
});

test("the period end is in the future and moves with the months asked for", () => {
  const six = Date.parse(GRANT.periodEnd(6));
  const twelve = Date.parse(GRANT.periodEnd(12));
  assert.ok(six > Date.now(), "a comp that has already expired grants nothing");
  assert.ok(twelve > six, "more months must reach further out");
});
