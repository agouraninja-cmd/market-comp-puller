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
