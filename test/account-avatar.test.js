// What may be saved as a profile photo, and what may be served.
// Pure like branding.test.js: no server, no database, no clock.
const test = require("node:test");
const assert = require("node:assert");
const {
  validateAvatar, decodeAvatar, avatarRev, sniffImage,
  AVATAR_SAVE_MAX,
} = require("../account-avatar.js");

// A real 1x1 PNG. The branding tests can use a truncated data URI because
// they only check a regex; this module also decodes the bytes and sniffs
// them, so a fake payload would fail for the wrong reason.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG = "data:image/png;base64," + PNG_B64;
const PNG_BYTES = Buffer.from(PNG_B64, "base64");

test("a real PNG data URI decodes to image/png bytes", () => {
  const d = decodeAvatar(PNG);
  assert.ok(d, "a valid 1x1 PNG must decode");
  assert.equal(d.mime, "image/png");
  assert.ok(Buffer.isBuffer(d.bytes));
  assert.deepEqual(d.bytes, PNG_BYTES);
  assert.equal(sniffImage(d.bytes), "image/png");
});

test("saving a real PNG returns the data URI and a stable rev", () => {
  const r = validateAvatar({ avatar: PNG });
  assert.equal(r.error, undefined);
  assert.equal(r.clear, undefined);
  assert.equal(r.dataUri, PNG);
  assert.equal(r.mime, "image/png");
  assert.equal(r.rev, avatarRev(PNG));
  assert.equal(r.rev.length, 12);
  assert.equal(avatarRev(PNG), avatarRev(PNG), "rev must be deterministic");
});

test("empty or missing avatar is a clear, not an error", () => {
  assert.equal(validateAvatar({}).clear, true);
  assert.equal(validateAvatar({ avatar: "" }).clear, true);
  assert.equal(validateAvatar({ avatar: "  " }).clear, true);
});

test("a non-object body is refused", () => {
  assert.match(validateAvatar(null).error, /Bad request/);
  assert.match(validateAvatar("data:image/png;base64,xx").error, /Bad request/);
  assert.match(validateAvatar([]).error, /Bad request/);
});

test("a URL is refused — only a data URI may be stored", () => {
  const r = validateAvatar({ avatar: "https://example.com/me.png" });
  assert.match(r.error, /PNG or JPEG/i);
  assert.equal(r.dataUri, undefined);
});

test("SVG is refused even as a data URI", () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64");
  const r = validateAvatar({ avatar: svg });
  assert.match(r.error, /PNG or JPEG/i);
});

test("declared type must match the bytes", () => {
  const asJpeg = "data:image/jpeg;base64," + PNG_B64;
  assert.equal(decodeAvatar(asJpeg), null, "a PNG labeled as JPEG must not decode");
  assert.match(validateAvatar({ avatar: asJpeg }).error, /PNG or JPEG/i);
});

test("garbage base64 labeled as png is refused", () => {
  const r = validateAvatar({ avatar: "data:image/png;base64,AAAA" });
  assert.match(r.error, /PNG or JPEG/i);
});

test("saving rejects an oversized photo and names the limit", () => {
  const big = "data:image/png;base64," + "A".repeat(AVATAR_SAVE_MAX);
  const r = validateAvatar({ avatar: big });
  assert.match(r.error, /80/);
});

test("decodeAvatar refuses an over-long URI even if the regex matches", () => {
  // Serving is more lenient than saving, but it still has a ceiling so a
  // row that somehow grew cannot become an unbounded response.
  const huge = "data:image/png;base64," + PNG_B64 + "A".repeat(120000);
  assert.equal(decodeAvatar(huge), null);
});
