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
  // Somebody with no firm is told so immediately rather than watching a
  // spinner resolve into a wall.
  const html = renderMessagesBody({ s: 403, j: { error: "Messages are for your firm.", code: "no_firm" } });
  assert.match(html, /Messages are for your firm/);
  // ...and the door out of it is a real page, not a dead end.
  assert.match(html, /href="\/brokers-firms"/);
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
  const open = js.slice(js.indexOf("function openThread(id, push, jump){"), js.indexOf("function openThread(id, push, jump){") + 600);
  assert.match(open, /applyComposerMode\(\);\s*applyDraft\(\);/, "the draft is not applied when a thread opens");
  const apply = js.slice(js.indexOf("function applyDraft(){"), js.indexOf("function openThread("));
  assert.match(apply, /\$\("msgInput"\)\.value = d\.text/);
  assert.match(apply, /state\.canAttach/);
  assert.match(apply, /That comp isn't in your vault, so it wasn't attached\./);
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
  assert.match(js, /if \(!state\.firm\) \{\s*\$\("msgNewBtn"\)\.className = "msg-btn sm msg-hide";/);
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
