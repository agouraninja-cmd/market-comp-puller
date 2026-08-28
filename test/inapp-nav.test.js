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
  // Two rules now, and an exact allowlist rather than a count: anything else
  // this boot learns to hide gets hidden inside the shipped app, which is the
  // one place nobody looks.
  const hidden = [...boot.matchAll(/(\[data-inapp[^{]*)\{display:none!important\}/g)].map((m) => m[1].trim());
  assert.deepEqual(hidden, ['[data-inapp="1"] .nav-dl', '[data-inapp-shell="1"] #acctGoogleRow'],
    "the boot hides something other than the download link and the Google button");
});

// "Continue with Google" inside the Electron shell ends on Google's own error
// page: Google refuses OAuth in an embedded user agent. So the button is
// hidden there — and NOT in an installed PWA, which is ordinary Chrome where
// the flow works fine. Getting that distinction wrong is invisible in both
// directions: too broad and working sign-in disappears for PWA users, too
// narrow and the dead end comes back.
test("the Google button is hidden in the Electron shell only, never in a PWA", () => {
  const boot = serverSrc.slice(serverSrc.indexOf("const INAPP_BOOT ="), serverSrc.indexOf("const INAPP_BOOT_MARKER"));

  // The shell flag is the UA token and nothing else.
  const shellLine = boot.split("\n").find((l) => l.includes("var shell="));
  assert.ok(shellLine, "the boot no longer computes a shell flag");
  assert.ok(shellLine.includes("navigator.userAgent") && shellLine.includes("INAPP_UA_TOKEN"),
    "the shell flag is no longer derived from the UA token");
  assert.ok(!shellLine.includes("display-mode") && !shellLine.includes("navigator.standalone"),
    "a PWA signal has leaked into the shell flag; a PWA would lose a button that works there");
  assert.ok(!/if\(shell\)[^;]{0,120}display-mode/.test(boot),
    "display-mode has leaked into the shell flag; a PWA would lose a button that works there");
  assert.ok(boot.includes('if(shell)document.documentElement.setAttribute("data-inapp-shell","1")'),
    "the shell attribute is no longer set from the shell flag");

  // data-inapp (the download link) must still fire for a PWA as well, so the
  // two attributes can never be collapsed into one.
  assert.ok(/m\("\(display-mode: standalone\)"\)[\s\S]{0,220}?setAttribute\("data-inapp","1"\)/.test(boot),
    "data-inapp no longer fires for an installed PWA");

  // The id it hides has to be the one index.html actually renders, and
  // !important is load-bearing: JS toggles .hidden on that row.
  assert.ok(indexSrc.includes('id="acctGoogleRow"'),
    "index.html no longer has #acctGoogleRow — the boot rule now hides nothing");
  assert.ok(boot.includes('[data-inapp-shell="1"] #acctGoogleRow{display:none!important}'),
    "the Google row rule is gone or no longer !important");
});
