// The security headers every response carries (2026-11-14).
//
// Until this, compninja.co answered with none: no clickjacking defence, no
// HSTS, no Content-Security-Policy, and `nosniff` on three routes out of
// hundreds. server.js writes its responses with hundreds of separate
// res.writeHead calls, so these are set ONCE, with res.setHeader, as the first
// thing that happens to a request. Node merges setHeader's headers into a
// later writeHead, and a route that names the same header itself still wins,
// so nothing below has to be repeated at a call site and no call site can
// forget it.
//
// Pure: requiring this starts nothing and reads no environment.
//
// What each one is for, and why it is worded the way it is:
//
//  - X-Content-Type-Options: nosniff. A response is what its content-type
//    says and nothing else. The cost to know about: a browser now REFUSES a
//    script not served as JavaScript or a stylesheet not served as text/css,
//    so a new static asset needs its real type in STATIC_FILES (they all have
//    one; test/security-headers.test.js pins it).
//
//  - X-Frame-Options: SAMEORIGIN and CSP frame-ancestors 'self'. Nobody
//    else's page may draw ours inside a frame, which is what stops a hidden
//    frame collecting a signed-in member's clicks (sharing, billing,
//    publishing). Both, because old browsers read only the first. Nothing in
//    this product is framed by a third party: the desktop app shows pages in
//    its own windows, not frames.
//
//  - Referrer-Policy: strict-origin-when-cross-origin. A link out of a page
//    tells the other site only "compninja.co", never the path. That matters
//    here: /r/<id> is a shared report's whole secret, and an admin CSV link
//    can still carry ?key=.
//
//  - Strict-Transport-Security, only on a request that arrived over HTTPS
//    (the proxy's x-forwarded-proto; browsers ignore it over plain HTTP
//    anyway, and a local server must never teach a browser to refuse
//    http://localhost). 180 days, and deliberately WITHOUT includeSubDomains
//    or preload: either would bind hostnames this code knows nothing about
//    (a mail-tracking subdomain, a future staging host) and preload is hard
//    to take back.
//
//  - Content-Security-Policy: only the three directives that cannot break a
//    page. base-uri and object-src close two script-injection side doors the
//    site never uses (no <base>, no <object>/<embed>). There is deliberately
//    NO script-src or style-src yet: every page here runs inline scripts and
//    styles, so a real script policy needs a nonce on each of them first. A
//    half-working one would blank the app the way a failed /valuation.js
//    does. That is the remaining work, and it is its own change.
//
//  - Permissions-Policy: the page, and anything it loads, may not use the
//    camera, the microphone, or the payment and USB APIs. None is used (photo
//    uploads are a file picker; checkout is a redirect to Stripe).

const HSTS_MAX_AGE_SEC = 180 * 24 * 60 * 60;

const CONTENT_SECURITY_POLICY = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'";

const BASE_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "permissions-policy": "camera=(), microphone=(), payment=(), usb=()",
});

// Did this request reach the proxy over HTTPS? The FIRST value of
// x-forwarded-proto is the hop the visitor made; anything else, including a
// missing header (a local run, the test suite, the loopback render that
// builds a page ahead), is not HTTPS.
function arrivedOverHttps(reqHeaders) {
  const raw = reqHeaders && reqHeaders["x-forwarded-proto"];
  const first = String(Array.isArray(raw) ? raw[0] : raw || "").split(",")[0].trim().toLowerCase();
  return first === "https";
}

// The headers for one request, as a fresh object.
function securityHeaders(reqHeaders) {
  const out = { ...BASE_HEADERS };
  if (arrivedOverHttps(reqHeaders)) {
    out["strict-transport-security"] = `max-age=${HSTS_MAX_AGE_SEC}`;
  }
  return out;
}

// Set them on a response that has not been written yet. Never throws: a
// header that cannot be set (headers already sent, a stand-in response in a
// test) must not turn into a failed request.
function applySecurityHeaders(req, res) {
  try {
    if (!res || typeof res.setHeader !== "function" || res.headersSent) return;
    const headers = securityHeaders(req && req.headers);
    for (const name of Object.keys(headers)) res.setHeader(name, headers[name]);
  } catch (_) { /* a header is never worth a request */ }
}

module.exports = {
  securityHeaders, applySecurityHeaders, arrivedOverHttps,
  BASE_HEADERS, CONTENT_SECURITY_POLICY, HSTS_MAX_AGE_SEC,
};
