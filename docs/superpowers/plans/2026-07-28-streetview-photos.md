# Street View Popup Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a map pin shows a Street View photo of that building above the popup text, via a server proxy that keeps the Google key out of the browser.

**Architecture:** A new `GET /api/streetview?lat=&lng=` route in server.js (modeled on the `/api/geocode` proxy) checks Google's free metadata endpoint, then streams the photo with a long cache header; `/api/config` gains a `streetview` flag; index.html's two popup builders switch to function content so the photo uses each pin's final geocoded position. Feature is dark until `GOOGLE_MAPS_API_KEY` is set.

**Tech Stack:** Plain Node 18+ (built-in `fetch`), Leaflet popups, no new dependencies. No test framework exists in this repo (per CLAUDE.md) — each task verifies with `node --check`, curl, and a browser walk.

**Spec:** `docs/superpowers/specs/2026-07-28-streetview-photos-design.md`

---

### Task 1: Server — env var, config flag, `/api/streetview` route

**Files:**
- Modify: `server.js` (env consts near line 92 `ADMIN_KEY`; config route near line 4257; new route directly after the `/api/geocode` block that ends near line 3984)

- [ ] **Step 1: Add the env const + metadata cache**

In `server.js`, directly after the `ADMIN_KEY` const (line ~92), add:

```js
// Optional Google Maps key powering the Street View photos in map pin
// popups (served through GET /api/streetview so the key never reaches the
// browser). Unset = the route 404s and popups are text-only, as before.
const GOOGLE_MAPS_API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
// lat,lng -> boolean "imagery exists" from the free metadata endpoint, so
// repeat popup opens never re-ask Google. In-memory, capped, process-lifetime.
const STREETVIEW_META_CACHE = new Map();
```

- [ ] **Step 2: Add `streetview` to `/api/config`**

Find (line ~4258):

```js
    return sendJson(res, 200, { authRequired: Boolean(APP_PASSWORD), leadCapture: LEAD_CAPTURE });
```

Replace with:

```js
    return sendJson(res, 200, { authRequired: Boolean(APP_PASSWORD), leadCapture: LEAD_CAPTURE, streetview: Boolean(GOOGLE_MAPS_API_KEY) });
```

- [ ] **Step 3: Add the route**

Directly after the `/api/geocode` route's closing `}` (line ~3984), add:

```js
  // --- Street View photo proxy. Powers the click-to-load building photo in
  // map pin popups (docs/superpowers/specs/2026-07-28-streetview-photos-
  // design.md). Key stays server-side; the FREE metadata endpoint is asked
  // first (cached) so a spot with no imagery never bills an image request.
  // Dark when GOOGLE_MAPS_API_KEY is unset. Every failure path is a bare
  // 404 — the popup <img>'s onerror removes it and the popup stays text-only. ---
  if (req.method === "GET" && req.url.split("?")[0] === "/api/streetview") {
    const params = new URL(req.url, "http://localhost").searchParams;
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return sendJson(res, 400, { error: "lat and lng are required." });
    }
    if (!GOOGLE_MAPS_API_KEY) { res.writeHead(404); return res.end(); }
    // A report has <= ~9 pins; 60/window is generous for a human reader.
    if (rateLimited("streetview:" + clientIp(req), 60)) {
      return sendJson(res, 429, { error: "Too many photo requests. Please wait a few minutes." });
    }
    (async () => {
      try {
        const loc = lat.toFixed(5) + "," + lng.toFixed(5);
        let hasImagery = STREETVIEW_META_CACHE.get(loc);
        if (hasImagery === undefined) {
          const mr = await fetch(
            "https://maps.googleapis.com/maps/api/streetview/metadata?location=" + loc +
              "&source=outdoor&key=" + GOOGLE_MAPS_API_KEY,
            { signal: AbortSignal.timeout(6000) }
          );
          const mj = await mr.json();
          hasImagery = Boolean(mj && mj.status === "OK");
          if (STREETVIEW_META_CACHE.size >= 500) {
            STREETVIEW_META_CACHE.delete(STREETVIEW_META_CACHE.keys().next().value);
          }
          STREETVIEW_META_CACHE.set(loc, hasImagery);
        }
        if (!hasImagery) { res.writeHead(404); return res.end(); }
        // No `heading` param: Google then aims the camera at the given point
        // from the nearest pano — the "look at the building" behavior.
        const ir = await fetch(
          "https://maps.googleapis.com/maps/api/streetview?size=600x360&location=" + loc +
            "&source=outdoor&fov=80&key=" + GOOGLE_MAPS_API_KEY,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!ir.ok) { res.writeHead(404); return res.end(); }
        const buf = Buffer.from(await ir.arrayBuffer());
        res.writeHead(200, {
          "Content-Type": ir.headers.get("content-type") || "image/jpeg",
          "Content-Length": buf.length,
          "Cache-Control": "public, max-age=2592000",
        });
        return res.end(buf);
      } catch (_) {
        res.writeHead(404);
        return res.end();
      }
    })();
    return;
  }
```

- [ ] **Step 4: Syntax check**

Run: `node --check server.js`
Expected: no output (exit 0)

- [ ] **Step 5: Restart the local server and verify the dark-off behavior (no key in .env)**

Kill the process on port 3000 and relaunch (`npm start`, or the portable-node full path per CLAUDE.md). Then:

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/streetview?lat=32.7715&lng=-96.8460"`
Expected: `404`

Run: `curl -s "http://localhost:3000/api/config"`
Expected: `{"authRequired":false,"leadCapture":true,"streetview":false}` (auth/lead values per local .env; `streetview` must be `false`)

Run: `curl -s "http://localhost:3000/api/streetview?lat=999&lng=0"`
Expected: `{"error":"lat and lng are required."}` (HTTP 400)

- [ ] **Step 6: (Only if a `GOOGLE_MAPS_API_KEY` is present in local .env) verify the live path**

Run: `curl -s -D - -o /tmp/sv.jpg "http://localhost:3000/api/streetview?lat=32.7715&lng=-96.8460" | head -8`
Expected: `HTTP/1.1 200`, `Content-Type: image/jpeg`, `Cache-Control: public, max-age=2592000`; `/tmp/sv.jpg` is a JPEG (starts with bytes `FF D8`)

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/streetview?lat=0&lng=0"`
Expected: `404` (open ocean — metadata says no imagery)

Skip this step when no key exists yet; the owner adds the key later and the route needs no further change.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "Serve Street View photos through a key-holding proxy route"
```

---

### Task 2: Client — config flag + photo in popup content

**Files:**
- Modify: `index.html` (map globals near line 3554; `initGate` near line 1840; popup builders `addSubjMarker`/`addCompMarker` near lines 3713–3735)

- [ ] **Step 1: Declare the flag with the map globals**

Find (line ~3554):

```js
  let mapInstance = null;
```

Replace with:

```js
  let mapInstance = null;
  let streetviewEnabled = false; // set from /api/config in initGate()
```

- [ ] **Step 2: Set it in `initGate`**

Find (line ~1840):

```js
    leadCaptureEnabled = Boolean(cfg.leadCapture);
```

Replace with:

```js
    leadCaptureEnabled = Boolean(cfg.leadCapture);
    streetviewEnabled = Boolean(cfg.streetview);
```

- [ ] **Step 3: Add the photo helper and switch both popups to function content**

Find (lines ~3713–3735):

```js
    let subjMarker = null;
    const compMarkersByNum = {};
    const addSubjMarker = (lat, lng) => {
      const subjIcon = L.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#DC2626;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0/.4)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 22],
      });
      return L.marker([lat, lng], { icon: subjIcon, zIndexOffset: 1000 })
        .addTo(mapInstance)
        .bindPopup(`<strong>Your property:</strong> ${escMap(meta.address)}`);
    };
    const addCompMarker = (c, lat, lng) => {
      // Each pin carries the comp's report-wide number, matching its table row.
      const dotIcon = L.divIcon({
        className: "",
        html: '<div style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#1e293b;color:#fff;font:600 11px Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgb(0 0 0/.35)">' + (c._num || "") + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      const line2 = [c.price_or_rate, c.transaction].filter(Boolean).map(escMap).join(" · ");
      const title = (c._num ? "Comp " + c._num + " — " : "") + (c.address || "Comp");
      return L.marker([lat, lng], { icon: dotIcon })
        .addTo(mapInstance)
        .bindPopup(`<strong>${escMap(title)}</strong>${line2 ? "<br>" + line2 : ""}`);
    };
```

Replace with:

```js
    let subjMarker = null;
    const compMarkersByNum = {};
    // Street View photo (only when the server holds a key). Popup content is
    // a FUNCTION so Leaflet builds it at open time from the marker's CURRENT
    // position — refinePins() moves pins after first paint, and the photo
    // must show the geocoded spot, not the model's block-level guess. The
    // img's onerror removes it, so a 404 (no key, no imagery, rate limit)
    // collapses back to today's text-only popup. Coordinates come from
    // getLatLng() — numbers, nothing user-authored.
    const svPhoto = (marker) => {
      if (!streetviewEnabled) return "";
      const ll = marker.getLatLng();
      return '<img src="/api/streetview?lat=' + ll.lat.toFixed(6) + '&lng=' + ll.lng.toFixed(6) +
        '" width="260" height="156" style="display:block;border-radius:4px;margin-bottom:6px;object-fit:cover" alt="" onerror="this.remove()">';
    };
    const addSubjMarker = (lat, lng) => {
      const subjIcon = L.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#DC2626;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0/.4)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 22],
      });
      const m = L.marker([lat, lng], { icon: subjIcon, zIndexOffset: 1000 }).addTo(mapInstance);
      m.bindPopup(() => svPhoto(m) + `<strong>Your property:</strong> ${escMap(meta.address)}`);
      return m;
    };
    const addCompMarker = (c, lat, lng) => {
      // Each pin carries the comp's report-wide number, matching its table row.
      const dotIcon = L.divIcon({
        className: "",
        html: '<div style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#1e293b;color:#fff;font:600 11px Inter,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgb(0 0 0/.35)">' + (c._num || "") + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      const line2 = [c.price_or_rate, c.transaction].filter(Boolean).map(escMap).join(" · ");
      const title = (c._num ? "Comp " + c._num + " — " : "") + (c.address || "Comp");
      const m = L.marker([lat, lng], { icon: dotIcon }).addTo(mapInstance);
      m.bindPopup(() => svPhoto(m) + `<strong>${escMap(title)}</strong>${line2 ? "<br>" + line2 : ""}`);
      return m;
    };
```

- [ ] **Step 4: Verify in the browser — flag off (no key): popups unchanged**

No restart needed (index.html is read per request). Reload http://localhost:3000, click "sample report", then run in the browser console:

```js
(() => {
  document.querySelectorAll("#compMap .leaflet-marker-icon")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const p = document.querySelector(".leaflet-popup-content");
  return { hasPopup: !!p, hasImg: !!(p && p.querySelector("img")), text: p && p.textContent.slice(0, 60) };
})()
```

Expected: `hasPopup: true`, `hasImg: false`, text starts with the comp/subject line — identical to today.

- [ ] **Step 5: Verify the enabled path + onerror collapse without a key**

In the same console, force the flag and reopen a popup (the route 404s without a key, so the img must remove itself):

```js
streetviewEnabled = true;
```

Then click a different pin, wait ~1s, and run:

```js
(() => {
  const p = document.querySelector(".leaflet-popup-content");
  return { hasImg: !!(p && p.querySelector("img")), text: p && p.textContent.slice(0, 60) };
})()
```

Expected: `hasImg: false` (the img was inserted, its request 404'd, `onerror` removed it) and the text renders normally. With a key configured, this same check instead returns `hasImg: true` and the img's `naturalWidth > 0`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Show a Street View photo in map pin popups when the proxy has a key"
```

---

### Task 3: Documentation — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Configuration list, after the `RESEND_API_KEY` block's related entries; Routes list, after the `/api/geocode` bullet)

- [ ] **Step 1: Add the env bullet**

In the Configuration section, after the `DAILY_SEARCH_CAP` bullet, add:

```markdown
- `GOOGLE_MAPS_API_KEY` — optional. When set, map pin popups show a
  street-level photo of the building via `GET /api/streetview` (a proxy so
  the key never reaches the browser; Google's free metadata check runs
  first so no-imagery spots cost nothing). Unset = the route 404s and
  popups are text-only. Key setup + quota-cap steps live in
  `docs/superpowers/specs/2026-07-28-streetview-photos-design.md`.
```

- [ ] **Step 2: Add the route bullet**

In the Routes list, after the `GET /api/geocode` bullet, add:

```markdown
- `GET /api/streetview?lat=&lng=` — Street View photo proxy for the map pin
  popups (popup content is built at open time from the pin's final geocoded
  position). Metadata-checks first (free, cached in-memory), then streams
  the image with a 30-day cache header. No key / no imagery / any error →
  bare 404, which the popup img's `onerror` turns into today's text-only
  popup. Rate-limited per IP.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the Street View photo proxy and its env var"
```

---

### Task 4: End-to-end verification + deploy

- [ ] **Step 1: Full walk on the sample report** — reload, render the sample, click every pin (subject + 5 comps): popups open cleanly, no console errors, no layout shift; fullscreen map popups behave the same.
- [ ] **Step 2: Shared-report spot check** — open any existing `/r/<id>` link locally; pins and popups work identically (route is public, flag is global).
- [ ] **Step 3: Regression** — CSV/PNG/print exports unchanged (photos are popup-only, popups are never open during capture).
- [ ] **Step 4: Deploy on the owner's word** — push `HEAD:main` (Render deploys from main; safe before the key exists — feature stays dark). After the owner completes the Google Cloud setup (spec §Owner setup) and sets `GOOGLE_MAPS_API_KEY` on Render, verify on the live site: `/api/config` shows `"streetview":true` and a pin popup shows a photo.
