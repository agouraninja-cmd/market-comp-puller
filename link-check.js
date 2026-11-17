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
// Only DNS name-not-found, 404, 410 and a parked domain count as dead. Bot-walled hosts are
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

// Parked domains (2026-11-17). A lapsed brokerage domain bought by a parking
// service answers 200 to every path, so the status rule above called it live
// and a comp citing it kept its "Listing" badge: the 76 Inverness Dr E report
// cited innovatecre.com/recent-transactions, a parked for-sale page, for a
// condo unit nobody could find anywhere else. A parked page is no source at
// all, so it counts as dead. Two signals, both cheap:
//   - a redirect whose Location is a parking or domain-sale host, or GoDaddy's
//     relative "/lander" hop;
//   - the first bytes of the page naming a parking service or a domain sale.
// Phrases are specific on purpose: "for sale" alone is on every listing page
// this check exists to keep.
const PARKING_HOSTS = [
  "sedoparking.com", "sedo.com", "parkingcrew.net", "bodis.com", "above.com",
  "parklogic.com", "dan.com", "afternic.com", "hugedomains.com", "undeveloped.com",
  "domainmarket.com", "buydomains.com", "brandbucket.com", "squadhelp.com",
  "atom.com", "namebright.com", "uniregistry.com", "domainlore.com", "efty.com",
  "porkbun.com", "parked.com",
];
const PARKED_BODY_RES = [
  /this domain (?:name )?(?:is|may be) for sale/i,
  /the domain (?:name )?[a-z0-9.-]* ?is for sale/i,
  /buy this domain/i,
  /domain (?:is )?parked/i,
  /this (?:web ?page|site|domain) is parked/i,
  /parked free,? courtesy of/i,
  /this domain has expired/i,
  /domain (?:name )?has expired/i,
  /window\.park\s*=/i,
  /(?:location(?:\.href)?\s*=|url=)\s*["']?\/lander\b/i,
  /sedoparking|parkingcrew|bodis\.com\/|parklogic|afternic\.com|hugedomains\.com|dan\.com\/buy-domain/i,
];

function parkingHost(host) {
  const h = String(host || "").toLowerCase();
  return PARKING_HOSTS.some((p) => h === p || h.endsWith("." + p));
}

// outcome: { status, location?, body? } -> true when the answer is a parked
// or for-sale domain rather than a page. `body` is the first few KB only.
function isParked(outcome) {
  const o = outcome || {};
  const loc = String(o.location || "").trim();
  if (Number.isFinite(o.status) && o.status >= 300 && o.status < 400 && loc) {
    if (/^\/lander\b/i.test(loc)) return true;
    if (parkingHost(hostOf(loc))) return true;
  }
  const body = typeof o.body === "string" ? o.body : "";
  return body ? PARKED_BODY_RES.some((re) => re.test(body)) : false;
}

// outcome: { dnsNotFound: true } | { status: <number>, location?, body? } |
//          { parked: true } | { error: true } | null
function verdictFor(outcome) {
  const o = outcome || {};
  if (o.dnsNotFound) return "dead";
  if (o.parked || isParked(o)) return "dead";
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
    if (verdicts[String(c.source_url || "").trim()] !== "dead") continue;
    c.source_type = "estimate";
    demoted += 1;
  }
  return demoted;
}

module.exports = { BLOCKED_HOSTS, PARKING_HOSTS, checkableUrl, hostClass, verdictFor, isParked, parkingHost, applyLinkVerdicts };
