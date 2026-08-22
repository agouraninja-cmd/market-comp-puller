// A firm's tenant contacts: what may be stored, and what a CSV of them means.
// Pure like org-access.test.js — no server, no database, no clock.
//
// The rules worth breaking a build over are the refusals. These rows are
// ADDRESSES SOMEBODY WILL MAIL, so a silently mangled one is a message to a
// stranger or to nobody with the sender believing it arrived — a sharper
// version of the reason broker-vault.js refuses "1.2M".
const test = require("node:test");
const assert = require("node:assert");
const C = require("../org-contacts.js");
const VAULT = require("../broker-vault.js");

// The vault's own CSV reader, injected exactly as server.js injects it. A
// second parser would be a second answer to what a quoted comma means.
const DEPS = {
  parseCsv: VAULT.parseCsv,
  isCommentRow: VAULT.isCommentRow,
  normalizeHeader: VAULT.normalizeHeader,
};

// Control characters are CONSTRUCTED, never typed: a literal one does not
// survive being written to a file, so a test containing one silently stops
// testing anything. See compninja-shell-gotchas.
const ESC = String.fromCharCode(27);
const TAB = String.fromCharCode(9);
const CTRL = new RegExp("[\\x00-\\x1F\\x7F]");

// --- the required field ------------------------------------------------------

test("a contact needs a name and nothing else", () => {
  const ok = C.normalizeContact({ name: "Dana Wu" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.row.name, "Dana Wu");
  assert.equal(ok.row.email, null, "no email is a normal contact, not an error");
  assert.equal(ok.row.company, null);
});

test("no name is refused, and no half-built row comes back with the error", () => {
  const r = C.normalizeContact({ email: "dana@acme.com", company: "Acme" });
  assert.deepEqual(r.errors, ["name is required"]);
  assert.equal(r.row, null, "a caller cannot store a rejected contact by forgetting to check");
});

test("a whitespace-only name is no name", () => {
  for (const name of ["", "   ", TAB, null, undefined]) {
    assert.deepEqual(C.normalizeContact({ name }).errors, ["name is required"], JSON.stringify(name));
  }
});

// --- the email, which is the field worth refusing over -----------------------

test("a real address is kept, lowercased and trimmed", () => {
  const r = C.normalizeContact({ name: "Dana", email: "  Dana@Acme.COM " });
  assert.equal(r.row.email, "dana@acme.com");
});

test("the shapes a real import actually gets wrong are all refused", () => {
  const bad = [
    "Dana Wu",                    // a name in the email column
    "208-555-0134",               // a phone number
    "dana@acme.com, ray@n.co",    // two addresses in one cell
    "dana@acme.com;ray@n.co",
    "dana@acme.com,",             // a trailing comma from a paste
    "dana@acme",                  // no dot in the domain
    "@acme.com",                  // nothing before the @
    "dana@",
    "dana at acme dot com",
    "dana @acme.com",             // a space
  ];
  for (const email of bad) {
    const r = C.normalizeContact({ name: "Dana", email });
    assert.equal(r.row, null, email);
    assert.match(r.errors[0], /is not an email address/, email);
    assert.ok(r.errors[0].includes(email.trim().slice(0, 60)),
      "the refusal quotes what was actually typed, so it can be found and fixed");
  }
});

test("a plus address and a subdomain are ordinary, not clever", () => {
  for (const email of ["dana+leases@acme.com", "dana@mail.acme.co.uk", "d.wu@acme-logistics.com"]) {
    assert.deepEqual(C.normalizeContact({ name: "Dana", email }).errors, [], email);
  }
});

// --- what reaches a page -----------------------------------------------------

test("control characters are stripped from every field", () => {
  const r = C.normalizeContact({
    name: "Dana" + ESC + "[31m" + "Wu",
    email: "dana@acme.com",
    company: "Acme" + TAB + "Logistics",
    notes: "spoke" + ESC + "Tuesday",
  });
  assert.deepEqual(r.errors, []);
  for (const f of ["name", "company", "notes"]) {
    assert.equal(CTRL.test(r.row[f]), false, f);
  }
});

test("a formula-shaped company keeps its name", () => {
  // guardFormula's job at the CSV boundary, deliberately not this file's — a
  // firm really called "+Plus Logistics" must not be renamed by us.
  const r = C.normalizeContact({ name: "Dana", company: "+Plus Logistics" });
  assert.equal(r.row.company, "+Plus Logistics");
});

test("long free text is capped, not refused", () => {
  const r = C.normalizeContact({ name: "D".repeat(500), notes: "x".repeat(2000) });
  assert.deepEqual(r.errors, [], "length is not a correctness question");
  assert.equal(r.row.name.length, C.MAX_SHORT_TEXT);
  assert.equal(r.row.notes.length, C.MAX_TEXT);
});

// --- editing -----------------------------------------------------------------

test("an edit is validated as the whole row it would become", () => {
  const existing = { name: "Dana Wu", email: "dana@acme.com", company: "Acme", notes: null };
  // Clearing the name must fail even though the patch alone looks harmless.
  assert.deepEqual(C.validateContactEdit(existing, { name: "" }).errors, ["name is required"]);
  // And a bad email fails an edit exactly as it fails an import.
  assert.match(C.validateContactEdit(existing, { email: "nope" }).errors[0], /not an email/);
});

test("an edit leaves untouched fields alone", () => {
  const existing = { name: "Dana Wu", email: "dana@acme.com", company: "Acme", notes: "note" };
  const r = C.validateContactEdit(existing, { company: "Nordic Cold" });
  assert.equal(r.row.name, "Dana Wu");
  assert.equal(r.row.email, "dana@acme.com");
  assert.equal(r.row.company, "Nordic Cold");
  assert.equal(r.row.notes, "note");
});

test("keys outside the contract are dropped, not rejected", () => {
  const existing = { name: "Dana Wu", email: null, company: null, notes: null };
  const r = C.validateContactEdit(existing, { company: "Acme", org_id: "somebody-elses-firm", id: "x" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(Object.keys(r.row).sort(), ["company", "email", "name", "notes"]);
});

// --- headers -----------------------------------------------------------------

test("a header maps only when exactly one column claims it", () => {
  const one = C.mapHeaders(["Name", "Email", "Company"], VAULT.normalizeHeader);
  assert.deepEqual(one, { name: 0, email: 1, company: 2 });

  // Two columns both looking like a name map NEITHER — the CSV mapper's rule.
  const two = C.mapHeaders(["Name", "Contact", "Email"], VAULT.normalizeHeader);
  assert.equal(two.name, undefined, "an ambiguous claim is no claim");
  assert.equal(two.email, 2, "the unambiguous ones still map");
});

test("the aliases people actually use are recognised", () => {
  const m = C.mapHeaders(["Tenant", "E-Mail", "Organization", "Comments"], VAULT.normalizeHeader);
  assert.deepEqual(m, { name: 0, email: 1, company: 2, notes: 3 });
});

// --- a whole file ------------------------------------------------------------

const csv = (s) => C.parseContactsCsv(s, DEPS);

test("a good file imports, counts its note lines, and refuses its bad rows", () => {
  const r = csv([
    "name,email,company",
    "# our own note line, skipped and counted",
    "Dana Wu,dana@acme.com,Acme",
    "Ray Ortiz,,Nordic Cold",
    "Bad Row,notanemail,X",
    ",orphan@x.co,Y",
    "",
  ].join("\n"));

  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => x.name), ["Dana Wu", "Ray Ortiz"]);
  assert.equal(r.rows[1].email, null, "a contact with no email still imports");
  assert.equal(r.commented, 1, "note lines are counted, never silently dropped");
  assert.equal(r.total, 4, "total counts data rows only");
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /^Line 5:/, "line numbers match what the broker sees in Excel");
  assert.match(r.errors[1], /^Line 6: name is required/);
});

test("a file with no name column imports nothing and says why", () => {
  const r = csv("email,company\ndana@acme.com,Acme\nray@n.co,Nordic\n");
  assert.deepEqual(r.rows, [], "two thousand blank contacts is the failure being avoided");
  assert.match(r.errors[0], /No "name" column/);
  assert.match(r.errors[0], /"name", "contact" or "tenant"/, "it names the spellings that work");
});

test("an empty file says so rather than importing nothing quietly", () => {
  assert.match(csv("").errors[0], /empty/);
});

test("quoted commas survive, because the vault's own reader is doing the work", () => {
  const r = csv('name,company\n"Wu, Dana","Acme, Inc."\n');
  assert.equal(r.rows[0].name, "Wu, Dana");
  assert.equal(r.rows[0].company, "Acme, Inc.");
});

test("an import is bounded and says when it stopped", () => {
  const lines = ["name"];
  for (let i = 0; i < C.MAX_ROWS_PER_IMPORT + 50; i++) lines.push("Person " + i);
  const r = csv(lines.join("\n"));
  assert.equal(r.rows.length, C.MAX_ROWS_PER_IMPORT);
  assert.ok(r.errors.some((e) => /Stopped at/.test(e)), "the cap is announced, not silent");
});

// --- dedupe ------------------------------------------------------------------

test("the same email twice is one contact, compared case-insensitively", () => {
  const rows = [
    { name: "Dana Wu", email: "dana@acme.com" },
    { name: "D. Wu", email: "DANA@ACME.COM" },
    { name: "Ray", email: "ray@n.co" },
  ];
  const r = C.dropExisting(rows, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.duplicates, 1);
});

test("contacts the firm already holds are dropped and counted", () => {
  const r = C.dropExisting(
    [{ name: "Dana", email: "dana@acme.com" }, { name: "Ray", email: "ray@n.co" }],
    ["Dana@Acme.com"]);
  assert.deepEqual(r.rows.map((x) => x.name), ["Ray"]);
  assert.equal(r.duplicates, 1);
});

test("contacts WITHOUT an email are never merged", () => {
  // Two people called Dana Wu may well be two people. Guessing would quietly
  // destroy one of them, and nothing on screen would show it.
  const rows = [{ name: "Dana Wu", email: null }, { name: "Dana Wu", email: null }];
  const r = C.dropExisting(rows, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.duplicates, 0);
  assert.equal(C.dedupeKey({ name: "Dana Wu", email: null }), null);
});

// --- the rule the feature was conditional on ---------------------------------

test("this module offers no way to build a contact from a lead", () => {
  // The plan makes it a condition of the feature existing that the list is
  // typed or imported and never collected. A `fromLead()` here would be the
  // thing somebody calls later without re-reading why it must not exist.
  const surface = Object.keys(C).join(" ").toLowerCase();
  for (const f of ["lead", "hub", "bov", "participant"]) {
    assert.equal(surface.includes(f), false, `org-contacts exports something named ${f}`);
  }
});
