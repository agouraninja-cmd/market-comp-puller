"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderHeroReviewHTML } = require("../market-hero-review");

test("the hero review page emits a script the browser can parse", () => {
  const html = renderHeroReviewHTML({ CN_LOGO: "<svg></svg>" });
  const i = html.indexOf("var KEYK");
  assert.ok(i > 0, "the review script should be on the page");
  assert.ok(html.lastIndexOf("<script>", i) > html.lastIndexOf("</script>", i),
    "the review script must open after every prior script closes");
  const start = html.lastIndexOf("<script>", i) + "<script>".length;
  const end = html.indexOf("</script>", start);
  new Function(html.slice(start, end));
});

test("the page says a technical OK is not a good photograph", () => {
  const html = renderHeroReviewHTML({ CN_LOGO: "<svg></svg>" });
  assert.match(html, /does not mean it is a good picture/);
  assert.match(html, /satellite aerial/);
  assert.match(html, /Header crop/);
  assert.match(html, /Whole photo/);
  assert.match(html, /\/api\/admin\/heroes/);
  assert.match(html, /grantAdminAccess/);
  assert.match(html, /name="robots" content="noindex/);
});
