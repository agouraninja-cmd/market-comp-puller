// The /messages page renderer.
//
// Run: npm test
//
// WHY THIS FILE EXISTS. The whole page — markup, stylesheet and ~450 lines of
// browser JS — is ONE template literal, which makes it uniquely able to break
// in a way nothing else catches: a stray backtick or a `${` inside a comment
// closes the literal or interpolates, and what ships is broken JavaScript and
// a blank workspace rather than a loud failure. That happened twice while this
// page was being written, and hub-page.js has the same scar. So the test that
// matters most here COMPILES what the page actually emits.
//
// Cost: zero. renderMessagesBody is pure — a boot payload in, a string out.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderMessagesBody } = require("../messages-page");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "messages-page.js"), "utf8");
const scriptOf = (html) => {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, "the page emits no script block");
  return m[1];
};

test("the page's own client script actually parses", () => {
  // The one failure this file exists for. A stray backtick emits a page that
  // still returns 200, still serves valid-looking HTML, and runs nothing.
  new vm.Script(scriptOf(renderMessagesBody({ s: 200, j: {} })));
  new vm.Script(scriptOf(renderMessagesBody(null)));
  new vm.Script(scriptOf(renderMessagesBody({ s: 403, j: { error: "no firm", code: "no_firm" } })));
});

test("the page literal contains exactly one backtick — its own opener", () => {
  // The direct check, so the failure is named rather than diagnosed. A
  // backtick in a COMMENT is the way this breaks, and a comment is exactly
  // where a reviewer stops reading.
  const at = SOURCE.indexOf("return `<style>");
  assert.notEqual(at, -1, "the page literal has moved; this guard now checks nothing");
  const literal = SOURCE.slice(at, SOURCE.lastIndexOf("`;"));
  assert.equal((literal.match(/`/g) || []).length, 1,
    "a backtick inside the page literal closes it early — the page will render and do nothing");
});

test("the boot payload cannot close the script tag or carry a raw control byte", () => {
  // Every "<" is escaped on the way in, which is what keeps a comp note like
  // <img onerror=…> inert and what stops a payload ending the <script>.
  const html = renderMessagesBody({ s: 200, j: { error: "</script><img onerror=alert(1)>" } });
  assert.ok(!html.includes("</script><img"), "the boot payload closed the script tag");
  assert.match(html, /\\u003c\/script/);
  new vm.Script(scriptOf(html));
});

test("no page source carries a raw control character", () => {
  // Literal control bytes in source mangle silently and survive review — a NUL
  // written into a string reads as an ordinary space on screen. Tabs and
  // newlines are ordinary formatting and are allowed.
  const stray = [...SOURCE].filter((c) => {
    const n = c.charCodeAt(0);
    return (n < 32 && n !== 10 && n !== 9) || n === 127;
  });
  assert.equal(stray.length, 0, "messages-page.js holds a raw control character");
});

test("the page ships no thread data of its own", () => {
  // The server hands down the REFUSAL and nothing else. A page that rendered a
  // firm's correspondence into its own markup would be serving it to a browser
  // the server has not authenticated — every read is gated per request.
  const html = renderMessagesBody({ s: 200, j: {} });
  assert.ok(!/"snapshot"/.test(html));
  assert.ok(!/"messages":\s*\[/.test(html));
});

test("the stylesheet is emitted in the BODY, not handed to the shell's head", () => {
  // vault-page.js's rule, and it is load-bearing rather than tidiness: this
  // page redefines shared selectors, so its rules must come AFTER MARKET_CSS
  // in document order to win on equal specificity. marketShell's `head`
  // parameter is emitted BEFORE MARKET_CSS and would lose.
  const html = renderMessagesBody(null);
  assert.ok(html.trimStart().startsWith("<style>"),
    "the page no longer leads with its own stylesheet");
});

test("every id the client script reaches for exists in the markup", () => {
  // The failure mode is a silent null dereference at boot: the page paints and
  // then does nothing, which looks like a slow server rather than a typo.
  const html = renderMessagesBody({ s: 200, j: {} });
  const script = scriptOf(html);
  const markup = html.slice(0, html.indexOf("<script>"));
  const ids = new Set();
  for (const m of script.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)) ids.add(m[1]);
  assert.ok(ids.size > 10, "the id scan found almost nothing; the helper was renamed");
  for (const id of ids) {
    assert.ok(markup.includes(`id="${id}"`), `the script reads #${id}, which the markup does not define`);
  }
});

test("the poll skips a hidden tab, and says so", () => {
  // The hub's rule, and the same known consequence: an automated browser
  // reports document.hidden === true, so no scripted pass can ever witness
  // live sync here. Dropping this guard would poll every background tab of
  // every member of every firm, forever.
  const script = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  assert.match(script, /if \(document\.hidden\) return;/,
    "the poll no longer skips a hidden tab");
  assert.match(script, /IDLE_MS/, "the idle guard is gone");
});

test("a refusal the server already knows is rendered before any fetch", () => {
  // Somebody signed out is told so immediately rather than watching a
  // spinner resolve into a wall.
  const js = scriptOf(renderMessagesBody({ s: 401, j: { error: "Please sign in." } }));
  assert.match(js, /if \(BOOT && BOOT\.s && BOOT\.s !== 200 && !noFirmBoot\) \{/);
  assert.match(js, /if \(BOOT\.s === 401\) gate\('<h3>Please sign in<\/h3>/);
});

test("no firm is a page, not a wall: Reports is theirs, and Chats says what a firm would give them", () => {
  // Until 2026-10-08 a reader in no firm and no deal room got a wall. Reports
  // (sent to you, your links) is every account's, so the page opens for them.
  const html = renderMessagesBody({ s: 403, j: { error: "Messages are for your firm.", code: "no_firm" } });
  const js = scriptOf(html);
  assert.match(js, /var noFirmBoot = BOOT && BOOT\.s === 403 && BOOT\.j && BOOT\.j\.code === "no_firm";/);
  // The list read's no_firm answer opens the page instead of gating it...
  assert.match(js, /if \(o\.s === 403 && o\.j && o\.j\.code === "no_firm"\) \{[\s\S]{0,900}?ungate\(\);/);
  // ...hides what needs a firm, and Chats' own empty state has the doors out.
  assert.match(js, /if \(state\.noFirm\) \{[\s\S]{0,300}?Chats are for your firm/);
  assert.match(html, /href="\/brokers-firms"/);
  assert.match(html, /href="\/desk\?firm=1"/);
});

// ---------------------------------------------------------------------------
// Reports (2026-10-08): Home's Reports tab, moved into Messages
// ---------------------------------------------------------------------------
test("Reports is a second list beside Chats, chosen by data-view, never by className", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  assert.match(html, /role="tablist" aria-label="Messages"/);
  assert.match(html, /id="msgViewChats"[^>]*aria-selected="true"/);
  assert.match(html, /id="msgViewReports"[^>]*aria-selected="false"/);
  assert.match(html, /id="msgReports"/);
  assert.match(html, /id="msgRMain"/);
  // The chat code assigns the page's className whole ("msg-page on-thread"),
  // so a view kept in a class would be wiped by the next thread opened.
  const js = scriptOf(html);
  assert.match(js, /\$\("msgPage"\)\.setAttribute\("data-view", v\);/);
  assert.match(html, /\.msg-page\[data-view="reports"\] #msgThreads/);
  assert.match(html, /\.msg-page:not\(\[data-view="reports"\]\) #msgReports/);
  // /messages#reports opens on it (the old /desk#reports lands there).
  assert.match(js, /var wantReports = String\(location\.hash \|\| ""\) === "#reports";/);
});

test("the Reports rules are report-inbox.js itself, emitted inside the page's one script", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "report-inbox.js"), "utf8");
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  assert.ok(js.includes(src), "the page carries a copy of the rules that is not the tested file");
  assert.ok(!/<\/script/i.test(src), "report-inbox.js holds a closing script tag, which would end the page's script early");
  // The shelf's saved view comes from org-access.js on the server, never a
  // hand copy in the page.
  const ORG = require("../org-access");
  assert.match(js, new RegExp('var SHELF_SAVED = \\{"broker":"","development":"' + ORG.SHOP_COPY.development.shelfType + '"'));
});

test("a report's actions call the routes the Reports tab called, and nothing writes by arriving", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const at = js.indexOf("function reportAction(e){");
  assert.ok(at > 0, "reportAction moved; this guard now checks nothing");
  const fn = js.slice(at, js.indexOf("// --- wiring", at));
  assert.match(fn, /api\("POST", "\/api\/shares\/revoke", \{ id: r\.id \}\)/);
  assert.match(fn, /api\("PUT", "\/api\/shares\/viewers", \{ id: r\.id, emails: emails \}\)/);
  assert.match(fn, /api\("POST", "\/api\/hubs", \{ fromShare: r\.id \}\)/);
  // A revoke is asked first, in the page, and only its own Yes sends it.
  assert.ok(fn.indexOf("data-rep-ask") < fn.indexOf("/api/shares/revoke"));
  assert.match(fn, /if \(e\.target\.closest\("\[data-rep-yes\]"\)\) \{/);
  // The reads are GETs only; a page built before it is seen writes nothing.
  const load = js.slice(js.indexOf("function loadReports(){"), js.indexOf("function reloadReports(){"));
  assert.match(load, /api\("GET", "\/api\/shares"\)/);
  assert.match(load, /api\("GET", "\/api\/org\/shelf\?id=" \+ encodeURIComponent\(firm\.id\)\)/);
  assert.doesNotMatch(load, /"(POST|PUT|PATCH|DELETE)"/);
});

test("a deal room starts only from a link with people to invite, for a member who can open one, and opens in Messages", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  // canAttach is canUseVault (GET /api/messages' canAttachComps), the server's
  // own gate; never a firm share, which has no viewer list to invite.
  assert.match(js, /if \(state\.canAttach && r\.visibility !== "org"\) acts\.push\('<button class="msg-btn" type="button" data-rep-hub="1"/);
  // A room, from either door, opens as a conversation here, never at /hub/.
  assert.match(js, /setView\("chats", \{ noOpen: true \}\);\s*refreshList\(true\)\.then\(function\(\)\{ openExternal\(id, true, true\); \}\);/);
  const detail = js.slice(js.indexOf("function renderReportDetail(){"), js.indexOf("function openReport("));
  assert.doesNotMatch(detail, /"\/hub\//, "a report's room links to the old hub page");
});

test("everything a person typed reaches the Reports view through esc(), and a failed read says nothing was lost", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const rows = js.slice(js.indexOf("function reportRowHtml(r){"), js.indexOf("function sectHtml("));
  for (const field of ["streetOf(r.address)", "sub", "key"]) {
    assert.ok(rows.includes("esc(" + field), "a report row writes " + field + " without esc()");
  }
  const detail = js.slice(js.indexOf("function renderReportDetail(){"), js.indexOf("function openReport("));
  assert.ok(detail.includes("esc(r.url)") && detail.includes("esc(v.email)") && detail.includes("esc(inv.url)"),
    "the open report writes a URL or an email without esc()");
  assert.match(js, /function factsHtml\(list\)\{[\s\S]{0,200}?esc\(f\[0\]\) \+ '<\/dt><dd>' \+ esc\(f\[1\]\)/);
  // A failed shares read is said as a failure, with the reassurance, never
  // drawn as an empty list (the Sharing card's 2026-08-22 rule, carried over).
  assert.match(js, /Couldn\\u2019t load your shared reports just now\. Nothing has been lost\. Refresh in a moment\./);
  assert.match(js, /rep\.shares = o\.s === 200 && o\.j \? o\.j : false;/);
});

test("in Reports the poll reads the list for its counts and opens nothing, so no chat is marked read unseen", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const tick = js.slice(js.indexOf("function tick(){"), js.indexOf("function markActive(){"));
  assert.match(tick, /if \(state\.view === "reports"\) \{ refreshList\(true\); return; \}/);
  assert.ok(tick.indexOf('state.view === "reports"') < tick.indexOf("readThread(false)"));
});


// ---------------------------------------------------------------------------
// Discovery and unread (Three Spaces, slice 8)
// ---------------------------------------------------------------------------
test("a discovery door seeds the composer through the URL, and nothing is posted by arriving", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  assert.match(js, /qp\.get\("say"\)/, "the page does not read ?say=");
  assert.match(js, /qp\.get\("comp"\)/, "the page does not read ?comp=");
  assert.match(js, /state\.draft = \{ text: say, compId: compId \}/);
  // The seed is consumed on arrival, so a reload cannot re-seed a message
  // somebody already sent or discarded.
  assert.match(js, /history\.replaceState\(\{\}, "", wanted \? "\/messages\?t=" \+ encodeURIComponent\(wanted\) : "\/messages"\)/);
  // Applied when a thread opens — text into the box, the comp into the tray
  // — and only through the picker's own rule (the comp must be in the
  // sender's vault), so a comp id in a URL buys nothing the button could not.
  // The whole of openThread, up to the function after it (it was the first
  // 600 characters until 2026-11-16, when keeping each chat's own draft made
  // the function longer than that).
  const open = js.slice(js.indexOf("function openThread(id, push, jump){"), js.indexOf("function readThread("));
  assert.match(open, /applyComposerMode\(\);\s*applyDraft\(\);/, "the draft is not applied when a thread opens");
  const apply = js.slice(js.indexOf("function applyDraft(){"), js.indexOf("function openThread("));
  assert.match(apply, /\$\("msgInput"\)\.value = d\.text/);
  assert.match(apply, /state\.canAttach/);
  assert.match(apply, /That comp isn't among your comps, so it wasn't attached\./);
  assert.doesNotMatch(apply, /\/api\/messages\/send/, "arriving with a draft must never send it");
  // With nobody to say it to yet, the New panel opens first — and only for
  // a reader who HAS a firm, since the picker searches one and a client in a
  // deal room (who reaches this page with no firm since 2026-09-02) would get
  // a panel that can find nobody.
  assert.match(js, /if \(state\.draft && state\.firm\) \{[\s\S]{0,400}openNewPanel\(\);/);
});

// ---------------------------------------------------------------------------
// A guest's deal room (2026-09-02)
// ---------------------------------------------------------------------------
// External used to mean "a room I own", so every owner-only control on this
// page could be drawn from "is this external". A client's room joined the
// list and the two questions came apart.
test("the broker's controls hang off whose room it is, not off it being external", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const at = js.indexOf("function applyComposerMode(){");
  assert.ok(at > 0, "applyComposerMode has moved; this guard now checks nothing");
  const fn = js.slice(at, at + 2400);
  assert.match(fn, /var mine = external && !!row && row\.owner === true;/,
    "the page decides ownership some other way than the server's answer");
  // The guest list is the broker's panel. A guest must not be handed the
  // other addresses in the room, which is why GET /api/hub sends them none.
  assert.match(fn, /\$\("msgPeopleBtn"\)\.className = mine \?/,
    "the guest list opens for somebody who is not the broker");
  assert.match(fn, /\$\("msgPeoplePanel"\)\.className = "msg-panel msg-hide"/);
  // Sending comps into a deal room is owner-only on the server, so the
  // button is not offered where it could only fail.
  assert.match(fn, /state\.canAttach && !closed && \(!external \|\| mine\)/,
    "Attach is offered in a room the reader does not own");
});

test("a reader with no firm gets their rooms, and nothing that needs a firm", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  // New opens firm threads. It goes away rather than failing when pressed.
  assert.match(js, /if \(!state\.firm\) \{\s*\$\("msgNewBtn"\)\.className = "msg-btn primary sm msg-hide";/);
  assert.match(js, /\$\("msgFirmLine"\)\.textContent = "Deal rooms shared with you";/);
  // The Internal / External headings are a way to tell two groups apart, so
  // they appear only when there are two — otherwise a client, external to a
  // firm they are not in, gets a heading saying so.
  assert.match(js, /var both = list\.length > 0 && ext\.length > 0;/);
});

// ---------------------------------------------------------------------------
// The only way to start a deal room (2026-09-04)
// ---------------------------------------------------------------------------
// The vault's hub form is gone, and it carried two fields this panel did not:
// the area (the room's market and subject address) and the property type.
// Without them a room started here was thinner than one started from the
// vault — the client's page fell back to "Comp hub" as a heading and My Desk
// lost its "Industrial · Boise, ID". Both optional, both sent under the
// field names the vault's form used, so the create route is untouched.
test("the New panel carries the area and type the vault's form used to, and sends them", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  assert.match(html, /id="msgNewArea"/, "the area field is gone from the panel");
  assert.match(html, /id="msgNewType"/, "the type select is gone from the panel");
  const js = scriptOf(html);
  // Shown and hidden WITH the about line: these are external-only, like it.
  assert.match(js, /\$\("msgNewMeta"\)\.className = external \? "msg-newmeta" : "msg-newmeta msg-hide";/);
  // Sent under the vault form's names — subjectAddress feeds marketOf() on
  // the server, propertyType is stored as typed.
  const send = js.slice(js.indexOf('api("POST", "/api/hubs"'), js.indexOf('api("POST", "/api/hubs"') + 400);
  assert.match(send, /subjectAddress: \(\$\("msgNewArea"\)\.value \|\| ""\)\.trim\(\)/);
  assert.match(send, /propertyType: \$\("msgNewType"\)\.value \|\| ""/);
  // And cleared when the panel opens, with the rest of it.
  const open = js.slice(js.indexOf("function openNewPanel(){"), js.indexOf("function openNewPanel(){") + 400);
  assert.match(open, /\$\("msgNewArea"\)\.value = "";/);
  assert.match(open, /\$\("msgNewType"\)\.value = "";/);
});

test("a firm of one is still offered the typed-email door", () => {
  // renderNewPeople used to return early when nobody else had joined the
  // firm, before the typed-email row was built — so a solo broker could type
  // a client's address and never be offered the row that starts the room.
  // With the vault's hub form gone (2026-09-04) this panel is the ONLY way
  // to start a deal room, so the door is decided the same way for everyone
  // and the "nobody has joined" sentence is just the list's stand-in.
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const fn = js.slice(js.indexOf("function renderNewPeople(){"), js.indexOf("function openNewPanel(){"));
  assert.ok(!/if \(!people\.length\) \{[\s\S]{0,600}return;/.test(fn),
    "renderNewPeople returns early for a firm of one, before the typed-email door");
  const door = fn.indexOf("data-extpick=");
  const solo = fn.indexOf("Nobody else has joined your firm yet.");
  assert.ok(door > 0 && solo > door, "the door must be decided before the firm-of-one sentence is chosen");
  assert.match(fn, /\$\("msgNewPeople"\)\.innerHTML = html \+ door;/);
});

test("the list is sorted unread first, then most recent, after every read", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const at = js.indexOf("state.threads = j.threads || [];");
  assert.ok(at > 0);
  assert.match(js.slice(at, at + 500), /state\.threads\.sort\(function\(a, b\)\{\s*var ua = a\.unread \? 1 : 0, ub = b\.unread \? 1 : 0;/,
    "unread first is not applied where the list is read");
});

// ---------------------------------------------------------------------------
// The OTHER way one template literal breaks, and the one that shipped.
//
// A backtick closes the literal loudly: the page becomes "NaN" and somebody
// notices within a minute. A single-backslash escape is the quiet version.
// `\s` is not a recognized escape in a template literal, so it collapses to a
// bare `s` — and `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` written in the source ships as
// `/^[^s@]+@[^s@]+.[^s@]+$/`, a character class excluding the LETTER s.
//
// It shipped in PR #255 and reached production. Every address with an "s" in
// it — jason@, chris@, sales@ — was refused by both email checks on the page:
// the New panel silently never offered the invite row, and the People panel
// answered "That doesn't look like an email address." The owner reported it as
// not being able to find how to invite by email, which is what it looked like
// from outside.
//
// A source-level assertion cannot catch this, because the SOURCE is correct.
// These tests read the regex out of the EMITTED script and run it.

const emittedEmailRegexes = () => {
  const script = scriptOf(renderMessagesBody({
    s: 200, j: { me: "u1", firm: "F", people: [], threads: [], canAttachComps: true },
  }));
  const found = [...script.matchAll(/\/\^\[\^[^\]]*\]\+@[^\s/]*\/(?=\.test)/g)].map((m) => m[0]);
  assert.ok(found.length >= 2,
    "the page's email checks have moved or been renamed; this guard now checks nothing");
  return found.map((lit) => new RegExp(lit.slice(1, -1)));
};

test("every email check the page SHIPS accepts an address containing the letter s", () => {
  for (const re of emittedEmailRegexes()) {
    for (const ok of ["jason@conejoindustries.com", "chris@acme.com", "sales@x.co", "s@s.se"]) {
      assert.ok(re.test(ok), `the shipped regex ${re} refuses ${ok} — \\s collapsed to a bare s`);
    }
  }
});

test("the shipped email checks still refuse what is not an address", () => {
  // The fix must not be "loosen it until everything passes".
  for (const re of emittedEmailRegexes()) {
    for (const bad of ["not an email", "a@b", "x y@z.com", "@nope.com", "trailing@dot."]) {
      assert.ok(!re.test(bad), `the shipped regex ${re} accepts ${bad}`);
    }
  }
});

test("the emitted script carries no collapsed backslash escape", () => {
  // The general form of the same bug, so the next one is caught wherever it
  // lands rather than only in the two email checks.
  const script = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  assert.ok(!/\[\^s@\]/.test(script),
    "[^s@] in the emitted script means a \\s collapsed — double the backslash in the source");
});

// ---------------------------------------------------------------------------
// Deleting a conversation (2026-09-26)
// ---------------------------------------------------------------------------

test("delete asks first, for both kinds of chat, and Escape backs out without leaving the page", () => {
  const script = scriptOf(renderMessagesBody(null));
  // ONE caller of the route, reached only from the question's own Delete
  // button — no door deletes on its first press.
  assert.equal((script.match(/\/api\/messages\/delete/g) || []).length, 1,
    "the delete route is called from more than one place");
  const fn = script.slice(script.indexOf("function deleteThread("));
  assert.ok(fn.indexOf('api("POST", "/api/messages/delete"') > 0);
  // A deal room is deleted by its own id (2026-10-02), and the question
  // carries which kind it is, so a room id is never sent as a thread id.
  assert.match(fn, /room \? \{ roomId: id \} : \{ threadId: id \}/);
  assert.equal((script.match(/deleteThread\(yes\.getAttribute\("data-del-yes"\), yes\.getAttribute\("data-kind"\)\)/g) || []).length, 2,
    "the row and the header must both delete only from the question's Delete button");
  assert.doesNotMatch(fn.slice(0, fn.indexOf("function externalMatches(")), /window\.confirm/,
    "the delete question is a browser dialog again, which covers the chat on a phone");
  // The deal room's question says what is true of a deal room: it comes back
  // WITH its history, unlike a firm chat (messaging.js, roomListed).
  const ask = script.slice(script.indexOf("function confirmHtml("), script.indexOf("function renameHtml("));
  assert.match(ask, /it comes back, with everything in it, if anyone writes in it again/);
  // The shared header's Escape listener goes BACK a page. The page's own
  // listener must run first (capture) and stop it, or cancelling the question
  // also leaves Messages.
  // The same listener serves the Unsend question (2026-09-29), so it is
  // pinned as one capture-phase block that stops BOTH questions' Escape.
  const at = script.search(/document\.addEventListener\("keydown", function\(e\)\{\s*if \(e\.key !== "Escape"\) return;/);
  assert.ok(at >= 0, "the page's Escape listener is gone or no longer checks Escape first");
  const block = script.slice(at, script.indexOf("}, true);", at) + 9);
  assert.match(block, /\}, true\);$/, "the Escape listener no longer runs in the capture phase");
  assert.match(block, /if \(!state\.confirmId\) return;[\s\S]{0,120}e\.stopPropagation\(\);/,
    "Escape on the delete question is no longer caught before the header's go-back listener");
  assert.match(block, /if \(state\.unsendId\) \{[\s\S]{0,80}e\.stopPropagation\(\);/,
    "Escape on the unsend question is no longer caught before the header's go-back listener");
});

test("Unsend is offered only while the server says so, and asks in the page", () => {
  const script = scriptOf(renderMessagesBody(null));
  // The button follows the server's unsendUntil and the clock, never just
  // "is this mine" — an old message of yours must not offer it.
  assert.match(script, /if \(!m \|\| !m\.mine \|\| m\.unsent \|\| !m\.unsendUntil\) return false;/,
    "Unsend is offered on a message the server did not mark as unsendable");
  assert.equal((script.match(/"\/api\/messages\/unsend"/g) || []).length, 1,
    "the unsend route is called from more than one place");
  assert.match(script, /doUnsend\(unYes\.getAttribute\("data-unsend-yes"\)\)/,
    "unsending no longer waits for the question's own Unsend button");
  const fn = script.slice(script.indexOf("function unsendQuestion("), script.indexOf("function scheduleUnsendExpiry("));
  assert.doesNotMatch(fn, /window\.confirm/, "the unsend question became a browser dialog");
  // An unsent message is drawn from the marker alone: nothing of its body.
  assert.match(script, /if \(m\.unsent\) \{\s*html \+= '<div class="msg-unsent">'/,
    "an unsent message is no longer drawn as its own marker");
  // An open conversation catches up on the poll, not only on reopening.
  assert.match(script, /var gone = j\.unsent \|\| \[\]/,
    "the poll no longer applies messages unsent since the last read");
});

test("the header's question is asked once, and a list read from before a delete cannot undo it", () => {
  const script = scriptOf(renderMessagesBody(null));
  // Bugbot, PR #339: the header bin set confirmId, and the row drew the same
  // question too — twice on a desktop, where both panes show.
  assert.match(script, /function askingHere\(kind, t\)\{ return state\.confirmId === t\.id && state\.confirmKind === kind && !state\.delBar; \}/,
    "a question asked from the header is drawn on the list row as well");
  assert.match(script, /if \(askingHere\("internal", t\)\) return confirmHtml\(t, "row", "internal"\);/);
  assert.match(script, /if \(askingHere\("external", x\)\) return confirmHtml\(x, "row", "external"\);/);
  // Bugbot, PR #339: a poll sent before the delete finished landed after it
  // and put the deleted conversation back.
  assert.match(script, /var seq = \+\+state\.listSeq;\s*return api\("GET", "\/api\/messages"\)\.then\(function\(o\)\{\s*if \(seq <= state\.staleBefore\) return;/,
    "a list read issued before a delete finished is applied after it");
  const del = script.slice(script.indexOf("function deleteThread("), script.indexOf("function externalMatches("));
  assert.match(del, /state\.staleBefore = state\.listSeq;/, "a finished delete no longer marks older list reads stale");
});

// ---------------------------------------------------------------------------
// Who a chat is with, and the More menu (2026-10-02)
// ---------------------------------------------------------------------------
// The owner's pick of the drafts at
// https://claude.ai/artifact/3sk3nK5VLG43d73TxEuZJA: Draft A with Draft C's
// private names. Reported as "Jacob Adler is myself": a room another account
// started is named after that account, and the row said nothing else.

test("a deal room's row says which deal, and a room somebody else started says so", () => {
  const script = scriptOf(renderMessagesBody(null));
  const fn = script.slice(script.indexOf("function externalRowHtml("), script.indexOf("function confirmHtml("));
  assert.match(fn, /dealLine\(x\), x\.owner \? "" : "Invited you"/,
    "a guest's row no longer says it was shared with them, or no longer names the deal");
  // The header says who invited whom too, which is the answer when two
  // accounts share a name.
  assert.match(script, /x\.label \+ " invited you"/);
});

test("every chat has one More menu, from its button, a right-click or the header", () => {
  const html = renderMessagesBody(null);
  const script = scriptOf(html);
  assert.match(html, /id="msgMoreBtn"/, "the open chat's More button is gone");
  assert.doesNotMatch(html, /id="msgDelBtn"/, "the old header bin is back beside the More menu");
  // Both kinds of row are wrapped with the same More button.
  const wrap = script.slice(script.indexOf("function rowWrap("), script.indexOf("function askingHere("));
  assert.match(wrap, /data-more="' \+ esc\(key\) \+ '"/);
  assert.match(script, /return rowWrap\("internal", t,/);
  assert.match(script, /return rowWrap\("external", x,/);
  // Right-click opens the same menu, and keeps the browser's own off the row.
  const ctx = script.slice(script.indexOf('$("msgThreads").addEventListener("contextmenu"'));
  assert.ok(ctx.length > 0, "right-clicking a chat no longer opens its menu");
  assert.match(ctx.slice(0, 400), /e\.preventDefault\(\);\s*openMenu\(k\.kind, k\.id, "row"/);
  // The menu's three choices, and nothing deletes or renames from the menu
  // itself: each one opens the question or the box first.
  const menu = script.slice(script.indexOf("function openMenu("), script.indexOf("function closeMenu("));
  assert.match(menu, /About this chat/);
  assert.match(menu, /Rename<\/span><small>only you see it/);
  assert.match(menu, /Delete for me/);
  const pick = script.slice(script.indexOf("function menuPick("), script.indexOf("function fmtDay("));
  assert.doesNotMatch(pick, /api\(/, "a menu choice acted without asking first");
  // A phone gets a sheet, because it has no right-click and a pointer-sized
  // menu is a missed tap.
  assert.match(script, /matchMedia\("\(hover: none\), \(max-width: 900px\)"\)/);
});

test("About this chat reads only what the list already holds, and marks nothing read", () => {
  const script = scriptOf(renderMessagesBody(null));
  const info = script.slice(script.indexOf("function infoHtml("), script.indexOf("function closeInfo("));
  assert.doesNotMatch(info, /api\(|fetch\(/, "opening About this chat fetches something (GET /api/hub would mark the room read)");
  // Names AND addresses, so two accounts with one name can be told apart.
  assert.match(script.slice(script.indexOf("function personHtml("), script.indexOf("function infoHtml(")), /msg-info-mail/);
  // Whether a guest opened the room is the owner's to see.
  assert.match(info, /if \(t\.owner\) \{\s*extra = /);
});

test("a private name is only ever the reader's, and saved only from its own box", () => {
  const script = scriptOf(renderMessagesBody(null));
  assert.equal((script.match(/"\/api\/messages\/name"/g) || []).length, 1,
    "the name route is called from more than one place");
  const save = script.slice(script.indexOf("function saveRename("));
  assert.match(save.slice(0, 1600), /body\[k\.kind === "external" \? "roomId" : "threadId"\] = k\.id;/);
  const box = script.slice(script.indexOf("function renameHtml("), script.indexOf("function findThread("));
  assert.match(box, /Only you see this name\./);
  // A row is called by the reader's own name for it, falling back to who it
  // is with — the people-first rule every row followed before.
  assert.match(script, /function chatName\(t\)\{ return \(t && \(t\.nickname \|\| t\.label\)\) \|\| "Conversation"; \}/);
  // The poll redraws the list every 15 seconds; a half-typed name survives it.
  const render = script.slice(script.indexOf("function renderThreads("), script.indexOf("function compCard("));
  assert.match(render, /var typed = live \? live\.value : null/);
});

test("closed deal rooms fold under one heading, and a search unfolds it", () => {
  const script = scriptOf(renderMessagesBody(null));
  const render = script.slice(script.indexOf("function renderThreads("), script.indexOf("function compCard("));
  assert.match(render, /var unfold = state\.showClosed \|\| !!q;/,
    "a search can find a match hidden behind the Closed heading");
  assert.match(render, /data-fold="1" aria-expanded="/);
});

test("the menu, the About card and the rename box all back out on Escape, before the header's go-back", () => {
  const script = scriptOf(renderMessagesBody(null));
  const at = script.search(/document\.addEventListener\("keydown", function\(e\)\{\s*if \(e\.key !== "Escape"\) return;/);
  const block = script.slice(at, script.indexOf("}, true);", at) + 9);
  assert.match(block, /if \(state\.menu \|\| state\.info\) \{[\s\S]{0,80}e\.stopPropagation\(\);/);
  assert.match(block, /if \(state\.renameKey\) \{[\s\S]{0,80}e\.stopPropagation\(\);/);
});

test("on a phone an open chat is one screen: the stream scrolls inside it and the box to type in is in view (2026-11-15)", () => {
  // It was as tall as its messages. The page opened on the oldest one and
  // the composer sat under all of them: 1,450px down with eleven messages.
  const html = renderMessagesBody({ s: 200, j: {} });
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const CHAT = '\\.msg-page\\.on-thread:not\\(\\[data-view="reports"\\]\\)';
  const narrow = css.match(/@media \(max-width:900px\)\{[\s\S]*?\n\}/);
  assert.ok(narrow, "the one-pane block moved");
  // A fixed height, the grid's one row held to it (an auto row grows with
  // its content and the page's overflow:hidden would cut it off), and the
  // screen as it is now (dvh) after the fallback (vh), never before it. The
  // whole screen since 2026-11-17, when the page lost its border.
  assert.match(narrow[0], new RegExp(CHAT + "\\{grid-template-rows:minmax\\(0,1fr\\);min-height:0;\\s*height:100vh;height:100dvh\\}"));
  assert.match(narrow[0], new RegExp(CHAT + " \\.msg-main\\{min-height:0;overflow-y:auto\\}"));
  assert.match(css, /\.msg-stream\{flex:1;overflow-y:auto;min-height:0;/, "the stream no longer scrolls inside the chat");
  // With the phone bar under it: down to the 54px bar (server.js RAIL_CSS)
  // and the safe area the bar also keeps (54 + 8 + 8 until 2026-11-17).
  const bar = css.match(/@media screen and \(max-width:899px\)\{\s*html\.nav-rail \.msg-page[\s\S]*?\n\}/);
  assert.ok(bar, "the chat lost its rule for the phone bar");
  assert.match(bar[0], new RegExp("html\\.nav-rail " + CHAT + "\\{\\s*height:calc\\(100vh - 54px - env\\(safe-area-inset-bottom,0px\\)\\);height:calc\\(100dvh - 54px - env\\(safe-area-inset-bottom,0px\\)\\)\\}"));
  const rail = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(rail, /html\.nav-rail body\{padding-bottom:calc\(54px \+ env\(safe-area-inset-bottom,0px\)\)\}/, "the phone bar is no longer 54px: the chat stops 54px from the foot of the screen");
  // The Feedback button floats over the corner Send is in: put away while a
  // chat is open, and Send moved clear of it where :has() is not understood.
  // The composer's own padding since it became one line (2026-11-17): its
  // actions row is display:contents, so a margin on it does nothing.
  assert.match(bar[0], new RegExp("html:has\\(" + CHAT + "\\) \\.tninja\\{display:none\\}"));
  assert.match(bar[0], /@supports not selector\(:has\(a\)\)\{ html\.nav-rail \.msg-page\.on-thread \.msg-composer\{padding-right:52px\} \}/);
  // Chats only. A report's pane has no scroller of its own, so a fixed
  // height there would cut the report off under the page's overflow:hidden.
  for (const m of css.matchAll(/([^{}]*\.on-thread[^{}]*)\{[^}]*(?:height:calc|grid-template-rows)/g)) {
    assert.match(m[1], /:not\(\[data-view="reports"\]\)/, "a fixed height reaches the Reports pane: " + m[1].trim());
  }
  // In the page's flow. A fixed box is not scrolled by a phone's keyboard,
  // so the composer would sit behind it.
  assert.ok(!/\.msg-page[^{}]*\{[^}]*position:fixed/.test(css), "the open chat is position:fixed");

  // The script half: both ways a chat opens bring it to the top of the
  // screen, and opening a report (whose pane is as tall as it needs) does not.
  const js = scriptOf(html);
  assert.equal((js.match(/\$\("msgPage"\)\.className = "msg-page on-thread"; fitThread\(\);/g) || []).length, 2,
    "a chat opens without being brought to the top of the screen");
  assert.equal((js.match(/"msg-page on-thread"/g) || []).length, 3, "a fourth way into a pane: decide whether it is a chat");
  const src = js.match(/function fitThread\(\)\{[\s\S]*?\n  \}/);
  assert.ok(src, "fitThread moved");
  const run = (matches, top, y) => {
    const calls = [];
    const win = { pageYOffset: y, scrollTo: (a, b) => calls.push([a, b]),
      matchMedia: (q) => { assert.equal(q, "(max-width: 900px)", "fitThread asks a different width than the stylesheet's one-pane rule"); return { matches }; } };
    new Function("window", "$", src[0] + "; fitThread();")(win, (id) => { assert.equal(id, "msgPage"); return { getBoundingClientRect: () => ({ top }) }; });
    return calls;
  };
  // Flush with the top since 2026-11-17 (8px under it before, to show the
  // box's edge; the page has no border now).
  assert.deepEqual(run(true, 297, 0), [[0, 297]], "the chat is not brought to the top of the screen");
  assert.deepEqual(run(true, -40.4, 500), [[0, 460]], "scrolled past it, the chat is not brought back");
  assert.deepEqual(run(true, -5, 0), [[0, 0]], "it asked to scroll above the page");
  assert.deepEqual(run(false, 297, 0), [], "a wide screen was scrolled: there the chat is beside the list");
  // A browser with no matchMedia is left alone, never thrown at.
  new Function("window", "$", src[0] + "; fitThread();")({}, () => ({}));
});

// ---------------------------------------------------------------------------
// One screen on a computer, and a reader who is not moved (2026-11-16)
// ---------------------------------------------------------------------------
// Pulls one function out of the emitted script by name. Every function in
// that script closes with a brace at two spaces, and nothing inside one does.
const fnOf = (js, name) => {
  const m = js.match(new RegExp("function " + name + "\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}"));
  assert.ok(m, name + " moved");
  return m[0];
};

test("on a computer Messages is one screen: the list and the chat scroll inside it (2026-11-16)", () => {
  // It was as tall as the open conversation: it opened on the oldest message
  // and the box to type in sat under all of them, 1,500px down with 22.
  const html = renderMessagesBody({ s: 200, j: {} });
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const wide = css.match(/@media \(min-width:901px\)\{\s*\.msg-page\{[\s\S]*?\n\}/);
  assert.ok(wide, "the one-screen block for a computer moved");
  // As tall as the window under wherever the page starts, never shorter
  // than a usable chat; the plain-vh line first, for a browser without
  // max(). Down to the window's foot since 2026-11-17 (no heading above it
  // and no border round it: beside the rail it starts at the top, 0px).
  assert.match(wide[0], /\.msg-page\{grid-template-rows:minmax\(0,1fr\);min-height:0;\s*height:100vh;height:max\(460px,calc\(100dvh - var\(--msg-top,0px\)\)\)\}/);
  assert.match(wide[0], /\.msg-side,\.msg-main\{min-height:0\}/, "a column may grow past the page again");
  // Both lists and both right-hand panes scroll inside themselves.
  assert.match(css, /\.msg-threads\{flex:1;overflow-y:auto;min-height:0\}/);
  assert.match(css, /\.msg-stream\{flex:1;overflow-y:auto;min-height:0;/);
  assert.match(css, /\.msg-rbody\{flex:1;overflow-y:auto;min-height:0;/, "a report's pane would be cut off at the page's foot");

  // Where the page starts is measured, because what is above it (the top
  // bar of the rollback shell, a notice) differs; an answer that cannot be
  // right falls back to the stylesheet's. 0 is a real answer since
  // 2026-11-17: a page with no height is the one not laid out yet.
  const js = scriptOf(html);
  const run = (top, y, hidden, height) => {
    const calls = [];
    const el = { hidden: !!hidden, getBoundingClientRect: () => ({ top, height: height == null ? 700 : height }),
      style: { setProperty: (k, v) => calls.push([k, v]), removeProperty: (k) => calls.push([k, null]) } };
    new Function("window", "$", fnOf(js, "sizePage") + "; sizePage();")({ pageYOffset: y }, () => el);
    return calls;
  };
  assert.deepEqual(run(167.6, 0), [["--msg-top", "168px"]]);
  assert.deepEqual(run(-32, 200), [["--msg-top", "168px"]], "a scrolled page measured a different start");
  assert.deepEqual(run(0, 0), [["--msg-top", "0px"]], "a page at the top of the screen, beside the rail, was not believed");
  assert.deepEqual(run(0, 0, false, 0), [["--msg-top", null]], "a page that is not laid out yet was believed");
  assert.deepEqual(run(-10, 0), [["--msg-top", null]], "a start above the document was believed");
  assert.deepEqual(run(168, 0, true), [], "a hidden page was measured");
  assert.match(fnOf(js, "ungate"), /\$\("msgPage"\)\.hidden = false;\s*sizePage\(\);/, "the page is not measured when it is shown");
  assert.match(js, /window\.addEventListener\("resize", sizePage\);/);
});

test("a redraw leaves a reader where they are, and says what arrived (2026-11-16)", () => {
  // Every redraw used to end at the newest message, and a deal room is
  // redrawn on every poll: fifteen seconds into reading back, the page took
  // the reader away.
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const src = ["atBottom", "showPill", "toNewest", "paintStream"].map((n) => fnOf(js, n)).join("\n");
  const make = ({ top, height = 2000, view = 500, line = null, question = false, grows = 0 }) => {
    const pill = { textContent: "", className: "" };
    const stream = {
      scrollHeight: height, clientHeight: view, scrollTop: top,
      set innerHTML(v) { this.scrollHeight += grows; },
      querySelector: (sel) => sel === ".msg-newline" ? line
        : (sel === ".msg-unsendq" && question ? { scrollIntoView() {} } : null),
      getBoundingClientRect: () => ({ top: 100 }),
    };
    const state = { unseen: 0 };
    const paint = new Function("state", "$", src + "; return paintStream;")(state,
      (id) => id === "msgNewPill" ? pill : stream);
    return { stream, pill, state, paint };
  };
  // Scrolled up, and two messages arrive from somebody else: not moved, told.
  let c = make({ top: 300 });
  c.paint("<x>", "", 2);
  assert.equal(c.stream.scrollTop, 300, "a reader scrolled up in the history was moved");
  assert.equal(c.pill.className, "msg-newpill");
  assert.equal(c.pill.textContent, "2 new messages ↓");
  c.paint("<x>", "", 1);
  assert.equal(c.pill.textContent, "3 new messages ↓", "a second arrival replaced the count instead of adding to it");
  // Already at the newest: stay there, and say nothing.
  c = make({ top: 1480 });
  c.paint("<x>", "", 1);
  assert.equal(c.stream.scrollTop, 2000);
  assert.equal(c.pill.className, "msg-newpill msg-hide");
  // The reader's own message always lands at the newest.
  c = make({ top: 300 });
  c.paint("<x>", "bottom", 0);
  assert.equal(c.stream.scrollTop, 2000);
  // A redraw with nothing new (a deal room's poll) moves nobody.
  c = make({ top: 300 });
  c.paint("<x>", "", 0);
  assert.equal(c.stream.scrollTop, 300);
  assert.equal(c.pill.className, "", "a redraw with nothing new touched the note");
  // ...and leaves a note that is already up saying what it said.
  c.paint("<x>", "", 2);
  c.paint("<x>", "", 0);
  assert.equal(c.pill.textContent, "2 new messages ↓");
  assert.equal(c.pill.className, "msg-newpill");
  // Older messages laid in above: the same distance from the foot.
  c = make({ top: 300, grows: 600 });
  c.paint("<x>", "older", 0);
  assert.equal(c.stream.scrollTop, 900);
  // Opening: the newest message, unless what is unread starts above the
  // screen, and then the "New" line, 12px under the top.
  c = make({ top: 0 });
  c.paint("<x>", "open", 0);
  assert.equal(c.stream.scrollTop, 2000);
  c = make({ top: 0, line: { getBoundingClientRect: () => ({ top: -400 }) } });
  c.paint("<x>", "open", 0);
  assert.equal(c.stream.scrollTop, 2000 - 400 - 100 - 12);
  // The Unsend question keeps its own rule: where the reader was, in view.
  c = make({ top: 300, question: true });
  c.paint("<x>", "", 0);
  assert.equal(c.stream.scrollTop, 300);

  // Both kinds of chat go through it, and nothing else sets the stream's end.
  assert.match(fnOf(js, "renderStream"), /paintStream\(html, mode, fresh\);/);
  assert.match(fnOf(js, "renderExternalStream"), /paintStream\(html, mode, fresh\);/);
  assert.equal((js.match(/el\.scrollTop = el\.scrollHeight;/g) || []).length, 1, "something outside toNewest jumps to the newest message");
  // The reads say which it was: opened, the reader's own, or somebody else's.
  assert.match(fnOf(js, "readThread"), /renderStream\(first \? "open" : \(mineIn \? "bottom" : ""\), first \? 0 : added\);/);
  assert.match(fnOf(js, "readExternal"), /renderExternalStream\(first \? "open" : \(mineIn \? "bottom" : ""\), first \? 0 : added\);/);
  // The note goes away when pressed, and when the reader scrolls down to it.
  assert.match(js, /\$\("msgNewPill"\)\.addEventListener\("click", toNewest\);/);
  assert.match(js, /if \(state\.unseen && atBottom\(this\)\) showPill\(0\);/);
  // Saving a comp marks its card where it stands; it used to read the whole
  // conversation again, which is a jump to the newest message.
  const save = js.slice(js.indexOf('api("POST", "/api/messages/comp/save"'), js.indexOf('$("msgTray").addEventListener'));
  assert.doesNotMatch(save, /readThread\(true\)/);
  assert.match(save, /cs\[k\]\.savedByMe = true/);
});

test("the New line is where the unread messages start, from the count the list showed (2026-11-16)", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const first = new Function(fnOf(js, "firstUnreadId") + "; return firstUnreadId;")();
  const mine = (m) => m.mine;
  const list = [
    { id: "1" }, { id: "2", mine: true }, { id: "3" }, { id: "4", unsent: true }, { id: "5", mine: true }, { id: "6" },
  ];
  assert.equal(first(list, 0, mine), "", "nothing unread drew a line");
  assert.equal(first(list, 1, mine), "6");
  assert.equal(first(list, 2, mine), "3", "the reader's own messages and an unsent one were counted as unread");
  assert.equal(first(list, 9, mine), "1", "more unread than is loaded: the line goes above the oldest one held");
  assert.equal(first([], 3, mine), "");
  // The count is taken from the list's row BEFORE the read that marks it
  // read, and the line is drawn above that message in both kinds of chat.
  assert.match(fnOf(js, "openThread"), /state\.openUnread = listed \? \(Number\(listed\.unread\) \|\| 0\) : 0;/);
  assert.match(fnOf(js, "openExternal"), /state\.openUnread = was \? \(Number\(was\.unread\) \|\| 0\) : 0;/);
  assert.match(fnOf(js, "renderStream"), /if \(state\.newFrom && m\.id === state\.newFrom\) \{\s*html \+= NEW_LINE;\s*lastWho = "";/);
  assert.match(fnOf(js, "renderExternalStream"), /state\.newFrom && it2\.m\.id === state\.newFrom\) \{\s*html \+= NEW_LINE;\s*lastWho = "";/);
  // Answering it takes the line away.
  assert.match(fnOf(js, "afterSend"), /state\.newFrom = "";/);
});

test("what you were typing stays with its chat, and the list says Draft (2026-11-16)", () => {
  // One box served every chat: a message started to one person was still in
  // it after opening another, a keystroke from the wrong recipient.
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const src = ["draftKey", "storeDrafts", "loadDrafts", "dropDraft", "holdDraft", "takeDraft", "draftLine"]
    .map((n) => fnOf(js, n)).join("\n");
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const box = { value: "" };
  const state = { me: "u-1", openKind: "internal", openId: "t-ben", attach: [], drafts: {} };
  const api = new Function("state", "$", "sessionStorage", "renderTray", "growInput",
    src + "; return { holdDraft, takeDraft, draftLine, dropDraft, loadDrafts };")(
    state, () => box, sessionStorage, () => {}, () => {});

  box.value = "half a thought\nfor Ben";
  state.attach = [{ id: "c1", address: "1 Main St" }];
  api.holdDraft();
  // Moving to another chat: its own (empty) draft, never Ben's.
  state.openId = "t-eli";
  api.takeDraft();
  assert.equal(box.value, "", "what was typed to one person followed the reader into another chat");
  assert.deepEqual(state.attach, [], "a comp attached for one person followed the reader into another chat");
  assert.equal(api.draftLine("internal", "t-ben"), "half a thought for Ben");
  assert.equal(api.draftLine("internal", "t-eli"), "", "the open chat's own row said Draft");
  assert.equal(api.draftLine("external", "t-ben"), "", "a deal room and a firm chat with one id shared a draft");
  // And back: the words and the comp.
  api.holdDraft();
  state.openId = "t-ben";
  api.takeDraft();
  assert.equal(box.value, "half a thought\nfor Ben");
  assert.deepEqual(state.attach, [{ id: "c1", address: "1 Main St" }]);
  // Only the words are kept past the page, under the reader's own id.
  assert.deepEqual(JSON.parse(store.get("cnMsgDrafts:u-1")), { "internal:t-ben": "half a thought\nfor Ben" });
  const next = { me: "u-1", openKind: "internal", openId: "", attach: [], drafts: {} };
  new Function("state", "sessionStorage", src + "; loadDrafts();")(next, sessionStorage);
  assert.deepEqual(next.drafts, { "internal:t-ben": { text: "half a thought\nfor Ben", attach: [] } });
  const other = { me: "u-2", openKind: "internal", openId: "", attach: [], drafts: {} };
  new Function("state", "sessionStorage", src + "; loadDrafts();")(other, sessionStorage);
  assert.deepEqual(other.drafts, {}, "another account in the same tab was handed these drafts");
  // An emptied box is no draft, and nothing is left behind in storage.
  box.value = "   ";
  state.attach = [];
  api.holdDraft();
  assert.equal(api.draftLine("internal", "t-eli"), "");
  assert.equal(store.has("cnMsgDrafts:u-1"), false);
  // A comp with no words still counts, and says so.
  state.attach = [{ id: "c1", address: "1 Main St" }, { id: "c2", address: "2 Main St" }];
  box.value = "";
  api.holdDraft();
  state.openId = "t-eli";
  assert.equal(api.draftLine("internal", "t-ben"), "2 comps attached");
  // Storage that throws (a private window) costs the convenience only.
  const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  new Function("state", "$", "sessionStorage", src + "; holdDraft(); loadDrafts();")(
    { me: "u-1", openKind: "internal", openId: "t", attach: [], drafts: {} }, () => ({ value: "x" }), broken);

  // Wired in: both ways a chat opens hold the old chat's words and take the
  // new one's; Back, Send and Delete each do their half; typing keeps it.
  for (const name of ["openThread", "openExternal"]) {
    assert.match(fnOf(js, name), /if \(!same\) holdDraft\(\);[\s\S]*if \(!same\) takeDraft\(\);/, name + " carries the box across chats");
  }
  assert.match(fnOf(js, "afterSend"), /dropDraft\(draftKey\(\)\);/, "a sent message is still listed as a draft");
  assert.match(fnOf(js, "deleteThread"), /dropDraft\(\(room \? "external" : "internal"\) \+ ":" \+ id\);/);
  assert.match(js, /\$\("msgBack"\)\.addEventListener\("click", function\(\)\{\s*closeDelBar\(\);[\s\S]{0,120}holdDraft\(\);/);
  assert.match(js, /\$\("msgInput"\)\.addEventListener\("input", function\(\)\{[\s\S]{0,260}holdDraft\(\);/);
  // The draft is drawn through esc(), like everything a person typed.
  assert.match(fnOf(js, "threadRowHtml"), /'<span class="msg-draft">Draft:<\/span> ' \+ esc\(draft\)/);
  // It never leaves the browser: no request carries it.
  assert.doesNotMatch(src, /api\(|fetch\(/);
});

test("inside a conversation a message says its time, a deal says its date, and you are your own initial (2026-11-16)", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  const js = scriptOf(html);
  // Under "Saturday, Nov 14" every message used to say "Nov 14".
  assert.match(fnOf(js, "renderStream"), /'<span class="msg-time">' \+ esc\(clock\(m\.createdAt\)\)/);
  assert.match(fnOf(js, "renderExternalStream"), /'<span class="msg-time">' \+ esc\(clock\(it2\.at\)\)/);
  assert.match(fnOf(js, "clock"), /toLocaleTimeString\(\[\], \{ hour: "numeric", minute: "2-digit" \}\)/);
  // The list keeps when(): one stamp there has to say the day too.
  assert.match(fnOf(js, "threadRowHtml"), /esc\(when\(t\.lastMessageAt\)\)/);
  // A stored 2026-08-14 reads "Aug 14, 2026" in every time zone: built from
  // its own numbers, never parsed as midnight UTC.
  const dealDay = new Function(fnOf(js, "dealDay") + "; return dealDay;")();
  assert.equal(dealDay("2026-08-14"), "Aug 14, 2026");
  assert.equal(dealDay("2026-01-01"), "Jan 1, 2026");
  assert.equal(dealDay("2026-03-04T00:00:00.000Z"), "Mar 4, 2026");
  assert.equal(dealDay("Q3 2026"), "Q3 2026", "a date in another shape was dropped");
  assert.equal(dealDay(""), "");
  assert.doesNotMatch(fnOf(js, "dealDay"), /Date\.parse/);
  assert.match(fnOf(js, "compCard"), /esc\(dealDay\(c\.dealDate\)\)/);
  assert.match(fnOf(js, "extCompCard"), /esc\(dealDay\(s\.deal_date\)\)/);
  // "You" was drawn with a Y in the circle, for every reader.
  assert.match(fnOf(js, "renderStream"), /circle\(m\.mine \? myInitial\(\) : initial\(name\), m\.userId, m\.author\)/);
  assert.match(fnOf(js, "renderExternalStream"), /circle\(name === "You" \? myInitial\(\) : initial\(name\), "", authorEmail\)/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.equal((server.match(/me: \{ id: String\(g\.user\.id\), email: String\(g\.user\.email \|\| ""\), name: String\(g\.user\.name \|\| ""\) \}/g) || []).length, 2,
    "the list read no longer says the reader's own name, in both of its answers");
});

test("a colleague's photo is in their circle, through the firm's own gated route (2026-11-16)", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const state = { photos: { "u-ben": "/api/org/person/photo?org=o1&id=m-ben&v=r1" }, photosByEmail: { "ben@firm.example": "/p?x=\"1" }, me: "u-me" };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const api = new Function("state", "esc", [fnOf(js, "photoFor"), fnOf(js, "tint"), fnOf(js, "isMe"), fnOf(js, "circle"), fnOf(js, "rowPerson")].join("\n") +
    "; return { circle, rowPerson };")(state, esc);
  // The letter stays under the picture, and a picture that fails removes
  // itself: a circle is never empty.
  assert.equal(api.circle("B", "u-ben", ""),
    '<span class="msg-av has-photo">B<img src="/api/org/person/photo?org=o1&amp;id=m-ben&amp;v=r1" alt="" loading="lazy" onerror="this.remove()"></span>');
  // Nobody on the roster with a photo (a client, a leaver): the letter alone,
  // in that person's colour (2026-11-17).
  assert.match(api.circle("J", "u-gone", "jordan@client.example"), /^<span class="msg-av t[0-4]">J<\/span>$/);
  // A deal room knows people by address; the address is escaped on its way in.
  assert.match(api.circle("B", "", "Ben@Firm.example"), /src="\/p\?x=&quot;1"/);
  // A row shows the other person of a direct message, never a group's.
  assert.equal(api.rowPerson({ kind: "dm", members: [{ userId: "u-me" }, { userId: "u-ben" }] }), "u-ben");
  assert.equal(api.rowPerson({ kind: "channel", members: [{ userId: "u-me" }, { userId: "u-ben" }] }), "");
  assert.equal(api.rowPerson({ kind: "dm", members: [{ userId: "u-me" }, { userId: "u-ben", left: true }] }), "");
  // The address is built only from the roster's own member id and photo
  // revision, for the firm the list read named: /api/org/person/photo stays
  // the one decider of who may see a face.
  assert.match(js, /if \(!p\.userId \|\| !p\.memberId \|\| !p\.photoRev \|\| !j\.firm\) return;\s*var src = "\/api\/org\/person\/photo\?org=" \+ encodeURIComponent\(j\.firm\.id\) \+ "&id=" \+ encodeURIComponent\(p\.memberId\)/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /memberId: pending \? "" : String\(r\.id \|\| ""\),\s*photoRev: pending \? "" : String\(\(u && u\.avatar_rev\) \|\| ""\),/,
    "an invitation is sent with a photo, or the roster lost its photo fields");
});

test("New conversation opens under its button, above the list (2026-11-16)", () => {
  // It was the last thing in the column, under every chat: off the screen on
  // a laptop and a scroll away on a phone.
  const html = renderMessagesBody({ s: 200, j: {} });
  const markup = html.slice(html.indexOf("</style>"), html.indexOf("<script>"));
  const at = (id) => { const i = markup.indexOf('id="' + id + '"'); assert.notEqual(i, -1, id); return i; };
  assert.ok(at("msgNewBtn") < at("msgNewPanel"), "the panel is above its own button");
  assert.ok(at("msgNewPanel") < at("msgFilter"), "the panel is under the search box again");
  assert.ok(at("msgNewPanel") < at("msgThreads"), "the panel is under the list again");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /#msgNewPanel\{flex:0 0 auto;border-top:0;border-bottom:1px solid var\(--line\);max-height:min\(60vh,440px\)\}/);
  // The note about new messages follows the stream directly: its stylesheet
  // rule pulls it up over the stream's foot by its own height and gap.
  assert.match(markup, /<div class="msg-stream" id="msgStream"><\/div>\s*(?:<!--[\s\S]*?-->\s*)?<button class="msg-newpill msg-hide" id="msgNewPill" type="button"><\/button>/);
  assert.match(css, /\.msg-newpill\{align-self:center;position:relative;z-index:2;flex:0 0 auto;height:32px;margin:-42px 0 10px;/);
  assert.match(css, /\.msg-newpill\{height:40px;margin-top:-50px\}/, "under a finger the note is no longer 40px tall, pulled up by 40 + 10");
});

// ---------------------------------------------------------------------------
// Draft A (2026-11-17, the owner's pick of the Messages drafts)
// ---------------------------------------------------------------------------
test("a colour per person: the same account is the same colour, and the reader stays navy", () => {
  const js = scriptOf(renderMessagesBody({ s: 200, j: {} }));
  const state = { photos: {}, photosByEmail: {}, me: "u-me", me2: "me@firm.example" };
  const esc = (s) => String(s);
  const api = new Function("state", "esc", "initial", [fnOf(js, "photoFor"), fnOf(js, "tint"), fnOf(js, "isMe"),
    fnOf(js, "circle"), fnOf(js, "groupCircle")].join("\n") + "; return { circle, tint, groupCircle };")(
    state, esc, (s) => String(s || "?").charAt(0).toUpperCase());
  // The account decides, else the address (any case), else the name.
  assert.equal(api.circle("B", "u-ben", ""), api.circle("B", "u-ben", "other@x.example"));
  assert.equal(api.tint("Ben@Firm.example"), api.tint("ben@firm.example"));
  assert.match(api.circle("J", "", "", "jordan"), /class="msg-av t[0-4]"/);
  assert.equal(api.tint(""), "", "a circle with nothing to key on took a colour anyway");
  // The reader's own circle, by account or by address, is the navy one.
  assert.equal(api.circle("S", "u-me", ""), '<span class="msg-av">S</span>');
  assert.equal(api.circle("S", "", "ME@firm.example"), '<span class="msg-av">S</span>');
  // Five colours, and they spread.
  const seen = new Set(["u-a", "u-b", "u-c", "u-d", "u-e", "u-f", "u-g", "u-h"].map(api.tint));
  assert.ok(seen.size >= 3, "eight people came out in " + seen.size + " colours");
  for (const t of seen) assert.match(t, /^ t[0-4]$/);
  // A group shows two of the OTHER people, never the reader, and a # only
  // when nobody else is left in it.
  const g = api.groupCircle({ kind: "channel", members: [{ userId: "u-me", name: "Me" },
    { userId: "u-ben", name: "Ben" }, { userId: "u-pri", name: "Priya" }, { userId: "u-lena", name: "Lena" }] });
  assert.match(g, /^<span class="msg-av msg-duo"><span class="msg-av t[0-4]">B<\/span><span class="msg-av t[0-4]">P<\/span><\/span>$/);
  assert.equal(api.groupCircle({ members: [{ userId: "u-me" }, { userId: "u-x", left: true }] }), '<span class="msg-av chan">#</span>');
  // Every tint class has its rule, from the site's paired tokens only.
  const css = renderMessagesBody({ s: 200, j: {} });
  for (let i = 0; i < 5; i++) assert.match(css, new RegExp("\\.msg-av\\.t" + i + "\\{background:var\\(--[a-z0-9-]+\\);color:var\\(--[a-z0-9-]+\\)"));
});

test("a first visit gets a card to start from, not a box to type into with nobody on the other end", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  const js = scriptOf(html);
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  // Only a firm member with nothing on either list and nothing open.
  assert.match(fnOf(js, "paintFirst"), /var first = !!state\.listed && !!state\.firm && !state\.noFirm && !state\.openId &&\s*!state\.threads\.length && !state\.external\.length;/);
  // An attribute, because the chat code assigns the page's className whole.
  assert.match(fnOf(js, "paintFirst"), /page\.setAttribute\("data-first", ""\)/);
  assert.match(css, /\.msg-page\[data-first\] #msgMain \.msg-head,\.msg-page\[data-first\] #msgComposer,\.msg-page\[data-first\] #msgTray\{display:none\}/);
  // Invite a client only for a member who can open a deal room.
  assert.match(fnOf(js, "paintFirst"), /\(state\.canAttach === true \? '<button class="msg-btn" type="button" data-first="invite">Invite a client<\/button>' : ""\)/);
  // A press opens the New panel and sends nothing: the person presses Start.
  const pick = fnOf(js, "firstPick");
  assert.match(pick, /openNewPanel\(\);/);
  assert.doesNotMatch(pick, /api\(|startThread/);
  assert.match(js, /var fp = e\.target\.closest\("\[data-first\]"\);\s*if \(fp\) \{ firstPick\(fp\.getAttribute\("data-first"\)\); return; \}/);
  // The list re-decides on every draw, and the card goes once somebody writes.
  assert.match(fnOf(js, "renderThreads"), /^function renderThreads\(\)\{\s*paintHeadAv\(\);\s*paintFirst\(\);/);
});

test("the composer is one line, and Chat and Comps are tabs", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.match(css, /\.msg-composer\{[^}]*display:grid;grid-template-columns:auto minmax\(0,1fr\) auto;/);
  assert.match(css, /\.msg-actions\{display:contents\}/);
  assert.match(html, /id="msgAttach" type="button" aria-label="Attach a comp" title="Attach a comp"><svg/);
  assert.match(css, /#msgTabChat\[aria-pressed="true"\],#msgTabComps\[aria-pressed="true"\]\{border-bottom-color:var\(--red\);/);
  // The header's circle is a computer's; a phone gives the name the room.
  assert.match(css.match(/@media \(max-width:900px\)\{[\s\S]*?\n\}/)[0], /\.msg-headav\{display:none\}/);
});

test("a deal room guest can be named, once the server says names can be saved (063)", () => {
  const html = renderMessagesBody({ s: 200, j: {} });
  const js = scriptOf(html);
  assert.match(js, /state\.guestNames = j\.guestNames === true;/);
  const panel = fnOf(js, "renderPeoplePanel");
  assert.match(panel, /var naming = !closed && state\.guestNames === true;/);
  assert.match(panel, /\$\("msgPeopleName"\)\.className = naming \? "" : "msg-hide";/);
  // Every typed value is escaped on its way into the row.
  assert.match(panel, /value="' \+ esc\(p\.name \|\| ""\) \+ '"/);
  // A blank box on an invitation sends no name at all.
  const guestNameFor = new Function(fnOf(js, "guestNameFor") + "; return guestNameFor;")();
  assert.equal(guestNameFor("a@b.example", "   "), undefined);
  assert.deepEqual(guestNameFor("a@b.example", "  Ana   Ruiz "), { "a@b.example": "Ana Ruiz" });
  assert.equal(guestNameFor("", "Ana"), undefined);
  // Renaming sends the list unchanged, so nobody is mailed.
  assert.match(fnOf(js, "saveGuestName"), /emails: currentPeopleEmails\(\), names: names/);
  assert.match(html, /id="msgPeopleName" class="msg-hide"/);
  assert.match(html, /id="msgNewName" class="msg-hide"/);
});
