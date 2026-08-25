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
  const live = heroFor("Ontario", "CA", { skipFiles: ["ontario-ca.jpg"] });
  const ll = CITY_COORDS["ontario, ca"];
  assert.equal(live.kind, "satellite");
  assert.equal(live.src, esriAerialUrl(ll.lat, ll.lng));
  assert.equal(live.credit, "Esri, Maxar");
  assert.equal(heroFor("Ontario", "ON", { skipFiles: ["ontario-ca.jpg"] }), null);
});

test("every curated city has coordinates so a failed file can fall through to Esri", () => {
  for (const key of Object.keys(HEROES)) {
    assert.ok(CITY_COORDS[key], key + " has a photo but no Esri point");
  }
});

test("an explorer city with coordinates but no photograph still gets an aerial", () => {
  // Injected empty auto table: Boise has a GENERATED photograph now, and this
  // test is about the branch below both photo layers.
  const h = heroFor("Boise", "ID", { auto: { cities: {} } });
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

// --- the automatic layer (market-heroes-auto.json) --------------------------

const AUTO_FIXTURE = {
  cities: {
    "casper, wy": {
      coords: { lat: 42.85, lng: -106.32 },
      hero: {
        file: "casper-wy.jpg",
        credit: "Somebody",
        license: "CC BY-SA 2.0",
        commons: "Cloudy Snowy Casper Aerial.jpg",
        alt: "Casper, WY from above",
        source: "geosearch",
        judge: { verdict: "good", reason: "A real aerial of a small city." },
      },
    },
    "nampa, id": { coords: { lat: 43.6, lng: -116.61 }, hero: null },
    "dallas, tx": {
      coords: { lat: 1, lng: 1 },
      hero: { file: "not-dallas.jpg", credit: "x", license: "CC0", commons: "x.jpg", alt: "x" },
    },
    "hacked, xx": {
      coords: { lat: 10, lng: 10 },
      hero: { file: "../server.js", credit: "x", license: "CC0", commons: "x.jpg", alt: "x" },
    },
    "creditless, xx": {
      coords: { lat: 10, lng: 10 },
      hero: { file: "creditless-xx.jpg", license: "CC0", alt: "x" },
    },
  },
};

test("a generated photograph heads a city nobody curated", () => {
  const h = heroFor("Casper", "WY", { auto: AUTO_FIXTURE });
  assert.equal(h.kind, "photo");
  assert.equal(h.src, "/market-heroes/casper-wy.jpg");
  assert.equal(h.srcset, photoSrcset("casper-wy.jpg"));
  assert.equal(h.credit, "Somebody");
  assert.match(h.commonsUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
});

test("a curated photograph still wins over a generated one", () => {
  const h = heroFor("Dallas", "TX", { auto: AUTO_FIXTURE });
  assert.equal(h.src, "/market-heroes/dallas-tx.jpg");
});

test("a generated file that fails the quality grade drops to the satellite, like a curated one", () => {
  const h = heroFor("Casper", "WY", { auto: AUTO_FIXTURE, skipFiles: ["casper-wy.jpg"] });
  assert.equal(h.kind, "satellite");
  assert.equal(h.src, esriAerialUrl(42.85, -106.32));
});

test("a generated entry is not believed on trust", () => {
  // The file name becomes a URL under /market-heroes/, so a generated path is
  // still a path. Credit and the Commons title are what the attribution line
  // is made of; an entry missing either is not attributable and is not used.
  const hacked = heroFor("Hacked", "XX", { auto: AUTO_FIXTURE });
  assert.equal(hacked.kind, "satellite", "a file name outside the folder must never be served");
  const creditless = heroFor("Creditless", "XX", { auto: AUTO_FIXTURE });
  assert.equal(creditless.kind, "satellite");
});

test("a city with no photograph at all still gets an aerial from the generated coordinates", () => {
  const h = heroFor("Nampa", "ID", { auto: AUTO_FIXTURE });
  assert.equal(h.kind, "satellite");
  assert.equal(h.src, esriAerialUrl(43.6, -116.61));
});

test("a market page published since the last generator run falls back to its own coordinates", () => {
  const h = heroFor("Brand New", "TX", { auto: AUTO_FIXTURE, coords: { lat: 31.5, lng: -97.1 } });
  assert.equal(h.kind, "satellite");
  assert.equal(h.src, esriAerialUrl(31.5, -97.1));
  // …and the committed tables still outrank whatever the caller supplies.
  const boise = heroFor("Boise", "ID", { auto: AUTO_FIXTURE, coords: { lat: 0, lng: 0 } });
  assert.equal(boise.src, esriAerialUrl(CITY_COORDS["boise, id"].lat, CITY_COORDS["boise, id"].lng));
  assert.equal(heroFor("Nowhere", "XX", { auto: { cities: {} } }), null);
});

test("coordsFor resolves the heroes' own chain, as a bare point", () => {
  const { coordsFor } = require("../market-hero");
  // Curated downtown point outranks whatever the caller supplies…
  assert.deepEqual(coordsFor("Boise", "ID", { coords: { lat: 0, lng: 0 } }),
    { lat: Number(CITY_COORDS["boise, id"].lat), lng: Number(CITY_COORDS["boise, id"].lng) });
  // …then the generated table…
  assert.deepEqual(coordsFor("Nampa", "ID", { auto: AUTO_FIXTURE }), { lat: 43.6, lng: -116.61 });
  // …then the payload's own point, and nothing invents one.
  assert.deepEqual(coordsFor("Brand New", "TX", { auto: AUTO_FIXTURE, coords: { lat: 31.5, lng: -97.1 } }),
    { lat: 31.5, lng: -97.1 });
  assert.equal(coordsFor("Nowhere", "XX", { auto: { cities: {} } }), null);
  // A garbage point is refused, never passed through: the momentum map holds
  // the heroes' rule — a wrong point is worse than none.
  assert.equal(coordsFor("Nowhere", "XX", { coords: { lat: "x", lng: 1 } }), null);
});

test("every generated hero on disk is a real, safe, attributed file", () => {
  const { autoCities, autoHeroFor } = require("../market-hero");
  for (const [key, row] of Object.entries(autoCities())) {
    assert.ok(row.coords || row.hero, key + " has neither a photo nor a point — it would render blank");
    const hero = autoHeroFor(key);
    if (!hero) continue;
    assert.ok(isHeroFilename(hero.file), key + " file is not a safe name");
    assert.ok(fs.existsSync(path.join(DIR, hero.file)), hero.file + " is missing");
    const sibling = srcsetName(hero.file);
    assert.ok(fs.existsSync(path.join(DIR, sibling)), sibling + " is missing");
    assert.ok(fs.statSync(path.join(DIR, hero.file)).size > 20 * 1024, hero.file + " looks empty");
    assert.ok(hero.credit && hero.license, key + " has no attribution");
    assert.ok(hero.commons, key + " has no Commons title to link back to");
    assert.equal(HEROES[key], undefined, key + " is generated AND curated — the curated one would always win");
  }
});

// --- a failed curated file, and the directory thumbnails ------------------

test("a curated file that fails the grade hands off to the generated one, not to a tile", () => {
  // The reason the skip list names FILES. Ontario, CA's curated JPEG is an
  // upscale; a city-keyed skip took the understudy down with it.
  const auto = {
    cities: {
      "ontario, ca": {
        coords: { lat: 34.056, lng: -117.6012 },
        hero: {
          file: "ontario-ca-auto.jpg", credit: "Somebody", license: "CC BY 4.0",
          commons: "Ontario CA from the air.jpg", alt: "Ontario, CA from above",
        },
      },
    },
  };
  const live = heroFor("Ontario", "CA", { auto, skipFiles: ["ontario-ca.jpg"] });
  assert.equal(live.kind, "photo");
  assert.equal(live.src, "/market-heroes/ontario-ca-auto.jpg");
  // Both failing means the tile, still of Ontario, CALIFORNIA.
  const both = heroFor("Ontario", "CA", { auto, skipFiles: ["ontario-ca.jpg", "ontario-ca-auto.jpg"] });
  assert.equal(both.kind, "satellite");
  assert.equal(both.src, esriAerialUrl(34.056, -117.6012));
  // And with nothing failing, the person's pick still wins.
  assert.equal(heroFor("Ontario", "CA", { auto }).src, "/market-heroes/ontario-ca.jpg");
});

test("the directory thumbnail is the same picture as the page it links to", () => {
  const { thumbFor, thumbName, HERO_THUMB_WIDTH, HERO_THUMB_HEIGHT } = require("../market-hero");
  const hero = heroFor("Dallas", "TX");
  const thumb = thumbFor("Dallas", "TX");
  assert.equal(thumb.kind, "photo");
  assert.equal(thumb.src, "/market-heroes/" + thumbName("dallas-tx.jpg"));
  assert.equal(thumb.src, hero.src.replace(/\.jpg$/, "-" + HERO_THUMB_WIDTH + ".jpg"));
  assert.equal(thumb.alt, hero.alt);
  // The thumbnail keeps the header's crop exactly, so a card cannot show a
  // differently-framed version of the same photograph.
  assert.equal(HERO_THUMB_WIDTH / HERO_THUMB_HEIGHT, HERO_WIDTH / HERO_HEIGHT);
});

test("a satellite city gets a small tile, and an unknown city gets no card picture", () => {
  const { thumbFor, HERO_THUMB_WIDTH, HERO_THUMB_HEIGHT } = require("../market-hero");
  const t = thumbFor("Boise", "ID", { auto: { cities: {} } });
  assert.equal(t.kind, "satellite");
  assert.equal(t.src, esriAerialUrl(CITY_COORDS["boise, id"].lat, CITY_COORDS["boise, id"].lng,
    HERO_THUMB_WIDTH, HERO_THUMB_HEIGHT));
  assert.equal(thumbFor("Narnia", "XX", { auto: { cities: {} } }), null);
});

test("every stored hero has its directory thumbnail on disk", () => {
  const { autoCities, autoHeroFor, thumbName } = require("../market-hero");
  const files = [
    ...Object.values(HEROES).map((r) => r.file),
    ...Object.keys(autoCities()).map((k) => (autoHeroFor(k) || {}).file).filter(Boolean),
  ];
  for (const file of files) {
    const thumb = thumbName(file);
    assert.ok(isHeroFilename(thumb), thumb + " is not a safe name");
    assert.ok(fs.existsSync(path.join(DIR, thumb)),
      thumb + " is missing — run: node scripts/auto-market-heroes.js --thumbs");
    assert.ok(fs.statSync(path.join(DIR, thumb)).size > 4 * 1024, thumb + " looks empty");
  }
});
