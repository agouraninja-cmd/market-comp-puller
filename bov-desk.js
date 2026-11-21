"use strict";
// ---------------------------------------------------------------------------
// The BOV desk -- PURE rules. No I/O, no clock reads, no requires: the same
// contract as bov-log.js and broker-leads.js, which is what lets `npm test`
// cover the whole thing with no database, no provider and no mail.
//
// What it is for. A Broker Opinion of Value request used to be worked by
// hand: read the notification, search the web for local brokers who handle
// that kind of property, write each one an email, wait, then write the
// introduction. The first real request (2026-11-19) sat for hours on exactly
// that, and its four outreach drafts were still unsent the next morning.
// server.js now does the search and the writing the moment a request lands,
// and the introduction the moment a broker says yes. This file holds every
// rule and every word of that:
//
//   finderPrompt     what the search provider is asked
//   parseCandidates  what of its answer is believed (little)
//   outreachDraft    the email to a broker
//   introDraft       the email that introduces the two
//   ackPhoneLine     the one line the owner's acknowledgment gained
//
// Six rules a future editor will otherwise break:
//
// 1. A CONTACT DETAIL IS COPIED OR ABSENT, never built. The prompt forbids a
//    guessed address and parseCandidates drops anything that is not shaped
//    like one, a placeholder, or a pattern ("first.last@"). `email_check`
//    then says how far to trust what is left: "match" only when the address
//    is on the same domain as the page it was read from.
//
// 2. ONLY "match" MAY BE SENT WITHOUT A PERSON LOOKING (canAutoSend). The
//    default is that nothing is sent until the owner presses Send under the
//    full text; BOV_AUTOPILOT=on is the owner's own switch, and even then a
//    free-mail or off-domain address waits for a person, and so does every
//    draft of a request whose own text does not look like an address and a
//    name (autopilotSafe). server.js adds the two limits a pure file cannot
//    hold: one unread send to a broker in AUTOPILOT_REST_DAYS, and
//    AUTOPILOT_PER_DAY in all.
//
// 3. THE OUTREACH NAMES THE PROPERTY AND NEVER THE PERSON. A broker learns
//    who asked only from the introduction, which is sent only to a broker
//    who said yes (or whom the owner chose). test/bov-desk.test.js fails the
//    build if a lead's name, email, phone or company reaches outreachDraft's
//    output.
//
// 4. WE CONNECT, WE ARE NOT A BROKERAGE. The owner is not a licensed broker
//    (CLAUDE.md), so every email says we connect owners with a local broker
//    and that the estimate is automated, not an appraisal. Nothing here says
//    "licensed" about a broker a search found: nobody checked.
//
// 5. THE MODEL'S WORDS ABOUT A BROKER ARE A CLAUSE, NOT A LETTER. `fit` must
//    start with "your", stay under FIT_MAX and carry no link or line break,
//    or it is dropped and the plain sentence is used. An unreviewed send
//    (autopilot) always uses the plain sentence.
//
// 6. ONE INTRODUCTION PER REQUEST BY DEFAULT. The first broker to accept is
//    introduced and the rest are told it is taken (server.js claims the
//    request atomically). The owner can introduce another by hand.
// ---------------------------------------------------------------------------

// Restated by the check constraints in migrations/065-bov-desk.sql; keep the
// three lists in step (test/bov-desk.test.js reads the file).
const MATCH_STATUSES = ["draft", "sent", "accepted", "introduced", "declined", "skipped"];
const REQUEST_STATES = ["new", "searching", "ready", "none_found", "failed", "introduced", "closed"];
const ORIGINS = ["search", "bench", "manual", "platform"];

// Brokers offered per request. Four went out by hand on the first one; five
// leaves room for one bad address.
const MAX_CANDIDATES = 5;
// Brokers already found for the same market and type are reused for this
// long before the web is asked again ("the bench"). It makes a second request
// in a market instant and free, and it is the reason one visitor filing ten
// requests costs one search.
const BENCH_DAYS = 60;
// Below this many usable bench brokers, a fresh search tops the list up.
const MIN_BENCH = 3;
// How far back the desk lists requests.
const DESK_DAYS = 60;
// Autopilot's two limits (rule 2). The bench is what makes them necessary: a
// second request in a market reuses the first one's brokers, so without a
// rest period fifty fake requests would be fifty emails to the same five
// people. A broker who was sent anything in the last AUTOPILOT_REST_DAYS is
// left for a person to decide, and the whole day stops at AUTOPILOT_PER_DAY.
const AUTOPILOT_REST_DAYS = 14;
const AUTOPILOT_PER_DAY = 12;

const FIT_MAX = 140;
const BODY_MAX = 6000;
const SUBJECT_MAX = 200;

// Addresses nobody can be reached at. A model that could not find an address
// reaches for these, and mail to them bounces under the owner's name.
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "email.com", "domain.com",
  "company.com", "test.com", "website.com", "yourdomain.com", "mail.com",
]);
const PLACEHOLDER_LOCALS = /^(first|firstname|last|lastname|name|your\.?name|first\.last|firstname\.lastname|flast|email|user|username|broker|agent)$/i;
// Real, but proves nothing about which firm somebody works for.
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "me.com", "live.com", "msn.com", "comcast.net", "att.net",
  "verizon.net", "sbcglobal.net", "protonmail.com", "proton.me", "ymail.com",
]);

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function isStatus(v) { return MATCH_STATUSES.includes(v); }
function isState(v) { return REQUEST_STATES.includes(v); }

// Control characters out, runs of whitespace to one space, trimmed, capped.
function clean(v, max) {
  const s = String(v == null ? "" : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, max);
}

function cleanEmail(v) {
  const s = clean(v, 200).toLowerCase().replace(/^mailto:/, "");
  if (!s || !EMAIL_RE.test(s)) return "";
  const at = s.lastIndexOf("@");
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (PLACEHOLDER_DOMAINS.has(domain) || PLACEHOLDER_LOCALS.test(local)) return "";
  return s;
}

// US numbers only, written one way. Anything else is dropped rather than
// passed on half-read: a wrong digit is a stranger's phone.
function cleanPhone(v) {
  const raw = clean(v, 60);
  if (!raw) return "";
  // An extension is dropped, not folded into the number ("555.0100 x12").
  const main = raw.replace(/[\s,;]*(?:x|ext\.?|extension)\s*\.?\s*\d+\s*$/i, "");
  let d = main.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10 || d[0] === "0" || d[0] === "1") return "";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function cleanUrl(v) {
  const s = clean(v, 500);
  if (!/^https?:\/\/[^\s<>"']+$/i.test(s)) return "";
  return s;
}

// A person, as far as a string can show it: letters, at least two words, and
// none of the shapes a firm, an address or a link has.
function cleanName(v) {
  const s = clean(v, 80).replace(/^(mr|mrs|ms|dr)\.?\s+/i, "");
  if (!s || /[@/\\<>|]|\d|https?:/i.test(s)) return "";
  if (!/[a-z]/i.test(s) || s.split(" ").length < 2) return "";
  if (/\b(llc|inc|corp|company|realty|group|partners|associates|team|properties|advisors|brokerage)\b\.?$/i.test(s)) return "";
  return s;
}

// The clause the model may contribute (rule 5).
function cleanFit(v) {
  let s = clean(v, 400).replace(/\[\d+\]/g, "").replace(/[*_`]/g, "").trim();
  s = s.replace(/[.;,\s]+$/, "");
  if (!s || s.length > FIT_MAX) return "";
  if (!/^your\s/i.test(s)) return "";
  if (/https?:|www\.|@/i.test(s)) return "";
  return "your" + s.slice(4);
}

function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}
// The last two labels. Wrong for a .co.uk, which is fine: every caller is
// comparing two US firm sites, and a miss only costs the "match" badge.
function baseDomain(host) {
  const parts = String(host || "").toLowerCase().split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

// How far to trust an address (rule 1):
//   "none"    there is none
//   "match"   same domain as the page it was read from
//   "free"    a free-mail address: real, but it proves no firm
//   "differs" another domain than the page (a directory, a listing site)
function emailCheck(email, sourceUrl) {
  const e = cleanEmail(email);
  if (!e) return "none";
  const domain = e.slice(e.lastIndexOf("@") + 1);
  if (FREE_MAIL.has(domain)) return "free";
  const host = hostOf(sourceUrl);
  if (host && baseDomain(host) === baseDomain(domain)) return "match";
  return "differs";
}

function canAutoSend(m) {
  return Boolean(m && m.status === "draft" && cleanEmail(m.email) && m.email_check === "match");
}

// Whether a request may be worked with nobody reading it (autopilot).
//
// The lead form is public, and with autopilot on its text travels to a
// broker's inbox under the owner's name with no person in between: the
// address in the outreach, the name and company in the introduction. So an
// unread request must LOOK like what the form is for. An address starts with
// a house number and is made of address characters; a name is made of name
// characters; and nothing in any of them has the shape of a link ("evil.com",
// "http", a dot inside a word). "St." and "Ave." pass; "N.W." does not, and
// costs that one request a person's glance, which is the safe direction.
// Anything that fails simply waits on the desk like every request does with
// autopilot off.
const LINKISH = /https?:|www\.|[A-Za-z0-9]\.[A-Za-z0-9]|[@<>]/i;
function autopilotSafe(lead) {
  const l = lead || {};
  const address = clean(l.address, 400);
  if (!/^\d{1,6}[A-Za-z]?\s/.test(address) || address.length > 120) return false;
  if (!/^[A-Za-z0-9 .,'#&/-]+$/.test(address) || LINKISH.test(address)) return false;
  for (const v of [l.name, l.company]) {
    const s = clean(v, 200);
    if (!s) continue;
    if (s.length > 80 || !/^[\p{L}\p{M}0-9 .,'&-]+$/u.test(s) || LINKISH.test(s)) return false;
  }
  return Boolean(clean(l.name, 200));
}

function firstName(name) {
  const s = clean(name, 80);
  return s ? s.split(" ")[0] : "";
}

// ---------------------------------------------------------------------------
// Wording that follows the property type. index.html's bovCopy() makes the
// same split for the same reason: a homeowner asked to "talk to a local
// agent", not for a Broker Opinion of Value.
// ---------------------------------------------------------------------------
// `noun` names one (the subject line), `handles` names the kind (never
// noun + "s": that shipped "propertys" once in this repo already).
const TYPE_WORDS = {
  Industrial:  { search: "industrial property (warehouses, flex and manufacturing buildings)", noun: "industrial property", handles: "industrial property" },
  Office:      { search: "office buildings", noun: "office building", handles: "office buildings" },
  Retail:      { search: "retail property (storefronts, pads and shopping centers)", noun: "retail property", handles: "retail property" },
  Multifamily: { search: "multifamily and apartment buildings", noun: "multifamily property", handles: "multifamily property" },
  Land:        { search: "commercial and development land", noun: "land", handles: "land" },
  Residential: { search: "homes, as a residential listing agent", noun: "home", handles: "homes" },
};
function wordsFor(type) {
  const residential = type === "Residential";
  const t = TYPE_WORDS[type] || { search: "commercial property", noun: "property", handles: "commercial property" };
  return {
    residential,
    search: t.search,
    noun: t.noun,
    handles: t.handles,
    pro: residential ? "agent" : "broker",
    // What the person asked for, said to a broker.
    asked: residential
      ? "asked to be connected with a local agent about their home's value"
      : "requested a Broker Opinion of Value",
    // What the broker is being asked to give.
    give: residential ? "a local take on the home's value" : "an opinion of value",
    subject: residential ? "Home value request" : "BOV request",
  };
}

// ---------------------------------------------------------------------------
// The search. Market and type only: the street address stays here, which is
// also what lets one answer serve every request in that market (the bench).
// ---------------------------------------------------------------------------
function finderPrompt({ market, type }) {
  const w = wordsFor(type);
  const who = w.residential
    ? "residential real estate agents who list " + w.search
    : "commercial real estate brokers or agents who handle sales of " + w.search;
  return [
    `Find up to ${MAX_CANDIDATES} individual, currently practicing ${who} in or around ${market}.`,
    `Use web search. Prefer people with recent listings or closed sales of this kind in ${market} itself, then the surrounding metro area. Prefer a mix of firms: no more than two people from the same firm.`,
    ``,
    `CONTACT DETAILS ARE COPIED, NEVER BUILT. Return an email address or a phone number only when a public page states it for that person: their own bio on their firm's site, a listing flyer, or the firm's team page. Never guess, construct or infer an address from a name or from a firm's usual pattern, and never return a general inbox (info@, contact@, sales@). If no page states one, use "". Leave out anyone with neither a stated email nor a stated phone number.`,
    ``,
    `Return ONLY one JSON object and nothing else, in exactly this shape:`,
    `{"brokers":[{"name":"","firm":"","email":"","phone":"","fit":"","license":"","source_url":""}]}`,
    ``,
    `"name" = the person's full name. A person, never a firm or a team.`,
    `"firm" = their brokerage.`,
    `"email" and "phone" = exactly as the page at source_url states them, or "".`,
    `"fit" = one short clause, under 110 characters, that starts with the word "your" and states what the page says this person does, for example "your office sales and leasing work across Greater Rhode Island". Facts from the page only. No praise and no adjectives about quality.`,
    `"license" = their state real estate license number if the page states it, else "".`,
    `"source_url" = the page where you read their contact details. Their bio on the firm's own website is best.`,
    ``,
    `If you cannot find anyone who meets these rules, return {"brokers":[]}.`,
  ].join("\n");
}

// The first balanced {...} in the text. A reply that wraps its JSON in a
// sentence or a code fence is still read; a reply with none is an error, not
// an empty list (the two mean different things on the desk).
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

// The keys one broker is known by: their address when they have one, and
// their name at their firm either way, so the same person with and without an
// address is still one person. Works on a candidate and on a stored row.
function keysOf(c) {
  const src = c || {};
  const byName = "n:" + (clean(src.name, 80) + "|" + clean(src.firm, 120)).toLowerCase();
  const email = cleanEmail(src.email);
  return email ? ["e:" + email, byName] : [byName];
}
function candidateKey(c) { return keysOf(c)[0]; }

// Candidates not already on this request (a second search must not offer the
// same broker twice, whatever became of the first offer).
function withoutKnown(candidates, rows) {
  const known = new Set();
  for (const r of rows || []) for (const k of keysOf(r)) known.add(k);
  return (candidates || []).filter((c) => c && !keysOf(c).some((k) => known.has(k)));
}

// One candidate, cleaned, or null when it is not somebody we could reach.
function cleanCandidate(raw, origin) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const source_url = cleanUrl(raw.source_url);
  let email = cleanEmail(raw.email);
  // A general inbox is not this person (the prompt asks for none; this is the
  // guarantee).
  if (email && /^(info|contact|sales|admin|office|hello|inquiries|support|marketing|leasing)@/.test(email)) email = "";
  const phone = cleanPhone(raw.phone);
  if (!email && !phone) return null;
  return {
    name,
    firm: clean(raw.firm, 120) || null,
    email: email || null,
    phone: phone || null,
    fit: cleanFit(raw.fit) || null,
    license: clean(raw.license, 40).replace(/[^A-Za-z0-9 .#-]/g, "") || null,
    source_url: source_url || null,
    email_check: emailCheck(email, source_url),
    origin: ORIGINS.includes(origin) ? origin : "search",
  };
}

function dedupe(list, max) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    if (!c) continue;
    const keys = keysOf(c);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(c);
    if (out.length >= (max || MAX_CANDIDATES)) break;
  }
  return out;
}
// The bench first (somebody who said yes before leads), then what a fresh
// search added.
function mergeCandidates(bench, found) {
  return dedupe((bench || []).concat(found || []), MAX_CANDIDATES);
}

// What of the provider's answer is believed. { ok:false } means the reply
// held no readable JSON (a failed search); { ok:true, brokers:[] } means the
// search ran and found nobody usable.
function parseCandidates(text) {
  const obj = firstObject(text);
  if (!obj || !Array.isArray(obj.brokers)) {
    return { ok: false, brokers: [], error: "The search did not return a list we could read." };
  }
  const cleaned = obj.brokers.map((b) => cleanCandidate(b, "search"));
  return { ok: true, brokers: dedupe(cleaned, MAX_CANDIDATES), dropped: cleaned.filter((c) => !c).length };
}

// Brokers already found for this market and type. A broker who passed or was
// skipped by the owner is not offered again; one who was introduced is (they
// said yes last time), and goes first.
function benchCandidates(rows) {
  const rank = { introduced: 0, accepted: 1, sent: 2, draft: 3 };
  const usable = (rows || [])
    .filter((r) => r && r.status !== "declined" && r.status !== "skipped" && r.origin !== "platform")
    .slice()
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  const blocked = (rows || []).filter((r) => r && (r.status === "declined" || r.status === "skipped"));
  const cleaned = usable.map((r) => cleanCandidate(r, "bench"));
  return dedupe(withoutKnown(cleaned, blocked), MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Who the mail is from. BOV_FROM is "Name <address>" or a bare address; with
// none, mail goes out as the site (EMAIL_FROM) and replies go to the owner's
// notification address. A sender named after the brand has no first person to
// write in ("I'm CompNinja with CompNinja").
// ---------------------------------------------------------------------------
function parseSender(fromHeader, fallbackEmail) {
  const raw = clean(fromHeader, 300);
  const m = /^(.*)<([^<>]+)>$/.exec(raw);
  let name = "", email = "";
  if (m) { name = clean(m[1].replace(/^"|"$/g, ""), 80); email = cleanEmail(m[2]); }
  else email = cleanEmail(raw);
  if (!email) { email = cleanEmail(fallbackEmail); name = ""; }
  if (/^compninja$/i.test(name)) name = "";
  return { name, email };
}
function signature(sender) {
  const s = sender || {};
  return [s.name, "CompNinja", s.email].filter(Boolean).join("\n");
}

function sizeLine(sizeSqft) {
  const n = Number(sizeSqft);
  if (!Number.isFinite(n) || n <= 0) return "";
  return Math.round(n).toLocaleString("en-US") + " SF";
}

// ---------------------------------------------------------------------------
// The email to a broker (rule 3: the property, never the person).
//   broker  { name, fit }
//   lead    { address, type, size_sqft }   -- nothing else is read
//   plain   true = leave the model's clause out (an unreviewed send)
// ---------------------------------------------------------------------------
function outreachDraft({ broker, lead, market, reportUrl, acceptUrl, sender, plain }) {
  const w = wordsFor(lead && lead.type);
  const b = broker || {};
  const hi = firstName(b.name) || "there";
  const s = sender || {};
  const tool = w.residential ? "a real estate valuation tool" : "a commercial real estate valuation tool";
  const intro = s.name
    ? `I'm ${s.name} with CompNinja, ${tool}.`
    : `I'm writing from CompNinja, ${tool}.`;
  const fit = plain ? "" : cleanFit(b.fit);
  const why = fit
    ? `An owner just ${w.asked} through our site, and with ${fit}, I thought you'd be a strong fit.`
    : `An owner just ${w.asked} through our site, and I'm looking for a local ${w.pro} who handles ${w.handles} around ${market || "that market"}.`;
  const size = sizeLine(lead && lead.size_sqft);
  const lines = [
    `Hi ${hi},`,
    ``,
    `${intro} ${why}`,
    ``,
    `Property: ${clean(lead && lead.address, 300)}`,
    `Type: ${clean(lead && lead.type, 40)}`,
    ...(size ? [`Size: about ${size}`] : []),
    ...(reportUrl ? [`Our automated estimate (not an appraisal): ${reportUrl}`] : []),
    ``,
    `We don't broker deals ourselves; we connect owners with a local ${w.pro}. The owner was told this is free, with no obligation.`,
    ``,
    ...(acceptUrl ? [
      `If you'd like to take this one on, confirm here and you'll be introduced to the owner by email right away:`,
      acceptUrl,
      ``,
      `You can also just reply to this email.`,
    ] : [
      `If you'd like to take this one on, reply and I'll introduce you to the owner directly.`,
    ]),
    ``,
    `Thanks,`,
    signature(s),
  ];
  return {
    subject: `${w.subject}: ${w.noun}, ${clean(lead && lead.address, 140)}`.slice(0, SUBJECT_MAX),
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// The introduction. The only mail that carries the requester's name and
// contact details to a broker, and it goes to both of them at once.
// ---------------------------------------------------------------------------
function introDraft({ lead, broker, reportUrl, sender }) {
  const l = lead || {}, b = broker || {};
  const w = wordsFor(l.type);
  const lf = firstName(l.name) || "there";
  const bf = firstName(b.name) || "there";
  const who = (name, firm) => clean(name, 120) + (firm ? ` of ${clean(firm, 120)}` : "");
  const reach = (name, email, phone) =>
    `  ${clean(name, 120)}: ${[cleanEmail(email), cleanPhone(phone)].filter(Boolean).join(" · ")}`;
  const lines = [
    `Hi ${lf} and ${bf},`,
    ``,
    `${lf}, this is ${who(b.name, b.firm)}, a local ${w.pro} who has agreed to give you ${w.give} for ${clean(l.address, 300)}. It is free, with no obligation.`,
    ``,
    `${bf}, ${who(l.name, l.company)} ${w.residential ? "asked for it" : "requested it"} through CompNinja.`,
    ``,
    `How to reach each other:`,
    reach(l.name, l.email, l.phone),
    reach(b.name, b.email, b.phone),
    ...(reportUrl ? [
      ``,
      `The automated estimate CompNinja produced for the property: ${reportUrl}`,
      `It is an automated estimate, not an appraisal.`,
    ] : []),
    ``,
    `I'll leave it with the two of you from here. CompNinja is not a brokerage and takes no part in the opinion of value or anything that follows from it.`,
    ``,
    signature(sender),
  ];
  return {
    subject: `Introduction: ${clean(l.address, 120)} (${lf} and ${bf})`.slice(0, SUBJECT_MAX),
    text: lines.join("\n"),
  };
}

// The line the owner's acknowledgment gained: the manual reply always asked
// whether the number on the form was the right one to call.
function ackPhoneLine(phone) {
  const p = cleanPhone(phone);
  return p ? `The broker will have ${p} as the best number to reach you. If another is better, reply and tell us.` : "";
}

// ---------------------------------------------------------------------------
// An edit from the desk. The owner may change the address, the subject and
// the body before sending; nothing else. Returns { ok, patch } or
// { ok:false, error }. An address typed by the owner is their own statement,
// so its check becomes "manual" and it is never auto-sent.
// ---------------------------------------------------------------------------
function validateEdit(input) {
  const src = input || {};
  const patch = {};
  if (src.email !== undefined) {
    const e = cleanEmail(src.email);
    if (!e) return { ok: false, error: "That isn't an email address we can send to." };
    patch.email = e;
    patch.email_check = "manual";
  }
  if (src.subject !== undefined) {
    const s = clean(src.subject, SUBJECT_MAX);
    if (!s) return { ok: false, error: "The email needs a subject." };
    patch.subject = s;
  }
  if (src.body !== undefined) {
    const b = String(src.body == null ? "" : src.body).replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
    if (!b) return { ok: false, error: "The email is empty." };
    if (b.length > BODY_MAX) return { ok: false, error: `The email is too long (${BODY_MAX} characters at most).` };
    patch.body = b;
  }
  return { ok: true, patch };
}

// A broker the owner adds by hand.
function manualCandidate(input) {
  const src = input || {};
  const name = cleanName(src.name);
  if (!name) return { ok: false, error: "Type the broker's first and last name." };
  const email = src.email ? cleanEmail(src.email) : "";
  if (src.email && !email) return { ok: false, error: "That isn't an email address we can send to." };
  const phone = cleanPhone(src.phone);
  if (!email && !phone) return { ok: false, error: "Add an email address or a phone number." };
  return {
    ok: true,
    candidate: {
      name, firm: clean(src.firm, 120) || null, email: email || null, phone: phone || null,
      fit: null, license: null, source_url: null,
      email_check: email ? "manual" : "none", origin: "manual",
    },
  };
}

// Where a click on the accept link stands. `match` and `request` are stored
// rows (request may be null: a hand-added broker on a request never started).
//   "open"        offer it
//   "introduced"  this broker already has the introduction
//   "taken"       another broker has it, or the request is closed
function acceptState(match, request) {
  if (!match) return "invalid";
  if (match.status === "introduced") return "introduced";
  if (request && request.state === "closed") return "taken";
  const winner = request && request.introduced_match_id;
  if (winner && String(winner) !== String(match.id)) return "taken";
  if (match.status === "skipped") return "taken";
  return "open";
}

// What the desk's header and /admin's card count: things waiting on the owner.
function attention(matches) {
  const out = { toSend: 0, toIntroduce: 0 };
  for (const m of matches || []) {
    if (!m) continue;
    if (m.status === "draft" && m.email) out.toSend++;
    if (m.status === "accepted") out.toIntroduce++;
  }
  return out;
}

// A prefilled Gmail compose window, for sending by hand from the owner's own
// mailbox. `account` pins which signed-in Google account opens it.
function gmailComposeUrl({ to, subject, body, account }) {
  const q = [
    "view=cm", "fs=1",
    "to=" + encodeURIComponent(to || ""),
    "su=" + encodeURIComponent(subject || ""),
    "body=" + encodeURIComponent(body || ""),
  ];
  if (account) q.push("authuser=" + encodeURIComponent(account));
  return "https://mail.google.com/mail/?" + q.join("&");
}

module.exports = {
  MATCH_STATUSES, REQUEST_STATES, ORIGINS,
  MAX_CANDIDATES, BENCH_DAYS, MIN_BENCH, DESK_DAYS, FIT_MAX, BODY_MAX,
  AUTOPILOT_REST_DAYS, AUTOPILOT_PER_DAY,
  isStatus, isState,
  clean, cleanEmail, cleanPhone, cleanName, cleanFit, cleanUrl,
  emailCheck, canAutoSend, autopilotSafe, firstName, wordsFor,
  finderPrompt, parseCandidates, benchCandidates, cleanCandidate, candidateKey,
  keysOf, withoutKnown, mergeCandidates,
  parseSender, signature,
  outreachDraft, introDraft, ackPhoneLine,
  validateEdit, manualCandidate, acceptState, attention, gmailComposeUrl,
};
