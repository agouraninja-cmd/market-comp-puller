#!/usr/bin/env node
// One-off: download the Wikimedia thumbs named in market-hero.js and crop
// them to HERO_WIDTH×HERO_HEIGHT JPEGs (plus a 1920w sibling) in
// market-heroes/. Not part of npm start.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  HEROES,
  HERO_WIDTH,
  HERO_HEIGHT,
  HERO_SRCSET_WIDTH,
  HERO_SRCSET_HEIGHT,
  srcsetName,
} = require("../market-hero");

const UA = "CompNinjaMarketHero/1.0 (info@compninja.co)";
const OUT = path.join(__dirname, "..", "market-heroes");

function thumbUrl(commons) {
  const title = "File:" + commons;
  return "https://commons.wikimedia.org/w/api.php?action=query&format=json&titles="
    + encodeURIComponent(title)
    + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=" + HERO_WIDTH;
}

function cropFilter(w, h, crop) {
  const cropY = crop === "bottom" ? "ih-oh" : crop === "top" ? "0" : "(ih-oh)/2";
  return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-ow)/2:${cropY}`;
}

function encodeJpeg(raw, dest, w, h, crop) {
  const r = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", raw,
    "-vf", cropFilter(w, h, crop),
    "-q:v", "2",
    dest,
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error("ffmpeg failed\n" + (r.stderr || r.stdout));
  }
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*" }, redirect: "follow" });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, ".tmp");
  fs.mkdirSync(tmp, { recursive: true });
  for (const [key, h] of Object.entries(HEROES)) {
    const out = path.join(OUT, h.file);
    const out1x = path.join(OUT, srcsetName(h.file));
    process.stdout.write(key + " … ");
    const api = await fetch(thumbUrl(h.commons), { headers: { "user-agent": UA } });
    const j = await api.json();
    const ii = Object.values(j.query.pages)[0].imageinfo[0];
    const src = (ii.thumburl || ii.url).split("?")[0];
    const raw = path.join(tmp, h.file + ".src");
    await download(src, raw);
    encodeJpeg(raw, out, HERO_WIDTH, HERO_HEIGHT, h.crop);
    encodeJpeg(raw, out1x, HERO_SRCSET_WIDTH, HERO_SRCSET_HEIGHT, h.crop);
    const kb = Math.round(fs.statSync(out).size / 1024);
    const kb1x = Math.round(fs.statSync(out1x).size / 1024);
    const thumbW = ii.thumbwidth || ii.width || "?";
    console.log(`${kb} KB + ${kb1x} KB (src ${thumbW}px)`);
    await sleep(400);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
