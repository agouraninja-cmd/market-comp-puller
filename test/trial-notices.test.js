// The Pro trial's two emails: which one is due, and what it says.
//
// Run: npm test   (node --test, no dependencies, no database)
//
// trial-notices.js is pure, so the whole decision table runs here with a
// fixed clock. The route that sends them is proven against a real server in
// test/trial-notices-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const { noticeDue, buildNotice, ENDING_WINDOW_DAYS } = require("../trial-notices");

const NOW = Date.parse("2026-10-01T16:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("a fresh trial is due the start email", () => {
  assert.equal(noticeDue({ trialEndsAt: NOW + 13 * DAY, now: NOW, sent: [] }), "start");
});

test("each email goes once", () => {
  assert.equal(noticeDue({ trialEndsAt: NOW + 13 * DAY, now: NOW, sent: ["start"] }), null);
  assert.equal(noticeDue({ trialEndsAt: NOW + 2 * DAY, now: NOW, sent: ["start", "ending"] }), null);
});

test("the ending email goes inside the last three days", () => {
  assert.equal(ENDING_WINDOW_DAYS, 3);
  assert.equal(noticeDue({ trialEndsAt: NOW + 3 * DAY, now: NOW, sent: ["start"] }), "ending");
  assert.equal(noticeDue({ trialEndsAt: NOW + 3 * DAY + 1, now: NOW, sent: ["start"] }), null,
    "not before the window opens");
});

test("when both are due, only the ending email goes", () => {
  // An account whose trial began before the start email could reach it and now
  // ends within the window: "you have Pro" then "your Pro is ending" a minute
  // apart is noise. The one carrying a date to act on wins.
  assert.equal(noticeDue({ trialEndsAt: NOW + DAY, now: NOW, sent: [] }), "ending");
});

test("nothing is due once the trial has ended", () => {
  assert.equal(noticeDue({ trialEndsAt: NOW - 1, now: NOW, sent: [] }), null);
  assert.equal(noticeDue({ trialEndsAt: NOW, now: NOW, sent: [] }), null);
});

test("an unreadable end date is never a reason to send", () => {
  assert.equal(noticeDue({ trialEndsAt: "not a date", now: NOW }), null);
  assert.equal(noticeDue({ trialEndsAt: undefined, now: NOW }), null);
});

const FIGURES = {
  name: "Dana Ruiz", trialEndsAt: Date.parse("2026-10-07T12:00:00Z"),
  monthly: 49, annual: 490, freeReports: 3,
  deskUrl: "https://compninja.co/desk", pricingUrl: "https://compninja.co/pricing",
};

test("the start email says when Pro ends, what happens after, and what it costs", () => {
  const m = buildNotice("start", FIGURES);
  assert.equal(m.subject, "You have CompNinja Pro until October 7");
  assert.match(m.text, /^Hi Dana,/);
  assert.match(m.text, /no card on file/);
  assert.match(m.text, /3 reports a month/, "the free plan it lands on is stated with its real allowance");
  assert.match(m.text, /\$49 a month or \$490 a year/);
  assert.match(m.text, /https:\/\/compninja\.co\/desk/);
  assert.match(m.text, /reply and say so/, "every email carries a way to stop them");
});

test("the ending email names the date and keeps the promise about saved work", () => {
  const m = buildNotice("ending", FIGURES);
  assert.equal(m.subject, "Your CompNinja Pro trial ends on October 7");
  assert.match(m.text, /stays in your account/);
  assert.match(m.text, /https:\/\/compninja\.co\/pricing/);
});

test("every figure is passed in, never typed", () => {
  // A price change must never leave these emails quoting the old one.
  const m = buildNotice("ending", { ...FIGURES, monthly: 1234, annual: 0, freeReports: 7 });
  assert.match(m.text, /\$1234 a month/);
  assert.doesNotMatch(m.text, /a year/, "no yearly price is quoted where none is sold");
  assert.match(m.text, /7 reports a month/);
  assert.doesNotMatch(m.text, /\$49|\$490/);
});

test("no name, no invented one", () => {
  assert.match(buildNotice("start", { ...FIGURES, name: "" }).text, /^Hi,/);
});

test("nothing honest to send, nothing sent", () => {
  assert.equal(buildNotice("start", { ...FIGURES, trialEndsAt: "nope" }), null);
  assert.equal(buildNotice("start", { ...FIGURES, monthly: 0 }), null);
  assert.equal(buildNotice("reminder", FIGURES), null);
});
