// No map draws Leaflet's +/- zoom buttons, on any screen (2026-11-20, the
// owner's call: first on phones, then "remove the zoom buttons on desktop
// too"). Zooming is pinch, double-tap or double-click, and the scroll wheel
// where a map turns it on (Home's map).
//
// Leaflet adds the buttons unless a map is made with `zoomControl: false`,
// so every `L.map(` call in the app's source must say so, and nothing may add
// `L.control.zoom` back. A new map that forgets fails here.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FILES = ["index.html", "server.js", "vault-page.js", "permits-page.js"];
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("every map is made without zoom buttons", () => {
  let maps = 0;
  for (const f of FILES) {
    const src = read(f);
    const re = /L\.map\(([^)]*\{[^}]*\})/g;
    let m;
    while ((m = re.exec(src))) {
      maps++;
      assert.match(m[1], /zoomControl\s*:\s*false/, `${f}: ${m[0]} must pass zoomControl: false`);
    }
  }
  assert.ok(maps >= 8, `expected to find every map, found ${maps}`);
});

test("nothing adds the zoom buttons back", () => {
  for (const f of FILES) {
    assert.doesNotMatch(read(f), /L\.control\.zoom\(/, `${f} adds L.control.zoom`);
  }
});
