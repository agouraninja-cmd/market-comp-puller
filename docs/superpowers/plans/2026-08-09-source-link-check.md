# Source-Link Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote a comp's badge to Estimate when its source URL is verifiably dead at report time, before the report is served, cached, or harvested.

**Architecture:** New pure rules module `link-check.js` (tested by `npm test`) + a thin impure fetch helper in server.js, awaited at the end of `getComps` so both `/api/comps` and the Market Explorer inherit it. Downstream needs zero changes: a demoted row is `estimate`, which the backtest's ground truth and corpus-first retrieval already exclude. Spec: `docs/superpowers/specs/2026-08-09-source-link-check-design.md`.

**Tech Stack:** Plain Node (18+ built-in `fetch`, `AbortController`, `dns.promises`), `node --test`, zero npm dependencies.

## Global Constraints

- **Dead means only**: DNS name-not-found, HTTP 404, or HTTP 410. 403, 429, 5xx, timeouts, TLS/network errors, and aborts are `unknown` and change nothing.
- **Bot-wall hosts are never fetched and never demoted**: loopnet.com, cityfeet.com, propertyshark.com, commercialsearch.com (measured 403 list, 2026-08-05 audit spec) plus costar.com, crexi.com, zillow.com, redfin.com, realtor.com, subdomains included.
- **Demotion skips** comps with `verified: true` and comps already `estimate`; the demoted comp KEEPS its `source_url`.
- **SSRF guard is mandatory**: model-supplied URLs; refuse IP-literal/localhost/single-label hosts at the rules layer and private/loopback/link-local/unique-local resolved addresses at the fetch layer.
- **Budget**: max 12 unique URLs, all in parallel under ONE AbortController, 2,500ms total. Everything fails open: any helper error ships the report unchanged.
- **Fixed analytics schema**: `logEvent` columns are `ts/kind/prop_type/market/source/cached/duration_ms/searches/out_tokens/rescue` — the `link_check` event packs counts into the `source` string; do NOT add columns or a migration.
- Zero npm dependencies; no em dashes in new prose (devlog/CLAUDE.md/comments); shared checkout: `git status --short` before staging, explicit paths only, never `git add -A`.
- Portable node if off PATH: `C:\Users\JacobAdler\AppData\Local\node-portable\node-v24.16.0-win-x64\node.exe`.

---

### Task 1: `link-check.js` pure module (TDD)

**Files:**
- Create: `link-check.js`
- Test: `test/link-check.test.js`

**Interfaces:**
- Produces: `checkableUrl(url) -> boolean`, `hostClass(url) -> "blocked"|"fetchable"`, `verdictFor(outcome) -> "dead"|"live"|"unknown"` where outcome is `{ dnsNotFound?: true, status?: number, error?: true }`, `applyLinkVerdicts(payload, verdictsByUrl) -> number` (demoted count; mutates `payload.comps`), and the `BLOCKED_HOSTS` array. Task 2 consumes all of these via `const LINKCHECK = require("./link-check");`.

- [ ] **Step 1: Write the failing tests**

Create `test/link-check.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const LC = require("../link-check");

test("checkableUrl accepts ordinary http/https listing URLs", () => {
  assert.equal(LC.checkableUrl("https://www.showcase.com/1200-w-industrial-blvd/12345"), true);
  assert.equal(LC.checkableUrl("http://county-assessor.example.gov/parcel?id=9"), true);
});

test("checkableUrl refuses non-http schemes, credentials, IPs, localhost, single labels", () => {
  assert.equal(LC.checkableUrl("ftp://example.com/file"), false);
  assert.equal(LC.checkableUrl("javascript:alert(1)"), false);
  assert.equal(LC.checkableUrl("https://user:pw@example.com/x"), false);
  assert.equal(LC.checkableUrl("http://192.168.1.10/admin"), false);
  assert.equal(LC.checkableUrl("http://10.0.0.1/x"), false);
  assert.equal(LC.checkableUrl("http://localhost:3000/x"), false);
  assert.equal(LC.checkableUrl("http://intranet/x"), false);
  assert.equal(LC.checkableUrl("http://[::1]/x"), false);
  assert.equal(LC.checkableUrl(""), false);
  assert.equal(LC.checkableUrl(null), false);
});

test("hostClass blocks the bot-wall list including subdomains, case-insensitively", () => {
  assert.equal(LC.hostClass("https://www.loopnet.com/Listing/123"), "blocked");
  assert.equal(LC.hostClass("https://images.crexi.com/x"), "blocked");
  assert.equal(LC.hostClass("https://WWW.REALTOR.COM/x"), "blocked");
  assert.equal(LC.hostClass("https://www.propertyshark.com/x"), "blocked");
  assert.equal(LC.hostClass("https://commercialcafe.com/x"), "fetchable");
  // Suffix match must be label-bounded: notloopnet.com is NOT loopnet.com.
  assert.equal(LC.hostClass("https://notloopnet.com/x"), "fetchable");
});

test("verdictFor: dead only for dnsNotFound, 404, 410", () => {
  assert.equal(LC.verdictFor({ dnsNotFound: true }), "dead");
  assert.equal(LC.verdictFor({ status: 404 }), "dead");
  assert.equal(LC.verdictFor({ status: 410 }), "dead");
});

test("verdictFor: 2xx/3xx are live", () => {
  assert.equal(LC.verdictFor({ status: 200 }), "live");
  assert.equal(LC.verdictFor({ status: 301 }), "live");
});

test("verdictFor: everything ambiguous is unknown", () => {
  for (const status of [400, 401, 403, 405, 429, 500, 503]) {
    assert.equal(LC.verdictFor({ status }), "unknown", `status ${status}`);
  }
  assert.equal(LC.verdictFor({ error: true }), "unknown");
  assert.equal(LC.verdictFor({}), "unknown");
  assert.equal(LC.verdictFor(null), "unknown");
});

test("applyLinkVerdicts demotes dead-linked comps to estimate and keeps the URL", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://a.example.com/1" },
    { address: "2 B St", source_type: "public_record", source_url: "https://b.example.com/2" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://a.example.com/1": "dead" });
  assert.equal(n, 1);
  assert.equal(payload.comps[0].source_type, "estimate");
  assert.equal(payload.comps[0].source_url, "https://a.example.com/1");
  assert.equal(payload.comps[1].source_type, "public_record");
});

test("applyLinkVerdicts skips verified comps and existing estimates", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://x.example.com/1", verified: true },
    { address: "2 B St", source_type: "estimate", source_url: "https://x.example.com/1" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://x.example.com/1": "dead" });
  assert.equal(n, 0);
  assert.equal(payload.comps[0].source_type, "listing");
  assert.equal(payload.comps[1].source_type, "estimate");
});

test("applyLinkVerdicts ignores live/unknown verdicts and tolerates junk shapes", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://a.example.com/1" },
    null,
    { address: "3 C St", source_type: "news" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://a.example.com/1": "live" });
  assert.equal(n, 0);
  assert.equal(payload.comps[0].source_type, "listing");
  assert.equal(LC.applyLinkVerdicts({}, {}), 0);
  assert.equal(LC.applyLinkVerdicts(null, null), 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/link-check.test.js`
Expected: FAIL, `Cannot find module '../link-check'`.

- [ ] **Step 3: Implement the module**

Create `link-check.js`:

```js
// ---------------------------------------------------------------------------
// Source-link check rules. A comp's source_url is its proof; a URL that is
// already dead when the model cites it was probably never real, so that comp
// is demoted to "estimate" before the report is served, cached, or harvested.
//
// Deliberately PURE, like entitlements.js and corpus-audit.js: no I/O, no
// fetch, no clock reads, so `npm test` exercises the whole decision table.
// server.js owns the network half (checkSourceLinks / applySourceLinkCheck)
// and passes outcomes in.
//
// Doctrine, matching the badge rule: under-claim death, never over-claim it.
// Only DNS name-not-found, 404, and 410 count as dead. Bot-walled hosts are
// never fetched and never demoted (51% of the corpus cites them; measured
// 2026-08-05). Spec: docs/superpowers/specs/2026-08-09-source-link-check-design.md
// ---------------------------------------------------------------------------

"use strict";

// The measured 403 list from the corpus-audit spec plus the same class of
// bot wall on the consumer portals. Subdomains count; suffix matching is
// label-bounded so notloopnet.com is not loopnet.com.
const BLOCKED_HOSTS = [
  "loopnet.com", "cityfeet.com", "propertyshark.com", "commercialsearch.com",
  "costar.com", "crexi.com", "zillow.com", "redfin.com", "realtor.com",
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ""));
  if (!m) return "";
  const authority = m[1];
  if (authority.includes("@")) return "";   // embedded credentials: never fetch
  return authority.replace(/:\d+$/, "").toLowerCase();
}

// Only URLs shaped like a public web page are ever checked. IP literals,
// localhost, and single-label hosts are refused here so the fetch layer's
// DNS guard is the second line, not the only one.
function checkableUrl(url) {
  const host = hostOf(url);
  if (!host || host === "localhost") return false;
  if (IPV4_RE.test(host) || host.startsWith("[")) return false;
  if (!host.includes(".")) return false;
  return true;
}

function hostClass(url) {
  const host = hostOf(url);
  return BLOCKED_HOSTS.some((b) => host === b || host.endsWith("." + b))
    ? "blocked" : "fetchable";
}

// outcome: { dnsNotFound: true } | { status: <number> } | { error: true } | null
function verdictFor(outcome) {
  const o = outcome || {};
  if (o.dnsNotFound) return "dead";
  if (o.status === 404 || o.status === 410) return "dead";
  if (Number.isFinite(o.status) && o.status >= 200 && o.status < 400) return "live";
  return "unknown";
}

// Demotes each comp whose URL's verdict is "dead". Returns the demoted count.
// Skips broker-verified comps (our own records vouch for those) and comps
// already at "estimate". The URL is kept as the audit trail of what was
// claimed.
function applyLinkVerdicts(payload, verdictsByUrl) {
  const comps = payload && Array.isArray(payload.comps) ? payload.comps : [];
  const verdicts = verdictsByUrl || {};
  let demoted = 0;
  for (const c of comps) {
    if (!c || c.verified === true) continue;
    if (String(c.source_type || "") === "estimate") continue;
    if (verdicts[String(c.source_url || "")] !== "dead") continue;
    c.source_type = "estimate";
    demoted += 1;
  }
  return demoted;
}

module.exports = { BLOCKED_HOSTS, checkableUrl, hostClass, verdictFor, applyLinkVerdicts };
```

- [ ] **Step 4: Run the module tests, then the whole suite**

Run: `node --test test/link-check.test.js` — all pass.
Run: `npm test` — everything else still green (the suite count grows by this file's tests).

- [ ] **Step 5: Commit**

```bash
git status --short
git add link-check.js test/link-check.test.js
git commit -m "link-check.js: pure rules for the dead-at-birth source-link check"
```

---

### Task 2: fetch helper + getComps wiring (server.js)

**Files:**
- Modify: `server.js` (three spots: requires at top near `const AUDIT = require("./corpus-audit")`; new helpers near `harvestComps`; the two return paths at the end of `getComps`, currently ~line 3966-3982)

**Interfaces:**
- Consumes: Task 1's `LINKCHECK` exports; existing `logEvent(kind, dims)`, `marketOf(address)`.
- Produces: `applySourceLinkCheck(report, type, address) -> Promise<void>` (never throws), used only inside `getComps`.

- [ ] **Step 1: Add the require**

Next to the other rules-module requires (`const AUDIT = require("./corpus-audit");`):

```js
const LINKCHECK = require("./link-check");
```

`dns` is already available via `require("dns")` if not imported; add `const dns = require("dns");` beside the other node requires only if absent (check first: `grep -n "require(\"dns\")" server.js`).

- [ ] **Step 2: Add the helpers** (place above `getComps`)

```js
// ---------------------------------------------------------------------------
// Dead-at-birth source-link check. Rules in link-check.js (pure, tested);
// this is the network half. Model-supplied URLs are fetched from OUR server,
// so the DNS answer is checked against private ranges before any request
// leaves the box. Everything fails open: a link-check problem must never
// cost a report. Spec: docs/superpowers/specs/2026-08-09-source-link-check-design.md
// ---------------------------------------------------------------------------
const LINK_CHECK_BUDGET_MS = 2500;   // total, shared by every URL in the batch
const LINK_CHECK_MAX_URLS = 12;
const LINK_CHECK_UA = "CompNinjaLinkCheck/1.0 (+https://compninja.co)";

function privateAddress(addr, family) {
  if (family === 4) {
    const p = String(addr).split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
  }
  const a = String(addr).toLowerCase();
  return a === "::" || a === "::1" || a.startsWith("fe80") ||
    a.startsWith("fc") || a.startsWith("fd") || a.startsWith("::ffff:");
}

async function checkSourceLinks(comps) {
  const verdicts = {};
  let blocked = 0;
  const urls = [];
  try {
    const seen = new Set();
    for (const c of comps || []) {
      const url = String((c && c.source_url) || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (!LINKCHECK.checkableUrl(url)) continue;
      if (LINKCHECK.hostClass(url) === "blocked") { blocked += 1; continue; }
      if (urls.length < LINK_CHECK_MAX_URLS) urls.push(url);
    }
    if (!urls.length) return { verdicts, checked: 0, blocked };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINK_CHECK_BUDGET_MS);
    await Promise.all(urls.map(async (url) => {
      try {
        const host = new URL(url).hostname;
        let addrs;
        try {
          addrs = await dns.promises.lookup(host, { all: true });
        } catch (e) {
          if (e && e.code === "ENOTFOUND") verdicts[url] = LINKCHECK.verdictFor({ dnsNotFound: true });
          return;   // any other DNS failure: no verdict, i.e. unknown
        }
        if (!addrs.length || addrs.some((a) => privateAddress(a.address, a.family))) return;
        const opts = { redirect: "follow", signal: controller.signal, headers: { "user-agent": LINK_CHECK_UA } };
        let r = await fetch(url, { ...opts, method: "HEAD" });
        if (r.status === 405) {
          r = await fetch(url, { ...opts, method: "GET" });
          try { if (r.body) await r.body.cancel(); } catch (_) {}
        }
        verdicts[url] = LINKCHECK.verdictFor({ status: r.status });
      } catch (_) { /* abort, TLS, socket: unknown */ }
    }));
    clearTimeout(timer);
    return { verdicts, checked: urls.length, blocked };
  } catch (_) {
    return { verdicts: {}, checked: 0, blocked };
  }
}

async function applySourceLinkCheck(report, type, address) {
  try {
    const comps = report && Array.isArray(report.comps) ? report.comps : [];
    if (!comps.length) return;
    const { verdicts, checked, blocked } = await checkSourceLinks(comps);
    if (checked + blocked === 0) return;   // nothing checkable cited
    const vals = Object.values(verdicts);
    const dead = vals.filter((v) => v === "dead").length;
    const live = vals.filter((v) => v === "live").length;
    const unknown = checked - dead - live;
    const demoted = LINKCHECK.applyLinkVerdicts(report, verdicts);
    if (demoted) {
      console.log(`🔗 ${demoted} comp(s) demoted: source link dead at harvest (${checked} checked, ${blocked} blocked-host, ${unknown} unknown)`);
    }
    // Counts ride the source column: the analytics schema is fixed, and a
    // migration for four integers is not worth the outage class it risks.
    logEvent("link_check", { prop_type: type, market: marketOf(address),
      source: `checked${checked}-dead${dead}-unknown${unknown}-blocked${blocked}` });
  } catch (err) {
    console.warn("Source link check skipped:", err && err.message);
  }
}
```

- [ ] **Step 3: Wire both getComps return paths**

At the end of `getComps` (~line 3978), the current code is:

```js
    const [primary, records] = await Promise.all([primaryCall, recordsCall]);
    return mergeLaneReports(primary, records, maxComps);
  }

  return solo((attempt) => callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpus, subjectDetails, "solo", null, progressFor(onProgress, attempt), stats), onProgress, stats);
```

Change to:

```js
    const [primary, records] = await Promise.all([primaryCall, recordsCall]);
    const merged = mergeLaneReports(primary, records, maxComps);
    // Dead-at-birth link check runs on the FINISHED report, inside getComps,
    // so /api/comps and the Explorer both inherit it and every downstream
    // surface (cache, harvest, snapshot, gate, share) sees the same badges.
    await applySourceLinkCheck(merged, type, address);
    return merged;
  }

  const report = await solo((attempt) => callAnthropicOnce(address, type, note, months, maxComps, txFocus, verifiedComps, subjectSizeSqft, corpus, subjectDetails, "solo", null, progressFor(onProgress, attempt), stats), onProgress, stats);
  await applySourceLinkCheck(report, type, address);
  return report;
```

- [ ] **Step 4: Syntax + suite**

Run: `node --check server.js` then `npm test`. All green (routes tests boot the real server; the check only runs inside a successful search, which those tests never trigger).

- [ ] **Step 5: Manual known-answer run of the impure half**

Write `C:\Users\JACOBA~1\...\scratchpad\linkcheck-manual.js` OUTSIDE the repo (scratchpad), containing:

```js
// Manual known-answer probe for checkSourceLinks. Run from the repo root:
//   node <scratchpad>/linkcheck-manual.js
// server.js cannot be required without booting the server, so this re-tests
// the helper's POLICY through link-check.js plus a live fetch pass that
// mirrors the helper's decisions 1:1.
const LC = require(process.cwd() + "/link-check");
const dns = require("dns");
const CASES = [
  "https://example.com/",                                   // expect live (200)
  "https://www.iana.org/definitely-not-a-real-page-4f9a2",  // expect dead (404)
  "http://no-such-host-4f9a2-compninja.com/x",              // expect dead (DNS)
  "https://www.loopnet.com/Listing/123/",                   // expect skipped (blocked host)
  "http://localtest.me/",                                   // expect skipped (resolves 127.0.0.1)
  "http://192.168.1.1/x",                                   // expect skipped (not checkable)
];
(async () => {
  for (const url of CASES) {
    if (!LC.checkableUrl(url)) { console.log("SKIP not-checkable:", url); continue; }
    if (LC.hostClass(url) === "blocked") { console.log("SKIP blocked-host:", url); continue; }
    const host = new URL(url).hostname;
    let addrs;
    try { addrs = await dns.promises.lookup(host, { all: true }); }
    catch (e) { console.log((e.code === "ENOTFOUND" ? "DEAD dns:" : "UNKNOWN dns-err:"), url); continue; }
    const priv = (a) => a.family === 4
      ? /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      : /^(::$|::1$|fe80|fc|fd|::ffff:)/.test(a.address.toLowerCase());
    if (addrs.some(priv)) { console.log("SKIP private-ip:", url); continue; }
    try {
      const r = await fetch(url, { method: "HEAD", redirect: "follow",
        headers: { "user-agent": "CompNinjaLinkCheck/1.0 (+https://compninja.co)" } });
      console.log(LC.verdictFor({ status: r.status }).toUpperCase(), r.status, url);
    } catch (_) { console.log("UNKNOWN fetch-err:", url); }
  }
})();
```

Run it; record the six verdict lines in the task report. Expected: live/dead/dead/skip/skip/skip (a transient network wobble downgrading a verdict to UNKNOWN is acceptable and worth noting, not fixing). Do not commit this script.

- [ ] **Step 6: Commit**

```bash
git status --short
git add server.js
git commit -m "Dead source links demote a comp to estimate before serve, cache, and harvest"
```

---

### Task 3: Docs + devlog

**Files:**
- Modify: `CLAUDE.md` (inside the `POST /api/comps` bullet, after the normalization sentence that ends "...while normalization is a guarantee.")
- Modify: `devlog.json` (append one entry; if the working file holds entries HEAD lacks, fold every one in, never drop them)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1-2.

- [ ] **Step 1: CLAUDE.md paragraph**

Insert after the normalization sentence ("...prompt rules are requests while normalization is a guarantee."):

> **Source-link check (2026-08-09).** After the report is parsed and normalized, and before the cache write, harvest, market snapshot, and the `gate()` funnel, `applySourceLinkCheck` (server.js) checks each comp's `source_url`: max 12 unique URLs in parallel under one 2.5s budget, HEAD with a GET-on-405 fallback, DNS resolved first and private/loopback answers refused (the URLs are model-supplied, so this is an SSRF guard, not a nicety). Rules live in the pure, tested **`link-check.js`**: bot-walled hosts (loopnet, cityfeet, propertyshark, commercialsearch, costar, crexi, zillow, redfin, realtor) are never fetched and never demoted; only DNS-gone/404/410 count as dead; a dead-linked comp is demoted to `estimate` (dead at birth usually means the citation was never real), keeping its `source_url` as the audit trail; broker-`verified` comps are exempt. It runs inside `getComps`, so the Explorer inherits it and the served report, cache, corpus, and shares all agree; the backtest and corpus retrieval need no changes because `estimate` is already excluded from both. Fails open on any error. Counts ride a `link_check` analytics event packed into the `source` column (the analytics schema is fixed). Link ROT on existing corpus rows deliberately does nothing; the sweep is deferred (see the spec).

- [ ] **Step 2: devlog entry**

Append to `devlog.json` (clean UTF-8, raw punctuation, surgical edit, never a PowerShell whole-file rewrite):

```json
{ "date": "2026-08-09", "type": "improvement",
  "title": "Dead source links demote a comp's badge before anyone sees it",
  "details": "Each fresh report now checks its comps' source URLs (bot-walled hosts exempt, one 2.5s budget). A link that is already dead at harvest time was probably never real, so that comp's badge drops to Estimate everywhere at once: the served report, the cache, and the permanent corpus. Links that rot later change nothing." }
```

Validate: `node -e "JSON.parse(require('fs').readFileSync('devlog.json','utf8'));console.log('OK')"` and confirm the mojibake pattern count is unchanged.

- [ ] **Step 3: Suite + commit**

Run `npm test`, then:

```bash
git status --short
git add CLAUDE.md devlog.json
git commit -m "Document the dead-at-birth source-link check"
```

---

## Post-merge (deploy time, owner-triggered)

Deploy via the `deploy` skill as usual. The live proof is one fresh billed search: the Render log shows either the `🔗` line or nothing (most reports cite live links), and `analytics_events` gains a `link_check` row with the packed counts. No migration to run.

## Self-review notes

- Spec coverage: rules module + every named rule (Task 1), fetch half with SSRF/budget/UA/fail-open (Task 2 Step 2), placement inside getComps covering both callers and the retry paths (Task 2 Step 3; solo() retries happen inside `solo`, so the check runs once on its final result), observability line + packed analytics event (Task 2 Step 2), no-backtest/no-retrieval/no-migration changes (nothing in the plan touches them), docs + deferred notes (Task 3). The spec's "live proof after deploy" lands in Post-merge.
- Type consistency: `LINKCHECK.checkableUrl/hostClass/verdictFor/applyLinkVerdicts` and `applySourceLinkCheck(report, type, address)` used identically across tasks; `getComps(address, type, ...)` argument order preserved in the wiring.
- Placeholder scan: clean; all code is complete and runnable as written.
