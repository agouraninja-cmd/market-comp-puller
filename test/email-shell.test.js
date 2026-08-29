// The outbound email letterhead. The contract under test: the shell dresses
// the text without changing it — every word survives, hostile text cannot
// become markup, URLs become links, and the brand footer is always present.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { renderEmailHtml, linkify, escapeHtml } = require("../email-shell");

test("the letterhead and footer are always present", () => {
  const html = renderEmailHtml("Subject", "Hello.");
  assert.match(html, /COMP<span[^>]*>NINJA<\/span>/, "the wordmark is text, never an image");
  assert.match(html, /border-bottom:2px solid #B91C1C/, "the red letterhead rule");
  assert.match(html, /info@compninja\.co/, "the public contact, never the owner's inbox");
  assert.match(html, /https:\/\/compninja\.co/, "the site link");
  assert.ok(!/agouraninja/.test(html), "LEAD_NOTIFY_EMAIL must never appear in outbound mail");
});

test("every word of the text survives into the HTML part", () => {
  const text = "Someone has shared a CompNinja valuation for 4980 W Gowen Rd with you.\n\n" +
    "View it here: https://compninja.co/r/abc123\n\n" +
    "Every CompNinja valuation is an automated estimate, not an appraisal.";
  const html = renderEmailHtml("Shared", text);
  for (const phrase of ["shared a CompNinja valuation", "4980 W Gowen Rd",
    "automated estimate, not an appraisal"]) {
    assert.ok(html.includes(phrase), `"${phrase}" must survive`);
  }
});

test("blank lines split paragraphs; single newlines keep their line breaks", () => {
  const html = renderEmailHtml("S", "Line one\nLine two\n\nSecond paragraph");
  assert.equal((html.match(/<p /g) || []).length, 2);
  assert.match(html, /Line one<br\/>Line two/);
});

test("hostile text cannot become markup", () => {
  const html = renderEmailHtml("<script>alert(1)</script>", "Hi <b>there</b> & \"friends\"\n\n<img src=x onerror=alert(1)>");
  assert.ok(!/<script>alert/.test(html), "subject is escaped");
  assert.ok(!/<b>there<\/b>/.test(html), "body tags are escaped");
  assert.ok(!/<img src=x/.test(html), "injected elements are escaped");
  assert.match(html, /&lt;b&gt;there&lt;\/b&gt; &amp; &quot;friends&quot;/);
});

test("bare URLs become links, trailing punctuation stays outside", () => {
  const out = linkify(escapeHtml("See https://compninja.co/r/abc123. Done."));
  assert.match(out, /<a href="https:\/\/compninja\.co\/r\/abc123"/);
  assert.match(out, /abc123<\/a>\./, "the period is not part of the link");
});

test("a crafted URL cannot smuggle an attribute", () => {
  // Quotes stop the URL charset, so nothing can escape the href attribute.
  const out = linkify(escapeHtml('https://x.co/a"onmouseover="alert(1)'));
  assert.ok(!/onmouseover="alert/.test(out.replace(/&quot;/g, '"')) || !/<a [^>]*onmouseover/.test(out),
    "no live attribute escapes the href");
  assert.ok(!/<a [^>]*onmouseover/.test(out), "the anchor carries only href and style");
});

// The bug this pins: linkify's character class stopped at `&`, so an escaped
// query string (`?u=abc&amp;t=xyz`) lost every parameter after the first. Both
// unsubscribe builders in server.js authenticate with a `&t=<mac>` token, so
// the "turn these emails off" link in every digest, renewal notice and hub
// note pointed at a URL the route could only refuse — and its refusal page
// blamed the reader's email client for the truncation.
test("a query-string URL keeps every parameter in its href", () => {
  const url = "https://compninja.co/watchlist/unsubscribe?u=abc123&t=deadbeef";
  const out = linkify(escapeHtml("Turn these emails off: " + url));
  const href = out.match(/href="([^"]*)"/)[1];
  assert.equal(href.replace(/&amp;/g, "&"), url,
    "the href decodes back to the URL it was given, token and all");
  assert.ok(!/href="[^"]*"[^>]*>[^<]*<\/a>&amp;t=/.test(out),
    "the token is inside the link, not stranded as text after it");
});

test("a URL ending in an entity is not sheared into a malformed one", () => {
  // `&amp;` ends in a semicolon, which the trailing-punctuation trim would
  // otherwise cut down to `&amp`.
  const out = linkify(escapeHtml("https://x.co/a?b=1&"));
  assert.ok(!/href="[^"]*&amp$/.test(out.match(/href="([^"]*)"/)[1] + ""),
    "no half-written entity in the href");
  assert.match(out.match(/href="([^"]*)"/)[1], /&amp;$/);
});

test("a bare ampersand still ends the URL, so an apostrophe cannot ride along", () => {
  // escapeHtml turns ' into &#39;, which must NOT be swallowed as part of the
  // link — only the literal `&amp;` entity is URL material.
  const out = linkify(escapeHtml("Open https://x.co/a's page"));
  assert.equal(out.match(/href="([^"]*)"/)[1], "https://x.co/a");
});
