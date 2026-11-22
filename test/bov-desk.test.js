// test/bov-desk.test.js
// The BOV desk's rules (bov-desk.js): what the broker search is asked, what
// of its answer is believed, and every word of the two emails. Pure, so all
// of it runs with no database, no provider and no mail.
//
// The rules worth a build failure are the ones a person on the other end
// pays for: an invented email address, the requester's name in a broker's
// inbox before anyone agreed to anything, or a line that says we are a
// brokerage. Each has a test that names it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const B = require("../bov-desk");

const LEAD = {
  id: 41, name: "Olive Owner", email: "olive@owner.test", phone: "401-555-0142",
  company: "Owner Holdings", address: "982 Warwick Avenue, Warwick, RI", type: "Office", size_sqft: 12000,
};
const SENDER = B.parseSender("Sam Sender <sam@sender.test>", "fallback@sender.test");
const BROKER = {
  name: "Jim Smith", firm: "Hayes & Sherry", email: "jim@firm.test", phone: "(401) 555-0100",
  fit: "your office sales and leasing work across Greater Rhode Island",
};

test("the vocabularies are the ones migration 065's check constraints restate", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "065-bov-desk.sql"), "utf8");
  const listed = (col) => {
    const m = new RegExp(`check \\(${col} in \\(([^)]+)\\)\\)`).exec(sql);
    assert.ok(m, `065 has no check on ${col}`);
    return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  };
  assert.deepEqual(listed("state"), B.REQUEST_STATES);
  assert.deepEqual(listed("status"), B.MATCH_STATUSES);
  assert.deepEqual(listed("origin"), B.ORIGINS);
});

test("migration 065 is additive: it destroys and rewrites nothing", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "065-bov-desk.sql"), "utf8");
  const code = sql.split("\n").map((l) => l.split("--")[0]).join("\n");
  assert.ok(!/\b(drop|truncate|delete\s+from|update\s+\w+\s+set)\b/i.test(code));
  assert.match(code, /create table if not exists bov_requests/);
  assert.match(code, /create table if not exists bov_matches/);
  assert.match(code, /alter table bov_requests enable row level security/);
  assert.match(code, /alter table bov_matches enable row level security/);
});

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------
test("the search is asked about a market and a type, and never told who asked or where", () => {
  const p = B.finderPrompt({ market: "Warwick, RI", type: "Office" });
  assert.match(p, /Warwick, RI/);
  assert.match(p, /office buildings/);
  assert.match(p, /Never guess, construct or infer/);
  assert.match(p, /"brokers":\[/);
  // finderPrompt takes no address and no lead at all, so nothing of either
  // can be in it; this pins the signature against a future "helpful" address.
  assert.equal(B.finderPrompt.length, 1);
  assert.doesNotMatch(p, /982|Olive|owner\.test/);
});

test("a home is searched for with agent wording, not broker wording", () => {
  const p = B.finderPrompt({ market: "Boise, ID", type: "Residential" });
  assert.match(p, /residential real estate agents/);
  assert.doesNotMatch(p, /commercial real estate brokers/);
});

test("an answer is believed only where it could be a real person with a real address", () => {
  const text = "Here you go:\n```json\n" + JSON.stringify({ brokers: [
    { name: "Jim Smith", firm: "Hayes & Sherry", email: "JSmith@HayesSherry.com", phone: "401.555.0100 x12",
      fit: "Your office sales and leasing work across Greater Rhode Island.", license: "RES.0012345",
      source_url: "https://www.hayessherry.com/team/jim-smith" },
    { name: "Acme Realty Group", email: "team@acme.test" },                      // a firm, not a person
    { name: "Pat Doe", email: "first.last@example.com" },                         // a placeholder
    { name: "Lee Park", email: "lee.park@gmail.com", source_url: "https://directory.test/lee" },
    { name: "Robin Vale", email: "info@valecre.test", phone: "(401) 555-0199" },  // a general inbox: phone kept
    { name: "No Contact", firm: "Somewhere" },                                    // nothing to reach them by
    { name: "Dana Cole", email: "dana@coleproperties.test", source_url: "javascript:alert(1)" },
  ] }) + "\n```";
  const out = B.parseCandidates(text);
  assert.equal(out.ok, true);
  assert.deepEqual(out.brokers.map((b) => b.name), ["Jim Smith", "Lee Park", "Robin Vale", "Dana Cole"]);
  const [jim, lee, robin, dana] = out.brokers;
  assert.equal(jim.email, "jsmith@hayessherry.com");
  assert.equal(jim.phone, "(401) 555-0100", "an extension is dropped, not folded into the number");
  assert.equal(jim.email_check, "unchecked", "nobody has read its page yet: never \"match\" from the search alone");
  assert.equal(jim.fit, "your office sales and leasing work across Greater Rhode Island");
  assert.equal(lee.email_check, "unchecked");
  assert.equal(robin.email, null, "a general inbox is not this person");
  assert.equal(robin.phone, "(401) 555-0199");
  assert.equal(robin.email_check, "none");
  assert.equal(dana.source_url, null, "only an http link is kept");
  assert.equal(dana.email_check, "unchecked");
  assert.equal(out.dropped, 3);
});

test("no readable list is a failed search; an empty list is a search that found nobody", () => {
  assert.equal(B.parseCandidates("I could not find anyone.").ok, false);
  assert.equal(B.parseCandidates("").ok, false);
  assert.deepEqual(B.parseCandidates('{"brokers":[]}').brokers, []);
  assert.equal(B.parseCandidates('{"brokers":[]}').ok, true);
  // Trailing prose with a brace in it does not fool the reader.
  assert.equal(B.parseCandidates('{"brokers":[]} (none met the rules {sorry})').ok, true);
});

test("at most MAX_CANDIDATES, and the same person once", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: "Broker Number" + "abcdefghi"[i], email: `b${i}@firm${i}.test` }));
  many.push({ name: "Broker Numbera", email: "b0@firm0.test" });
  // The same person at the same firm, once with an address and once without.
  many.unshift({ name: "Kim Roe", firm: "Roe CRE", phone: "4015550111" }, { name: "Kim Roe", firm: "Roe CRE", email: "kim@roecre.test" });
  const out = B.parseCandidates(JSON.stringify({ brokers: many }));
  assert.equal(out.brokers.length, B.MAX_CANDIDATES);
  assert.equal(out.brokers.filter((b) => b.name === "Kim Roe").length, 1);
});

test("the model's clause must start with \"your\", stay short and carry no link", () => {
  assert.equal(B.cleanFit("Your industrial listings in Meridian."), "your industrial listings in Meridian");
  assert.equal(B.cleanFit("He is the best broker in town"), "");
  assert.equal(B.cleanFit("your work, see https://x.test"), "");
  assert.equal(B.cleanFit("your " + "x".repeat(200)), "");
  assert.equal(B.cleanFit(""), "");
});

test("phones are US numbers written one way, or nothing", () => {
  assert.equal(B.cleanPhone("401-555-0142"), "(401) 555-0142");
  assert.equal(B.cleanPhone("+1 (401) 555-0142"), "(401) 555-0142");
  assert.equal(B.cleanPhone("401.555.0142 ext. 7"), "(401) 555-0142");
  assert.equal(B.cleanPhone("555-0142"), "");
  assert.equal(B.cleanPhone("+44 20 7946 0958"), "");
  assert.equal(B.cleanPhone(""), "");
});

test("only an address proven by its own page may go out unread", () => {
  const draft = { status: "draft", email: "jim@firm.test" };
  assert.equal(B.canAutoSend({ ...draft, email_check: "match" }), true);
  for (const check of ["free", "differs", "manual", "none", "unseen", "unchecked", undefined]) {
    assert.equal(B.canAutoSend({ ...draft, email_check: check }), false, String(check));
  }
  assert.equal(B.canAutoSend({ status: "sent", email: "jim@firm.test", email_check: "match" }), false);
  assert.equal(B.canAutoSend({ status: "draft", email: null, email_check: "match" }), false);
  assert.equal(B.canAutoSend(null), false);
});

// The first live run (2026-11-21, 982 Warwick Ave, Office). Two addresses on
// the firm's own domain that no page shows were labeled "match" because only
// the domains were compared; one broker's own bio page showed an address the
// search left out. These are those cases, with the firm names kept so the
// next reader can see what happened.
test("an address is \"match\" only when its page was read and shows it", () => {
  const fair = { name: "Matthew Fair", firm: "Hayes & Sherry", email: "mfair@hayessherry.com", phone: "(401) 555-0110",
    source_url: "https://www.hayessherry.com/content/properties/pdf/133.pdf" };
  const lucivero = { name: "David T. Lucivero", firm: "Hayes & Sherry", email: "dlucivero@hayessherry.com", phone: "(401) 555-0111",
    source_url: "https://www.hayessherry.com/our-team" };
  // The cited pages were 404s: unchecked, never match.
  assert.equal(B.pageEmailCheck(fair, { ok: false, status: 404 }).email_check, "unchecked");
  assert.equal(B.pageEmailCheck(lucivero, null).email_check, "unchecked");
  // The firm's real team page lists both men and no email for anybody: the
  // addresses were built from a pattern. Kept for the owner to judge, labeled.
  const teamPage = { ok: true, emails: B.emailsOnPage("<li>Matthew Fair 401-555-0110</li><li>David T. Lucivero 401-555-0111</li><a href='mailto:info@hayessherry.com'>info</a>") };
  const v = B.pageEmailCheck(lucivero, teamPage);
  assert.deepEqual(v, { email: "dlucivero@hayessherry.com", email_check: "unseen", adopted: false });
  for (const check of ["unseen", "unchecked"]) {
    assert.equal(B.canAutoSend({ status: "draft", email: lucivero.email, email_check: check }), false, check);
    assert.equal(B.unprovenCheck(check), true, check);
  }
  // Thomas Sweeney's address IS on his bio page: match, and only now.
  const sweeney = { name: "Thomas Sweeney", firm: "Sweeney Real Estate & Appraisal", email: "tsweeney@sreari.com",
    source_url: "https://www.sreari.com/meet-our-team/thomas-sweeney/" };
  const bio = { ok: true, emails: B.emailsOnPage('<p>Email: <a href="mailto:tsweeney@sreari.com">tsweeney@sreari.com</a></p>') };
  assert.equal(B.pageEmailCheck(sweeney, bio).email_check, "match");
  assert.equal(B.unprovenCheck("match"), false);
  // Shown on the page but on another domain, or free mail: the domain half.
  const dir = { ok: true, emails: ["lee.park@gmail.com", "dana@coleproperties.test"] };
  assert.equal(B.pageEmailCheck({ name: "Lee Park", email: "lee.park@gmail.com", source_url: "https://directory.test/lee" }, dir).email_check, "free");
  assert.equal(B.pageEmailCheck({ name: "Dana Cole", email: "dana@coleproperties.test", source_url: "https://directory.test/d" }, dir).email_check, "differs");
});

test("an address the search left out is read off the person's own page, never built", () => {
  // Kevin Casey came back with no email; his bio page shows one.
  const casey = { name: "Kevin Casey", firm: "Sweeney Real Estate & Appraisal", email: "", phone: "(401) 555-0120",
    source_url: "https://www.sreari.com/meet-our-team/kevin-casey/" };
  const bio = { ok: true, emails: B.emailsOnPage('<div class="contact">kcasey@sreari.com<br>office: info@sreari.com</div>') };
  assert.deepEqual(B.pageEmailCheck(casey, bio), { email: "kcasey@sreari.com", email_check: "match", adopted: true });
  // A page that does not show his address yields none; nothing is made up.
  const team = { ok: true, emails: ["tsweeney@sreari.com", "info@sreari.com"] };
  assert.deepEqual(B.pageEmailCheck(casey, team), { email: null, email_check: "none", adopted: false });
  assert.deepEqual(B.pageEmailCheck(casey, { ok: false }), { email: null, email_check: "none", adopted: false });
  // Whose address it is takes a personal shape, and exactly one of them.
  assert.equal(B.personalAddress("Kevin Casey", ["kevin.casey@x.test"]), "kevin.casey@x.test");
  assert.equal(B.personalAddress("Kevin Casey", ["caseyk@x.test"]), "caseyk@x.test");
  assert.equal(B.personalAddress("Thomas Sweeney", ["sweeney@sreari.com"]), "", "a family-named firm's own inbox is nobody's");
  assert.equal(B.personalAddress("Kevin Casey", ["kcasey@x.test", "kevin.casey@x.test"]), "", "two candidates: neither");
  assert.equal(B.personalAddress("Kevin Casey", ["kcasey2@x.test"]), "");
  assert.equal(B.personalAddress("David T. Lucivero", ["dlucivero@x.test"]), "dlucivero@x.test", "the middle initial is not the last name");
  assert.equal(B.personalAddress("Casey", ["casey@x.test"]), "");
});

test("addresses a page hides from scrapers are still read, and nothing else is", () => {
  const html = [
    "<a href='mailto:jo%40firm.test'>Jo</a>",
    "pat&#64;firm.test",
    "lee&#x40;firm&#46;test",
    "sam [at] firm [dot] test",
    // Cloudflare: key 0x42, then "cf@x.io" XORed with it.
    `<a class="__cf_email__" data-cfemail="42${Buffer.from("cf@x.io").map((b) => b ^ 0x42).toString("hex")}">[email&#160;protected]</a>`,
    "<img src='logo@2x.png'>",
    "Email: First.Last@example.com",
  ].join("\n");
  assert.deepEqual(B.emailsOnPage(html).sort(), ["cf@x.io", "jo@firm.test", "lee@firm.test", "pat@firm.test", "sam@firm.test"]);
  assert.deepEqual(B.emailsOnPage(""), []);
  assert.equal(B.decodeCfEmail("zz"), "");
});

// With autopilot on, the public form's text is mailed to a stranger with
// nobody reading it first, so it must look like what the form is for.
test("a request goes unread only when its own text is an address and a name", () => {
  const ok = { name: "Olive Owner", company: "Owner Holdings, LLC", address: "982 Warwick Ave., Unit #4, Warwick, RI 02888" };
  assert.equal(B.autopilotSafe(ok), true);
  assert.equal(B.autopilotSafe({ ...ok, company: "" }), true);
  assert.equal(B.autopilotSafe({ ...ok, name: "Zoë O'Neil-Smith" }), true);
  const held = {
    "no house number": { address: "Warwick Avenue, Warwick, RI" },
    "a link in the address": { address: "982 Warwick Ave, see evil.com for photos" },
    "an http link": { address: "982 Warwick Ave http://x" },
    "markup": { address: "982 Warwick Ave <b>" },
    "a sentence, not an address": { address: "982 reasons to click here! Free money; act now" },
    "far too long": { address: "982 " + "Warwick ".repeat(20) },
    "a link in the name": { name: "Visit evil.com today" },
    "an address for a name": { name: "olive@owner.test" },
    "a link in the company": { company: "www.evil.test" },
    "no name": { name: "" },
  };
  for (const [why, over] of Object.entries(held)) {
    assert.equal(B.autopilotSafe({ ...ok, ...over }), false, why);
  }
  assert.equal(B.autopilotSafe(null), false);
  assert.ok(B.AUTOPILOT_REST_DAYS >= 7 && B.AUTOPILOT_PER_DAY <= 20, "the limits are limits");
});

test("the bench reuses brokers found before, a yes first, and never one who passed", () => {
  const rows = [
    { name: "Sent Sam", email: "sam@a.test", status: "sent", origin: "search", source_url: "https://a.test/sam" },
    { name: "Yes Yara", email: "yara@b.test", status: "introduced", origin: "search" },
    { name: "No Noel", email: "noel@c.test", status: "declined", origin: "search" },
    { name: "Skip Skye", email: "skye@d.test", status: "skipped", origin: "search" },
    { name: "Member Mo", email: "mo@e.test", status: "accepted", origin: "platform" },
    // The broker who passed, found again on a later request: still not offered.
    { name: "No Noel", email: "noel@c.test", status: "draft", origin: "bench" },
  ];
  const bench = B.benchCandidates(rows);
  assert.deepEqual(bench.map((b) => b.name), ["Yes Yara", "Sent Sam"]);
  assert.ok(bench.every((b) => b.origin === "bench"));
  // A stored "match" is not carried over: the page is read again (bovCheckPages).
  assert.equal(bench[1].email_check, "unchecked");
});

test("a second search never offers a broker already on the request", () => {
  const known = [{ name: "Jim Smith", firm: "Hayes & Sherry", email: null }, { name: "Other", email: "lee@x.test" }];
  const fresh = [
    { name: "Jim Smith", firm: "Hayes & Sherry", email: "jim@firm.test" },   // same person, now with an address
    { name: "Lee Park", email: "lee@x.test" },                                // same address
    { name: "New Person", email: "new@y.test" },
  ];
  assert.deepEqual(B.withoutKnown(fresh, known).map((c) => c.name), ["New Person"]);
});

// ---------------------------------------------------------------------------
// The email to a broker
// ---------------------------------------------------------------------------
test("the outreach names the property and never the person who asked", () => {
  const d = B.outreachDraft({
    broker: BROKER, lead: LEAD, market: "Warwick, RI",
    reportUrl: "https://site.test/r/abc123XYZ", acceptUrl: "https://site.test/bov/accept?m=1&t=2", sender: SENDER,
  });
  assert.equal(d.subject, "BOV request: office building, 982 Warwick Avenue, Warwick, RI");
  assert.match(d.text, /^Hi Jim,/);
  assert.match(d.text, /Property: 982 Warwick Avenue, Warwick, RI/);
  assert.match(d.text, /Size: about 12,000 SF/);
  assert.match(d.text, /https:\/\/site\.test\/bov\/accept\?m=1&t=2/);
  // Rule 3. Every private field of the lead, by value.
  for (const secret of ["Olive", "Owner Holdings", "olive@owner.test", "555-0142", "5550142"]) {
    assert.ok(!d.text.includes(secret) && !d.subject.includes(secret), `the outreach leaked "${secret}"`);
  }
});

test("the outreach says what we are and what the estimate is", () => {
  const d = B.outreachDraft({ broker: BROKER, lead: LEAD, market: "Warwick, RI", reportUrl: "https://site.test/r/abc123XYZ", acceptUrl: "https://a.test/x", sender: SENDER });
  assert.match(d.text, /We don't broker deals ourselves; we connect owners with a local broker/);
  assert.match(d.text, /automated estimate \(not an appraisal\)/);
  assert.match(d.text, /free, with no obligation/);
  // Nobody checked a license, so nothing claims one (rule 4).
  assert.doesNotMatch(d.text, /licensed/i);
  assert.match(d.text, /Sam Sender\nCompNinja\nsam@sender\.test$/);
});

test("the model's clause is used when a person will read it, and left out of an unread send", () => {
  const args = { broker: BROKER, lead: LEAD, market: "Warwick, RI", acceptUrl: "https://a.test/x", sender: SENDER };
  assert.match(B.outreachDraft(args).text, /with your office sales and leasing work across Greater Rhode Island, I thought you'd be a strong fit/);
  const plain = B.outreachDraft({ ...args, plain: true }).text;
  assert.doesNotMatch(plain, /Greater Rhode Island/);
  assert.match(plain, /I'm looking for a local broker who handles office buildings around Warwick, RI/);
  // A clause that fails the rule is dropped the same way, plain or not.
  assert.doesNotMatch(B.outreachDraft({ ...args, broker: { ...BROKER, fit: "The best in town" } }).text, /best in town/);
});

test("the plain sentence reads right for every property type", () => {
  const want = {
    Industrial: "who handles industrial property around",
    Office: "who handles office buildings around",
    Retail: "who handles retail property around",
    Multifamily: "who handles multifamily property around",
    Land: "who handles land around",
    Residential: "local agent who handles homes around",
  };
  const VAULT = require("../broker-vault");
  // A type added to the vault's vocabulary must get words here.
  assert.deepEqual(Object.keys(want).sort(), VAULT.PROPERTY_TYPES.slice().sort());
  for (const [type, phrase] of Object.entries(want)) {
    const d = B.outreachDraft({ broker: { name: "Ann Lee" }, lead: { ...LEAD, type }, market: "Boise, ID", acceptUrl: "https://a.test/x", sender: SENDER, plain: true });
    assert.ok(d.text.includes(phrase), `${type}: ${d.text}`);
    assert.doesNotMatch(d.text, /propertys|lands |homess/);
  }
});

test("a home's outreach asks for an agent and never says Broker Opinion of Value", () => {
  const d = B.outreachDraft({ broker: { name: "Ann Lee" }, lead: { ...LEAD, type: "Residential" }, market: "Boise, ID", acceptUrl: "https://a.test/x", sender: SENDER });
  assert.match(d.subject, /^Home value request: home, /);
  assert.match(d.text, /asked to be connected with a local agent about their home's value/);
  assert.doesNotMatch(d.text, /Broker Opinion of Value|commercial real estate/);
});

test("a sender named after the brand writes as the firm, not as a person", () => {
  const brand = B.parseSender("CompNinja <reports@sender.test>", "x@y.test");
  assert.deepEqual(brand, { name: "", email: "reports@sender.test" });
  const d = B.outreachDraft({ broker: BROKER, lead: LEAD, market: "Warwick, RI", acceptUrl: "https://a.test/x", sender: brand });
  assert.match(d.text, /I'm writing from CompNinja/);
  assert.doesNotMatch(d.text, /I'm CompNinja/);
  assert.match(d.text, /Thanks,\nCompNinja\nreports@sender\.test$/);
  // Unset or unreadable: the fallback address, no name.
  assert.deepEqual(B.parseSender("", "desk@sender.test"), { name: "", email: "desk@sender.test" });
  assert.deepEqual(B.parseSender("not an address", "desk@sender.test"), { name: "", email: "desk@sender.test" });
  assert.deepEqual(B.parseSender("solo@sender.test", "desk@sender.test"), { name: "", email: "solo@sender.test" });
});

// ---------------------------------------------------------------------------
// The introduction
// ---------------------------------------------------------------------------
test("the introduction gives each of the two the other's details, and says what we are not", () => {
  const i = B.introDraft({ lead: LEAD, broker: BROKER, reportUrl: "https://site.test/r/abc123XYZ", sender: SENDER });
  assert.equal(i.subject, "Introduction: 982 Warwick Avenue, Warwick, RI (Olive and Jim)");
  assert.match(i.text, /^Hi Olive and Jim,/);
  assert.match(i.text, /Olive, this is Jim Smith of Hayes & Sherry, a local broker/);
  assert.match(i.text, /Jim, Olive Owner of Owner Holdings requested it through CompNinja/);
  assert.match(i.text, /Olive Owner: olive@owner\.test · \(401\) 555-0142/);
  assert.match(i.text, /Jim Smith: jim@firm\.test · \(401\) 555-0100/);
  assert.match(i.text, /It is an automated estimate, not an appraisal\./);
  assert.match(i.text, /CompNinja is not a brokerage/);
  assert.doesNotMatch(i.text, /licensed/i);
  // No report, no estimate paragraph (never a dangling "here:").
  assert.doesNotMatch(B.introDraft({ lead: LEAD, broker: BROKER, sender: SENDER }).text, /automated estimate/);
});

test("the owner's acknowledgment states the number on file, or says nothing", () => {
  assert.equal(B.ackPhoneLine("4015550142"),
    "The broker will have (401) 555-0142 as the best number to reach you. If another is better, reply and tell us.");
  assert.equal(B.ackPhoneLine(""), "");
  assert.equal(B.ackPhoneLine("call me"), "");
});

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------
test("an edit may change the address, subject and body, and nothing else", () => {
  assert.deepEqual(B.validateEdit({}), { ok: true, patch: {} });
  const ok = B.validateEdit({ email: " New@Firm.Test ", subject: "  Hello  ", body: "Line one\r\nLine two  " });
  assert.deepEqual(ok.patch, { email: "new@firm.test", email_check: "manual", subject: "Hello", body: "Line one\nLine two" });
  assert.equal(B.validateEdit({ email: "nope" }).ok, false);
  assert.equal(B.validateEdit({ subject: "   " }).ok, false);
  assert.equal(B.validateEdit({ body: "" }).ok, false);
  assert.equal(B.validateEdit({ body: "x".repeat(B.BODY_MAX + 1) }).ok, false);
  assert.ok(!("status" in B.validateEdit({ status: "sent", body: "hi" }).patch));
});

test("a broker added by hand needs a name and a way to reach them", () => {
  assert.equal(B.manualCandidate({ name: "Jo", email: "jo@x.test" }).ok, false);
  assert.equal(B.manualCandidate({ name: "Jo Park" }).ok, false);
  assert.equal(B.manualCandidate({ name: "Jo Park", email: "bad" }).ok, false);
  const made = B.manualCandidate({ name: "Jo Park", firm: "Park CRE", email: "Jo@Park.Test", phone: "401 555 0177" });
  assert.equal(made.ok, true);
  assert.deepEqual(made.candidate, {
    name: "Jo Park", firm: "Park CRE", email: "jo@park.test", phone: "(401) 555-0177",
    fit: null, license: null, source_url: null, email_check: "manual", origin: "manual",
  });
  assert.equal(B.canAutoSend({ status: "draft", ...made.candidate }), false);
});

test("where a click on the accept link stands", () => {
  const m = (status, id = "m1") => ({ id, status });
  assert.equal(B.acceptState(null, null), "invalid");
  assert.equal(B.acceptState(m("sent"), { state: "ready", introduced_match_id: null }), "open");
  assert.equal(B.acceptState(m("draft"), null), "open");
  assert.equal(B.acceptState(m("declined"), { state: "ready" }), "open", "a broker who passed may change their mind");
  assert.equal(B.acceptState(m("introduced"), { state: "introduced", introduced_match_id: "m1" }), "introduced");
  assert.equal(B.acceptState(m("sent"), { state: "introduced", introduced_match_id: "m2" }), "taken");
  assert.equal(B.acceptState(m("accepted"), { state: "ready", introduced_match_id: "m1" }), "open");
  assert.equal(B.acceptState(m("sent"), { state: "closed" }), "taken");
  assert.equal(B.acceptState(m("skipped"), { state: "ready" }), "taken");
});

test("what is waiting on the owner", () => {
  assert.deepEqual(B.attention([
    { status: "draft", email: "a@b.test" }, { status: "draft", email: null },
    { status: "accepted" }, { status: "sent" }, { status: "introduced" }, null,
  ]), { toSend: 1, toIntroduce: 1 });
  assert.deepEqual(B.attention(null), { toSend: 0, toIntroduce: 0 });
});

test("the Gmail window is prefilled and pinned to the sending account", () => {
  const u = B.gmailComposeUrl({ to: "jim@firm.test", subject: "A & B", body: "Line 1\nLine 2", account: "sam@sender.test" });
  const q = new URL(u).searchParams;
  assert.equal(new URL(u).origin, "https://mail.google.com");
  assert.equal(q.get("to"), "jim@firm.test");
  assert.equal(q.get("su"), "A & B");
  assert.equal(q.get("body"), "Line 1\nLine 2");
  assert.equal(q.get("authuser"), "sam@sender.test");
  assert.equal(new URL(B.gmailComposeUrl({ to: "a@b.test" })).searchParams.get("authuser"), null);
});
