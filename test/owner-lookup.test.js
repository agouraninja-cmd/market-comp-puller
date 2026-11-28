// test/owner-lookup.test.js
// owner-lookup.js, the pure rules of finding who owns a commercial property.
// The routes are run in test/owner-lookup-run.test.js; this file proves what
// of a search's answer is believed, which is the half a stranger pays for:
// a home is never looked up, a people-search site is never a source, and a
// phone number or email nobody can point to is never shown.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const O = require("../owner-lookup.js");

const ADDRESS = "1450 S Eagle Rd, Meridian, ID 83642";
const ANSWER = {
  owner: { name: "EAGLE ROAD HOLDINGS LLC", kind: "company", mailing_address: "PO Box 100, Boise, ID 83701",
    record_source: "Ada County Assessor", record_url: "https://adacounty.example/parcel/R123" },
  entity: { state: "Idaho", status: "Active", registered_agent: "Summit Registered Agents Inc",
    filing_url: "https://sos.example/business/456" },
  people: [
    { name: "Dana Wu", role: "Manager of the owning LLC", company: "Eagle Road Holdings LLC",
      phone: "208-555-2142", email: "dana@eagleroad.example", source_url: "https://eagleroad.example/contact" },
    { name: "", role: "Property manager", company: "Ridgeline Management", phone: "(208) 555-2199", email: "",
      source_url: "https://ridgeline.example/properties/1450" },
  ],
  note: "The county lists the LLC; its manager is named on the state filing.",
};

test("the module is pure: no requires, no clock, no network", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "owner-lookup.js"), "utf8");
  assert.doesNotMatch(src, /\brequire\(/, "no requires");
  assert.doesNotMatch(src, /Date\.now\(\)|new Date\(\)/, "the caller passes the clock in");
  assert.doesNotMatch(src, /\bfetch\(/, "no I/O");
});

// --- what may be looked up ----------------------------------------------------

test("an address is refused in a sentence the member can act on", () => {
  assert.equal(O.lookupRefusal({ address: ADDRESS, type: "Industrial" }), "");
  assert.equal(O.lookupRefusal({ address: ADDRESS }), "", "a type is not required");
  assert.match(O.lookupRefusal({ address: "" }), /Type the property's address/);
  assert.match(O.lookupRefusal({ address: "Eagle Rd, Meridian, ID" }), /street number/);
  assert.match(O.lookupRefusal({ address: "1450 S Eagle Rd" }), /city and state/);
  // Without commas, an address that ends in a state still names its market.
  assert.equal(O.lookupRefusal({ address: "1210 N 17th st Boise ID" }), "");
  assert.equal(O.lookupRefusal({ address: "1210 N 17th St Boise id" }), "");
  assert.equal(O.lookupRefusal({ address: "1210 N 17th St Boise Idaho" }), "");
  assert.equal(O.lookupRefusal({ address: "50 Main St Hartford CT" }), "");
  assert.match(O.lookupRefusal({ address: "1450 S Eagle Ct" }), /city and state/, "Ct is Court, not Connecticut");
  assert.match(O.lookupRefusal({ address: "12 Elm St" }), /city and state/);
  assert.match(O.lookupRefusal({ address: "1 Main St, Boise, ID https://x.example" }), /doesn't look like an address/);
  assert.match(O.lookupRefusal({ address: "1 " + "Main ".repeat(60) + "St, Boise, ID" }), /too long/);
});

test("a home is never looked up", () => {
  assert.match(O.lookupRefusal({ address: ADDRESS, type: "Residential" }), /does not look up the owner of a home/);
  assert.match(O.lookupRefusal({ address: "6728 W Fairview Ave Trailer 51, Boise, ID" }), /not one unit of it/);
  // A unit of a known COMMERCIAL property is the member's own call.
  assert.equal(O.lookupRefusal({ address: "100 Main St Unit 4, Boise, ID", type: "Office" }), "");
  // And the search is told the same thing, in case the type was not known.
  const prompt = O.finderPrompt({ address: ADDRESS, type: "Industrial" });
  assert.match(prompt, /COMMERCIAL PROPERTY ONLY/);
  assert.match(prompt, /return exactly \{"residential":true\} and nothing else/);
  const home = O.parseAnswer(JSON.stringify({ residential: true, owner: { name: "Pat Homeowner" },
    people: [{ name: "Pat Homeowner", phone: "208-555-2188", source_url: "https://x.example/p" }] }));
  assert.equal(home.ok, true);
  assert.equal(home.found, false);
  assert.deepEqual(home.result, { residential: true, owner: null, entity: null, people: [], note: "" },
    "nothing beside the flag is kept, whatever else came back");
});

test("the prompt names the sources allowed and forbids a built contact detail", () => {
  const prompt = O.finderPrompt({ address: ADDRESS, type: "Retail" });
  assert.match(prompt, /retail property at 1450 S Eagle Rd, Meridian, ID 83642/);
  assert.match(prompt, /county assessor/i);
  assert.match(prompt, /Secretary of State/);
  assert.match(prompt, /NEVER use, cite or copy from a people-search/);
  assert.match(prompt, /COPIED, NEVER BUILT/);
  assert.match(prompt, /Never return a home phone number/);
  // An unknown type is not put into the sentence.
  assert.match(O.finderPrompt({ address: ADDRESS, type: "Castle" }), /owns the commercial property at/);
});

// --- what of the answer is believed ---------------------------------------------

test("a good answer keeps the owner, the filing and the people, each with its page", () => {
  const out = O.parseAnswer("Here is what I found:\n```json\n" + JSON.stringify(ANSWER) + "\n```");
  assert.equal(out.ok, true);
  assert.equal(out.found, true);
  assert.equal(out.result.owner.name, "EAGLE ROAD HOLDINGS LLC");
  assert.equal(out.result.owner.kind, "company");
  assert.equal(out.result.owner.record_url, "https://adacounty.example/parcel/R123");
  assert.equal(out.result.entity.registered_agent, "Summit Registered Agents Inc");
  assert.equal(out.result.people.length, 2);
  const [dana, mgr] = out.result.people;
  assert.equal(dana.phone, "(208) 555-2142", "written one way");
  assert.equal(dana.email, "dana@eagleroad.example");
  assert.equal(dana.phone_check, "unchecked", "nothing is trusted until its page has been read");
  assert.equal(mgr.name, "");
  assert.equal(mgr.company, "Ridgeline Management", "a company with no named person is still somebody to call");
  assert.equal(mgr.email_check, "none");
});

test("a people-search site is never a source", () => {
  for (const host of ["spokeo.com", "www.whitepages.com", "people.truepeoplesearch.com", "rocketreach.co"]) {
    assert.equal(O.isPeopleSearch(`https://${host}/dana-wu`), true, host);
  }
  assert.equal(O.isPeopleSearch("https://adacounty.example/parcel/R123"), false);
  assert.equal(O.isPeopleSearch("https://notspokeo.com/x"), false, "a host that only ends in the same letters is not it");
  const out = O.parseAnswer(JSON.stringify({ ...ANSWER,
    owner: { ...ANSWER.owner, record_url: "https://www.spokeo.com/eagle-road" },
    people: [{ name: "Dana Wu", phone: "208-555-2142", source_url: "https://www.spokeo.com/Dana-Wu" }, ANSWER.people[1]] }));
  assert.equal(out.result.owner.record_url, "", "the record link is dropped, the owner's name stands");
  assert.equal(out.result.people.length, 1, "a person read off a people-search site is not offered at all");
  assert.equal(out.dropped, 1);
});

test("a contact detail with no page to point to is dropped, and so is one that is not a detail", () => {
  const out = O.parseAnswer(JSON.stringify({ owner: { name: "Acme Holdings LLC", kind: "banana" }, people: [
    { name: "No Page", phone: "208-555-2142", email: "np@acme.example", source_url: "" },
    { name: "Bad Page", phone: "208-555-2143", source_url: "javascript:alert(1)" },
    { name: "Made Up", phone: "555-0100", email: "first.last@acme.example", source_url: "https://acme.example/team" },
    { name: "Movie Number", phone: "208-555-0100", source_url: "https://acme.example/team" },
    { name: "<b>Markup</b>", phone: "208-555-2144", source_url: "https://acme.example/team" },
    { name: "", company: "" },
    "not an object",
  ] }));
  assert.equal(out.result.owner.kind, "unknown", "a kind outside the list is unknown");
  const byName = Object.fromEntries(out.result.people.map((p) => [p.name, p]));
  assert.equal(byName["No Page"].phone, "", "no page, no phone");
  assert.equal(byName["No Page"].email, "");
  assert.equal(byName["Bad Page"].phone, "", "a page that is not a web address is no page");
  assert.equal(byName["Bad Page"].source_url, "");
  assert.equal(byName["Made Up"].phone, "", "seven digits is not a number");
  assert.equal(byName["Made Up"].email, "", "a pattern is not an address");
  assert.equal(byName["Movie Number"].phone, "", "555-01xx is the range reserved for fiction");
  assert.equal(out.result.people.some((p) => /Markup/.test(p.name)), false, "markup is dropped, never shown");
  assert.equal(out.dropped, 3);
});

test("at most six people, and the same person twice is one", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: "Person " + "ABCDEFGHI"[i], company: "Acme",
    source_url: "https://acme.example/team" }));
  const out = O.parseAnswer(JSON.stringify({ owner: { name: "Acme Holdings LLC" }, people: [...many, many[0]] }));
  assert.equal(out.result.people.length, O.MAX_PEOPLE);
});

test("nothing found is an answer; an unreadable reply is not", () => {
  const none = O.parseAnswer('{"owner":{"name":""},"people":[],"note":"The county site was down."}');
  assert.equal(none.ok, true);
  assert.equal(none.found, false);
  assert.equal(none.result.note, "The county site was down.");
  for (const junk of ["", "I could not complete the search.", "{not json", '{"something":"else"}']) {
    assert.equal(O.parseAnswer(junk).ok, false, JSON.stringify(junk));
  }
  // A note may not carry a link or markup onto the page.
  assert.equal(O.parseAnswer('{"owner":{"name":"A LLC"},"people":[],"note":"see https://x.example"}').result.note, "");
});

// --- the page check -------------------------------------------------------------

test("a page's phone numbers are read however it writes them", () => {
  const html = `<p>Call (208) 555-2142 or 208.555.2143</p><a href="tel:+12085552144">Call</a>
    <span>208&#45;555&#45;2145</span><p>Fax 208 555 2146 ext 12</p><p>Zip 83642-1234 and id 1234567890123</p>`;
  const got = O.phonesOnPage(html);
  for (const d of ["2085552142", "2085552143", "2085552144", "2085552145", "2085552146"]) assert.ok(got.includes(d), d);
  assert.equal(got.some((d) => d.startsWith("1234")), false, "a long id is not a phone number");
});

test("each detail is on its page, not on its page, or unchecked, and a failure is never 'on its page'", () => {
  const p = O.parseAnswer(JSON.stringify(ANSWER)).result.people[0];
  const shows = { ok: true, phones: ["2085552142"], emails: ["dana@eagleroad.example"] };
  assert.deepEqual([O.checkPerson(p, shows).phone_check, O.checkPerson(p, shows).email_check], ["on_page", "on_page"]);
  const other = { ok: true, phones: ["2085559999"], emails: [] };
  assert.deepEqual([O.checkPerson(p, other).phone_check, O.checkPerson(p, other).email_check], ["not_on_page", "not_on_page"]);
  for (const unread of [null, undefined, { ok: false }, {}]) {
    assert.deepEqual([O.checkPerson(p, unread).phone_check, O.checkPerson(p, unread).email_check], ["unchecked", "unchecked"]);
  }
  // A person with no details has nothing to check.
  const bare = { ...p, phone: "", email: "", phone_check: "none", email_check: "none" };
  assert.deepEqual([O.checkPerson(bare, shows).phone_check, O.checkPerson(bare, shows).email_check], ["none", "none"]);
});

// --- the allowance ---------------------------------------------------------------

test("the allowance is a month's count, and 0 or off switches the feature off", () => {
  assert.equal(O.perMonthFrom(undefined), 100);
  assert.equal(O.perMonthFrom(""), 100);
  assert.equal(O.perMonthFrom("25"), 25);
  for (const off of ["0", "off", "none", "-3", "abc"]) assert.equal(O.perMonthFrom(off), 0, off);
  assert.deepEqual(O.allowance(3, 100), { used: 3, perMonth: 100, left: 97 });
  assert.deepEqual(O.allowance(140, 100), { used: 140, perMonth: 100, left: 0 }, "never negative");
  assert.match(O.allowanceLine(O.allowance(100, 100)), /used all 100 owner lookups for this month.*reset on the 1st/);
  assert.equal(O.monthStart("2026-11-23T18:04:05.000Z"), "2026-11-01T00:00:00.000Z");
  assert.equal(O.cacheSince("2026-11-23T00:00:00.000Z"), "2026-08-25T00:00:00.000Z", "ninety days back");
});

test("the same building is the same key, however it is typed", () => {
  assert.equal(O.addressKey("1450 S. Eagle Rd., Meridian, ID 83642"), O.addressKey("  1450 s eagle rd meridian  id 83642 "));
  assert.notEqual(O.addressKey("1450 S Eagle Rd, Meridian, ID"), O.addressKey("1452 S Eagle Rd, Meridian, ID"));
});

test("a history row is an address and a day, never the answer", () => {
  const row = { id: "x1", address: ADDRESS, property_type: "Industrial", found: true, created_at: "2026-11-23T00:00:00.000Z",
    result: O.parseAnswer(JSON.stringify(ANSWER)).result };
  assert.deepEqual(O.recentRow(row), { id: "x1", address: ADDRESS, type: "Industrial", found: true,
    owner: "EAGLE ROAD HOLDINGS LLC", lookedUpAt: "2026-11-23T00:00:00.000Z" });
});

test("the use note says what the member must not do with an answer", () => {
  assert.match(O.USE_NOTE, /Do Not Call Registry/);
  assert.match(O.USE_NOTE, /never auto-dial or text/);
  assert.match(O.USE_NOTE, /postal address and a way to opt out/);
  assert.match(O.USE_NOTE, /Not for tenant screening, credit, employment or insurance/);
});
