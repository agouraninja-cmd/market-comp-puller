// Firm messaging route wiring — the gates and the routing, not the rules.
//
// messaging.test.js already proves the DECISIONS are right. Nothing there
// proves they are WIRED: that /messages really renders, that every
// /api/messages* route really refuses an anonymous caller, that the prefix is
// really outside the hub block's 404, and that the page really ships no
// message data to a browser the server has not authenticated.
//
// Spec: docs/superpowers/specs/2026-09-01-firm-messaging-design.md
//
// Cost: zero. Nothing here calls Supabase, Anthropic or Stripe. The bare
// server has no database, which is the state several of these assert on.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("messaging routes on a bare server (no database)", async (t) => {
  // The wall left ON. /messages is a signed-in surface and must behave like
  // one with the wall in its live state, not in a state no deployment runs.
  const srv = await shared.boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("/messages renders its own page, not the wall's landing page", async () => {
    const r = await fetch(srv.base + "/messages");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    const html = await r.text();
    assert.match(html, /Your firm's messages/);
    // Discriminating on CONTENT, never on the 200: since 2026-08-08 the wall
    // answers 200 as well, so a status code proves nothing about which page
    // replied.
    assert.doesNotMatch(html, /id="compForm"/);
  });

  await t.test("the page is noindex and no-store, like every signed-in surface", async () => {
    const r = await fetch(srv.base + "/messages");
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(r.headers.get("cache-control") || "", /no-store/);
    // vary: cookie, because the header above it is decided on the session
    // cookie. Without it a cached anonymous copy is re-served to somebody who
    // has just signed in — /how-it-works' lesson.
    assert.match(r.headers.get("vary") || "", /cookie/);
    assert.match(await r.text(), /name="robots" content="noindex/);
  });

  await t.test("a query string does not 404 the page", async () => {
    // pagePath, not req.url. A link somebody shares carries ?fbclid= and an
    // exact match made every shared market page a 404 for whoever clicked it.
    assert.equal((await fetch(srv.base + "/messages?t=abc&fbclid=x")).status, 200);
  });

  await t.test("the page ships NO message data to an unauthenticated browser", async () => {
    // If this ever fails, somebody has server-rendered a firm's correspondence
    // into a page served to a visitor with no session.
    const html = await (await fetch(srv.base + "/messages")).text();
    assert.doesNotMatch(html, /"messages":\s*\[/);
    assert.doesNotMatch(html, /"snapshot":/);
    // The boot payload is the refusal and nothing else.
    assert.match(html, /var BOOT = \{"s":401/);
  });

  await t.test("the page's own script is not nested inside the shared nav's script", async () => {
    // ACCOUNT_NAV_JS is a COMPLETE <script>…</script> block. Interpolating one
    // inside another closes the tag early and dumps the whole page script onto
    // the screen as visible text — it still renders 200 and still serves valid
    // HTML, so only looking at it (or this) catches it. hub-page.js shipped
    // exactly that bug.
    const html = await (await fetch(srv.base + "/messages")).text();
    const i = html.indexOf("var BOOT =");
    assert.ok(i > 0, "the page script should be on the page");
    assert.ok(html.lastIndexOf("<script>", i) > html.lastIndexOf("</script>", i),
      "the messages script is nested inside another script block");
  });

  await t.test("every API route refuses an anonymous caller with 401", async () => {
    // The gate's FIRST refusal, on every door. A route that forgot openMessaging
    // would answer 404 or 503 here instead.
    const calls = [
      ["GET", "/api/messages"],
      ["GET", "/api/messages/thread?id=x"],
      ["GET", "/api/messages/comps?thread=x"],
      ["POST", "/api/messages/thread"],
      ["POST", "/api/messages/send"],
      ["POST", "/api/messages/read"],
      ["POST", "/api/messages/comp/save"],
          ["GET", "/api/messages/unread"],
    ];
    for (const [method, url] of calls) {
      const r = await fetch(srv.base + url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(r.status, 401, `${method} ${url} should refuse an anonymous caller`);
    }
  });

  await t.test("an unknown /api/messages/* path is a 404 from this block, not the hub's", async () => {
    const r = await fetch(srv.base + "/api/messages/nope");
    assert.equal(r.status, 404);
  });

  await t.test("the prefix does not collide with the comp hub's block", async () => {
    // /api/hub's single `if` swallows everything under /api/hub/ with its own
    // 404. This is the check that the new routes are outside it, and that the
    // hub's own routes still answer as they did.
    assert.equal((await fetch(srv.base + "/api/hub?id=abc123def")).status, 503);
  });
});

// ---------------------------------------------------------------------------
// Source-level rules. These read the file rather than the wire because the
// failure each one describes is invisible from outside: the route answers
// normally and the wrong data moves.
// ---------------------------------------------------------------------------

test("every thread read carries the caller's own firm", () => {
  const SERVER_JS = read("server.js");
  // The SECOND WALL. A thread id always arrives from the browser and proves
  // nothing, so the membership check is what authorizes and this is what makes
  // a bug in it something other than a cross-firm leak. In the QUERY rather
  // than checked after the read, so a row from another firm never arrives in
  // this process at all.
  //
  // (030's "never widen a user_id read into an org read" rule is real and
  // applies here too — test/org-routes.test.js owns it for the whole file.)
  for (const fn of ["msgThreadRow", "msgThreadRowsByIds"]) {
    const at = SERVER_JS.indexOf(`async function ${fn}(`);
    assert.notEqual(at, -1, `${fn} is gone`);
    const body = SERVER_JS.slice(at, SERVER_JS.indexOf("\n}\n", at));
    assert.match(body, /org_id=eq\./,
      `${fn} reads a thread without scoping it to the caller's firm`);
  }
});

test("the comps a message carries are read back scoped to the sender", () => {
  const SERVER_JS = read("server.js");
  // The hub's vault-send rule. Without user_id in this filter, naming another
  // broker's comp id in the request body would put their private deal in a
  // thread they are not in.
  const at = SERVER_JS.indexOf('msgPath === "/api/messages/send"');
  assert.notEqual(at, -1, "the send route is gone");
  const body = SERVER_JS.slice(at, at + 6000);
  assert.match(body, /broker_comps\?user_id=eq\.\$\{encodeURIComponent\(g\.user\.id\)\}/,
    "the send route reads comps without scoping them to the sender");
});

test("a shared comp is never a foreign key back into a live vault row", () => {
  const SQL = read("migrations/044-firm-messaging.sql");
  // The decision the whole feature rests on: a message is a RECORD OF WHAT WAS
  // SAID. org_comps references broker_comps on delete cascade, which is right
  // for a live copy and wrong for correspondence — deleting the vault comp
  // would delete what a colleague read last week.
  const at = SQL.indexOf("create table if not exists msg_comps");
  const block = SQL.slice(at, SQL.indexOf(");", at));
  assert.match(block, /source_comp_id uuid/, "source_comp_id is gone");
  assert.ok(!/source_comp_id uuid[^,]*references/.test(block),
    "source_comp_id has grown a foreign key — a vault delete would now rewrite a thread");
  assert.match(block, /snapshot jsonb not null/,
    "the snapshot is what makes the record survive; it cannot be nullable");
});

test("saving a received comp goes through the vault's own validator", () => {
  const SERVER_JS = read("server.js");
  // The undo-a-delete precedent: a comp the vault would refuse to be told
  // today must not arrive by message either. An insert built straight from the
  // snapshot would bypass every rule broker-vault.js enforces.
  const at = SERVER_JS.indexOf('msgPath === "/api/messages/comp/save"');
  assert.notEqual(at, -1, "the save route is gone");
  const body = SERVER_JS.slice(at, at + 4000);
  assert.match(body, /VAULT\.normalizeRow\(/,
    "the save route inserts without running the vault's own normalizer");
  assert.match(body, /deal_date: snap\.deal_date == null \? "undated"/,
    "an undated vault comp (042) can no longer be saved — normalizeRow refuses a blank date");
});

test("messaging tables are read by messaging code and by nothing else", () => {
  const SERVER_JS = read("server.js");
  // 013's separate-tables rule. The corpus, the report blend and the market
  // snapshot swallow their own errors, so a leak into any of them would be
  // silent. Counted over the whole file: every mention of a msg_ table must be
  // inside the messaging section.
  for (const fn of ["harvestComps", "corpusRowsForMarket", "vaultCompsForReport", "orgCompsForReport"]) {
    const at = SERVER_JS.indexOf(`function ${fn}(`);
    if (at === -1) continue;
    const body = SERVER_JS.slice(at, SERVER_JS.indexOf("\n}\n", at));
    assert.ok(!/msg_(threads|messages|comps|thread_members|comp_saves)/.test(body),
      `${fn} reads a messaging table — a firm's correspondence must never reach a report or the corpus`);
  }
});

test("Messages is a row on both rails, in the same place", () => {
  // nav-parity.test.js's rule for a new destination: the rail is one shape
  // drawn by two files, and a row on one side only is the seam that makes
  // clicking between them feel like leaving the product.
  const SERVER_JS = read("server.js");
  const INDEX_HTML = read("index.html");
  // The row's text may carry the unread dot after it (slice 8); the word is
  // what both authors must agree on.
  assert.match(SERVER_JS, /<a href="\/messages"[^>]*>Messages(?:<span id="navMsgDot"[^>]*><\/span>)?<\/a>/,
    "the shared rail has no Messages row");
  assert.match(INDEX_HTML, /id="navMessagesLink" href="\/messages"[^>]*>Messages</,
    "the app's rail has no Messages row");

  // Directly under VAULT on both (owner's placement, 2026-09-01 — it shipped
  // above it for one afternoon), so the sidebar does not reshuffle itself when
  // a member navigates between the app and a server-rendered page. Asserted as
  // a SEQUENCE rather than by position, because the vault row above it ships
  // hidden and closes up for a member without the entitlement.
  const shared_ = SERVER_JS.slice(SERVER_JS.indexOf('<a href="/desk">Workspace</a>'));
  assert.ok(shared_.indexOf('id="navVault"') < shared_.indexOf("/messages"),
    "Messages must sit below Vault on the shared rail");
  assert.ok(shared_.indexOf("/messages") < shared_.indexOf('href="/markets"'),
    "Messages must sit above Market explorer on the shared rail");
  const app = INDEX_HTML.slice(INDEX_HTML.indexOf('id="myDeskLink"'));
  assert.ok(app.indexOf('id="menuVaultLink"') < app.indexOf("navMessagesLink"),
    "Messages must sit below Vault in the app");
  assert.ok(app.indexOf("navMessagesLink") < app.indexOf('href="/markets"'),
    "Messages must sit above Market explorer in the app");

  // It is NOT hidden-and-hydrated like the vault and bulk rows: those ask an
  // entitlement question and this one does not.
  assert.ok(!/id="navMessagesLink"[^>]*\bhidden\b/.test(INDEX_HTML),
    "the app's Messages row ships hidden, so it needs a hydration rule nobody wrote");
});

test("a member reading their messages is not sold a report", () => {
  // CTA_FREE_PAGES: somebody mid-conversation is not deciding whether to run a
  // report, and the way back is the Workspace row, which is still on this bar.
  const SERVER_JS = read("server.js");
  assert.match(SERVER_JS, /CTA_FREE_PAGES = new Set\(\[[^\]]*"\/messages"/,
    "/messages still carries the Run a report CTA");
});


// ---------------------------------------------------------------------------
// Unread, in-app only (Three Spaces, slice 8)
// ---------------------------------------------------------------------------

test("the unread dot sits beside Messages on BOTH rails, hidden until asked, and is hydrated from its own endpoint", () => {
  const SERVER_JS = read("server.js");
  const INDEX_HTML = read("index.html");
  assert.match(SERVER_JS, /<a href="\/messages"[^>]*>Messages<span id="navMsgDot" class="navdot" hidden[^>]*><\/span><\/a>/,
    "the shared rail has no unread dot inside its Messages row");
  assert.match(INDEX_HTML, /id="navMessagesLink" href="\/messages"[^>]*>Messages<span id="navMsgDot" class="navdot" hidden[^>]*><\/span><\/a>/,
    "the app's rail has no unread dot inside its Messages row");
  // Fetched in the after-paint pass on both sides — never on /api/config,
  // which runs on every page load and is under a standing rule against DB
  // reads.
  const navJs = SERVER_JS.slice(SERVER_JS.indexOf("const ACCOUNT_NAV_JS"), SERVER_JS.indexOf("const ACCOUNT_NAV_JS") + 12000);
  assert.match(navJs, /fetch\("\/api\/messages\/unread"/, "ACCOUNT_NAV_JS does not ask for the count");
  assert.match(INDEX_HTML, /fetch\("\/api\/messages\/unread"/, "index.html does not ask for the count");
  const configAt = SERVER_JS.indexOf('req.url === "/api/config"');
  assert.ok(configAt > 0);
  assert.doesNotMatch(SERVER_JS.slice(configAt, configAt + 6000), /msg_|unread/, "/api/config grew a messaging read");
});

test("the author stamps their own cursor after posting, so a thread is never unread to the person who last wrote in it", () => {
  const SERVER_JS = read("server.js");
  const sendAt = SERVER_JS.indexOf('msgPath === "/api/messages/send"');
  const block = SERVER_JS.slice(sendAt, SERVER_JS.indexOf('msgPath === "/api/messages/unread"', sendAt));
  assert.match(block, /touchMsgThread\(id, now\);[\s\S]{0,600}msg_thread_members\?thread_id=eq\.[\s\S]{0,120}\{ last_read_at: now \}/,
    "the send route no longer stamps the author's last_read_at");
});
