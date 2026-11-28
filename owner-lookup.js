"use strict";
// ---------------------------------------------------------------------------
// Owner lookup -- PURE rules. No I/O, no clock reads, no requires: bov-desk.js's
// contract, which is what lets `npm test` cover it with no database, no search
// provider and no web page.
//
// What it is for (2026-11-23). A broker told the owner his number one problem
// is finding the contact information to get in front of a landlord. A member
// names a commercial property; server.js runs ONE web search that reads the
// county's record for who owns it, the state's business filing for who is
// behind the company, and the owner's or manager's own pages for a business
// phone or email; and the member may save a person it found to their
// contacts. This file holds every rule of that:
//
//   finderPrompt   what the search provider is asked
//   parseAnswer    what of its answer is believed (little)
//   checkPerson    whether the cited page really shows a phone or an email
//   allowance      how many lookups a member has left this month
//   addressKey     what "the same building" means for a member's own history
//
// Seven rules a future editor will otherwise break. Docs:
// .claude/rules/owner-lookup.md, which also holds the legal review.
//
// 1. COMMERCIAL PROPERTY ONLY. A home's owner is a private person, and a
//    private person's phone number is where the Do Not Call rules, the state
//    privacy laws and New Jersey's Daniel's Law all bite. A Residential type
//    is refused before any search (lookupRefusal), the prompt tells the model
//    to answer {"residential":true} and nothing else for a home, and
//    parseAnswer keeps nothing beside that flag.
//
// 2. PUBLIC RECORDS AND THE OWNER'S OWN PAGES, NEVER A PEOPLE-SEARCH SITE.
//    The prompt names the allowed sources. parseAnswer then drops any person
//    whose cited page is on a people-search or data-broker host
//    (PEOPLE_SEARCH_HOSTS) and any record link on one. We do not resell a
//    data broker's file, and a number from one is a home number as often as
//    not.
//
// 3. A CONTACT DETAIL IS COPIED OR ABSENT, never built (the BOV desk's rule
//    6, and its 2026-11-21 lesson: the prompt is not obeyed reliably). So a
//    phone or email with no http source page is dropped, and server.js then
//    READS the page: checkPerson answers "on_page", "not_on_page" or
//    "unchecked" for each, and the screen says which.
//
// 4. THE ANSWER IS THE MEMBER'S OWN, never a shared file. A lookup is stored
//    on the account that asked (owner_lookups, user-scoped) so opening the
//    same building again is free. It is never read for another account.
//    That is the privacy wall's rule (which buildings a broker is chasing is
//    their book) and it is also what keeps this a search a member ran, not a
//    database of people CompNinja compiles and sells.
//
// 5. NOTHING IS SAVED AS A CONTACT ON ITS OWN. org-contacts.js: the list is
//    typed or imported, never collected. A found person becomes a contact
//    only when the member presses Save on that person.
//
// 6. COUNT A SEARCH ONLY WHEN IT ANSWERED. A provider failure, a timeout or
//    an answer nobody could read stores nothing and costs the member nothing.
//    "Nothing found" is an answer and counts: the search ran.
//
// 7. WE NEVER CONTACT ANYBODY. Nothing here dials, texts or mails an owner.
//    The use note (USE_NOTE) rides with every answer because the member is
//    the one who will.
// ---------------------------------------------------------------------------

const PER_MONTH_DEFAULT = 100;
// A stored answer is reused for this long before the same member's repeat
// lookup runs a new search. Ownership changes at a sale, and a county's page
// is rarely fresher than a quarter anyway.
const CACHE_DAYS = 90;
const MAX_PEOPLE = 6;
const MAX_ADDRESS = 200;
const RECENT_MAX = 20;

const KINDS = ["company", "person", "trust", "government", "unknown"];
const TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land"];

// People-search and data-broker sites. Named whole hosts; a subdomain of one
// is the same site. Deliberately a short list of the ones a search actually
// lands on: the rule the prompt states is the real filter, and this is the
// backstop for the day it is not obeyed.
const PEOPLE_SEARCH_HOSTS = [
  "spokeo.com", "whitepages.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com",
  "peoplefinders.com", "intelius.com", "instantcheckmate.com", "truthfinder.com", "radaris.com",
  "mylife.com", "peekyou.com", "zabasearch.com", "ussearch.com", "usphonebook.com", "thatsthem.com",
  "nuwber.com", "clustrmaps.com", "cyberbackgroundchecks.com", "searchpeoplefree.com",
  "peoplesearchnow.com", "smartbackgroundchecks.com", "publicrecordsnow.com", "addresses.com",
  "anywho.com", "411.com", "advancedbackgroundchecks.com", "checkpeople.com", "idtrue.com",
  "privateeye.com", "rocketreach.co", "zoominfo.com", "signalhire.com", "contactout.com",
  "lusha.com", "apollo.io", "peopledatalabs.com", "voterrecords.com", "officialusa.com",
  "homemetry.com", "neighbor.report", "blockshopper.com", "rehold.com", "ownerly.com",
];

// The words that ride with every answer. One copy, so the screen, the tests
// and the rules file cannot drift.
const USE_NOTE = "From public records and public web pages, as found today. Check it before you rely on it. " +
  "Before calling a personal number, check the National Do Not Call Registry, and never auto-dial or text it. " +
  "A marketing email needs your postal address and a way to opt out. " +
  "Not for tenant screening, credit, employment or insurance decisions.";

function clean(v, max) {
  const s = String(v == null ? "" : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, max);
}

function cleanUrl(v) {
  const s = clean(v, 500);
  return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : "";
}

function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}

function isPeopleSearch(url) {
  const h = hostOf(url);
  if (!h) return false;
  return PEOPLE_SEARCH_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

// A link we will show: http(s), and not a people-search site (rule 2).
function allowedUrl(v) {
  const u = cleanUrl(v);
  return u && !isPeopleSearch(u) ? u : "";
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const PLACEHOLDER_LOCALS = /^(first|firstname|last|lastname|name|your\.?name|first\.last|firstname\.lastname|flast|email|user|username|owner)$/i;
const PLACEHOLDER_DOMAINS = new Set(["example.com", "example.org", "example.net", "email.com", "domain.com", "company.com"]);
function cleanEmail(v) {
  const s = clean(v, 200).toLowerCase().replace(/^mailto:/, "");
  if (!s || !EMAIL_RE.test(s)) return "";
  const at = s.lastIndexOf("@");
  if (PLACEHOLDER_DOMAINS.has(s.slice(at + 1)) || PLACEHOLDER_LOCALS.test(s.slice(0, at))) return "";
  return s;
}

// US numbers only, written one way; anything else is dropped rather than
// passed on half-read (bov-desk.js's cleanPhone, restated: a different caller
// with the same reason, a wrong digit is a stranger's phone).
function phoneDigits(v) {
  const raw = clean(v, 60);
  if (!raw) return "";
  const main = raw.replace(/[\s,;]*(?:x|ext\.?|extension)\s*\.?\s*\d+\s*$/i, "");
  let d = main.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10 || d[0] === "0" || d[0] === "1") return "";
  // 555-01xx is the range reserved for fiction: a model inventing a number
  // reaches for it.
  if (d.slice(3, 8) === "55501") return "";
  return d;
}
function cleanPhone(v) {
  const d = phoneDigits(v);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "";
}

// ---- The address ------------------------------------------------------------

function cleanAddress(v) { return clean(v, MAX_ADDRESS + 1); }

// A member types "1210 N 17th St Boise ID" as often as "..., Boise, ID".
// Without commas the address still names its market when it ENDS in a
// state (code or name), after at least a street and a city word. "Ct" is
// both Connecticut and Court, so that one code counts only typed as "CT".
const STATE_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
const STATE_NAMES = /\s(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming)\.?$/i;
function endsWithState(a) {
  const s = String(a || "").trim();
  const words = s.split(/\s+/);
  if (words.length < 4) return false;            // number, street, city, state
  if (STATE_NAMES.test(s)) return true;
  const last = words[words.length - 1].replace(/\.$/, "");
  if (!/^[A-Za-z]{2}$/.test(last)) return false;
  if (last.toUpperCase() === "CT") return last === "CT";
  return STATE_CODES.has(last.toUpperCase());
}

// Why a lookup may not run, or "" when it may. The sentence is what the
// member reads.
function lookupRefusal({ address, type } = {}) {
  const a = cleanAddress(address);
  if (!a) return "Type the property's address.";
  if (a.length > MAX_ADDRESS) return "That address is too long.";
  if (/https?:|www\.|[<>@]/i.test(a)) return "That doesn't look like an address.";
  if (!/^\d+[A-Za-z]?(?:\s*-\s*\d+)?\s+\S+/.test(a)) return "Start with the street number, like 1450 S Eagle Rd, Meridian, ID.";
  if (!/,\s*[A-Za-z]{2}\b/.test(a) && !/\b\d{5}\b/.test(a) && !endsWithState(a)) return "Add the city and state, like 1450 S Eagle Rd, Meridian, ID.";
  // A unit of a building is very often somebody's home (rule 1).
  if (/(?:^|[\s,])(?:apt|apartment|unit|trailer|lot|spc|space)\.?\s*#?\s*[A-Za-z0-9-]+\s*(?:,|$)/i.test(a) && String(type || "") === "") {
    return "Owner lookup is for a whole commercial property, not one unit of it.";
  }
  if (String(type || "") === "Residential") return "Owner lookup is for commercial property. It does not look up the owner of a home.";
  return "";
}

// "The same building", for ONE member's own history: case, punctuation and
// spacing aside. Not the vault's addressKey and not a corpus key: nothing
// joins on this but the member's own repeat lookup.
function addressKey(address) {
  return cleanAddress(address).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, MAX_ADDRESS);
}

// ---- The prompt -------------------------------------------------------------

function finderPrompt({ address, type }) {
  const kind = TYPES.includes(type) ? `${type.toLowerCase()} property` : "commercial property";
  return [
    `Find who owns the ${kind} at ${cleanAddress(address)}, and how a commercial real estate broker could reach the owner on business.`,
    `Use web search, in this order:`,
    `1. The county assessor, tax collector or recorder for that address: the owner of record and the owner's mailing address.`,
    `2. If the owner is a company, trust or partnership: the Secretary of State business filing (in the state it is registered in) for its managers, members, officers or general partner, and its registered agent.`,
    `3. The owner's own business website, the property's own leasing or management page, or a leasing sign or flyer for this property: a business phone number or email address for the owner, an officer, the asset manager, the property manager or the leasing contact.`,
    ``,
    `THIS IS FOR COMMERCIAL PROPERTY ONLY. If the address is a single-family home, a condominium unit, a mobile home or any home its owner lives in, return exactly {"residential":true} and nothing else.`,
    ``,
    `SOURCES. Use only government records and pages the owner, its manager or its leasing broker published themselves. NEVER use, cite or copy from a people-search, background-check or contact-database site (Spokeo, Whitepages, BeenVerified, TruePeopleSearch, FastPeopleSearch, Radaris, ZoomInfo, RocketReach, Apollo and the like).`,
    ``,
    `CONTACT DETAILS ARE COPIED, NEVER BUILT. Return a phone number or an email address only when the page at source_url states it for that person or company, as a way to reach them on business. Never return a home phone number, never guess or construct an email address from a name or a company's usual pattern, and never return a number you cannot point to. If no page states one, use "". A registered agent that is a law firm or a filing service is not the owner: list it only as the registered agent.`,
    ``,
    `Return ONLY one JSON object and nothing else, in exactly this shape:`,
    `{"owner":{"name":"","kind":"","mailing_address":"","record_source":"","record_url":""},"entity":{"state":"","status":"","registered_agent":"","filing_url":""},"people":[{"name":"","role":"","company":"","phone":"","email":"","source_url":""}],"note":""}`,
    ``,
    `"owner.name" = the owner of record exactly as the county writes it. "owner.kind" = one of "company", "person", "trust", "government", "unknown". "owner.mailing_address" = the mailing address the county has for the owner. "owner.record_source" = the office the record came from, like "Ada County Assessor". "owner.record_url" = the page you read it on.`,
    `"entity" = the business filing, when the owner is a company: the state, the status ("Active", "Dissolved"), the registered agent's name, and the filing's page. Use "" for anything not found.`,
    `"people" = up to ${MAX_PEOPLE} people or companies a broker could contact about this property, most useful first. "name" = a person's full name, or "" when only a company is known. "role" = what they are to this property, like "Manager of the owning LLC", "Property manager" or "Leasing contact". "company" = their company. "phone" and "email" = exactly as the page at source_url states them, or "". "source_url" = the page where you read that person and their contact details.`,
    `"note" = one short sentence, under 200 characters, on anything a reader must know, like "The county lists a different owner than the leasing flyer." No advice.`,
    ``,
    `If you cannot find the owner of record, return {"owner":{"name":""},"people":[],"note":"<why>"}.`,
  ].join("\n");
}

// ---- The answer -------------------------------------------------------------

function firstObject(text) {
  const s = String(text || "");
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (_) { break; }
        }
      }
    }
  }
  return null;
}

// Text a search returned, shown to a member: one line, no markup, no link.
function cleanText(v, max) {
  const s = clean(v, max * 2).replace(/\[\d+\]/g, "").replace(/[*_`]/g, "").trim();
  if (!s || /[<>]/.test(s) || /https?:|www\./i.test(s)) return "";
  return s.slice(0, max);
}

function cleanPerson(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source_url = cleanUrl(raw.source_url);
  // Rule 2: a person read off a people-search site is not offered at all.
  if (source_url && isPeopleSearch(source_url)) return null;
  const name = cleanText(raw.name, 80);
  const company = cleanText(raw.company, 120);
  if (!name && !company) return null;
  // Rule 3: with no page to point to, the detail is not kept.
  const phone = source_url ? cleanPhone(raw.phone) : "";
  const email = source_url ? cleanEmail(raw.email) : "";
  return {
    name, company,
    role: cleanText(raw.role, 80),
    phone, email, source_url,
    phone_check: phone ? "unchecked" : "none",
    email_check: email ? "unchecked" : "none",
  };
}

function personKey(p) {
  return [p.name, p.company, p.phone, p.email].join("|").toLowerCase();
}

// What of the search's answer is believed. { ok:false } is an answer nobody
// could read (not counted, rule 6). Otherwise { ok:true, found, result }.
function parseAnswer(text) {
  const obj = firstObject(text);
  if (!obj || typeof obj !== "object") return { ok: false, error: "The search did not return an answer we could read." };
  if (obj.residential === true) {
    // Rule 1: nothing else is kept, whatever else came back.
    return { ok: true, found: false, result: { residential: true, owner: null, entity: null, people: [], note: "" } };
  }
  const o = obj.owner && typeof obj.owner === "object" ? obj.owner : {};
  const name = cleanText(o.name, 160);
  const owner = name ? {
    name,
    kind: KINDS.includes(o.kind) ? o.kind : "unknown",
    mailing_address: cleanText(o.mailing_address, 200),
    record_source: cleanText(o.record_source, 100),
    record_url: allowedUrl(o.record_url),
  } : null;

  const e = obj.entity && typeof obj.entity === "object" ? obj.entity : {};
  const ent = {
    state: cleanText(e.state, 40),
    status: cleanText(e.status, 40),
    registered_agent: cleanText(e.registered_agent, 120),
    filing_url: allowedUrl(e.filing_url),
  };
  const entity = owner && (ent.state || ent.status || ent.registered_agent || ent.filing_url) ? ent : null;

  const seen = new Set();
  const people = [];
  let dropped = 0;
  for (const raw of Array.isArray(obj.people) ? obj.people : []) {
    const p = cleanPerson(raw);
    if (!p) { dropped++; continue; }
    const k = personKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    if (people.length < MAX_PEOPLE) people.push(p);
  }
  if (!owner && !people.length && !Array.isArray(obj.people) && !obj.owner) {
    return { ok: false, error: "The search did not return an answer we could read." };
  }
  return {
    ok: true,
    found: Boolean(owner || people.length),
    dropped,
    result: { residential: false, owner, entity, people, note: cleanText(obj.note, 200) },
  };
}

// ---- The page check (rule 3) --------------------------------------------------

// Every US phone number a page shows, as ten digits. Read off the text and
// off tel: links.
function phonesOnPage(html) {
  const s = String(html || "")
    .replace(/&#(\d{2,3});/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/gi, " ").replace(/&#x2d;|&ndash;|&#8209;|‑|–/gi, "-");
  const out = [];
  // Not inside a longer run of digits on either side (an id, a parcel
  // number), with or without the country's leading 1.
  const re = /(?<![\d.])(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.\-/]{0,3}(\d{3})[\s.-]{0,3}(\d{4})(?!\d)/g;
  let m;
  while ((m = re.exec(s))) {
    const d = m[1] + m[2] + m[3];
    if (d[0] !== "0" && d[0] !== "1" && !out.includes(d)) out.push(d);
  }
  return out;
}

// `page` is { ok, emails: [...], phones: [...] } for the person's cited page,
// or null / { ok:false } when it could not be read. A failure of any kind
// lands on "unchecked", never "on_page".
function checkPerson(person, page) {
  const out = { ...person };
  const read = Boolean(page && page.ok);
  if (person.phone) {
    out.phone_check = !read ? "unchecked" : ((page.phones || []).includes(phoneDigits(person.phone)) ? "on_page" : "not_on_page");
  }
  if (person.email) {
    out.email_check = !read ? "unchecked" : ((page.emails || []).includes(person.email) ? "on_page" : "not_on_page");
  }
  return out;
}

function checkLabel(check) {
  if (check === "on_page") return "Shown on the page it came from";
  if (check === "not_on_page") return "Not on the page it was said to come from. Check before using it";
  if (check === "unchecked") return "We could not open its page to check it";
  return "";
}

// ---- The allowance ----------------------------------------------------------

// The first instant of the UTC month `now` (an ISO string or a Date's
// toISOString) falls in. The caller passes the clock in.
function monthStart(nowIso) {
  return String(nowIso || "").slice(0, 7) + "-01T00:00:00.000Z";
}
function cacheSince(nowIso) {
  return new Date(Date.parse(nowIso) - CACHE_DAYS * 864e5).toISOString();
}
// 0, "off", or anything that is not a positive whole number switches the
// feature off (the rollback). Unset is the default.
function perMonthFrom(env) {
  const raw = String(env == null ? "" : env).trim().toLowerCase();
  if (!raw) return PER_MONTH_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function allowance(used, perMonth) {
  const u = Math.max(0, Math.floor(Number(used) || 0));
  return { used: u, perMonth, left: Math.max(0, perMonth - u) };
}
function allowanceLine(a) {
  if (!a || !a.perMonth) return "";
  if (!a.left) return `You've used all ${a.perMonth} owner lookups for this month. They reset on the 1st.`;
  return `${a.left} of ${a.perMonth} lookups left this month.`;
}

// A stored lookup as a member's history row: the address and the day, never
// the answer (the list is a door, and the answer rides the POST).
function recentRow(row) {
  return {
    id: row.id,
    address: row.address,
    type: row.property_type || "",
    found: row.found === true,
    owner: (row.result && row.result.owner && row.result.owner.name) || "",
    lookedUpAt: row.created_at,
  };
}

module.exports = {
  PER_MONTH_DEFAULT, CACHE_DAYS, MAX_PEOPLE, MAX_ADDRESS, RECENT_MAX,
  KINDS, TYPES, PEOPLE_SEARCH_HOSTS, USE_NOTE,
  cleanAddress, lookupRefusal, addressKey,
  finderPrompt, parseAnswer,
  phonesOnPage, checkPerson, checkLabel, phoneDigits, cleanPhone, cleanEmail,
  isPeopleSearch, hostOf,
  monthStart, cacheSince, perMonthFrom, allowance, allowanceLine, recentRow,
};
