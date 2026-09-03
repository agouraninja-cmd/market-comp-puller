"use strict";
// ---------------------------------------------------------------------------
// Logo import — which picture on a firm's website is its logo (2026-09-02).
//
// PURE, like branding.js: no I/O, no clock, no network. server.js owns the
// DNS guard, the fetch, the redirect hops and the byte caps; this module
// decides what a typed address means, which declared pictures are worth
// fetching and in what order, and whether the bytes that came back are a
// picture the letterhead can use. It requires account-avatar.js for the one
// thing that file already owns: sniffing PNG/JPEG/WebP off the bytes.
//
// Three rules. The address must be PUBLIC (no localhost, no IP literal, no
// single-label host, no embedded credentials) — the same refusals
// link-check.js's checkableUrl makes for model-supplied URLs, restated here
// because this one is typed by a member and reaches our own fetch. The
// ORDER is apple-touch-icon (a 180px PNG most sites declare), then icons
// large enough to be a mark, then og:image, then the undeclared
// /apple-touch-icon.png convention, then tiny icons last; .ico, .svg and
// .gif hrefs are skipped outright, since the letterhead accepts only
// PNG/JPEG/WebP (branding.js's LOGO_RE). And the BYTES decide: a candidate
// is accepted only when it sniffs as one of those three and, for a PNG, is
// at least MIN_PNG_PX wide — a 16px favicon is not a logo — and not wider
// than BANNER_RATIO times its height, which is a homepage banner (og:image
// is usually one) rather than a mark.
// ---------------------------------------------------------------------------

const { sniffImage } = require("./account-avatar");

const MAX_CANDIDATES = 6;
const PAGE_MAX = 512 * 1024;             // bytes of HTML worth reading for <link> tags
const LOGO_FETCH_MAX = 2 * 1024 * 1024;  // raw image bytes; the browser scales it before the 150KB save cap
const MIN_PNG_PX = 48;                   // narrower than this is a favicon
const SMALL_ICON_PX = 64;                // a declared size below this sorts last
const BANNER_RATIO = 3;                  // a PNG wider than this many times its height is a banner

function normalizeSiteUrl(input, { allowPrivate = false } = {}) {
  let s = String(input == null ? "" : input).trim();
  if (!s) return { error: "Enter your firm's web address." };
  if (s.length > 300) return { error: "That address is too long." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (_) { return { error: "That doesn't look like a web address." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Only http and https addresses can be read." };
  if (u.username || u.password) return { error: "That address carries a password; leave it out." };
  const host = u.hostname.toLowerCase();
  if (!allowPrivate) {
    if (host === "localhost" || !host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) {
      return { error: "Enter a public web address, like yourfirm.com." };
    }
  }
  u.hash = "";
  return { url: u.toString(), host };
}

function attr(tag, name) {
  const m = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  if (!m) return "";
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ""));
}
function sizeOf(sizes) {
  const m = String(sizes || "").match(/(\d+)x(\d+)/i);
  return m ? Number(m[1]) : 0;
}
function usableHref(abs) {
  return !/\.(ico|svg|gif|bmp)(\?|#|$)/i.test(abs);
}

/** The pictures a page declares, best first, absolute, deduped, capped. */
function logoCandidates(html, baseUrl) {
  const head = String(html || "").slice(0, PAGE_MAX);
  const out = [];
  const seen = new Set();
  const push = (kind, href, size) => {
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch (_) { return; }
    if (!/^https?:/i.test(abs) || !usableHref(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ kind, url: abs, size: size || 0 });
  };
  const touch = [], icons = [], og = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, "rel").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (/apple-touch-icon/.test(rel)) touch.push({ href, size: sizeOf(attr(tag, "sizes")) || 180 });
    else if (/(^|\s)icon(\s|$)/.test(rel) || /shortcut icon/.test(rel)) {
      const type = attr(tag, "type").toLowerCase();
      if (type && !/png|jpe?g|webp/.test(type)) continue;
      icons.push({ href, size: sizeOf(attr(tag, "sizes")) });
    }
  }
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (key === "og:image" || key === "og:image:url" || key === "og:image:secure_url") {
      const c = attr(tag, "content");
      if (c) og.push({ href: c });
    }
  }
  touch.sort((a, b) => b.size - a.size).forEach((t) => push("apple-touch-icon", t.href, t.size));
  const big = icons.filter((i) => !i.size || i.size >= SMALL_ICON_PX).sort((a, b) => b.size - a.size);
  const small = icons.filter((i) => i.size && i.size < SMALL_ICON_PX).sort((a, b) => b.size - a.size);
  big.forEach((i) => push("icon", i.href, i.size));
  // The undeclared convention: many sites keep /apple-touch-icon.png with no
  // <link> for it. Tried BEFORE og:image (measured on github.com: its declared
  // icons are too small, its og:image is a homepage banner, and the
  // undeclared touch icon is the actual mark) and before the tiny icons.
  push("apple-touch-icon", "/apple-touch-icon.png", 180);
  og.forEach((o) => push("og:image", o.href));
  small.forEach((i) => push("icon", i.href, i.size));
  return out.slice(0, MAX_CANDIDATES);
}

function pngWidth(buf) {
  // Signature (8) + IHDR length (4) + "IHDR" (4) puts the width at byte 16.
  return buf.length >= 24 && buf.slice(12, 16).toString("ascii") === "IHDR" ? buf.readUInt32BE(16) : 0;
}
function pngHeight(buf) {
  return buf.length >= 24 && buf.slice(12, 16).toString("ascii") === "IHDR" ? buf.readUInt32BE(20) : 0;
}

/** Fetched bytes -> { mime, dataUri }, or null when they are not a usable picture. */
function acceptLogoBytes(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > LOGO_FETCH_MAX) return null;
  const mime = sniffImage(buf);
  if (!mime) return null;
  if (mime === "image/png") {
    const w = pngWidth(buf), h = pngHeight(buf);
    if (w < MIN_PNG_PX) return null;
    if (h > 0 && w / h > BANNER_RATIO) return null;
  }
  return { mime, dataUri: "data:" + mime + ";base64," + buf.toString("base64") };
}

module.exports = { normalizeSiteUrl, logoCandidates, acceptLogoBytes, pngWidth, pngHeight,
  MAX_CANDIDATES, PAGE_MAX, LOGO_FETCH_MAX, MIN_PNG_PX, SMALL_ICON_PX, BANNER_RATIO };
