// The /hub/<id> page renderer.
//
// renderHubHTML is pure — an id and the site's chrome in, a string out — so it
// needs no database, no session and no browser.
//
// The first test is the one that earns this file, and it is the same reason
// test/vault-page.test.js exists: the whole page, browser JavaScript included,
// is built inside ONE template literal. A stray `${`, or a regex written with
// one backslash instead of two, does not fail at require time — it silently
// emits broken JavaScript, and the page dies at its first line with an empty
// shell and a console error nobody is watching.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
// NOT the connection hub at /brokers.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const { renderHubHTML } = require("../hub-page");
const { ITEM_STATUSES } = require("../hub-access.js");

const CHROME = { CN_LOGO: "<svg></svg>", THEME_CSS: "", ACCOUNT_NAV_JS: "<script>/*nav*/</script>" };
const html = renderHubHTML("abc123def", CHROME);

// The page's OWN inline script, which is the last one on the page. The shared
// account-nav script is a complete <script> element passed in as chrome, so
// this deliberately takes the final block rather than the first.
function pageScript(source) {
  const blocks = source.match(/<script>[\s\S]*?<\/script>/g) || [];
  assert.ok(blocks.length, "the page must carry an inline script");
  const own = blocks[blocks.length - 1];
  return own.replace(/^<script>/, "").replace(/<\/script>$/, "");
}

test("the emitted browser JavaScript actually parses", () => {
  // The whole point of this file. `new vm.Script` compiles without running,
  // which is what we want: the script expects a DOM.
  const js = pageScript(html);
  assert.doesNotThrow(() => new vm.Script(js), "the page emits broken JavaScript");
});

test("the page's own script is not nested inside the chrome's script", () => {
  // ACCOUNT_NAV_JS is a complete <script> element, not raw JS. Interpolating
  // it INSIDE this page's script closed the tag early on the first draft and
  // printed the entire script on screen as visible text, with a 200 and valid
  // HTML. Only looking at it caught that; this is the net.
  const i = html.indexOf("var HUB_ID");
  assert.ok(i > 0);
  assert.ok(html.lastIndexOf("<script>", i) > html.lastIndexOf("</script>", i),
    "the hub script must open after every prior script closes");
});

test("the page ships NO hub data, because the token is in the fragment", () => {
  // The invite token lives in the URL fragment, which browsers never send, so
  // at render time the server cannot know who is asking. If this ever fails,
  // someone has server-rendered a hub's contents into a page whose reader the
  // server has not authenticated.
  assert.doesNotMatch(html, /"snapshot":/);
  assert.doesNotMatch(html, /"messages":\s*\[/);
  assert.match(html, /location\.hash/);
  assert.match(html, /\/api\/hub\/access/);
});

test("the id is JSON-encoded into the script, never pasted raw", () => {
  const weird = renderHubHTML('a"b</script>', CHROME);
  assert.doesNotMatch(pageScript(weird), /var HUB_ID = "a"b/);
});

// --- the comp pipeline (slice 2) -----------------------------------------

test("the page's status vocabulary matches hub-access.js exactly", () => {
  // Three copies of this list exist by necessity: hub-access.js (which
  // requests are allowed), migration 024's CHECK (which rows are allowed),
  // and this page's <select> (what a person can pick). test/hub-access.test.js
  // pins the first two together; this pins the third to them. A page offering
  // a status the server refuses is a control that fails on click.
  const m = pageScript(html).match(/var STATUSES = \[([^\]]*)\]/);
  assert.ok(m, "the page must declare STATUSES");
  const onPage = m[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  assert.deepEqual(onPage, ITEM_STATUSES);
});

test("every status has a label, and none of them is the raw key", () => {
  // "passed" on screen is a word a client reads about their own decision, so
  // the label table must cover the vocabulary rather than falling through to
  // the database value.
  const js = pageScript(html);
  const m = js.match(/var STATUS_LABEL = \{([^}]*)\}/);
  assert.ok(m, "the page must declare STATUS_LABEL");
  for (const s of ITEM_STATUSES) {
    assert.ok(new RegExp('["\']?' + s + '["\']?\\s*:').test(m[1]), `no label for ${s}`);
  }
  // "new" must not read as a verdict — a comp nobody has ruled on is not the
  // same as one that was passed on.
  assert.match(m[1], /"new": "Not decided"/);
});

test("a reader who cannot write gets a word, not a control", () => {
  // An observer and a tenant read the same table; only one of them can change
  // it. The branch is on the SERVER's canWrite, never on the role string.
  const js = pageScript(html);
  assert.match(js, /if \(canWriteHub\)\{/);
  assert.match(js, /createElement\("select"\)/);
  assert.match(js, /createElement\("span"\)/);
  assert.match(js, /canWriteHub = !!d\.canWrite/);
});

test("a refused status change reverts the control rather than keeping it", () => {
  // This column is a record of what the client decided, so a select showing
  // something the database does not hold is the one lie it must not tell.
  const js = pageScript(html);
  const fn = js.match(/function setStatus\(item, sel\)\{[\s\S]*?\n  \}/);
  assert.ok(fn, "the page must define setStatus");
  assert.ok((fn[0].match(/sel\.value = previous/g) || []).length >= 3,
    "every failure path must put the control back");
});

test("the tally counts decisions, never undecided comps", () => {
  // A tally including "new" would let a hub where nothing has happened read as
  // though something had.
  const js = pageScript(html);
  const fn = js.match(/function renderTally\(items\)\{[\s\S]*?\n  \}/);
  assert.ok(fn, "the page must define renderTally");
  assert.match(fn[0], /i\.status !== "new"/);
});

// --- per-comp note threads (slice 2) --------------------------------------

test("notes split on item_id and nothing else", () => {
  // A note filed against a comp belongs under that comp; a note about the
  // requirement belongs in the stream. One list, filtered at render, is what
  // lets a POLLED message land in the right place without knowing which view
  // is open.
  const js = pageScript(html);
  assert.match(js, /function msgsFor\(itemId\)\{/);
  assert.match(js, /itemId \? String\(m\.itemId\) === String\(itemId\) : !m\.itemId/);
});

test("one post path serves the hub stream and a comp thread", () => {
  // The only difference is whether an itemId rides along. Two paths would let
  // the account ask, the error copy or the cursor update drift between them.
  const js = pageScript(html);
  assert.match(js, /function postMessage\(field, btn, itemId\)\{/);
  assert.match(js, /if \(itemId\) payload\.itemId = itemId;/);
  // The account ask must exist exactly once, in that shared path.
  assert.equal((js.match(/auth=signup/g) || []).length, 1);
});

test("an empty note affordance is not offered to someone who cannot post", () => {
  // "Add note" on a row an observer cannot act on is noise in a table they
  // are trying to read.
  assert.match(pageScript(html), /if \(n \|\| canWriteHub\)\{/);
});

test("only one comp thread is open at a time", () => {
  // Several open threads push the comps apart until the list stops being
  // readable as a list, and the list is the page's primary surface.
  const js = pageScript(html);
  assert.match(js, /openThread = \(openThread === it\.id\) \? null : it\.id;/);
  assert.match(js, /if \(openThread === it\.id\) rows\.appendChild\(threadRow/);
});

test("a comp thread is rendered inside the table, under its own comp", () => {
  // The placement is the feature: the note and the building it is about have
  // to be readable together, which is the thing an email thread cannot do.
  const js = pageScript(html);
  assert.match(js, /function threadRow\(it, colspan\)\{/);
  assert.match(js, /td\.colSpan = colspan/);
  assert.match(js, /tr\.className = "thread"/);
});

test("a posted note is deduped against the poll that will replay it", () => {
  // The cursor is the server's, but an optimistic local add is not, so the
  // next poll can return a message the composer already appended.
  assert.match(pageScript(html), /allMsgs\.some\(function\(x\)\{ return x\.id && m\.id && x\.id === m\.id; \}\)/);
});
