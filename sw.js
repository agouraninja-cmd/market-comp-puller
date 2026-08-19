/* CompNinja service worker.
 *
 * Its whole job is two things: make the app installable (a fetch handler is
 * what browsers require before offering "Add to Home Screen"), and make a
 * dropped connection show a real page instead of a white screen. It is
 * deliberately NOT a performance layer.
 *
 * ⚠ READ THIS BEFORE MAKING IT "FASTER". Every strategy here is network-first,
 * and that is not timidity -- this app has two documented ways a stale cached
 * asset breaks it badly, and a service worker is the one layer that can
 * outlive a deploy and keep serving the stale copy for days:
 *
 *   1. index.html's inline script destructures VALUATION as its very first
 *      statement. If /valuation.js is ever stale relative to that HTML, the
 *      destructure throws and the ENTIRE front end aborts -- no search form,
 *      no modals, no report rendering -- while the page still paints its HTML
 *      and CSS and therefore looks perfectly fine. server.js serves that file
 *      with max-age: 0 for exactly this reason, and /gut-check.js and
 *      /explore-query.js carry the same rule for /vault and the Explorer.
 *      Those three are on NEVER_CACHE below. Do not "just precache the JS".
 *   2. tailwind.css is regenerated on deploys that add utility classes. A
 *      cache-first copy means a class that exists in the HTML silently does
 *      not style. It gets network-first like everything else.
 *
 * Nothing under /api/ is touched at all, and no navigation response is ever
 * stored: what lives at / depends on the visitor's auth state (the account
 * wall serves the landing page to a signed-out visitor and the app to a
 * signed-in one), so a cached navigation would serve one to the other after a
 * sign-out. The offline page is a separate, static, auth-free document.
 */
"use strict";

// Bump to purge every previously cached response. Anything that changes what
// is safe to store belongs in this string.
const CACHE = "compninja-v1";
const OFFLINE_URL = "/offline.html";

// Precached because it must be there at the exact moment the network is not.
const PRECACHE = [OFFLINE_URL, "/favicon.svg", "/icons/icon-192.png"];

// ⚠ Never store these, at any version. See hazard 1 above.
const NEVER_CACHE = ["/valuation.js", "/gut-check.js", "/explore-query.js"];

// Static, non-personal assets worth keeping a fallback copy of. An allowlist
// rather than a denylist on purpose: this app serves private data (the broker
// vault, shared reports, My Desk) off ordinary-looking paths, and a rule that
// caches "anything that looks static" is one route away from writing a
// broker's book into a cache the next person on that device can read.
const CACHEABLE = [
  "/tailwind.css",
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/og-image.png",
];
const CACHEABLE_PREFIX = "/icons/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      // A precache miss must not leave the app with no service worker at all;
      // the offline page is a nicety, installability is not.
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // Without this, event.preloadResponse in the fetch handler is always
      // undefined and every navigation pays an extra service-worker hop.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })()
  );
});

function isCacheable(url) {
  if (NEVER_CACHE.includes(url.pathname)) return false;
  return CACHEABLE.includes(url.pathname) || url.pathname.startsWith(CACHEABLE_PREFIX);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never proxy third parties
  if (url.pathname.startsWith("/api/")) return;      // never cache or delay an API call

  // Navigations: always the network, and the offline page only when the
  // network genuinely failed. `preloadResponse` is used when the browser
  // offers it so the service worker does not add a round trip to every page.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(req));
        } catch (err) {
          const cached = await caches.match(OFFLINE_URL);
          return cached || new Response(
            "You're offline.",
            { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  if (!isCacheable(url)) return;                     // everything else: untouched

  // Network-first, cache purely as the offline fallback. A 200 refreshes the
  // stored copy; anything else is passed through without disturbing it.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
