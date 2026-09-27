// permit-watch.js — tracking your own permit (2026-09-27).
//
// The rules with teeth: a portal status is mapped onto a step only when the
// words say so (never "issued" for "Ready to Issue"); a step completes once,
// ever, so a notice is never sent twice; the first read of a permit announces
// nothing; and a member hears exactly what they asked to hear, on the channels
// they asked for.

const test = require("node:test");
const assert = require("node:assert");
const W = require("../permit-watch");

test("portal statuses map onto the five steps, and an unknown one onto none", () => {
  const cases = [
    // Captured live 2026-09-16 (test/fixtures/permit-portals)
    ["Applicant Upload", "submitted", null],
    ["Prescreen", "submitted", null],
    ["Received", "submitted", null],
    ["In Review", "review", null],
    ["In Progress", "review", null],
    ["Returned to Applicant", "review", "attention"],
    // Named in the rules file and common Accela workflows
    ["Prep for Issuance", "approved", null],
    ["Ready to Issue", "approved", null],
    ["Pending Payment", "approved", null],
    ["Plan Review Complete", "approved", null],
    ["Approved", "approved", null],
    ["Issued", "issued", null],
    ["Permit Issued", "issued", null],
    ["Final Inspection Scheduled", "issued", null],
    ["Finaled", "final", null],
    ["Closed", "final", null],
    ["Certificate of Occupancy Issued", "final", null],
    ["Complete", "final", null],
    ["Expired", null, "ended"],
    ["Withdrawn", null, "ended"],
    ["Closed - Withdrawn", null, "ended"],
    ["Not Approved", null, "ended"],
    ["Void", null, "ended"],
    ["On Hold", null, "attention"],
    ["Incomplete", "review", "attention"],
    ["Zzyzx", null, null],
    ["", null, null],
    ["(blank)", null, null],
  ];
  for (const [status, step, flag] of cases) {
    assert.deepEqual(W.classifyStatus(status), { step, flag }, status);
  }
});

test("a permit number is normalized, and junk is refused before it reaches a portal", () => {
  assert.equal(W.normalizePermitNumber(" bld26-02789 "), "BLD26-02789");
  assert.equal(W.normalizePermitNumber("C-NEW-2026-0052"), "C-NEW-2026-0052");
  assert.equal(W.normalizePermitNumber(""), null);
  assert.equal(W.normalizePermitNumber("x"), null, "one character is not a permit number");
  assert.equal(W.normalizePermitNumber("<script>"), null);
  assert.equal(W.normalizePermitNumber("A".repeat(41)), null);
});

test("adding a permit: only a city the sweep reads, and the notification settings are sanitized", () => {
  const opts = { cities: ["boise", "meridian"], cityLabels: ["Boise", "Meridian"] };
  const bad = W.validateWatchInput({ jurisdiction: "nampa", permitNumber: "X-1" }, opts);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Boise or Meridian/);
  assert.equal(W.validateWatchInput({ jurisdiction: "boise", permitNumber: "?" }, opts).ok, false);

  const ok = W.validateWatchInput({
    jurisdiction: "Boise", permitNumber: "bld26-1", label: "  Our   warehouse ",
    notify: { steps: ["issued", "bogus", "submitted", "final"], any: "true", alerts: false, email: false, app: true },
  }, opts);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    jurisdiction: "boise", permit_number: "BLD26-1", label: "Our warehouse",
    notify: { steps: ["issued", "final"], any: false, alerts: false, email: false, app: true },
  }, "unknown steps and 'submitted' drop; a string 'true' is not a boolean");

  const dflt = W.validateWatchInput({ jurisdiction: "meridian", permitNumber: "C-1" }, opts);
  assert.deepEqual(dflt.value.notify, { steps: ["approved", "issued", "final"], any: false, alerts: true, email: true, app: true });
});

test("editing a watch changes the nickname and the settings only", () => {
  const row = { notify_steps: ["issued"], notify_any: false, notify_alerts: true, notify_email: true, notify_app: true };
  assert.equal(W.validateWatchPatch({ jurisdiction: "meridian" }, row).ok, false, "the city is the permit");
  const p = W.validateWatchPatch({ label: "", notify: { email: false } }, row);
  assert.deepEqual(p.patch, {
    label: null, notify_steps: ["issued"], notify_any: false, notify_alerts: true, notify_email: false, notify_app: true,
  }, "an unnamed setting keeps the stored value, never the default");
});

const NOW = Date.parse("2026-09-27T13:00:00Z");
const value = (notify) => ({ jurisdiction: "boise", permit_number: "BLD26-02789", label: null, notify: W.normalizeNotify(notify) });

test("the add-time read marks every step so far as passed, and announces nothing", () => {
  const row = W.newWatchRow("u1", value(), { found: true, status: "Prep for Issuance", address: "8000 S FEDERAL WAY, Boise ID", source_url: "https://p/d", description: "Walkway" }, NOW);
  assert.deepEqual(row.passed_steps, ["submitted", "review", "approved"]);
  assert.equal(row.status, "Prep for Issuance");
  assert.equal(row.last_checked_at, new Date(NOW).toISOString());
  assert.equal(row.check_error, null);
  assert.equal(row.description, "Walkway");

  const down = W.newWatchRow("u1", value(), null, NOW);
  assert.equal(down.status, null);
  assert.deepEqual(down.passed_steps, []);
  assert.match(down.check_error, /did not answer/);
  assert.equal(down.last_checked_at, null, "never checked, so the sweep reads it first");
});

const watchAt = (status, notify, extra) => ({
  id: "w1", jurisdiction: "boise", permit_number: "BLD26-02789", label: null, address: "8000 S FEDERAL WAY, Boise ID",
  source_url: "https://p/d", status, passed_steps: W.stepsThrough(W.classifyStatus(status).step),
  ...W.notifyColumns(W.normalizeNotify(notify)), ...extra,
});

test("a step the member asked about completes with a notice on both channels", () => {
  const { watchPatch, event } = W.decideCheck(watchAt("In Review"), { found: true, status: "Issued" }, NOW);
  assert.equal(watchPatch.status, "Issued");
  assert.deepEqual(watchPatch.passed_steps, ["submitted", "review", "approved", "issued"],
    "a jump over Approved completes it too");
  assert.deepEqual(event.steps, ["approved", "issued"]);
  assert.equal(event.notice, "Steps complete: Approved and Issued");
  assert.equal(event.app, true);
  assert.equal(event.email_due, true);
  assert.equal(event.old_status, "In Review");
});

test("a step completes once: dropping back and returning announces nothing new", () => {
  const w = watchAt("Issued", {}, { passed_steps: ["submitted", "review", "approved", "issued"] });
  const back = W.decideCheck(w, { found: true, status: "Returned to Applicant" }, NOW);
  assert.equal(back.event.notice, "Needs attention", "alerts are on by default");
  assert.deepEqual(back.watchPatch.passed_steps, ["submitted", "review", "approved", "issued"], "nothing un-completes");
  const again = W.decideCheck({ ...w, status: "Returned to Applicant" }, { found: true, status: "Issued" }, NOW);
  assert.equal(again.event.notice, null, "Issued was already announced");
  assert.equal(again.event.app, false);
  assert.equal(again.event.email_due, false);
});

test("the member hears exactly what they chose", () => {
  // Only Finaled, no alerts, no changes: an approval is quiet but recorded.
  const quiet = W.decideCheck(watchAt("In Review", { steps: ["final"], alerts: false }), { found: true, status: "Approved" }, NOW);
  assert.equal(quiet.event.kind, "quiet");
  assert.equal(quiet.event.notice, null);
  assert.equal(quiet.watchPatch.status, "Approved", "the status still moves on the page");

  const ended = W.decideCheck(watchAt("Issued", { steps: [] }), { found: true, status: "Expired" }, NOW);
  assert.equal(ended.event.notice, "Permit ended");

  const any = W.decideCheck(watchAt("Prescreen", { steps: [], alerts: false, any: true }), { found: true, status: "Received" }, NOW);
  assert.equal(any.event.notice, "Status changed");

  const appOnly = W.decideCheck(watchAt("In Review", { email: false }), { found: true, status: "Approved" }, NOW);
  assert.equal(appOnly.event.app, true);
  assert.equal(appOnly.event.email_due, false);

  const neither = W.decideCheck(watchAt("In Review", { email: false, app: false }), { found: true, status: "Approved" }, NOW);
  assert.equal(neither.event.notice, "Step complete: Approved", "the history still names the step");
  assert.equal(neither.event.app, false);
  assert.equal(neither.event.email_due, false);
});

test("no change, a first read, a vanished permit", () => {
  const same = W.decideCheck(watchAt("In Review"), { found: true, status: "In Review" }, NOW);
  assert.equal(same.event, null);
  assert.equal(same.watchPatch.check_error, null);

  const first = W.decideCheck(watchAt(null, {}, { passed_steps: [] }), { found: true, status: "Issued", address: "1 MAIN ST" }, NOW);
  assert.equal(first.event.kind, "first");
  assert.equal(first.event.notice, null, "we never saw it change, so nothing is announced");
  assert.deepEqual(first.watchPatch.passed_steps, ["submitted", "review", "approved", "issued"]);

  const gone = W.decideCheck(watchAt("In Review"), { found: false }, NOW);
  assert.equal(gone.event, null);
  assert.match(gone.watchPatch.check_error, /no longer finds/);
  assert.equal(gone.watchPatch.status, undefined, "a vanished record keeps its last status");
});

test("one lookup per permit however many members watch it, stalest first, capped", () => {
  const w = (id, j, n, checked) => ({ id, jurisdiction: j, permit_number: n, last_checked_at: checked });
  const due = W.dueChecks([
    w("a", "boise", "B-1", "2026-09-26T13:00:00Z"),
    w("b", "boise", "b-1", "2026-09-20T13:00:00Z"),
    w("c", "meridian", "M-1", "2026-09-25T13:00:00Z"),
    w("d", "nampa", "N-1", null),
    w("e", "boise", "B-2", null),
  ], { cities: ["boise", "meridian"], cap: 2 });
  assert.deepEqual(due.map((g) => g.permit_number), ["B-2", "B-1"]);
  assert.deepEqual(due[1].watches.map((x) => x.id), ["a", "b"], "two members, one lookup");
});

test("the email names the permit, the step, both statuses, and where to change it", () => {
  const w = watchAt("Issued", {}, { label: "Our warehouse" });
  const e = { notice: "Step complete: Issued", old_status: "Prep for Issuance", new_status: "Issued", detected_at: "2026-09-27T13:00:00Z" };
  const mail = W.buildNoticeEmail({ items: [{ watch: w, event: e }], siteUrl: "https://compninja.co/", cityOf: () => "Boise" });
  assert.equal(mail.subject, "Step complete: Issued · Boise permit BLD26-02789");
  assert.match(mail.text, /Boise permit BLD26-02789 — Our warehouse/);
  assert.match(mail.text, /now reads “Issued” \(it read “Prep for Issuance”\)/);
  assert.match(mail.text, /https:\/\/compninja\.co\/permits/);
  assert.match(mail.text, /Portal record: https:\/\/p\/d/);
  assert.match(mail.text, /switch them off/);
  assert.equal(W.buildNoticeEmail({ items: [{ watch: w, event: { ...e, notice: null } }] }), null, "nothing to say, no email");
  const two = W.buildNoticeEmail({ items: [{ watch: w, event: e }, { watch: w, event: e }], cityOf: () => "Boise" });
  assert.equal(two.subject, "2 permit updates");
});

test("the page view lights the ledger's furthest step and counts the unread notices", () => {
  const row = watchAt("Returned to Applicant", {}, { passed_steps: ["submitted", "review", "approved"], last_checked_at: "x" });
  const v = W.watchView(row, [
    { id: "e1", watch_id: "w1", old_status: "Approved", new_status: "Returned to Applicant", notice: "Needs attention", app: true, seen_at: null, detected_at: "2026-09-27T13:00:00Z" },
    { id: "e2", watch_id: "w1", old_status: "In Review", new_status: "Approved", notice: "Step complete: Approved", app: true, seen_at: "2026-09-26T15:00:00Z", detected_at: "2026-09-26T13:00:00Z" },
    { id: "e3", watch_id: "other", app: true, seen_at: null },
  ], { cityOf: () => "Boise" });
  assert.equal(v.step, "approved", "returned after approval has still been approved");
  assert.equal(v.flag, "attention");
  assert.deepEqual(v.steps.map((s) => s.done), [true, true, true, false, false]);
  assert.equal(v.unread, 1);
  assert.deepEqual(v.history.map((h) => [h.id, h.unread]), [["e1", true], ["e2", false]]);
  assert.equal(v.city, "Boise");
  assert.equal(W.unreadCount([{ app: true }, { app: true, seen_at: "x" }, { app: false }]), 1);
});
