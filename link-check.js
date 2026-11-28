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

// ---------------------------------------------------------------------------
// Does a page STATE a sale price? (2026-11-27)
//
// The link check above proves a page exists. That was enough for a comp, one
// vote among several. It is not enough for the subject's OWN sale, which can
// now carry most of a value (valuation.js, "The building's own sale"): the
// audit behind that rule found a sale "cited" to an article that said the
// terms were not disclosed, and an asking price cited to a company's home
// page. So for that ONE url the server reads the page and asks whether it
// says the price.
//
//   "states"       the price is on the page
//   "undisclosed"  the page is about this property (its street number and
//                  street are on it), carries the price nowhere, and SAYS the
//                  price or the terms were not disclosed. The search put a
//                  number on a page that says there is none to give, and the
//                  sale is not leaned on.
//   "unknown"      anything else: a page that would not load, a script shell
//                  with no text, a page that names neither, and a page that
//                  names the property and simply shows no price. No evidence
//                  either way, and no penalty, the doctrine above: under-claim,
//                  never over-claim.
//
// Why "shows no price" is not enough to refuse a sale (it was, for one day):
// one GET sees less than a reader or the search did. A business journal
// serves a headline, a paragraph and "Subscribe to keep reading"; a county
// page names the parcel and loads its sale history a request later. Both
// name the property and show no price, and both may state it. What our GET
// CAN establish is a page saying, in words, that the price was not given.
//
// The price is looked for the ways a deal page writes it: in full
// ("$12,625,000", "12625000"), and rounded in millions the way a headline
// does ("$12.625 million", "$12.63M", "$12.6 MM"), or thousands under a
// million ("$975K"). A rounding counts while it stays within PRICE_ROUNDING
// (1%) of the price, rounded either way: "$12.5 million" is how an article
// writes $12,450,000, and "$69M" is how a headline writes $69.4M. A bare
// "13 million" for $12.6M is NOT accepted: that is another number. The unit
// may be hyphened on ("a $12.6-million sale") or written "mln".
//
// It is looked for in the WHOLE document, scripts included, and only the
// question "is this page about the property" is asked of the visible text.
// A page that draws its article in the browser carries the words in a script
// and the address in its title: read as visible text alone, that page names
// the property and "lacks" a price it plainly states. Finding the figure in a
// script by coincidence costs nothing (the answer is only ever the benefit of
// the doubt); missing it there would refuse a good sale.
// ---------------------------------------------------------------------------
function pageText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&#36;|&dollar;/gi, "$").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").toLowerCase();
}
const PRICE_ROUNDING = 0.01;
// The whole document as text, scripts and all: tags out, the same entities
// as pageText. For the price search only.
function pageRaw(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&#36;|&dollar;/gi, "$").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").toLowerCase();
}
function priceForms(price) {
  const p = Math.round(Number(price));
  if (!(p >= 1000)) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forms = [esc(p.toLocaleString("en-US")), String(p)];
  const short = (n, unit) => {
    const seen = new Set();
    for (const d of [3, 2, 1, 0]) {
      const k = Math.pow(10, d);
      // Rounded down and rounded up at this many decimals: a float's own
      // toFixed gives "12.4" for 12.45, and the article says "12.5".
      for (const v of [Math.floor(n * k + 1e-9) / k, Math.ceil(n * k - 1e-9) / k]) {
        if (!(v > 0) || Math.abs(v - n) / n > PRICE_ROUNDING) continue;
        const text = String(Number(v.toFixed(d)));
        if (seen.has(text)) continue;
        seen.add(text);
        forms.push(esc(text) + "\\s*-?\\s*(?:" + unit + ")(?![a-z])");
      }
    }
  };
  if (p >= 1e6) short(p / 1e6, "million|mil|mln|mm|m");
  else short(p / 1e3, "thousand|k");
  return forms;
}
// A page saying, in words, that there is no price to give.
const UNDISCLOSED_RE = new RegExp([
  "\\b(?:terms|price|pricing|financial terms|financial details|details|amount|sum)\\b[^.]{0,60}\\b(?:not disclosed|undisclosed|not released|not made public|not announced|not available|not provided|kept private|confidential|were(?:n't| not) disclosed|was(?:n't| not) disclosed)\\b",
  "\\bundisclosed (?:price|sum|amount|terms|figure)\\b",
  "\\bfor an undisclosed\\b",
  "\\b(?:did not|didn't|declined to|would not|wouldn't) disclose\\b",
].join("|"));
function pageStatesPrice(html, price, address) {
  const text = pageText(html);
  const raw = pageRaw(html);
  if (raw.length < 200) return "unknown";
  const forms = priceForms(price);
  if (!forms.length) return "unknown";
  if (forms.some((f) => new RegExp("(?:^|[^0-9.,])" + f + "(?![0-9])").test(raw))) return "states";
  // Is the page about this property at all? Its street number, then the
  // first word of its street within a few words, in what a reader sees.
  const m = String(address || "").toLowerCase().match(/^\s*(\d+)(?:\s*-\s*\d+)?\s+(?:[nsew]\.?\s+)?([a-z0-9]+)/);
  if (!m) return "unknown";
  const about = new RegExp("(?:^|[^0-9])" + m[1] + "(?:\\s*-\\s*\\d+)?\\s+(?:[a-z.]+\\s+){0,2}" + m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text);
  return about && UNDISCLOSED_RE.test(text) ? "undisclosed" : "unknown";
}

module.exports = { BLOCKED_HOSTS, PARKING_HOSTS, checkableUrl, hostClass, verdictFor, isParked, parkingHost, applyLinkVerdicts,
  pageStatesPrice, priceForms, pageText, pageRaw, PRICE_ROUNDING };
