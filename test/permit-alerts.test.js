// permit-alerts.js — a member's permit alerts (2026-10-01, Draft B).
//
// The rules with teeth: an alert names only cities we read and types and
// kinds the form offers; a filter change moves the email mark to now, so
// widening an alert never mails the past; a permit is new to an alert only
// when it was STORED after the alert's mark AND filed within two weeks (the
// history pass stores old permits too); and the page's own copy of the
// matching rule agrees with this one, permit for permit.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const A = require("../permit-alerts");

const NOW = Date.parse("2026-10-01T15:00:00Z");
const CITIES = ["boise", "meridian"];
const cityOf = (k) => ({ boise: "Boise", meridian: "Meridian" }[k] || "");

const permit = (over) => ({
  jurisdiction: "boise", propertyType: "Industrial", kind: "ti", type: "Tenant Improvement",
  address: "8000 S FEDERAL WAY, Boise ID 83716", description: "Warehouse office build-out", projectName: "",
  applicant: "", contractor: "", permitNumber: "BLD26-02789", appliedDate: "2026-09-30",
  firstSeenAt: "2026-10-01T13:05:00Z", sourceUrl: "https://permits.example/BLD26-02789", ...over,
});

test("a new alert takes only cities we read and the types and kinds the form offers, and names itself", () => {
  const ok = A.validateAlertInput({ jurisdiction: "Boise", propertyType: "Industrial", kind: "ti", words: "  Federal  Way " }, { cities: CITIES, cityOf });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    jurisdiction: "boise", property_type: "Industrial", kind: "ti", words: "Federal Way",
    name: "Industrial build-outs in Boise mentioning “Federal Way”", notify_email: true,
  });
  assert.equal(A.validateAlertInput({}, { cities: CITIES, cityOf }).value.name, "Every permit in every city");
  assert.equal(A.validateAlertInput({ kind: "new", jurisdiction: "meridian" }, { cities: CITIES, cityOf }).value.name, "New buildings in Meridian");
  assert.equal(A.validateAlertInput({ name: "My corner", email: false }, { cities: CITIES }).value.notify_email, false);
  assert.equal(A.validateAlertInput({ jurisdiction: "nampa" }, { cities: CITIES }).ok, false, "a city we do not read");
  assert.equal(A.validateAlertInput({ propertyType: "Other" }, { cities: CITIES }).ok, false, "Other is not something one follows");
  assert.equal(A.validateAlertInput({ kind: "demolition" }, { cities: CITIES }).ok, false);
  assert.equal(A.validateAlertInput({ words: "x".repeat(61) }, { cities: CITIES }).ok, false);
});

test("changing an alert's filters moves its email mark to now; renaming it or switching email does not", () => {
  const row = { jurisdiction: "boise", property_type: "Industrial", kind: null, words: null, name: "Industrial in Boise", notified_through: "2026-09-01T00:00:00Z" };
  const wider = A.validateAlertPatch({ jurisdiction: "", propertyType: "Industrial", kind: "", words: "" }, row, { cities: CITIES, cityOf, now: NOW });
  assert.equal(wider.patch.jurisdiction, null);
  assert.equal(wider.patch.notified_through, new Date(NOW).toISOString(), "widening never mails the past");
  const same = A.validateAlertPatch({ jurisdiction: "boise", propertyType: "Industrial", kind: "", words: "" }, row, { cities: CITIES, now: NOW });
  assert.equal(same.patch.notified_through, undefined, "the same filters keep the mark");
  const renamed = A.validateAlertPatch({ name: "Federal Way", email: false }, row, { cities: CITIES, now: NOW });
  assert.deepEqual(renamed.patch, { name: "Federal Way", notify_email: false });
  assert.equal(A.validateAlertPatch({}, row, { cities: CITIES, now: NOW }).ok, false);
  assert.equal(A.validateAlertPatch({ jurisdiction: "nampa" }, row, { cities: CITIES, now: NOW }).ok, false);
});

test("an alert matches on each filter it sets, and words are found anywhere a person would look", () => {
  const a = { jurisdiction: "boise", property_type: "Industrial", kind: "ti", words: "federal way" };
  assert.equal(A.matches(a, permit()), true);
  assert.equal(A.matches(a, permit({ jurisdiction: "meridian" })), false);
  assert.equal(A.matches(a, permit({ propertyType: "Office" })), false);
  assert.equal(A.matches(a, permit({ kind: "new" })), false);
  assert.equal(A.matches(a, permit({ address: "1 MAIN ST" })), false);
  assert.equal(A.matches({ words: "acme" }, permit({ contractor: "ACME Builders" })), true);
  assert.equal(A.matches({ words: "02789" }, permit()), true, "the permit number counts");
  assert.equal(A.matches({}, permit()), true, "no filter is every permit");
});

test("new means stored after the alert's mark, filed within two weeks, and read before this run's cutoff", () => {
  const alerts = [
    { id: "a1", name: "Industrial in Boise", jurisdiction: "boise", property_type: "Industrial", notify_email: true, notified_through: "2026-09-30T13:30:00Z" },
    { id: "a2", name: "Meridian", jurisdiction: "meridian", notify_email: true, notified_through: "2026-09-30T13:30:00Z" },
    { id: "a3", name: "Quiet", jurisdiction: "boise", notify_email: false, notified_through: "2026-09-01T00:00:00Z" },
  ];
  const views = [
    permit({ permitNumber: "NEW-1" }),
    permit({ permitNumber: "NEW-2", appliedDate: "2026-09-29" }),
    permit({ permitNumber: "OLD-SEEN", firstSeenAt: "2026-09-30T13:05:00Z" }), // already in yesterday's email
    permit({ permitNumber: "BACKFILL", appliedDate: "2026-03-02" }),             // stored today, filed in March
    permit({ permitNumber: "LATE", firstSeenAt: "2026-10-01T14:59:00Z" }),       // stored after the cutoff
    permit({ permitNumber: "MER-1", jurisdiction: "meridian", propertyType: "Office" }),
  ];
  const items = A.digestFor(alerts, views, { now: NOW, cutoff: "2026-10-01T14:00:00Z" });
  assert.deepEqual(items.map((x) => [x.alert.id, x.permits.map((p) => p.permitNumber)]), [
    ["a1", ["NEW-1", "NEW-2"]],
    ["a2", ["MER-1"]],
  ], "newest first; email-off alerts are not sent");
  assert.deepEqual(A.digestFor(alerts, [], { now: NOW }), []);
});

test("the email names each alert, lists its permits, and says where to change it", () => {
  const one = A.buildDigestEmail({ items: [{ alert: { name: "Industrial in Boise" }, permits: [permit()] }], siteUrl: "https://compninja.co/", cityOf });
  assert.equal(one.subject, "1 new permit: Industrial in Boise");
  assert.match(one.text, /^A new permit fits one of your alerts on CompNinja\./);
  assert.match(one.text, /Industrial in Boise \(1 new\)\n• Sep 30 · 8000 S FEDERAL WAY, Boise ID 83716 · Boise · tenant build-out · industrial \(BLD26-02789\)\n  https:\/\/permits\.example\/BLD26-02789/);
  assert.match(one.text, /change your alerts: https:\/\/compninja\.co\/permits/);
  const many = Array.from({ length: A.EMAIL_MAX_PER_ALERT + 3 }, (_, i) => permit({ permitNumber: `P-${i}`, address: "", sourceUrl: "" }));
  const two = A.buildDigestEmail({ items: [{ alert: { name: "A" }, permits: many }, { alert: { name: "B" }, permits: [permit()] }], siteUrl: "https://compninja.co", cityOf });
  assert.equal(two.subject, `${A.EMAIL_MAX_PER_ALERT + 4} new permits for your alerts`);
  assert.match(two.text, /no address on the permit/);
  assert.match(two.text, /…and 3 more on the Permit tracker\./);
  assert.doesNotMatch(two.text, /undefined|NaN|null/);
  assert.equal(A.buildDigestEmail({ items: [] }), null);
});

test("⚠ the page's copy of the matching rule agrees with this one", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "permits-page.js"), "utf8");
  const m = src.match(/function alertMatches\(a,p\)\{[\s\S]*?\n  \}\n/);
  assert.ok(m, "permits-page.js still defines alertMatches");
  const pageMatches = new Function(`${m[0]}; return alertMatches;`)();
  const alerts = [
    {}, { jurisdiction: "boise" }, { jurisdiction: "meridian" }, { property_type: "Industrial" }, { property_type: "Office" },
    { kind: "ti" }, { kind: "new" }, { words: "federal" }, { words: "ACME" }, { words: "02789" },
    { jurisdiction: "boise", property_type: "Industrial", kind: "ti", words: "warehouse" },
  ];
  const permits = [
    permit(), permit({ jurisdiction: "meridian" }), permit({ propertyType: "Office", kind: "new" }),
    permit({ contractor: "Acme", address: "" }), permit({ description: "", projectName: "Warehouse" }),
  ];
  for (const a of alerts) {
    // The page holds alertView's shape (propertyType); the server, the row's.
    const pageShape = { jurisdiction: a.jurisdiction || "", propertyType: a.property_type || "", kind: a.kind || "", words: a.words || "" };
    for (const p of permits) assert.equal(pageMatches(pageShape, p), A.matches(a, p), JSON.stringify([a, p.permitNumber, p.jurisdiction]));
  }
});
