"use strict";

// The installable-app identity (PWA). The desktop app users install IS the
// site — the manifest is what makes Chrome/Edge offer "Install CompNinja" —
// so these pins guard the three ways it silently breaks: a manifest the
// browser rejects, an icon that 404s or lies about its size, and a route
// that never serves any of it because the static allowlist forgot the path.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("manifest carries the fields Chrome/Edge require to offer Install", () => {
  assert.equal(manifest.name, "CompNinja");
  assert.equal(manifest.short_name, "CompNinja");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.id, "/");
  // Installability needs at least a 192 and a 512.
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
});

test("every manifest icon exists on disk and is the size it claims", () => {
  for (const icon of manifest.icons) {
    const file = path.join(root, icon.src.replace(/^\//, ""));
    const { width, height } = pngSize(file);
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} claims ${icon.sizes}`);
    assert.equal(icon.type, "image/png");
  }
});

test("maskable is its own icon entry, never combined with any", () => {
  // "any maskable" makes some launchers apply the mask to the transparent
  // mark, shrinking it inside a white plate. One purpose per entry.
  for (const icon of manifest.icons) {
    const purpose = icon.purpose || "any";
    assert.ok(purpose === "any" || purpose === "maskable", `unexpected purpose: ${purpose}`);
  }
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
});

test("server.js allowlists the manifest and every icon it names", () => {
  // STATIC_FILES is an allowlist — an entry missing here is a 404 in
  // production while everything works from the repo checkout.
  assert.ok(serverSrc.includes('"/manifest.webmanifest"'));
  for (const icon of manifest.icons) {
    assert.ok(serverSrc.includes(`"${icon.src}"`), `STATIC_FILES is missing ${icon.src}`);
  }
});

test("index.html links the manifest and wires the footer Install button", () => {
  assert.ok(indexSrc.includes('rel="manifest"'));
  assert.ok(indexSrc.includes('href="/manifest.webmanifest"'));
  // The button ships hidden and is revealed only by beforeinstallprompt, so
  // it can never be a control that does nothing.
  assert.match(indexSrc, /id="installAppItem"\s+hidden/);
  assert.ok(indexSrc.includes("beforeinstallprompt"));
  assert.ok(indexSrc.includes("appinstalled"));
});

test("the landing render and marketShell both carry the manifest link", () => {
  // Under the account wall an ANONYMOUS visitor at / gets the landing render,
  // not index.html — if only the app page links the manifest, Chrome/Edge
  // never offer Install to the people who haven't signed up yet, which is
  // the exact audience a download door exists for. Two head builders serve
  // every public page (marketShell + renderHowItWorksHTML); both must link it.
  const linkCount = serverSrc.split('rel="manifest"').length - 1;
  assert.ok(linkCount >= 2, `server.js renders the manifest link ${linkCount} time(s); expected marketShell AND the landing render`);
});

test("no service worker — the app must never cache /valuation.js itself", () => {
  // index.html's inline script destructures VALUATION as its first statement;
  // a service worker's cache could serve that file stale relative to the HTML
  // and abort the whole front end — the exact failure the max-age:0 rule on
  // /valuation.js exists to prevent. Installability no longer requires one.
  assert.ok(!indexSrc.includes("serviceWorker"), "index.html registers a service worker");
  assert.ok(!fs.existsSync(path.join(root, "sw.js")) && !fs.existsSync(path.join(root, "service-worker.js")));
});
