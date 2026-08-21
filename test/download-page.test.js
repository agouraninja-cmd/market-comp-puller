"use strict";

// The /download page's links are only as real as three files agreeing on the
// installer names: desktop-app/package.json's artifactName settings decide
// what electron-builder emits, .github/workflows/desktop-release.yml decides
// what gets attached to the release, and server.js's DOWNLOAD_FILES decides
// what the page links to. A rename in any one of them leaves the page serving
// 404 links with nothing else failing — this suite is the tripwire.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appPkg = JSON.parse(fs.readFileSync(path.join(root, "desktop-app", "package.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "desktop-release.yml"), "utf8");

// The names electron-builder actually emits, derived from the build config
// rather than restated here.
const EXPECTED = {
  windows: appPkg.build.nsis.artifactName.replace("${ext}", "exe"),
  mac: appPkg.build.dmg.artifactName.replace("${ext}", "dmg"),
  linux: appPkg.build.linux.artifactName.replace("${ext}", "AppImage"),
};

test("artifact names are version-less so releases/latest/download URLs never move", () => {
  for (const name of Object.values(EXPECTED)) {
    assert.ok(!name.includes("$") && !/\d+\.\d+\.\d+/.test(name),
      `${name} carries a version — the /download page's stable links would break on every release`);
  }
});

test("the release workflow attaches exactly the files the builder emits", () => {
  for (const name of Object.values(EXPECTED)) {
    assert.ok(workflow.includes(`desktop-app/dist/${name}`),
      `desktop-release.yml does not attach ${name}`);
  }
});

test("the /download page links exactly the files the release carries", () => {
  for (const name of Object.values(EXPECTED)) {
    assert.ok(serverSrc.includes(`"${name}"`), `server.js DOWNLOAD_FILES is missing ${name}`);
  }
  assert.ok(serverSrc.includes("releases/latest/download"));
});

test("the page is reachable: route, nav link, and sitemap entry all exist", () => {
  assert.ok(serverSrc.includes('=== "/download"'), "no GET /download route");
  assert.ok(serverSrc.includes('["/download", "Download the app"],'), "NAV_LINKS has no /download entry");
  assert.ok(serverSrc.includes("/download</loc>"), "sitemap does not list /download");
});
