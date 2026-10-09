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
      return res.end(JSON.stringify(typeof meta === "function" ? meta(Object.fromEntries(u.searchParams)) : meta));
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

// ---- by address (2026-10-09): POST /api/building-photo, then ?t=<token> ----

async function signUp(srv) {
  const email = `photos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const r = await fetch(srv.base + "/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: "Photo Tester" }),
  });
  assert.equal(r.status, 200, "signup must succeed");
  return String(r.headers.get("set-cookie") || "").split(";")[0];
}
const askPhotos = (srv, cookie, places) => fetch(srv.base + "/api/building-photo", {
  method: "POST",
  headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
  body: JSON.stringify({ places }),
});

// Google's metadata by address: the Peachtree building has Google's own
// recent camera, the Main St house only a stranger's photosphere, and the
// quota address answers Google's own refusal of US.
function byAddress(q) {
  const loc = String(q.location || "");
  if (/peachtree/.test(loc)) return goodMeta();
  if (/main st/.test(loc)) return Object.assign(goodMeta(), { copyright: "© A. Stranger" });
  if (/quota/.test(loc)) return { status: "OVER_QUERY_LIMIT" };
  return { status: "ZERO_RESULTS" };
}

test("a photo by address: signed in only, sealed in the URL, aimed by Google, billed only when shown", async (t) => {
  const { google, srv } = await bootWith(t, byAddress);
  const places = [
    { address: "2300 Peachtree Rd NE, Atlanta, GA 30309" },
    { address: "18 Main St, Boise, ID 83702" },
    { address: "Peachtree Industrial Blvd corridor" },
    { address: "99 Quota Way, Boise, ID" },
  ];

  assert.equal((await askPhotos(srv, null, places)).status, 401, "signed out is refused");

  const cookie = await signUp(srv);
  const r = await askPhotos(srv, cookie, places);
  assert.equal(r.status, 200);
  const { photos } = await r.json();
  assert.match(photos[0], /^\/api\/streetview\?t=[A-Za-z0-9_-]+$/, "the good one is a sealed photo URL");
  assert.ok(!/peachtree|2300|atlanta/i.test(photos[0]), "no address in the URL");
  assert.equal(photos[1], null, "a stranger's photosphere is no photo");
  assert.equal(photos[2], null, "no street number is no photo, and Google is never asked");
  assert.equal(photos[3], 0, "Google refusing us is 'ask later', not 'no photo'");
  assert.equal(google.images().length, 0, "asking costs nothing: only the free metadata ran");
  const asked = google.hits.filter((h) => h.path.endsWith("/metadata")).map((h) => h.q.location);
  assert.ok(!asked.some((a) => /corridor/.test(a)), "a numberless address never leaves the server");
  const meta = google.hits.find((h) => /peachtree/.test(h.q.location || ""));
  assert.equal(meta.q.radius, "75");
  assert.equal(meta.q.source, "outdoor");

  const img = await fetch(srv.base + photos[0]);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.match(String(img.headers.get("cache-control")), /max-age=2592000/);
  const imgs = google.images();
  assert.equal(imgs.length, 1, "one billed image, when the img asked");
  assert.equal(imgs[0].q.location, "2300 peachtree rd ne, atlanta, ga 30309");
  assert.equal(imgs[0].q.heading, undefined, "no heading: Google turns the camera toward the address");
  assert.equal(imgs[0].q.size, "640x384");
});

test("a token the server did not mint is a 404 and never reaches Google", async (t) => {
  const { google, srv } = await bootWith(t, byAddress);
  const cookie = await signUp(srv);
  const { photos } = await (await askPhotos(srv, cookie, [{ address: "2300 Peachtree Rd NE, Atlanta, GA" }])).json();
  const before = google.hits.length;
  const forged = photos[0].slice(0, -3) + (photos[0].endsWith("AAA") ? "BBB" : "AAA");
  assert.equal((await fetch(srv.base + forged)).status, 404);
  assert.equal((await fetch(srv.base + "/api/streetview?t=1notatoken")).status, 404);
  assert.equal(google.hits.length, before, "nothing was asked of Google");
});

test("an address Google places far from our own geocode is refused", async (t) => {
  // Google's camera for this address stands 2 km from where our own geocoder
  // put it: the same street name in another part of town.
  const { srv } = await bootWith(t, byAddress);
  const cookie = await signUp(srv);
  const r = await askPhotos(srv, cookie, [{ address: "2300 Peachtree Rd NE", lat: 43.6, lng: -116.2 }]);
  assert.deepEqual((await r.json()).photos, [null]);
});

test("no key: the address route is dark and Google is never asked", async (t) => {
  const google = await startGoogle(byAddress);
  const srv = await shared.boot({ GOOGLE_MAPS_API_KEY: "", STREETVIEW_API_URL: google.url });
  t.after(async () => { srv.stop(); await google.stop(); });
  const cookie = await signUp(srv);
  assert.equal((await askPhotos(srv, cookie, [{ address: "2300 Peachtree Rd NE" }])).status, 404);
  assert.equal(google.hits.length, 0);
});
