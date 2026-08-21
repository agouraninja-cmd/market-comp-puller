"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  HEROES, CITY_COORDS, HERO_WIDTH, HERO_HEIGHT, HERO_SRCSET_WIDTH, HERO_SRCSET_HEIGHT,
  heroFor, srcsetName, photoSrcset, esriAerialUrl, commonsFileUrl, isHeroFilename,
} = require("../market-hero");

const SEED = require("../market-seed.json");
const DIR = path.join(__dirname, "..", "market-heroes");

test("every seeded market has a curated city photograph, not a satellite fallback", () => {
  for (const [slug, p] of Object.entries(SEED)) {
    const h = heroFor(p.city, p.state);
    assert.ok(h, `${slug} (${p.city}, ${p.state}) has no hero`);
    assert.equal(h.kind, "photo", `${slug} fell through to satellite — add a Commons photo`);
    assert.match(h.src, /^\/market-heroes\/[a-z0-9-]+\.jpg$/);
    assert.ok(h.srcset.includes(h.src + " " + HERO_WIDTH + "w"), slug + " srcset is missing the 3840w file");
    assert.match(h.srcset, new RegExp("-" + HERO_SRCSET_WIDTH + "\\.jpg " + HERO_SRCSET_WIDTH + "w"));
    assert.ok(h.alt);
    assert.ok(h.credit);
    assert.ok(h.commonsUrl.startsWith("https://commons.wikimedia.org/wiki/File:"));
  }
});

test("Dallas industrial, office, and multifamily share one photograph", () => {
  const a = heroFor("Dallas", "TX");
  const b = heroFor("dallas", "tx");
  assert.equal(a.src, b.src);
  assert.equal(a.src, "/market-heroes/dallas-tx.jpg");
  assert.equal(a.srcset, photoSrcset("dallas-tx.jpg"));
  assert.equal(srcsetName("dallas-tx.jpg"), "dallas-tx-1920.jpg");
});

test("Ontario, CA is not Ontario, Canada", () => {
  const ca = heroFor("Ontario", "CA");
  const on = heroFor("Ontario", "ON");
  assert.equal(ca.kind, "photo");
  assert.equal(on, null);
});

test("a failed Ontario file falls through to Esri of Ontario, CA, not Canada", () => {
  const live = heroFor("Ontario", "CA", { skipKeys: ["ontario, ca"] });
  const ll = CITY_COORDS["ontario, ca"];
  assert.equal(live.kind, "satellite");
  assert.equal(live.src, esriAerialUrl(ll.lat, ll.lng));
  assert.equal(live.credit, "Esri, Maxar");
  assert.equal(heroFor("Ontario", "ON", { skipKeys: ["ontario, ca"] }), null);
});

test("every curated city has coordinates so a failed file can fall through to Esri", () => {
  for (const key of Object.keys(HEROES)) {
    assert.ok(CITY_COORDS[key], key + " has a photo but no Esri point");
  }
});

test("an explorer city with coordinates still gets an aerial", () => {
  const h = heroFor("Boise", "ID");
  assert.equal(h.kind, "satellite");
  assert.match(h.src, /World_Imagery/);
  assert.match(h.src, /bbox=/);
  assert.match(h.src, new RegExp("size=" + HERO_WIDTH + "," + HERO_HEIGHT));
  assert.match(h.srcset, new RegExp(HERO_SRCSET_WIDTH + "w"));
  assert.equal(h.credit, "Esri, Maxar");
});

test("an unknown city without coordinates does not invent a picture", () => {
  assert.equal(heroFor("Narnia", "XX"), null);
  assert.equal(heroFor("", ""), null);
});

test("every curated JPEG is on disk, and the filename regex refuses a path", () => {
  for (const [key, row] of Object.entries(HEROES)) {
    assert.ok(isHeroFilename(row.file), key + " file is not a safe name");
    assert.ok(fs.existsSync(path.join(DIR, row.file)), row.file + " is missing");
    const bytes = fs.statSync(path.join(DIR, row.file)).size;
    assert.ok(bytes > 20 * 1024, row.file + " looks empty (" + bytes + " bytes)");
    const sibling = srcsetName(row.file);
    assert.ok(isHeroFilename(sibling), key + " 1920w sibling is not a safe name");
    assert.ok(fs.existsSync(path.join(DIR, sibling)), sibling + " is missing");
    const bytes1x = fs.statSync(path.join(DIR, sibling)).size;
    assert.ok(bytes1x > 10 * 1024, sibling + " looks empty (" + bytes1x + " bytes)");
  }
  assert.equal(isHeroFilename("../server.js"), false);
  assert.equal(isHeroFilename("dallas-tx.png"), false);
  assert.equal(isHeroFilename("dallas-tx.jpg"), true);
  assert.equal(isHeroFilename("dallas-tx-1920.jpg"), true);
});

test("the Commons file URL keeps the File: title readable", () => {
  const u = commonsFileUrl("Aerial of Downtown Atlanta, GA.jpg");
  assert.match(u, /File:Aerial/);
  assert.ok(!u.includes("%20"), "wiki pages use underscores, not %20");
});

test("the Esri fallback is a static JPEG of a real bbox, not a tile URL", () => {
  const url = esriAerialUrl(43.615, -116.2023);
  assert.match(url, /format=jpg/);
  assert.match(url, new RegExp("size=" + HERO_WIDTH + "," + HERO_HEIGHT));
  assert.equal(HERO_SRCSET_HEIGHT, HERO_HEIGHT * (HERO_SRCSET_WIDTH / HERO_WIDTH));
  assert.ok(CITY_COORDS["boise, id"]);
});
