"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BP = require("../building-photo");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// building-photo.js: Home's and The Board's street photos, looked up by
// address through our own POST /api/building-photo (2026-10-09).

test("eligible: a street number naming a whole property, never a unit or a district", () => {
  assert.equal(BP.eligible("2300 Peachtree Rd NE, Atlanta, GA 30309"), true);
  assert.equal(BP.eligible("6728 W Fairview Ave Trailer 51, Boise, ID"), false);
  assert.equal(BP.eligible("1234 Main St Apt 3B, Denver, CO"), false);
  assert.equal(BP.eligible("Financial District (general submarket estimate)"), false);
  assert.equal(BP.eligible(""), false);
  assert.equal(BP.eligible(null), false);
  // The Florida trap index.html's tests pin: FL is a state, not floor 33101.
  assert.equal(BP.eligible("873 E Citation Ct, Miami, FL 33101"), true);
});

test("one spelling per address, the server's own (photo-token.js normalizeAddress)", () => {
  const T = require("../photo-token");
  for (const a of ["  2300 PEACHTREE Rd NE,  Atlanta, GA 30309, ", "1201 W Idaho St", "1210N17th st Boise Id"]) {
    assert.equal(BP.keyFor(a), T.normalizeAddress(a), a);
  }
});

test("only our own sealed photo URLs are ever laid into a page", () => {
  assert.equal(BP.isPhotoSrc("/api/streetview?t=1AbC_d-9"), true);
  assert.equal(BP.isPhotoSrc("/api/streetview?lat=1&lng=2"), false);
  assert.equal(BP.isPhotoSrc("https://example.com/x.jpg"), false);
  assert.equal(BP.isPhotoSrc("/api/streetview?t=1abc\" onerror=\"x"), false);
  assert.equal(BP.isPhotoSrc(null), false);
});

test("under Node the browser half is inert: nothing known, nothing asked", async () => {
  assert.equal(BP.photo("2300 Peachtree Rd NE"), undefined);
  assert.equal(BP.photo("6728 W Fairview Ave Trailer 51"), null, "an ineligible address is a known no");
  assert.equal(BP.known("2300 Peachtree Rd NE"), false);
  assert.equal(BP.overlay(null, "x", "/api/streetview?t=1a"), null);
  assert.equal(BP.pending("2300 Peachtree Rd NE"), false);
  assert.equal(await BP.lookup([]), undefined);
});

// ---- Home never shows the aerial first ----------------------------------------
// 2026-10-10, the owner: "it is showing birds eye view first, then the
// building make it just show the building". Home's photo code (hmAerial to
// hmPhotoForget) is lifted out of index.html and run against stand-ins: a
// card waiting on its answer is an empty box, and the aerial is drawn only
// once there is no photo to show.
function homePhotos(answers) {
  const from = html.indexOf("function hmAerial(box, ll, w, h, z)");
  const to = html.indexOf("function hmLL(row)");
  assert.ok(from > 0 && to > from, "could not bound Home's photo block");
  const cards = [];
  const overlays = [];
  const inFlight = new Set();
  const stub = {
    eligible: () => true,
    photo: (a) => answers[a],
    known: () => false,
    pending: (a) => inFlight.has(a),
    lookup: async () => {},
    overlay: (box, address, src, o) => { overlays.push({ box, src, o }); box.kids.push({ street: src }); },
  };
  const doc = {
    createElement: () => ({ style: {}, addEventListener() {} }),
    querySelectorAll: () => cards.filter((c) => c.isConnected),
  };
  const aerialTileSpec = () => [{ src: "https://server.arcgisonline.com/tile/18/1/1", left: 0, top: 0 }];
  const api = new Function("aerialTileSpec", "streetviewEnabled", "BLDGPHOTO", "document", "hmEl",
    "IntersectionObserver", "setTimeout", "clearTimeout",
    html.slice(from, to) + "; return { hmPhoto, hmPhotoFlush, hmPhotoUpgrade };")(
    aerialTileSpec, true, stub, doc, () => ({}), undefined, () => 0, () => {});
  const card = () => {
    const box = { kids: [], cls: new Set(), isConnected: true, querySelector: () => null };
    Object.defineProperty(box, "textContent", { set() { box.kids = []; } });
    box.classList = { add: (c) => box.cls.add(c), remove: (c) => box.cls.delete(c), contains: (c) => box.cls.has(c) };
    box.append = (...n) => box.kids.push(...n);
    cards.push(box);
    return box;
  };
  const aerial = (box) => box.kids.filter((k) => !k.street).length;
  return { ...api, stub, inFlight, overlays, card, aerial };
}

test("Home: a card waiting on its photo is an empty box, then the building, never the aerial first", async () => {
  const answers = {};
  const H = homePhotos(answers);
  const ll = { lat: 33.8, lng: -84.4 };
  const box = H.hmPhoto(H.card(), ll, "2300 Peachtree Rd NE", 48, 48, 17);
  assert.equal(H.aerial(box), 0, "no aerial while the answer comes in");
  assert.equal(box.kids.length, 0);
  H.stub.lookup = async () => { answers["2300 Peachtree Rd NE"] = "/api/streetview?t=1a"; };
  await H.hmPhotoFlush();
  assert.equal(H.overlays.length, 1);
  assert.equal(H.aerial(box), 0, "the photo goes into an empty box, not over an aerial");
  // The image would not load: only now does the aerial appear.
  box.kids = [];
  H.overlays[0].o.onFail();
  assert.equal(H.aerial(box), 1);
});

test("Home: the aerial only where there is no photo to show", async () => {
  const ll = { lat: 33.8, lng: -84.4 };
  // Already known to have no photo: the aerial straight away.
  let H = homePhotos({ "1 No Photo Rd": null });
  assert.equal(H.aerial(H.hmPhoto(H.card(), ll, "1 No Photo Rd", 48, 48, 17)), 1);
  // Asked, and Google has none.
  const answers = {};
  H = homePhotos(answers);
  let box = H.hmPhoto(H.card(), ll, "2 Empty Lot Rd", 48, 48, 17);
  H.stub.lookup = async () => { answers["2 Empty Lot Rd"] = null; };
  await H.hmPhotoFlush();
  assert.equal(H.aerial(box), 1);
  // Asked, and our route could not answer (signed out, a rate limit).
  H = homePhotos({});
  box = H.hmPhoto(H.card(), ll, "3 Refused Rd", 48, 48, 17);
  await H.hmPhotoFlush();
  assert.equal(H.aerial(box), 1, "a refused call must not leave an empty box for good");
});

test("Home: a card drawn again mid-lookup keeps waiting for the answer in flight", async () => {
  const answers = {};
  const H = homePhotos(answers);
  const ll = { lat: 33.8, lng: -84.4 };
  const box = H.hmPhoto(H.card(), ll, "4 Redrawn Rd", 48, 48, 17);
  // Another card's lookup is already asking about this address.
  H.inFlight.add("4 Redrawn Rd");
  await H.hmPhotoFlush();
  assert.equal(H.aerial(box), 0, "in flight is not 'could not be asked'");
  H.inFlight.delete("4 Redrawn Rd");
  answers["4 Redrawn Rd"] = "/api/streetview?t=4d";
  H.hmPhotoUpgrade();
  assert.equal(H.overlays.length, 1);
  assert.equal(H.aerial(box), 0);
});

// ---- A card that opens with its building in it (2026-10-13) ---------------------
// The owner: "is there a way to have the pictures load immediately on the map
// instead of it being gray first?" The browser half of building-photo.js,
// run in a stand-in window: a warm fetches the photo ahead of any card, once,
// never from a page nobody has opened, and a failed one remembers nothing.
function browserPhotos({ prerendering = false } = {}) {
  const vm = require("node:vm");
  const src = fs.readFileSync(path.join(ROOT, "building-photo.js"), "utf8");
  const mem = {};
  const images = [];
  const cached = new Set();
  const listeners = {};
  const posts = [];
  class FakeImage {
    constructor() { images.push(this); this.style = {}; this.complete = false; this.naturalWidth = 0; this._ls = {}; }
    set src(v) { this._src = v; if (cached.has(v)) { this.complete = true; this.naturalWidth = 640; } }
    get src() { return this._src; }
    addEventListener(t, fn) { this._ls[t] = fn; }
    setAttribute() {}
    fire(t) { (this["on" + t] || this._ls[t] || (() => {}))(); }
  }
  const win = {
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    Image: FakeImage,
    document: {
      prerendering,
      createElement: () => new FakeImage(),
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    },
  };
  // Our route: a sealed photo for every address, one per place asked.
  win.fetch = async (url, init) => {
    const places = JSON.parse(init.body).places;
    posts.push(places.length);
    return { ok: true, json: async () => ({ photos: places.map((_, i) => "/api/streetview?t=p" + posts.length + "x" + i) }) };
  };
  const mod = { exports: {} };
  vm.runInNewContext(src, { self: win, fetch: (...a) => win.fetch(...a), module: mod, JSON, Date, Map, Set, Object, String, Number, RegExp, Array, Promise });
  const show = () => { win.document.prerendering = false; (listeners.prerenderingchange || []).splice(0).forEach((fn) => fn()); };
  return { P: mod.exports, win, images, cached, posts, show };
}

test("a warm fetches a known photo ahead of any card, once, and only once the page is shown", async () => {
  const B = browserPhotos({ prerendering: true });
  const A = "2300 Peachtree Rd NE, Atlanta, GA";
  await B.P.lookup([{ address: A }]);
  assert.match(B.P.photo(A), /^\/api\/streetview\?t=/);
  assert.equal(B.P.preload(A), false, "a prerendered page nobody has opened spends no Google image");
  assert.equal(B.images.length, 0);
  B.show();
  assert.equal(B.images.length, 1, "shown: now it is fetched");
  assert.equal(B.images[0].src, B.P.photo(A));
  assert.equal(B.P.known(A), false);
  B.images[0].fire("load");
  assert.equal(B.P.known(A), true, "landed: the card shows it with no fade");
  assert.equal(B.P.preload(A), false, "never again for one already loaded");
  assert.equal(B.images.length, 1);
});

test("a warm that fails remembers nothing, and is not tried twice in a page's life", async () => {
  const B = browserPhotos();
  const A = "18 Main St, Boise, ID";
  await B.P.lookup([{ address: A }]);
  assert.equal(B.P.preload(A), true);
  B.images[0].fire("error");
  assert.match(B.P.photo(A), /^\/api\/streetview\?t=/, "a rate limit says nothing about the building: the card still asks");
  assert.equal(B.P.preload(A), false);
  assert.equal(B.images.length, 1);
  assert.equal(B.P.preload("1 Never Asked Rd, Boise, ID"), false, "no answer yet, nothing to fetch");
  assert.equal(B.P.preload("Financial District"), false);
});

test("a photo the browser already holds is laid in with no fade from the empty box", async () => {
  const B = browserPhotos();
  const A = "2300 Peachtree Rd NE, Atlanta, GA";
  await B.P.lookup([{ address: A }]);
  const box = { kids: [], appendChild(n) { this.kids.push(n); } };
  const fresh = B.P.overlay(box, A, B.P.photo(A), {});
  assert.match(fresh.style.cssText, /opacity:0;transition:opacity/, "not yet in the browser: it fades in when it lands");
  assert.equal(fresh.style.opacity, undefined);
  B.cached.add(B.P.photo(A));
  const held = B.P.overlay(box, A, B.P.photo(A), { urgent: true });
  assert.equal(held.style.opacity, "1");
  assert.equal(held.style.transition, "none");
  assert.equal(held.fetchPriority, "high", "a card on screen asks for its photo first");
  assert.equal(held.loading, undefined);
});

test("a big ask lands batch by batch, so the first cards need not wait for the last", async () => {
  const B = browserPhotos();
  const items = Array.from({ length: 30 }, (_, i) => ({ address: `${100 + i} Main St, Boise, ID` }));
  let landed = 0;
  const seen = [];
  await B.P.lookup(items, () => { landed++; seen.push(B.P.photo(items[0].address)); });
  assert.deepEqual(B.posts, [25, 5]);
  assert.equal(landed, 2);
  assert.match(seen[0], /^\/api\/streetview\?t=/, "the first batch's answers are in when it lands");
});

test("asking again while a big lookup is out never asks about its later batches twice", async () => {
  // Home redraws as its reads land, and each draw asks about every building:
  // the second ask must find batch two already taken, not send it again.
  const B = browserPhotos();
  const answer = B.win.fetch;
  let release;
  const gate = new Promise((r) => { release = r; });
  B.win.fetch = async (url, init) => { await gate; return answer(url, init); };
  const items = Array.from({ length: 30 }, (_, i) => ({ address: `${100 + i} Main St, Boise, ID` }));
  const first = B.P.lookup(items);
  await B.P.lookup(items);
  assert.equal(B.P.pending(items[29].address), true, "batch two is the first lookup's, still to come");
  release();
  await first;
  assert.deepEqual(B.posts, [25, 5], "each place asked about once");
  assert.equal(B.P.pending(items[29].address), false);
});

test("a lookup the route refuses lets go of every place it held", async () => {
  const B = browserPhotos();
  B.win.fetch = async () => ({ ok: false });
  const items = Array.from({ length: 30 }, (_, i) => ({ address: `${100 + i} Main St, Boise, ID` }));
  await B.P.lookup(items);
  assert.equal(B.P.pending(items[0].address), false);
  assert.equal(B.P.pending(items[29].address), false, "a card waiting on batch two falls back rather than waiting for good");
  assert.equal(B.P.photo(items[29].address), undefined, "and nothing is remembered: the next visit asks again");
});

// Home's half (index.html, hmPhotoPlaces to hmPhotoHover), lifted out and run
// against stand-ins: every building is asked about at once, the drawn pins in
// view first, and their photos are warmed, HM_WARM_MAX a page.
function homeWarm({ tab = "today", items = [], rows = [], props = true, view = () => true, answers = {}, onList = [] }) {
  const from = html.indexOf("const HM_WARM_MAX");
  const to = html.indexOf("async function readDeskSites()");
  assert.ok(from > 0 && to > from, "could not bound Home's warm block");
  const asked = [];
  const warmed = [];
  const stub = {
    eligible: (a) => /^\d+ /.test(String(a || "")),
    photo: (a) => answers[a],
    lookup: async (places, onBatch) => { asked.push(places.map((p) => p.address)); if (onBatch) onBatch(); },
    preload: (a) => { if (!answers[a] || warmed.includes(a)) return false; warmed.push(a); return true; },
    keyFor: (a) => String(a).toLowerCase(),
  };
  // The list's pane: a thumbnail per `onList` address, all on screen.
  const rect = (top) => ({ top, bottom: top + 48 });
  const pane = {
    closest: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 800 }) }),
    querySelectorAll: () => onList.map((a, i) => ({ _bpAddr: a, getBoundingClientRect: () => rect(60 * i) })),
  };
  const doc = { querySelector: () => pane, documentElement: pane.closest() };
  const hmMap = { getBounds: () => ({ contains: ([lat, lng]) => view({ lat, lng }) }) };
  const api = new Function("hmMap", "hmItems", "hmRows", "hmTab", "hmLayerOn", "hmLL", "hmLLForAddress",
    "hmPhotosOn", "hmPhotoUpgrade", "BLDGPHOTO", "setTimeout", "clearTimeout", "document", "window",
    html.slice(from, to) + "; return { hmPhotoPlaces, hmPhotoAskAll, hmPhotoWarm, hmPhotoHover, HM_WARM_MAX };")(
    hmMap, items, rows, tab, () => props, (r) => r.ll, (a) => (items.find((x) => x.address === a) || {}).ll || null,
    () => true, () => {}, stub, () => 0, () => {}, doc, { innerHeight: 800 });
  return { ...api, asked, warmed };
}

test("Home asks about every building at once, the pins in view first, never the permits", async () => {
  const ll = (lat) => ({ lat, lng: -116.2 });
  const H = homeWarm({
    items: [{ num: 1, address: "1 Far Rd", ll: ll(50) }, { num: 2, address: "2 Near Rd", ll: ll(43) }, { num: null, address: "a message" }],
    rows: [{ address: "3 Near St", ll: ll(43) }, { address: "4 Unlocated St", ll: null }, { address: "Downtown corridor", ll: ll(43) }],
    view: ({ lat }) => lat < 45,
  });
  H.hmPhotoAskAll();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(H.asked[0], ["2 Near Rd", "3 Near St", "1 Far Rd", "4 Unlocated St"]);
  assert.ok(!/permit/.test(html.slice(html.indexOf("function hmPhotoPlaces"), html.indexOf("function hmPhotoAskAll"))),
    "permits can number in the hundreds: only a hovered or opened one is asked about");
});

test("Home warms the photos of the drawn pins in view, at most HM_WARM_MAX a page", async () => {
  const answers = {};
  const rows = Array.from({ length: 50 }, (_, i) => {
    const address = `${10 + i} Elm St`;
    answers[address] = "/api/streetview?t=e" + i;
    return { address, ll: { lat: 43, lng: -116 } };
  });
  rows.push({ address: "99 Away St", ll: { lat: 60, lng: -116 } });
  answers["99 Away St"] = "/api/streetview?t=away";
  const H = homeWarm({ tab: "properties", rows, answers, view: ({ lat }) => lat < 45 });
  H.hmPhotoWarm();
  assert.equal(H.warmed.length, H.HM_WARM_MAX);
  assert.ok(!H.warmed.includes("99 Away St"), "a pin out of view is not fetched ahead");
  H.hmPhotoWarm();
  assert.equal(H.warmed.length, H.HM_WARM_MAX, "the page's allowance is spent");
  // A thumbnail on screen loads itself: the allowance goes to pins the list is not showing.
  const listed = homeWarm({ tab: "properties", rows, answers, view: ({ lat }) => lat < 45, onList: rows.slice(0, 10).map((r) => r.address) });
  listed.hmPhotoWarm();
  assert.equal(listed.warmed.length, H.HM_WARM_MAX, "the allowance, all on pins no thumbnail is showing");
  assert.equal(H.HM_WARM_MAX, 40);
  assert.ok(!listed.warmed.includes(rows[0].address));
  // A layer switched off draws no pins, so nothing of it is warmed.
  const off = homeWarm({ tab: "properties", rows, answers, props: false });
  off.hmPhotoWarm();
  assert.equal(off.warmed.length, 0);
});

test("Home warms the pin under the pointer, asking about it first when it must", async () => {
  const answers = { "5 Known Rd": "/api/streetview?t=k" };
  const H = homeWarm({ answers });
  H.hmPhotoHover("5 Known Rd", null);
  assert.deepEqual(H.warmed, ["5 Known Rd"]);
  assert.equal(H.asked.length, 0, "already answered: no lookup");
  H.hmPhotoHover("6 New Rd", { lat: 43, lng: -116 });
  answers["6 New Rd"] = "/api/streetview?t=n";
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(H.asked, [["6 New Rd"]]);
  assert.deepEqual(H.warmed, ["5 Known Rd", "6 New Rd"]);
  H.hmPhotoHover("Downtown corridor", null);
  assert.equal(H.asked.length, 1, "no street number, nothing to ask");
});

test("every pin carries the address of the card it opens, for the warm on hover", () => {
  const block = html.slice(html.indexOf("function hmDrawPins()"), html.indexOf("function hmFitOpts") > 0 ? html.indexOf("function hmFitOpts") : html.indexOf("const hmFitOpts"));
  const pins = block.match(/hmPin\(/g) || [];
  assert.equal(pins.length, 4);
  assert.equal((block.match(/, r\.address\);/g) || []).length, 2, "both property pins");
  assert.match(block, /\(hmRowByKey\(key\) \|\| x\)\.address\);/, "Today's pins: the same address hmSelect's card uses");
  assert.match(block, /\[p\.street, p\.city\]\.filter\(Boolean\)\.join\(", "\)\);/, "a permit's pin: its card's address");
  assert.match(html, /if \(photoOf\) m\.on\("mouseover", \(\) => hmPhotoHover\(photoOf, ll\)\);/);
  assert.match(html, /hmMap\.on\("moveend", hmPhotoWarmSoon\);/);
  assert.match(block, /hmSyncLayerNote\(\);\n\s*hmPhotoAskAll\(\);/, "asked as the pins are drawn");
});

// ---- ⚠ the copies agree with index.html's ---------------------------------------
// building-photo.js carries copies of index.html's houseNumberOf and
// unitDesignatorOf, because /vault cannot load index.html's script. Lifted out
// of index.html the way test/index-html.test.js lifts unitDesignatorOf, and
// run side by side.
function indexHelpers() {
  const from = html.indexOf("function houseNumberOf(address)");
  const to = html.indexOf("const typeGuessCache");
  assert.ok(from > 0 && to > from, "could not bound index.html's address-proving block");
  return new Function(html.slice(from, to) + "; return { houseNumberOf, unitDesignatorOf };")();
}

test("⚠ houseNumberOf / unitDesignatorOf match index.html's", () => {
  const ix = indexHelpers();
  for (const a of [
    "1820 N 21st St, Boise, ID 83702", "6728 W Fairview Ave Trailer 51, Boise, ID 83704", "1234 Main St Apt 3B, Denver, CO",
    "1234 Main St #45, Denver, CO", "500 Market St Ste 200, San Francisco, CA", "9 Pine Dr Unit A, Boise, ID",
    "700 5th Ave Bldg B, Seattle, WA", "One Wilshire Blvd, Los Angeles, CA", "6728 W Fairview Ave 51, Boise, ID",
    "100 Roomy Lane, Austin, TX", "44 Lotus Lane, Sacramento, CA", "1200 United Nations Plaza, New York, NY",
    "123 Ste Genevieve Ave, St Louis, MO", "873 E Citation Ct, Miami, FL 33101", "500 Main St Fl 3, Miami, FL 33101",
    "77 Bay St, Miami, FL 33101-4021", "", "  42 Oak Blvd SPC 12, Mesa, AZ",
  ]) {
    assert.equal(BP.houseNumberOf(a), ix.houseNumberOf(a), "houseNumberOf: " + a);
    assert.equal(BP.unitDesignatorOf(a), ix.unitDesignatorOf(a), "unitDesignatorOf: " + a);
  }
});

// ---- wiring ---------------------------------------------------------------------

test("served with maxAge 0 and loaded by the page that draws building photos", () => {
  assert.match(server, /"\/building-photo\.js": \{ file: "building-photo\.js", type: "text\/javascript; charset=utf-8", maxAge: 0 \}/);
  assert.match(html, /<script src="\/building-photo\.js"><\/script>/);
  // /vault loaded it for The Board's deal cards until the deal wall left
  // (2026-10-09); nothing there draws a building photo now.
  const vault = fs.readFileSync(path.join(ROOT, "vault-page.js"), "utf8");
  assert.doesNotMatch(vault, /building-photo\.js|__CN_STREETVIEW__/);
});

test("the address travels in a POST body to our own route, never in a URL and never to Overpass", () => {
  const src = fs.readFileSync(path.join(ROOT, "building-photo.js"), "utf8");
  assert.match(src, /fetch\("\/api\/building-photo", \{\s*method: "POST"/);
  assert.doesNotMatch(src, /overpass/i);
  assert.doesNotMatch(src, /\?address=|&address=|location=/);
  // Home is the one caller since The Board's deal wall left (2026-10-09).
  assert.match(html, /BLDGPHOTO\.lookup\(/);
});
