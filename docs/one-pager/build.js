#!/usr/bin/env node
// Builds the one-pager PDF (and a PNG preview) from one-pager.html with a
// Chrome the machine already has. No dependencies.
//
//   node docs/one-pager/build.js            -> PDF + PNG next to this file
//   node docs/one-pager/build.js --measure  -> only report whether it fits
//
// Chrome rather than Edge: on the owner's machine the x86 Edge exits before
// it is ready (see scripts/shot.js). Set CN_SHOT_BROWSER to override.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const DIR = __dirname;
const SRC = path.join(DIR, "one-pager.html");
const PDF = path.join(DIR, "CompNinja-1pg-10.7.26.pdf");
const PNG = path.join(DIR, "CompNinja-1pg-10.7.26.png");

const CANDIDATES = [
  process.env.CN_SHOT_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("No Chrome found. Set CN_SHOT_BROWSER to its path.");
  process.exit(1);
}

const url = pathToFileURL(SRC).href;
const base = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=8000"];
const run = (args) => execFileSync(CHROME, base.concat(args), { encoding: "utf8", maxBuffer: 32 << 20 });

// 1. Measure: does every column fit, and did Inter load?
const dom = run(["--window-size=816,1056", "--dump-dom", url + "?measure"]);
const m = dom.match(/data-measure="([^"]*)"/);
if (!m) {
  console.error("The page never reported its measurements.");
  process.exit(1);
}
const report = JSON.parse(m[1].replace(/&quot;/g, '"'));
report.cols.forEach((c, i) =>
  console.log(`${i ? "right" : "left "} column: ${c.used}px used, ${c.spare < 0 ? -c.spare + "px OVER" : c.spare + "px spare"}`));
console.log(`Inter loaded: ${report.inter}`);
const fits = report.cols.every((c) => c.spare >= 0) && report.inter;
if (process.argv.includes("--measure")) process.exit(fits ? 0 : 2);
if (!fits) console.warn("Building anyway, but the page does not fit as it stands.");

// 2. The PDF, US Letter from the page's own @page rule.
run(["--no-pdf-header-footer", "--print-to-pdf=" + PDF, url]);
// 3. A 2x PNG of the same page, for previews and chat.
run(["--window-size=816,1056", "--force-device-scale-factor=2", "--screenshot=" + PNG, url]);
console.log("Wrote", path.relative(process.cwd(), PDF), "and", path.relative(process.cwd(), PNG));
