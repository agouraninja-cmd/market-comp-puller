#!/usr/bin/env node
// One-off: download the Wikimedia thumbs named in market-hero.js and crop
// them to 1600×720 JPEGs in market-heroes/. Not part of npm start.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { HEROES } = require("../market-hero");

const UA = "CompNinjaMarketHero/1.0 (info@compninja.co)";
const OUT = path.join(__dirname, "..", "market-heroes");
const W = 1600, H = 720;

function thumbUrl(commons) {
  const title = "File:" + commons;
  return "https://commons.wikimedia.org/w/api.php?action=query&format=json&titles="
    + encodeURIComponent(title)
    + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1920";
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*" }, redirect: "follow" });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, ".tmp");
  fs.mkdirSync(tmp, { recursive: true });
  for (const [key, h] of Object.entries(HEROES)) {
    const out = path.join(OUT, h.file);
    process.stdout.write(key + " … ");
    const api = await fetch(thumbUrl(h.commons), { headers: { "user-agent": UA } });
    const j = await api.json();
    const ii = Object.values(j.query.pages)[0].imageinfo[0];
    const src = (ii.thumburl || ii.url).split("?")[0];
    const raw = path.join(tmp, h.file + ".src");
    await download(src, raw);
    const cropY = h.crop === "bottom" ? "ih-oh" : h.crop === "top" ? "0" : "(ih-oh)/2";
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)/2:${cropY}`;
    const r = spawnSync("ffmpeg", [
      "-y", "-loglevel", "error", "-i", raw, "-vf", vf, "-q:v", "4", out,
    ], { encoding: "utf8" });
    if (r.status !== 0) {
      console.log("ffmpeg failed\n" + (r.stderr || r.stdout));
      process.exit(1);
    }
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(kb + " KB");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
