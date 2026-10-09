const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const shared = require("./helpers/boot");

// GET /api/streetview, actually run against a stand-in Google
// (STREETVIEW_API_URL, test-only: CENSUS_API_URL's precedent).
// test/streetview-aim.test.js proves judgePano's rules; this proves the route
// obeys them where it costs money: a refused pano must never be followed by
// an IMAGE request (that is the billed call), and a passed one must be asked
// for by its pano id, aimed and framed.

const HOUSE = { lat: 43.6184, lng: -116.2103 };
// A camera 18 m south of the house, on the street.
const CAMERA = { lat: HOUSE.lat - 18 / 111320, lng: HOUSE.lng };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

// One stand-in per test, answering metadata with whatever `meta` says and
// recording every request so a test can count image calls.
function startGoogle(meta) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
    if (u.pathname.endsWith("/metadata")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(meta));
    }
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(JPEG);
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${srv.address().port}/maps/api/streetview`,
    hits,
    images: () => hits.filter((h) => !h.path.endsWith("/metadata")),
    stop: () => new Promise((r) => srv.close(r)),
  })));
}

async function bootWith(t, meta) {
  const google = await startGoogle(meta);
  const srv = await shared.boot({ GOOGLE_MAPS_API_KEY: "test-key", STREETVIEW_API_URL: google.url });
  t.after(async () => { srv.stop(); await google.stop(); });
  return { google, srv };
}

const photoUrl = (base) => `${base}/api/streetview?lat=${HOUSE.lat}&lng=${HOUSE.lng}`;
const goodMeta = () => ({
  status: "OK", copyright: "© Google", date: new Date().getUTCFullYear() - 1 + "-05",
  pano_id: "PANO_1", location: { lat: CAMERA.lat, lng: CAMERA.lng },
});

test("a good pano: one image call, by pano id, aimed at the building and framed", async (t) => {
  const { google, srv } = await bootWith(t, goodMeta());
  const r = await fetch(photoUrl(srv.base));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPEG);
  const imgs = google.images();
  assert.equal(imgs.length, 1);
  const q = imgs[0].q;
  assert.equal(q.pano, "PANO_1");
  assert.equal(q.size, "640x384");
  assert.equal(q.key, "test-key");
  const heading = Number(q.heading);
  assert.ok(heading < 8 || heading > 352, `camera is south, so it looks north: ${heading}`);
  assert.ok(Number(q.fov) >= 45 && Number(q.fov) <= 90, `fov ${q.fov}`);
  // The metadata ask is the free one, and carries the 35 m radius.
  const m = google.hits.find((h) => h.path.endsWith("/metadata"));
  assert.equal(m.q.radius, "35");
  assert.equal(m.q.source, "outdoor");
});

test("a user's photosphere 404s and is never billed", async (t) => {
  const { google, srv } = await bootWith(t, Object.assign(goodMeta(), { copyright: "© A. Stranger" }));
  const r = await fetch(photoUrl(srv.base));
  assert.equal(r.status, 404);
  assert.equal(google.images().length, 0);
});

test("a capture older than ten years 404s and is never billed", async (t) => {
  const { google, srv } = await bootWith(t, Object.assign(goodMeta(), { date: "2011-07" }));
  const r = await fetch(photoUrl(srv.base));
  assert.equal(r.status, 404);
  assert.equal(google.images().length, 0);
});

test("the neighbor's camera 404s, and the refusal is remembered (one metadata call)", async (t) => {
  const far = { lat: HOUSE.lat + 80 / 111320, lng: HOUSE.lng };
  const { google, srv } = await bootWith(t, Object.assign(goodMeta(), { location: far }));
  assert.equal((await fetch(photoUrl(srv.base))).status, 404);
  assert.equal((await fetch(photoUrl(srv.base))).status, 404);
  assert.equal(google.images().length, 0);
  assert.equal(google.hits.filter((h) => h.path.endsWith("/metadata")).length, 1);
});

test("no key: the route 404s without calling anyone", async (t) => {
  const google = await startGoogle(goodMeta());
  const srv = await shared.boot({ GOOGLE_MAPS_API_KEY: "", STREETVIEW_API_URL: google.url });
  t.after(async () => { srv.stop(); await google.stop(); });
  assert.equal((await fetch(photoUrl(srv.base))).status, 404);
  assert.equal(google.hits.length, 0);
});
