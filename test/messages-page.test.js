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
  assert.match(html, /href="\/firms"/);
});
