// The app's script, served as its own cacheable file (2026-11-14).
//
// index.html is one file: about 400 KB of markup and CSS, and one inline
// <script> of about 1 MB. The page is served `no-store` (it is personalised at
// serve time and a stale copy means a member silently misses every update), so
// the megabyte of script rode along on EVERY page view: Home, the comp report
// page, every shared report. Measured at the compression the edge applies, a
// page view was about 400 KB over the wire and is about 106 KB without the
// script.
//
// The split happens at SERVE time, on purpose. index.html stays exactly as it
// is on disk: one file to edit, the Tailwind build still finds the classes in
// its JS strings, and every test that reads or runs the page from disk is
// untouched. What changes is what the browser is handed: the page with
// `<script src="/app.<hash>.js"></script>` where the inline block was, and the
// block itself at that address, cacheable for a year because the address
// changes whenever the script does.
//
// Pure: requiring this starts nothing and reads no file. server.js does the
// reading and remembers the result until index.html changes on disk.
//
// Rules:
//
//  - **The address is the content.** /app.<hash>.js is the first 16 hex
//    characters of the script's SHA-256. The page names the exact hash and is
//    itself never cached, so a browser can never pair a page with a script
//    cached from an older one, which is the hazard /valuation.js avoids by
//    not being cached at all.
//  - **Only the ONE big inline script is moved**, and only when it is a plain
//    `<script>` with no attributes. The small inline scripts ahead of it (the
//    theme boot, the markers server.js fills per visitor) stay inline and
//    still run first: an external script without `async` or `defer` blocks
//    the parser where it stands, so the order of execution is unchanged.
//  - **Anything unexpected means "leave the page alone".** No inline script
//    big enough, or one carrying attributes, returns null and the caller
//    serves the page as it always was. A page that is merely slower beats a
//    page whose script went missing: that one renders its HTML and CSS, looks
//    fine and does nothing.
//  - **A request for a hash that is not the current one still gets the
//    current script**, uncached (the caller's rule; scriptCacheControl says
//    which). During a deploy a page from the old instance can ask the new one
//    for its script; a 404 there would be the dead page above. It is the
//    same pairing of old page and new file every other script here already
//    lives with for those few seconds.

const crypto = require("node:crypto");

// Below this an inline script is not worth a second request.
const MIN_SCRIPT_BYTES = 100 * 1024;

const SCRIPT_PATH_RE = /^\/app\.([0-9a-f]{16})\.js$/;

// The page split around its one big plain inline script, or null.
function splitMainScript(html) {
  const text = String(html || "");
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let best = null;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1].trim();
    if (/\bsrc\s*=/i.test(attrs)) continue;          // already external
    const size = Buffer.byteLength(m[2]);
    if (!best || size > best.size) best = { size, attrs, index: m.index, whole: m[0], body: m[2] };
  }
  if (!best || best.size < MIN_SCRIPT_BYTES) return null;
  // A type, a nonce, defer, a data attribute: each changes how the block runs
  // or is found, and an external copy would not be the same thing.
  if (best.attrs) return null;
  return {
    before: text.slice(0, best.index),
    script: best.body,
    after: text.slice(best.index + best.whole.length),
  };
}

function scriptHash(script) {
  return crypto.createHash("sha256").update(String(script)).digest("hex").slice(0, 16);
}

function scriptPath(hash) {
  return `/app.${hash}.js`;
}

// The hash a request path names, or null when it is not one of ours.
function hashFromPath(pathname) {
  const m = SCRIPT_PATH_RE.exec(String(pathname || ""));
  return m ? m[1] : null;
}

// The page as the browser gets it, and the script it now points at.
// `transformScript` is applied to the script BEFORE it is hashed, so whatever
// the caller rewrites in it (the canonical origin) is part of the address.
function externalize(html, { transformScript } = {}) {
  const parts = splitMainScript(html);
  if (!parts) return null;
  const script = typeof transformScript === "function" ? String(transformScript(parts.script)) : parts.script;
  const hash = scriptHash(script);
  const url = scriptPath(hash);
  // Ask for the script as soon as the <head> has arrived instead of when the
  // parser reaches the end of the body. Only when </head> is where a head
  // ends: before the body, exactly once in the markup ahead of the script.
  let before = parts.before;
  const headEnd = before.indexOf("</head>");
  const bodyStart = before.indexOf("<body");
  if (headEnd > 0 && headEnd === before.lastIndexOf("</head>") && (bodyStart < 0 || headEnd < bodyStart)) {
    before = before.slice(0, headEnd) + `<link rel="preload" as="script" href="${url}">\n` + before.slice(headEnd);
  }
  return {
    html: before + `<script src="${url}"></script>` + parts.after,
    script, hash, url,
  };
}

// A year and immutable for the address that IS this content; nothing at all
// for any other hash, so a mismatched pairing is never remembered by a
// browser or by the edge.
function scriptCacheControl(requestedHash, currentHash) {
  return requestedHash && requestedHash === currentHash
    ? "public, max-age=31536000, immutable"
    : "no-store";
}

module.exports = {
  splitMainScript, externalize, scriptHash, scriptPath, hashFromPath, scriptCacheControl,
  MIN_SCRIPT_BYTES,
};
