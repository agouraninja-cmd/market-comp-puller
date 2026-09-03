// Which picture on a firm's website is its logo. Pure like branding.test.js:
// no server, no network.
const test = require("node:test");
const assert = require("node:assert");
const LOGO = require("../logo-import");

function png(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr, Buffer.alloc(64)]);
}

test("a bare domain becomes https, a path is kept, a fragment is dropped", () => {
  assert.equal(LOGO.normalizeSiteUrl("hawkinsridge.com").url, "https://hawkinsridge.com/");
  assert.equal(LOGO.normalizeSiteUrl("  www.hawkinsridge.com/about#team ").url, "https://www.hawkinsridge.com/about");
  assert.equal(LOGO.normalizeSiteUrl("http://hawkinsridge.com").url, "http://hawkinsridge.com/");
  assert.equal(LOGO.normalizeSiteUrl("HawkinsRidge.COM").host, "hawkinsridge.com");
});

test("the address must be public: no localhost, IP literal, single label or credentials", () => {
  for (const bad of ["localhost", "127.0.0.1", "http://10.0.0.5/x", "[::1]", "intranet", "https://user:pw@hawkinsridge.com"]) {
    assert.ok(LOGO.normalizeSiteUrl(bad).error, bad + " must be refused");
  }
  assert.ok(LOGO.normalizeSiteUrl("").error);
  assert.ok(LOGO.normalizeSiteUrl("ftp://hawkinsridge.com").error);
  assert.ok(LOGO.normalizeSiteUrl("x".repeat(301)).error);
  // The test-only door: a loopback stub is allowed through by the CALLER, never by default.
  assert.equal(LOGO.normalizeSiteUrl("http://127.0.0.1:8080/", { allowPrivate: true }).url, "http://127.0.0.1:8080/");
});

test("candidates: apple-touch-icon first, big icons, og:image, the undeclared convention, tiny icons last; .ico/.svg never", () => {
  const html = `<html><head>
    <link rel="icon" sizes="16x16" href="/favicon-16.png">
    <link rel="icon" type="image/svg+xml" href="/mark.svg">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="icon" sizes="192x192" href="icons/192.png">
    <meta property="og:image" content="https://cdn.example.com/banner.jpg">
    <link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">
    <link rel="apple-touch-icon" href="/touch.png">
    <link rel="apple-touch-icon" sizes="152x152" href="/touch-152.png">
  </head><body><link rel="icon" href="/late.png"></body></html>`;
  const c = LOGO.logoCandidates(html, "https://hawkinsridge.com/about/");
  assert.deepEqual(c.map((x) => x.url), [
    "https://hawkinsridge.com/touch-180.png",
    "https://hawkinsridge.com/touch.png",
    "https://hawkinsridge.com/touch-152.png",
    "https://hawkinsridge.com/about/icons/192.png",
    "https://hawkinsridge.com/late.png",
    "https://hawkinsridge.com/apple-touch-icon.png",
  ], "six at most, so og:image and the 16px favicon fell off the end — the undeclared touch icon outranks a banner");
  assert.deepEqual(c.map((x) => x.kind), ["apple-touch-icon", "apple-touch-icon", "apple-touch-icon", "icon", "icon", "apple-touch-icon"]);
  assert.ok(!c.some((x) => /\.(ico|svg)$/.test(x.url)));
});

test("a page that declares nothing still tries /apple-touch-icon.png, and a relative href resolves against the page", () => {
  assert.deepEqual(LOGO.logoCandidates("<html><head><title>x</title></head></html>", "https://hawkinsridge.com/"),
    [{ kind: "apple-touch-icon", url: "https://hawkinsridge.com/apple-touch-icon.png", size: 180 }]);
  const c = LOGO.logoCandidates('<link rel="icon" href="../img/logo.png">', "https://hawkinsridge.com/a/b/");
  assert.equal(c[0].url, "https://hawkinsridge.com/a/img/logo.png");
  assert.deepEqual(LOGO.logoCandidates("", "not a url"), [], "an unusable base yields nothing rather than a throw");
});

test("the bytes decide: PNG/JPEG/WebP by signature, a PNG at least 48px wide, nothing over the cap", () => {
  const ok = LOGO.acceptLogoBytes(png(180, 180));
  assert.equal(ok.mime, "image/png");
  assert.match(ok.dataUri, /^data:image\/png;base64,iVBOR/);
  assert.equal(LOGO.acceptLogoBytes(png(16, 16)), null, "a favicon is not a logo");
  assert.equal(LOGO.acceptLogoBytes(png(1200, 300)), null, "a banner is not a logo");
  assert.ok(LOGO.acceptLogoBytes(png(600, 200)), "a wide wordmark still is");
  assert.equal(LOGO.pngWidth(png(300, 20)), 300);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  assert.equal(LOGO.acceptLogoBytes(jpeg).mime, "image/jpeg");
  assert.equal(LOGO.acceptLogoBytes(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(LOGO.acceptLogoBytes(Buffer.from("GIF89a" + "x".repeat(20))), null);
  assert.equal(LOGO.acceptLogoBytes(Buffer.alloc(0)), null);
  assert.equal(LOGO.acceptLogoBytes(Buffer.concat([png(180, 180), Buffer.alloc(LOGO.LOGO_FETCH_MAX)])), null, "over the cap");
});
