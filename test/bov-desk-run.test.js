// test/bov-desk-run.test.js
// The BOV desk, actually run: a real server.js against the stand-in PostgREST
// and Resend (helpers/fake-supabase.js) and a stand-in search provider.
//
// bov-desk.test.js proves what the emails say. This proves who they reach
// and when, which is the half a person on the other end pays for:
//   - a request starts the desk on its own, and NOTHING reaches a broker
//     until the owner presses Send (or has switched autopilot on);
//   - opening the desk only reads;
//   - the link in the email only shows an offer on GET, and on POST
//     introduces exactly one broker, with the requester's details in that one
//     mail and no other;
//   - an unrun migration 065 and a server with no outbound mail each cost the
//     desk and never the request.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const KEY = "desk-key";
const OWNER = "owner@site.test";
const SENDER = "Sam Sender <sam@site.test>";
const REPORT = "https://site.test/r/abc123XYZ";

const LEAD = {
  name: "Olive Owner", email: "olive@owner.test", phone: "401-555-0142", company: "Owner Holdings",
  address: "982 Warwick Avenue, Warwick, RI", type: "Office", source: "bov",
  report_url: REPORT, size_sqft: 12000,
};

// Five the rules keep and two they drop (a firm, a placeholder address).
const FOUND = { brokers: [
  { name: "Avery Stone", firm: "Stone CRE", email: "avery@stonecre.test", phone: "401-555-0101",
    fit: "your office sales work across Greater Rhode Island", source_url: "https://www.stonecre.test/team/avery" },
  { name: "Blake Rivers", firm: "Rivers Group", email: "blake@riversgroup.test", phone: "",
    fit: "your Warwick office listings", source_url: "https://riversgroup.test/blake" },
  { name: "Casey Moor", firm: "Moor Realty", email: "casey.moor@gmail.com", phone: "401-555-0103",
    fit: "", source_url: "https://directory.test/casey" },
  { name: "Devon Hale", firm: "Hale Partners", email: "", phone: "401-555-0104",
    fit: "your office leasing work", source_url: "https://halepartners.test/devon" },
  { name: "Emery Lake", firm: "Lake Commercial", email: "emery@lakecommercial.test", phone: "",
    fit: "your investment sales work", source_url: "https://listings.test/emery" },
  { name: "Acme Realty Group", email: "team@acme.test" },
  { name: "Pat Doe", email: "first.last@example.com" },
] };

// Answers as Anthropic does (the suite boots SEARCH_PROVIDER=anthropic, the
// comp-fit run test's choice): one text block holding the JSON.
async function startProvider() {
  const calls = [];
  const state = { answer: FOUND, status: 200 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let sent = {};
      try { sent = JSON.parse(body || "{}"); } catch (_) { /* recorded as empty */ }
      calls.push({ prompt: JSON.stringify(sent.messages || ""), stream: sent.stream === true });
      res.writeHead(state.status, { "content-type": "application/json" });
      if (state.status !== 200) return res.end(JSON.stringify({ error: { message: "nope" } }));
      res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 400 },
        content: [{ type: "text", text: typeof state.answer === "string" ? state.answer : JSON.stringify(state.answer) }] }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/v1/messages`, calls, state,
    stop: () => new Promise((r) => server.close(r)) };
}

async function bootDesk(t, { tables = {}, env = {}, fakeOpts = {} } = {}) {
  const db = await fake.start({ tables, ...fakeOpts });
  const provider = await startProvider();
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    ADMIN_KEY: KEY,
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "CompNinja <reports@site.test>",
    RESEND_API_URL: db.resendUrl,
    LEAD_NOTIFY_EMAIL: OWNER,
    SITE_URL: "https://site.test",
    SEARCH_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "test-key-not-a-real-one",
    STREAM_ANTHROPIC: "off",
    SEARCH_API_URL: provider.url,
    BOV_AUTOMATION: "on",
    BOV_FROM: SENDER,
    ...env,
  });
  t.after(async () => { srv.stop(); await provider.stop(); await db.stop(); });
  return { db, provider, srv };
}

const postLead = (srv, over) => fetch(srv.base + "/api/lead", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...LEAD, ...(over || {}) }),
});
const readDesk = (srv, key = KEY) => fetch(srv.base + "/api/admin/bov", { headers: { "x-admin-key": key } });
const act = (srv, body) => fetch(srv.base + "/api/admin/bov", {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-key": KEY },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const toOf = (mail) => [].concat(mail.to || []);
const mailTo = (db, address) => db.sent.filter((m) => toOf(m).includes(address));
const matchNamed = (db, name) => db.tables.bov_matches.find((m) => m.name === name);
// The accept link as the email carries it, turned into a path on this server.
function acceptPath(match) {
  const m = /https:\/\/site\.test(\/bov\/accept\?m=[^\s]+)/.exec(match.body || "");
  assert.ok(m, `no accept link in ${match.name}'s draft`);
  return m[1];
}
// Poll for a state the fire-and-forget kickoff reaches after the response.
async function until(check, what, ms = 10000) {
  for (let waited = 0; waited < ms; waited += 25) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a request starts the desk on its own, and a broker hears nothing until the owner sends", async (t) => {
  const { db, provider, srv } = await bootDesk(t);

  const res = await postLead(srv);
  assert.equal(res.status, 200, await res.text());
  await until(() => (db.tables.bov_requests || []).some((r) => r.state === "ready"), "the desk to be ready");
  // The owner's new-lead notice, the requester's acknowledgment, and the
  // desk's "brokers found" notice. Nothing else.
  await fake.waitForMail(db, 3);
  assert.deepEqual(db.unparsed, [], "the stand-in understood every query the desk sent");

  await t.test("one search, asked about the market and the type and nothing about who or where", () => {
    assert.equal(provider.calls.length, 1);
    const p = provider.calls[0].prompt;
    assert.match(p, /Warwick, RI/);
    assert.match(p, /office buildings/);
    assert.equal(provider.calls[0].stream, false);
    for (const secret of ["982 Warwick", "Olive", "olive@owner.test", "555-0142", "Owner Holdings"]) {
      assert.ok(!p.includes(secret), `the search was told "${secret}"`);
    }
  });

  await t.test("the request and five drafted brokers are stored", () => {
    assert.equal(db.tables.bov_requests.length, 1);
    const r = db.tables.bov_requests[0];
    assert.equal(r.market, "Warwick, RI");
    assert.equal(r.property_type, "Office");
    assert.equal(r.report_url, REPORT);
    assert.equal(r.introduced_match_id, null);
    const names = db.tables.bov_matches.map((m) => m.name);
    assert.deepEqual(names, ["Avery Stone", "Blake Rivers", "Casey Moor", "Devon Hale", "Emery Lake"]);
    assert.ok(db.tables.bov_matches.every((m) => m.status === "draft" && m.origin === "search"));
    assert.deepEqual(db.tables.bov_matches.map((m) => m.email_check), ["match", "match", "free", "none", "differs"]);
    const avery = matchNamed(db, "Avery Stone");
    assert.match(avery.body, /with your office sales work across Greater Rhode Island/);
    assert.match(avery.body, new RegExp(REPORT.replace(/[.]/g, "\\.")));
    assert.match(avery.body, /I'm Sam Sender with CompNinja/);
    assert.match(acceptPath(avery), new RegExp(`m=${avery.id}&t=[0-9a-f]{32}$`));
    // A broker with a phone number only has nothing drafted to send.
    assert.equal(matchNamed(db, "Devon Hale").body, null);
  });

  await t.test("no broker was mailed, and no draft names the person who asked", () => {
    for (const m of db.tables.bov_matches) {
      if (m.email) assert.equal(mailTo(db, m.email).length, 0, `${m.name} was mailed before anyone pressed Send`);
      for (const secret of ["Olive", "olive@owner.test", "555-0142", "Owner Holdings"]) {
        assert.ok(!String(m.body || "").includes(secret), `${m.name}'s draft leaked "${secret}"`);
      }
    }
    assert.equal(db.sent.length, 3);
  });

  await t.test("the requester's acknowledgment comes from the sender and states the number on file", () => {
    const [ack] = mailTo(db, LEAD.email);
    assert.ok(ack, "the requester was acknowledged");
    assert.equal(ack.from, SENDER);
    assert.equal(ack.reply_to, "sam@site.test");
    assert.match(ack.text, new RegExp(REPORT.replace(/[.]/g, "\\.")));
    assert.match(ack.text, /The broker will have \(401\) 555-0142 as the best number to reach you/);
    assert.match(ack.text, /not an appraisal/);
  });

  await t.test("the owner is told what is waiting and where", () => {
    const notices = mailTo(db, OWNER);
    assert.equal(notices.length, 2);
    const desk = notices.find((m) => /^BOV desk:/.test(m.subject));
    assert.equal(desk.subject, "BOV desk: 5 brokers found for 982 Warwick Avenue, Warwick, RI");
    assert.match(desk.text, /Broker 1: Avery Stone \(Stone CRE\), avery@stonecre\.test/);
    assert.match(desk.text, /Read the 4 drafts and press Send/);
    assert.match(desk.text, /https:\/\/site\.test\/admin\/bov/);
  });

  await t.test("opening the desk only reads: no mail, no search, no write", async () => {
    const before = { mail: db.sent.length, searches: provider.calls.length,
      writes: db.requests.filter((r) => r.method !== "GET").length };
    const page = await fetch(srv.base + "/admin/bov");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /BOV desk/);
    assert.ok(!html.includes("Olive") && !html.includes("Avery"), "the page shell carries no data");
    assert.equal((await readDesk(srv, "wrong-key")).status, 401);
    const res2 = await readDesk(srv);
    assert.equal(res2.status, 200);
    const desk = await res2.json();
    await fake.waitForMail(db, before.mail);
    assert.equal(db.sent.length, before.mail);
    assert.equal(provider.calls.length, before.searches);
    assert.equal(db.requests.filter((r) => r.method !== "GET").length, before.writes);

    assert.equal(desk.ready, true);
    assert.equal(desk.autopilot, false);
    assert.deepEqual(desk.mail, { ready: true, from: SENDER, replyTo: "sam@site.test" });
    assert.deepEqual(desk.attention, { toSend: 4, toIntroduce: 0 });
    assert.equal(desk.requests.length, 1);
    const [req] = desk.requests;
    assert.equal(req.state, "ready");
    assert.equal(req.lead.name, "Olive Owner");
    assert.equal(req.report_url, REPORT);
    assert.equal(req.matches.length, 5);
    const g = new URL(req.matches[0].gmail_url);
    assert.equal(g.searchParams.get("to"), "avery@stonecre.test");
    assert.equal(g.searchParams.get("authuser"), "sam@site.test");
    assert.equal(req.matches[3].gmail_url, "", "nothing to compose for a broker with no address");
  });

  await t.test("Send goes to one broker, as edited, and is marked only once it went", async () => {
    const avery = matchNamed(db, "Avery Stone");
    const edited = avery.body.replace("Hi Avery,", "Hello Avery,");
    const mailBefore = db.sent.length;
    const out = await act(srv, { action: "send", match_id: avery.id, body: edited });
    assert.deepEqual(out, { status: 200, body: { ok: true, sent: 1 } });
    await fake.waitForMail(db, mailBefore + 1);
    assert.equal(db.sent.length, mailBefore + 1, "exactly one email");
    const mail = db.sent[db.sent.length - 1];
    assert.deepEqual(toOf(mail), ["avery@stonecre.test"]);
    assert.equal(mail.from, SENDER);
    assert.equal(mail.reply_to, "sam@site.test");
    assert.equal(mail.subject, "BOV request: office building, 982 Warwick Avenue, Warwick, RI");
    assert.equal(mail.text, edited);
    assert.equal(matchNamed(db, "Avery Stone").status, "sent");
    assert.ok(matchNamed(db, "Avery Stone").sent_at);
    // The address was not touched, so it keeps the check it earned.
    assert.equal(matchNamed(db, "Avery Stone").email_check, "match");
    // A second press is refused, not a second email.
    assert.equal((await act(srv, { action: "send", match_id: avery.id })).status, 409);
    await fake.waitForMail(db, mailBefore + 1);
    assert.equal(db.sent.length, mailBefore + 1);
  });

  await t.test("a broker with a phone number only is drafted when given an address, and not sent unread", async () => {
    const devon = matchNamed(db, "Devon Hale");
    const mailBefore = db.sent.length;
    const out = await act(srv, { action: "send", match_id: devon.id, email: "Devon@HalePartners.test" });
    assert.deepEqual(out.body, { ok: true, sent: 0, drafted: true });
    const after = matchNamed(db, "Devon Hale");
    assert.equal(after.email, "devon@halepartners.test");
    assert.equal(after.email_check, "manual");
    assert.equal(after.status, "draft");
    assert.match(after.body, /^Hi Devon,/);
    await fake.waitForMail(db, mailBefore);
    assert.equal(db.sent.length, mailBefore, "the owner has not read that draft yet");
  });

  await t.test("the link shows the offer on GET and changes nothing", async () => {
    const avery = matchNamed(db, "Avery Stone");
    const mailBefore = db.sent.length;
    const res3 = await fetch(srv.base + acceptPath(avery));
    assert.equal(res3.status, 200);
    assert.match(res3.headers.get("x-robots-tag") || "", /noindex/);
    const html = await res3.text();
    assert.match(html, /Take on this Broker Opinion of Value\?/);
    assert.match(html, /982 Warwick Avenue, Warwick, RI/);
    assert.match(html, /Yes, introduce me to the owner/);
    for (const secret of ["Olive", "olive@owner.test", "555-0142", "Owner Holdings"]) {
      assert.ok(!html.includes(secret), `the offer page showed "${secret}"`);
    }
    await fake.waitForMail(db, mailBefore);
    assert.equal(db.sent.length, mailBefore, "a mail scanner fetching the link introduces nobody");
    assert.equal(matchNamed(db, "Avery Stone").status, "sent");
    assert.equal(db.tables.bov_requests[0].introduced_match_id, null);
  });

  await t.test("a link that was cut short or forged opens nothing", async () => {
    const avery = matchNamed(db, "Avery Stone");
    const forged = `/bov/accept?m=${avery.id}&t=${"0".repeat(32)}`;
    for (const method of ["GET", "POST"]) {
      const r = await fetch(srv.base + forged, { method });
      assert.equal(r.status, 400);
      assert.match(await r.text(), /This link is not recognized/);
    }
    assert.equal((await fetch(srv.base + "/bov/accept")).status, 400);
    assert.equal(matchNamed(db, "Avery Stone").status, "sent");
  });

  await t.test("\"No thanks\" is recorded and introduces nobody", async () => {
    const casey = matchNamed(db, "Casey Moor");
    const mailBefore = db.sent.length;
    const r = await fetch(srv.base + acceptPath(casey) + "&no=1", { method: "POST" });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Thanks for letting us know/);
    assert.equal(matchNamed(db, "Casey Moor").status, "declined");
    await fake.waitForMail(db, mailBefore);
    assert.equal(db.sent.length, mailBefore);
  });

  await t.test("accepting introduces the two in one email, and tells the owner", async () => {
    const avery = matchNamed(db, "Avery Stone");
    const mailBefore = db.sent.length;
    const r = await fetch(srv.base + acceptPath(avery), { method: "POST" });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /You&#39;re introduced|You're introduced/);
    await fake.waitForMail(db, mailBefore + 2);
    assert.equal(db.sent.length, mailBefore + 2, "the introduction and the owner's notice");
    const intro = db.sent.find((m) => /^Introduction:/.test(m.subject));
    assert.deepEqual(toOf(intro), ["olive@owner.test", "avery@stonecre.test"]);
    assert.deepEqual(intro.cc, ["sam@site.test"]);
    assert.equal(intro.from, SENDER);
    assert.match(intro.text, /Olive, this is Avery Stone of Stone CRE, a local broker/);
    assert.match(intro.text, /Olive Owner: olive@owner\.test · \(401\) 555-0142/);
    assert.match(intro.text, /CompNinja is not a brokerage/);
    const notice = db.sent.find((m) => /^BOV: Avery Stone accepted/.test(m.subject));
    assert.deepEqual(toOf(notice), [OWNER]);
    assert.match(notice.text, /Sent to olive@owner\.test and avery@stonecre\.test\. Nothing for you to do\./);

    assert.equal(matchNamed(db, "Avery Stone").status, "introduced");
    assert.equal(db.tables.bov_requests[0].state, "introduced");
    assert.equal(db.tables.bov_requests[0].introduced_match_id, avery.id);
  });

  await t.test("the next broker is told it is taken, and a second click resends nothing", async () => {
    const blake = matchNamed(db, "Blake Rivers");
    const mailBefore = db.sent.length;
    for (const method of ["GET", "POST"]) {
      const r = await fetch(srv.base + acceptPath(blake), { method });
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.match(html, /This one has been taken/);
      assert.ok(!html.includes("982 Warwick"), "a broker who lost it is not shown the address again");
    }
    const again = await fetch(srv.base + acceptPath(matchNamed(db, "Avery Stone")), { method: "POST" });
    assert.match(await again.text(), /already been introduced/);
    await fake.waitForMail(db, mailBefore);
    assert.equal(db.sent.length, mailBefore);
    assert.equal(matchNamed(db, "Blake Rivers").status, "draft");
    // The requester's details went out in exactly one mail to anyone but the
    // requester and the owner: the introduction.
    const leaked = db.sent.filter((m) => m.text.includes("olive@owner.test") &&
      !toOf(m).includes("olive@owner.test") && !toOf(m).includes(OWNER));
    assert.deepEqual(leaked, []);
  });

  await t.test("a second request in the market reuses those brokers and searches nothing", async () => {
    const searches = provider.calls.length;
    const res4 = await postLead(srv, { name: "Second Asker", email: "second@asker.test", phone: "",
      address: "45 Post Road, Warwick, RI", report_url: undefined });
    assert.equal(res4.status, 200);
    await until(() => db.tables.bov_requests.length === 2 && db.tables.bov_requests[1].state === "ready",
      "the second request to be ready");
    assert.equal(provider.calls.length, searches, "the bench answered; no search was billed");
    const second = db.tables.bov_requests[1];
    const mine = db.tables.bov_matches.filter((m) => String(m.lead_id) === String(second.lead_id));
    // The broker who said yes leads; the one who passed is not offered again.
    assert.deepEqual(mine.map((m) => m.name), ["Avery Stone", "Blake Rivers", "Devon Hale", "Emery Lake"]);
    // The address the owner typed for Devon came along with them.
    assert.equal(mine[2].email, "devon@halepartners.test");
    assert.ok(mine.every((m) => m.origin === "bench" && m.status === "draft"));
    assert.match(mine[0].body, /45 Post Road, Warwick, RI/);
    assert.doesNotMatch(mine[0].body, /982 Warwick|Second Asker|abc123XYZ/);
    assert.notEqual(acceptPath(mine[0]), acceptPath(matchNamed(db, "Avery Stone")), "a link of its own");
    assert.deepEqual(db.unparsed, []);
  });
});

test("autopilot sends only what a page proved, in the plain wording", async (t) => {
  const { db, srv } = await bootDesk(t, { env: { BOV_AUTOPILOT: "on" } });
  assert.equal((await postLead(srv)).status, 200);
  // Owner notice, acknowledgment, two sends, desk notice.
  await fake.waitForMail(db, 5);
  await until(() => /^BOV desk:/.test((db.sent[db.sent.length - 1] || {}).subject || ""), "the desk notice");
  assert.equal(db.sent.length, 5);
  assert.equal(mailTo(db, "avery@stonecre.test").length, 1);
  assert.equal(mailTo(db, "blake@riversgroup.test").length, 1);
  assert.equal(mailTo(db, "casey.moor@gmail.com").length, 0, "a free-mail address waits for a person");
  assert.equal(mailTo(db, "emery@lakecommercial.test").length, 0, "an address off the page's site waits for a person");
  const [sent] = mailTo(db, "avery@stonecre.test");
  assert.doesNotMatch(sent.text, /Greater Rhode Island/, "an unread send carries none of the search's own words");
  assert.match(sent.text, /I'm looking for a local broker who handles office buildings around Warwick, RI/);
  assert.deepEqual(db.tables.bov_matches.map((m) => m.status), ["sent", "sent", "draft", "draft", "draft"]);
  // The drafts a person will read keep the clause.
  assert.match(matchNamed(db, "Emery Lake").body, /with your investment sales work/);
  const desk = db.sent.find((m) => /^BOV desk:/.test(m.subject));
  assert.match(desk.text, /Sent automatically: 2 of 5 \(autopilot is on\)/);
  assert.match(desk.text, /Read the 2 drafts and press Send/);
  assert.equal((await (await readDesk(srv)).json()).autopilot, true);

  await t.test("a second request in the market does not mail the same brokers again", async () => {
    const mailBefore = db.sent.length;
    assert.equal((await postLead(srv, { name: "Second Asker", email: "second@asker.test",
      address: "45 Post Road, Warwick, RI" })).status, 200);
    await until(() => db.tables.bov_requests.length === 2 && db.tables.bov_requests[1].state === "ready",
      "the second request to be ready");
    // The owner's notice, the acknowledgment and the desk notice: no broker.
    await fake.waitForMail(db, mailBefore + 3);
    assert.equal(db.sent.length, mailBefore + 3);
    assert.equal(mailTo(db, "avery@stonecre.test").length, 1, "one unread email to a broker in the rest period");
    assert.equal(mailTo(db, "blake@riversgroup.test").length, 1);
    const second = db.tables.bov_matches.filter((m) => String(m.lead_id) === String(db.tables.bov_requests[1].lead_id));
    assert.ok(second.length >= 2 && second.every((m) => m.status === "draft"), "they wait on the desk instead");
  });

  await t.test("a request whose text is not an address and a name is held for a person", async () => {
    const mailBefore = db.sent.length;
    // A new market, so nothing here is resting: only the text holds it.
    assert.equal((await postLead(srv, { name: "Click evil.com now", email: "third@asker.test",
      address: "77 Elm Street, Cranston, RI" })).status, 200);
    await until(() => db.tables.bov_requests.length === 3 && db.tables.bov_requests[2].state === "ready",
      "the third request to be ready");
    await fake.waitForMail(db, mailBefore + 3);
    assert.equal(db.sent.length, mailBefore + 3, "nothing went to a broker");
    const notice = db.sent[db.sent.length - 1];
    assert.match(notice.text, /Autopilot held this one/);
    const third = db.tables.bov_matches.filter((m) => String(m.lead_id) === String(db.tables.bov_requests[2].lead_id));
    assert.ok(third.every((m) => m.status === "draft"));
    // Held for a person, so the drafts keep the wording a person reads.
    assert.match(third[0].body, /with your office sales work across Greater Rhode Island/);
  });
});

test("an unrun migration 065 costs the desk and never the request", async (t) => {
  const { db, provider, srv } = await bootDesk(t, { fakeOpts: { missingTables: ["bov_requests", "bov_matches"] } });
  assert.equal((await postLead(srv)).status, 200);
  await fake.waitForMail(db, 2);
  assert.equal(db.sent.length, 2, "the owner's notice and the acknowledgment still went");
  assert.equal(db.tables.leads.length, 1, "the request is stored");
  assert.equal(provider.calls.length, 0, "nothing was searched for that could not be stored");
  assert.ok(await srv.alive(), "the server is still up");

  const desk = await (await readDesk(srv)).json();
  assert.equal(desk.ready, false);
  assert.equal(desk.requests.length, 1, "the request is still listed");
  assert.deepEqual(desk.requests[0].matches, []);
  const out = await act(srv, { action: "find", lead_id: desk.requests[0].lead.id });
  assert.equal(out.status, 503);
  assert.equal(out.body.code, "migration");
  assert.match(out.body.error, /065/);
  const stats = await (await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": KEY } })).json();
  assert.deepEqual(stats.bovDesk, { db: true, ready: false });
});

test("with no outbound mail the desk drafts, and every send is the owner's own", async (t) => {
  const { db, srv } = await bootDesk(t, { env: { EMAIL_FROM: "" } });
  assert.equal((await postLead(srv)).status, 200);
  await until(() => (db.tables.bov_requests || []).some((r) => r.state === "ready"), "the desk to be ready");
  // Only the owner is reachable: the new-lead notice and the desk notice.
  await fake.waitForMail(db, 2);
  assert.ok(db.sent.every((m) => toOf(m).includes(OWNER)));
  const desk = await (await readDesk(srv)).json();
  assert.equal(desk.mail.ready, false);

  const avery = matchNamed(db, "Avery Stone");
  const send = await act(srv, { action: "send", match_id: avery.id });
  assert.equal(send.status, 503);
  assert.equal(send.body.code, "no_mail");
  assert.equal(matchNamed(db, "Avery Stone").status, "draft", "nothing is marked sent that was not");
  // Sent by hand from the owner's own mailbox, then recorded.
  assert.equal((await act(srv, { action: "mark", match_id: avery.id, status: "sent" })).status, 200);
  assert.equal(matchNamed(db, "Avery Stone").status, "sent");

  // The broker accepts. No introduction can be sent, so they are told it is
  // coming and the owner is told to make it.
  const mailBefore = db.sent.length;
  const r = await fetch(srv.base + acceptPath(avery), { method: "POST" });
  assert.match(await r.text(), /This one is yours/);
  await fake.waitForMail(db, mailBefore + 1);
  const notice = db.sent[db.sent.length - 1];
  assert.match(notice.subject, /^BOV: Avery Stone accepted/);
  assert.match(notice.text, /NOT sent/);
  assert.equal(matchNamed(db, "Avery Stone").status, "accepted");
  assert.equal(db.tables.bov_requests[0].introduced_match_id, avery.id, "it is still theirs");
  assert.equal(db.tables.bov_requests[0].state, "ready");
  assert.deepEqual((await (await readDesk(srv)).json()).attention, { toSend: 3, toIntroduce: 1 });

  // The desk hands the owner the introduction to send themselves.
  const intro = await act(srv, { action: "introduce", match_id: avery.id });
  assert.equal(intro.status, 503);
  assert.equal(intro.body.code, "no_mail");
  const g = new URL(intro.body.gmail_url).searchParams;
  assert.equal(g.get("to"), "olive@owner.test,avery@stonecre.test");
  assert.match(g.get("body"), /Olive, this is Avery Stone of Stone CRE/);
  assert.equal(matchNamed(db, "Avery Stone").status, "accepted");
  assert.equal((await act(srv, { action: "introduced", match_id: avery.id })).status, 200);
  assert.equal(matchNamed(db, "Avery Stone").status, "introduced");
  assert.equal(db.tables.bov_requests[0].state, "introduced");
});

test("a send the mail provider refuses is not marked sent", async (t) => {
  const { db, srv } = await bootDesk(t, { fakeOpts: { resendStatus: 500 } });
  assert.equal((await postLead(srv)).status, 200);
  await until(() => (db.tables.bov_requests || []).some((r) => r.state === "ready"), "the desk to be ready");
  const avery = matchNamed(db, "Avery Stone");
  const out = await act(srv, { action: "send", match_id: avery.id });
  assert.equal(out.status, 502);
  assert.equal(matchNamed(db, "Avery Stone").status, "draft");
  assert.equal(matchNamed(db, "Avery Stone").sent_at, null);
  // And an introduction it refuses introduces nobody.
  const r = await fetch(srv.base + acceptPath(avery), { method: "POST" });
  assert.match(await r.text(), /This one is yours/);
  assert.equal(matchNamed(db, "Avery Stone").status, "accepted");
  assert.equal(db.tables.bov_requests[0].state, "ready");
});

test("BOV_AUTOMATION=off is the old lead route, and the desk still works by hand", async (t) => {
  const { db, provider, srv } = await bootDesk(t, { env: { BOV_AUTOMATION: "off" } });
  assert.equal((await postLead(srv)).status, 200);
  await fake.waitForMail(db, 2);
  assert.equal(db.sent.length, 2);
  assert.equal(provider.calls.length, 0);
  assert.equal((db.tables.bov_requests || []).length, 0);

  const desk = await (await readDesk(srv)).json();
  assert.equal(desk.automation, false);
  assert.equal(desk.requests[0].state, "new");
  // A report link that is not this site's is refused before anything runs.
  const bad = await act(srv, { action: "find", lead_id: desk.requests[0].lead.id, report_url: "https://evil.test/r/abc123XYZ" });
  assert.equal(bad.status, 400);
  assert.equal(provider.calls.length, 0);
  const out = await act(srv, { action: "find", lead_id: desk.requests[0].lead.id, report_url: REPORT });
  assert.deepEqual(out.body, { ok: true, state: "ready", added: 5, note: null });
  assert.equal(provider.calls.length, 1);
  assert.equal(db.tables.bov_requests[0].report_url, REPORT);
  await fake.waitForMail(db, 2);
  assert.equal(db.sent.length, 2, "finding by hand mails nobody");

  await t.test("a broker the owner knows is added with a draft, once", async () => {
    const lead_id = desk.requests[0].lead.id;
    assert.equal((await act(srv, { action: "add", lead_id, name: "Jo", email: "jo@park.test" })).status, 400);
    const add = await act(srv, { action: "add", lead_id, name: "Jo Park", firm: "Park CRE", email: "jo@park.test" });
    assert.equal(add.status, 200);
    const jo = matchNamed(db, "Jo Park");
    assert.equal(jo.origin, "manual");
    assert.equal(jo.email_check, "manual");
    assert.match(jo.body, /^Hi Jo,/);
    assert.equal((await act(srv, { action: "add", lead_id, name: "Jo Park", firm: "Park CRE", email: "jo@park.test" })).status, 409);
  });

  await t.test("the owner may give a request to the broker of their choice", async () => {
    const blake = matchNamed(db, "Blake Rivers");
    const mailBefore = db.sent.length;
    const out2 = await act(srv, { action: "introduce", match_id: blake.id });
    assert.deepEqual(out2.body, { ok: true, introduced: true });
    await fake.waitForMail(db, mailBefore + 1);
    const intro = db.sent[db.sent.length - 1];
    assert.deepEqual(toOf(intro), ["olive@owner.test", "blake@riversgroup.test"]);
    assert.equal(matchNamed(db, "Blake Rivers").status, "introduced");
    assert.equal(db.tables.bov_requests[0].state, "introduced");
  });

  await t.test("closing a request takes its links down; reopening puts them back", async () => {
    const lead_id = desk.requests[0].lead.id;
    assert.equal((await act(srv, { action: "close", lead_id })).body.state, "closed");
    const avery = matchNamed(db, "Avery Stone");
    assert.match(await (await fetch(srv.base + acceptPath(avery))).text(), /This one has been taken/);
    assert.equal((await act(srv, { action: "reopen", lead_id })).body.state, "introduced");
  });

  await t.test("an unknown action, a missing row and a bad id are refused", async () => {
    assert.equal((await act(srv, { action: "explode" })).status, 404);
    assert.equal((await act(srv, { action: "send", match_id: crypto.randomUUID() })).status, 404);
    assert.equal((await act(srv, { action: "find", lead_id: "1;drop table leads" })).status, 404);
    assert.equal((await act(srv, { action: "mark", match_id: matchNamed(db, "Avery Stone").id, status: "introduced" })).status, 400);
  });
  assert.deepEqual(db.unparsed, []);
});

test("a search that fails or finds nobody says so, and the request is kept", async (t) => {
  const { db, provider, srv } = await bootDesk(t);
  provider.state.status = 500;
  assert.equal((await postLead(srv)).status, 200);
  await until(() => (db.tables.bov_requests || []).some((r) => r.state === "failed"), "the failed search to be recorded");
  await fake.waitForMail(db, 3);
  const notice = db.sent.find((m) => /^BOV desk:/.test(m.subject));
  assert.equal(notice.subject, "BOV desk: no broker found yet for 982 Warwick Avenue, Warwick, RI");
  assert.match(db.tables.bov_requests[0].note, /could not be run/);

  // The retry is a click, never a timer.
  provider.state.status = 200;
  provider.state.answer = "I could not find anyone suitable.";
  const lead_id = db.tables.leads[0].id;
  assert.equal((await act(srv, { action: "find", lead_id })).body.state, "failed");
  provider.state.answer = { brokers: [] };
  const none = await act(srv, { action: "find", lead_id });
  assert.equal(none.body.state, "none_found");
  assert.match(none.body.note, /found no broker/);
  provider.state.answer = FOUND;
  assert.equal((await act(srv, { action: "find", lead_id })).body.added, 5);
  assert.equal(provider.calls.length, 4);
});

test("a member broker who asks for a lead from their pipeline is on the desk as accepted", async (t) => {
  const DAY = 86400000;
  const TOKEN = "test-session-token";
  const { db, srv } = await bootDesk(t, {
    env: { PRO_ENABLED: "on" },
    tables: {
      users: [{ id: "u1", email: "member@brokerage.test", name: "Morgan Member", vault_beta: true }],
      sessions: [{ id: "s1", user_id: "u1", token_hash: crypto.createHash("sha256").update(TOKEN).digest("hex"),
        expires_at: new Date(Date.now() + 30 * DAY).toISOString() }],
      leads: [{ id: 41, ts: new Date(Date.now() - DAY).toISOString(), name: "Olive Owner", email: "olive@owner.test",
        phone: "401-555-0142", company: "", address: "982 Warwick Avenue, Warwick, RI", type: "Office", source: "bov" }],
      broker_coverage: [{ id: "c1", user_id: "u1", market: "Warwick, RI", property_type: "Office", source: "chosen" }],
    },
  });
  const r = await fetch(srv.base + "/api/broker/leads/intro", {
    method: "POST",
    headers: { cookie: `cn_session=${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ lead_id: "41" }),
  });
  assert.equal(r.status, 200, await r.text());
  await until(() => (db.tables.bov_matches || []).length === 1, "the broker to reach the desk");
  const [m] = db.tables.bov_matches;
  assert.equal(m.origin, "platform");
  assert.equal(m.status, "accepted");
  assert.equal(m.email, "member@brokerage.test");
  assert.equal(String(m.lead_id), "41");
  await fake.waitForMail(db, 1);
  assert.match(db.sent[0].text, /Introduce them in one click: https:\/\/site\.test\/admin\/bov/);
  // Nothing was sent to the requester or the broker: the owner still decides.
  assert.ok(db.sent.every((x) => toOf(x).includes(OWNER)));
  const desk = await (await readDesk(srv)).json();
  assert.deepEqual(desk.attention, { toSend: 0, toIntroduce: 1 });
  // One press introduces them.
  const out = await act(srv, { action: "introduce", match_id: m.id });
  assert.deepEqual(out.body, { ok: true, introduced: true });
  await fake.waitForMail(db, 2);
  assert.deepEqual(toOf(db.sent[1]), ["olive@owner.test", "member@brokerage.test"]);
  assert.deepEqual(db.unparsed, []);
});
