"use strict";

// "Download the app" must not be offered to somebody already inside the app.
// The mechanism spans three files that cannot see each other at runtime —
// desktop-app/main.js stamps a user-agent token, server.js's INAPP_BOOT looks
// for it and hides `.nav-dl`, and NAV_LINKS is what puts that class on the
// link — and every failure here is SILENT: the link simply comes back, in the
// one place nobody looks (inside the shipped app). Hence these pins.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "desktop-app", "main.js"), "utf8");

test("the desktop app's UA token is the one the site looks for", () => {
  // The cross-file pin this suite exists for. A rename on either side alone
  // leaves an app that still works and a link that quietly reappears.
  const declared = serverSrc.match(/const INAPP_UA_TOKEN = "([^"]+)"/);
  assert.ok(declared, "server.js no longer declares INAPP_UA_TOKEN");
  const stamped = mainSrc.match(/const UA_TOKEN = "([^"]+)"/);
  assert.ok(stamped, "desktop-app/main.js no longer declares UA_TOKEN");
  assert.ok(stamped[1].startsWith(declared[1]),
    `the app stamps "${stamped[1]}" but the site matches "${declared[1]}"`);
  // And the app must actually apply it, not merely declare it.
  // Non-greedy across the nested getUserAgent() call, so the paren inside the
  // argument does not end the match.
  assert.ok(/setUserAgent\([\s\S]{0,160}?UA_TOKEN/.test(mainSrc),
    "main.js declares UA_TOKEN but never puts it on the user agent");
});

test("the detection covers the PWA case too, not just Electron", () => {
  // Measured 2026-08-20: Electron reports `display-mode: browser`, so the UA
  // token is what catches the desktop app — but an installed PWA answers to
  // the media query and NOT to the token. Both signals are required; dropping
  // either leaves one of the two installable products still being offered a
  // download of itself.
  assert.ok(serverSrc.includes("(display-mode: standalone)"));
  assert.ok(serverSrc.includes("navigator.standalone"), "iOS home-screen case dropped");
  assert.ok(serverSrc.includes("INAPP_UA_TOKEN"));
});

test("the hide rule is !important, or the nav's own display:block wins", () => {
  // `.hdr nav .dd a{display:block}` (0,2,2) out-specifies `[data-inapp] .nav-dl`
  // (0,2,0), and the app menu's Tailwind `block` utility does the same. This
  // is the identical trap the `.hdr nav [hidden]` line already carries.
  assert.match(serverSrc, /\[data-inapp="1"\] \.nav-dl\{display:none!important\}/);
});

test("the download link carries the class the rule targets", () => {
  assert.ok(serverSrc.includes('["/download", "Download the app", "nav-dl"],'),
    "NAV_LINKS' /download entry lost its nav-dl class");
});

test("every surface gets the boot: both server head builders and the app", () => {
  // Two head builders serve every server-rendered page; index.html gets it by
  // marker replacement rather than a hand-copy (THEME_BOOT is the cautionary
  // tale of the other approach).
  const bootUses = serverSrc.split("INAPP_BOOT +").length - 1;
  assert.ok(bootUses >= 2, `INAPP_BOOT is used in ${bootUses} head builder(s); expected 2`);
  assert.ok(indexSrc.includes("<!--INAPP_BOOT-->"), "index.html lost the INAPP_BOOT marker");
  assert.ok(serverSrc.includes("INAPP_BOOT_MARKER, INAPP_BOOT"),
    "the / handler no longer replaces the marker");
});

test("it runs before paint and hides nothing else", () => {
  // Inline in <head> so the link is never drawn and then snatched away, and
  // scoped to .nav-dl so it can never take a neighbouring nav item with it.
  const boot = serverSrc.slice(serverSrc.indexOf("const INAPP_BOOT ="), serverSrc.indexOf("const INAPP_BOOT_MARKER"));
  assert.ok(boot.includes("<script>") && !boot.includes("defer") && !boot.includes("async"),
    "the boot script must run inline, not deferred");
  assert.ok(boot.includes("try{") && boot.includes("catch(e)"),
    "matchMedia/navigator access must not be able to abort the page");
  assert.equal(boot.split("display:none").length - 1, 1, "the rule hides more than the one link");
});
