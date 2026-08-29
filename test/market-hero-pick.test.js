"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MIN_SOURCE_WIDTH, gradeCandidate, rankCandidates, titleNamesCity,
  licenseOk, heroFilename, cleanCredit, baseTitle,
} = require("../market-hero-pick");
const { FILE_RE } = require("../market-hero");

const CTX = { city: "Casper", state: "WY" };

function cand(over) {
  return {
    title: "File:Casper Wyoming aerial.jpg",
    width: 4000, height: 2200, mime: "image/jpeg",
    license: "CC BY-SA 4.0", artist: "Somebody", source: "category-aerial",
    ...over,
  };
}

test("a wide, freely licensed aerial from a city category is worth downloading", () => {
  const g = gradeCandidate(cand(), CTX);
  assert.equal(g.ok, true);
  assert.ok(g.score > 60, "an aerial that names the city should rank high, got " + g.score);
});

test("nothing that is not a raster photograph gets through", () => {
  for (const mime of ["image/svg+xml", "application/pdf", "image/gif", "video/webm", ""]) {
    assert.equal(gradeCandidate(cand({ mime }), CTX).ok, false, mime + " should be refused");
  }
});

test("a licence that is not clearly free is refused, not assumed", () => {
  assert.equal(licenseOk("CC BY 4.0"), true);
  assert.equal(licenseOk("Public domain"), true);
  assert.equal(licenseOk("CC0"), true);
  assert.equal(licenseOk("Fair use"), false);
  assert.equal(licenseOk("All rights reserved"), false);
  assert.equal(licenseOk(""), false);
  assert.equal(gradeCandidate(cand({ license: "" }), CTX).ok, false);
});

test("seals, maps, collages and charts are refused however well they name the city", () => {
  for (const title of [
    "File:Seal of Casper, Wyoming.jpg",
    "File:Casper Wyoming locator map.png",
    "File:Casper Collage.jpg",
    "File:Casper Wyoming household income chart.png",
    "File:Flag of Casper.jpg",
  ]) {
    assert.equal(gradeCandidate(cand({ title }), CTX).ok, false, title + " should be refused");
  }
});

test("a photograph of one thing in the city is not a photograph of the city", () => {
  // The first automatic pass offered Nampa's department store shopfront.
  assert.equal(gradeCandidate(cand({ title: "File:Nampa Department Store (Nampa, Idaho).jpg" }),
    { city: "Nampa", state: "ID" }).ok, false);
  assert.equal(gradeCandidate(cand({ title: "File:Casper Wyoming church interior.jpg" }), CTX).ok, false);
  assert.equal(gradeCandidate(cand({ title: "File:Steam locomotive at Casper.jpg" }), CTX).ok, false);
});

test("shapes that cannot become a 4.8:1 band are refused", () => {
  assert.equal(gradeCandidate(cand({ width: 2000, height: 3000 }), CTX).ok, false, "portrait");
  assert.equal(gradeCandidate(cand({ width: 12000, height: 600 }), CTX).ok, false, "stitched strip");
  assert.equal(gradeCandidate(cand({ width: MIN_SOURCE_WIDTH - 1, height: 900 }), CTX).ok, false, "too small");
  assert.equal(gradeCandidate(cand({ width: MIN_SOURCE_WIDTH, height: 900 }), CTX).ok, true, "just big enough");
});

test("a search hit that never names the city is refused; a geotagged one is not", () => {
  // Commons answers "Casper Wyoming skyline" with Skyline Drive, Virginia.
  const strayTitle = "File:Skyline Drive in the Fall (21852619608).jpg";
  assert.equal(gradeCandidate(cand({ title: strayTitle, source: "search" }), CTX).ok, false);
  assert.equal(gradeCandidate(cand({ title: strayTitle, source: "geosearch", distanceM: 900 }), CTX).ok, true,
    "a photograph geotagged downtown proves its city without naming it");
});

test("city names match as whole words, punctuation and all", () => {
  assert.equal(titleNamesCity("File:Coeur d'Alene aerial, May 2023.jpg", "Coeur D'Alene"), true);
  assert.equal(titleNamesCity("Las Vegas from above", "Las Vegas"), true);
  assert.equal(titleNamesCity("Vegas Street, Reno", "Las Vegas"), false);
  assert.equal(titleNamesCity("New Bedford pano", "Bedford"), true);
  assert.equal(titleNamesCity("Bedfordshire fields", "Bedford"), false);
});

test("provenance outranks a good title, and the shortlist is capped and deduped", () => {
  const list = [
    cand({ title: "File:Casper skyline.jpg", source: "search" }),
    cand({ title: "File:Casper skyline.jpg", source: "wikipedia" }),   // same file, twice
    cand({ title: "File:Casper aerial.jpg", source: "geosearch", distanceM: 500 }),
    cand({ title: "File:Casper riverfront.jpg", source: "category" }),
    cand({ title: "File:Seal of Casper.jpg", source: "wikipedia" }),
  ];
  const { kept, rejected } = rankCandidates(list, CTX, 2);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].title, "File:Casper skyline.jpg");
  assert.ok(kept[0].score >= kept[1].score, "best first");
  assert.ok(rejected.some((r) => /Seal/.test(r.title)), "the seal is still reported as refused");
  // The full "File:…jpg" survives grading: every later Wikimedia call and the
  // credit link are keyed on it, and the readable form rides alongside.
  for (const k of kept) {
    assert.match(k.title, /^File:/);
    assert.ok(!/^File:/.test(k.label));
  }
});

test("a soft original is penalised, never refused — a real photo beats a satellite tile", () => {
  const sharp = gradeCandidate(cand({ width: 4200, height: 2400 }), CTX);
  const soft = gradeCandidate(cand({ width: 2500, height: 1600 }), CTX);
  assert.equal(soft.ok, true);
  assert.ok(soft.score < sharp.score);
});

test("the generated filename is one market-hero.js will serve", () => {
  assert.equal(heroFilename("Casper", "WY"), "casper-wy.jpg");
  assert.equal(heroFilename("Coeur D'Alene", "ID"), "coeur-d-alene-id.jpg");
  assert.equal(heroFilename("St. Louis", "MO"), "st-louis-mo.jpg");
  for (const [c, st] of [["Casper", "WY"], ["Coeur D'Alene", "ID"], ["Salt Lake City", "UT"]]) {
    assert.match(heroFilename(c, st), FILE_RE, `${c} produces a name the static handler refuses`);
  }
  assert.equal(heroFilename("../etc", ""), "etc.jpg");
});

test("the credit is text, never the markup Commons states it in", () => {
  assert.equal(cleanCredit('<a href="https://example.com" rel="nofollow">Jane Doe</a>'), "Jane Doe");
  assert.equal(cleanCredit("Bob &amp; Sons"), "Bob & Sons");
  assert.ok(!cleanCredit("<span>" + "x".repeat(200) + "</span>").includes("<"));
  assert.ok(cleanCredit("y".repeat(200)).length <= 60);
});

test("baseTitle strips the namespace and the extension for display only", () => {
  assert.equal(baseTitle("File:Cumberland Aerial 2022.jpg"), "Cumberland Aerial 2022");
  assert.equal(baseTitle("File:Savannah.tif"), "Savannah");
});

test("a geotagged photograph from the next town over is not evidence about this town", () => {
  // Agoura Hills was offered a Library of Congress aerial of the Malibu
  // coastline: inside the search radius, titled "in Los Angeles".
  const malibu = cand({
    title: "File:Aerial view of Pacific Coast shoreline in Los Angeles, California LCCN2013632643.jpg",
    source: "geosearch", distanceM: 11000,
  });
  assert.equal(gradeCandidate(malibu, { city: "Agoura Hills", state: "CA" }).ok, false);
  // Close enough to be the city itself, or naming it, still passes.
  assert.equal(gradeCandidate({ ...malibu, distanceM: 800 }, { city: "Agoura Hills", state: "CA" }).ok, true);
  assert.equal(gradeCandidate({
    title: "File:Agoura Hills from the hills.jpg", source: "geosearch", distanceM: 11000,
    width: 4000, height: 2200, mime: "image/jpeg", license: "CC BY 4.0",
  }, { city: "Agoura Hills", state: "CA" }).ok, true);
});

test("undescribed stock imports sink below anything that says what it shows", () => {
  // Commons geosearch around Salt Lake City returns bulk Unsplash imports
  // titled after the city: measured, they were a desk flat-lay, a portrait and
  // a field with horses. They still name the city and still carry its geotag.
  const stock = gradeCandidate(cand({
    title: "File:Salt Lake City, United States (Unsplash HSd2y7VjX-E).jpg",
    source: "geosearch", distanceM: 900,
  }), { city: "Salt Lake City", state: "UT" });
  const described = gradeCandidate(cand({
    title: "File:Salt Lake City skyline from Ensign Peak.jpg",
    source: "geosearch", distanceM: 900,
  }), { city: "Salt Lake City", state: "UT" });
  assert.equal(stock.ok, true, "not refused — one of them might be the skyline");
  assert.ok(stock.score < described.score - 30, "but judged last");
});

test("archival building surveys are refused outright, however well they name the city", () => {
  // Ontario, CA's entire shortlist was six of these: black-and-white HABS
  // elevations of one church and one packing house, big, freely licensed,
  // geotagged downtown, and with the city in every title.
  const habs = cand({
    title: "File:MAIN SECTION - EAST - NORTH WINGS from E - Latimer Packing House, 321 South San Antonio Avenue, Ontario, San Bernardino County, CA HABS CAL,36-ONT,1-3.jpg",
    source: "geosearch", distanceM: 700, width: 5000, height: 3970,
  });
  const g = gradeCandidate(habs, { city: "Ontario", state: "CA" });
  assert.equal(g.ok, false);
  assert.match(g.reasons[0], /archival/);
  for (const t of ["File:Something HAER PA,2-PITBU,1.jpg", "File:A road HALS CA-12.jpg"]) {
    assert.equal(gradeCandidate(cand({ title: t }), CTX).ok, false, t);
  }
  // "Habsburg" is not a survey, and a title is not a haystack for substrings.
  assert.equal(gradeCandidate(cand({ title: "File:Casper Habsburg Avenue aerial.jpg" }), CTX).ok, true);
});

test("the article's other pictures rank between its lead image and a bare category", () => {
  const at = (source) => gradeCandidate(cand({ title: "File:Nampa Idaho downtown.jpg", source }),
    { city: "Nampa", state: "ID" }).score;
  assert.ok(at("wikipedia") > at("wikipedia-article"));
  assert.ok(at("wikipedia-article") > at("category"));
  // And it proves the city by itself, like every other Wikipedia/Commons
  // source: an article about Nampa does not illustrate itself with Boise.
  assert.equal(gradeCandidate(cand({ title: "File:Downtown at dusk.jpg", source: "wikipedia-article" }),
    { city: "Nampa", state: "ID" }).ok, true);
});
