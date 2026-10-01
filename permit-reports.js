"use strict";
// permit-reports.js — Nampa's permits, read from the reports the city
// publishes (2026-10-01, the owner's "add Nampa to the permit scraper").
//
// WHY REPORTS. Nampa's live portal (Tyler EnerGov, permit-portals.js's
// client) sits behind a load balancer that answers 403 to any agent that
// does not look like a web browser, our honest one included (tested
// 2026-10-01). Disguising the sweep was refused. The city's own website,
// cityofnampa.us, serves the same records as published reports to our named
// agent: its "Permit Reports" page links
//   - a MONTHLY "Commercial Permit - Plan Review Status" PDF: every
//     commercial application received that month, with its date in, the
//     status on the report's date, the project, address, applicant, scope of
//     work and stated value; and
//   - WEEKLY and MONTHLY "Permit Activity" PDFs: every permit ISSUED in the
//     period, with its issue date, address, project, scope, value and the
//     companies on it (applicant, owner, contractor), commercial and
//     residential.
// Together they give what the portals give for Boise and Meridian — a filing
// date and a status — a few weeks late.
//
// Pure: no I/O, no clock reads. pdf-text.js turns a PDF into positioned text;
// this file turns that into permits, and decides which reports to read and
// whose status wins.
//
// THE RULES
//  - A permit is stored only from a plan review row, because only that row
//    has the filing date (applied_date). An activity row updates a permit we
//    already have (it is issued, and who built it); one we never saw filed
//    (filed before the city's reports begin) is counted and left out.
//  - Every status carries the date it was TRUE on (`asOf`): the plan review
//    report's own date, or the issue date for an issued permit. A status only
//    ever replaces one that is older (statusIsNewer), so re-reading an old
//    report can never walk an issued permit back to "In Review".
//  - A filing date the city's system did not really record is no filing date:
//    the January 2026 report carries 2025 permits migrated into the new system
//    with a "Date In" of January 1 (a holiday), some of them issued months
//    before it. A date in on January 1, or after the permit's own issue date,
//    is dropped, and the permit with it.
//  - Nampa's reports have no permit type. The kind is read from the project
//    name and scope of work (kindOf): a tenant build-out, a new building, an
//    addition, or plain "Commercial" when the words do not say. Under-claim:
//    only words that mean it count, the badge rule.

const PT = require("./pdf-text");
// What a portal status MEANS (issued, open, ended), read one way everywhere.
const PULSE = require("./permit-pulse");

// ---------------------------------------------------------------------------
// The index page
// ---------------------------------------------------------------------------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "MM/DD/YYYY" or "M/D/YY" -> "YYYY-MM-DD", or null.
function isoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The Permit Reports page -> every report it links that we read, newest
// upload first: [{ kind: "plan"|"activity", id, url, label, month?, from?, to? }].
// The DocumentCenter id grows with each upload, so it orders by when the city
// posted a report, which is what "newest" has to mean for a batch posted late.
function parseReportIndex(html, base) {
  const origin = String(base || "https://www.cityofnampa.us").replace(/\/+$/, "");
  const out = new Map();
  const re = /<a\b[^>]*href="([^"]*\/DocumentCenter\/View\/(\d+)\/([^"?#]*))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const id = Number(m[2]);
    const slug = decodeURIComponent(m[3]).toLowerCase();
    const text = m[4].replace(/<[^>]+>/g, " ").replace(/&ndash;|&#8211;/g, "-").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const url = /^https?:/i.test(m[1]) ? m[1] : origin + (m[1].startsWith("/") ? "" : "/") + m[1];
    if (/plan-review-status/.test(slug)) {
      // The link text carries the year ("August 2026"); a slug may too.
      const words = `${text} ${slug.replace(/-/g, " ")}`.toLowerCase();
      const mi = MONTHS.findIndex((n) => new RegExp(`\\b${n}\\b`).test(words));
      const y = /\b(20\d\d)\b/.exec(words);
      if (mi < 0 || !y) continue;
      out.set(id, { kind: "plan", id, url, label: text || slug, month: `${y[1]}-${String(mi + 1).padStart(2, "0")}` });
    } else if (/permit-activity|activity-report/.test(slug)) {
      const d = /(\d{2})-(\d{2})-(\d{4})-+(\d{2})-(\d{2})-(\d{4})/.exec(slug);
      const entry = { kind: "activity", id, url, label: text || slug };
      if (d) { entry.from = `${d[3]}-${d[1]}-${d[2]}`; entry.to = `${d[6]}-${d[4]}-${d[5]}`; }
      else {
        const words = `${text} ${slug.replace(/-/g, " ")}`.toLowerCase();
        const mi = MONTHS.findIndex((n) => new RegExp(`\\b${n}\\b`).test(words));
        const y = /\b(20\d\d)\b/.exec(words);
        if (mi < 0 || !y) continue;
        entry.month = `${y[1]}-${String(mi + 1).padStart(2, "0")}`;
      }
      out.set(id, entry);
    }
  }
  return [...out.values()].sort((a, b) => b.id - a.id);
}

// Which reports a run reads. A weekday run: the NEWEST `newest` by upload
// (reports never change once posted, so only new ones carry news; a batch of
// late weeks posted together still fits). The backfill (`all`): every plan
// review report, the monthly activity reports for the months they cover, and
// the weekly ones only for months with no monthly report yet — the same
// permits, a third of the downloads.
const NEWEST = 6;
function pickReports(index, { all = false, newest = NEWEST, since = null } = {}) {
  const list = (Array.isArray(index) ? index : []).filter((r) => !since || String(r.month || r.to || "") >= since);
  if (!all) return list.slice(0, newest);
  const plans = list.filter((r) => r.kind === "plan");
  const monthly = list.filter((r) => r.kind === "activity" && r.month);
  const covered = new Set(monthly.map((r) => r.month));
  const weekly = list.filter((r) => r.kind === "activity" && r.from &&
    !(covered.has(r.from.slice(0, 7)) && covered.has(r.to.slice(0, 7))));
  return [...plans, ...monthly, ...weekly].sort((a, b) => b.id - a.id);
}

// ---------------------------------------------------------------------------
// The plan review report (a ruled table, landscape)
// ---------------------------------------------------------------------------
const PERMIT_NO = /^[A-Z]{2,5}-\d{3,6}-\d{4}$/;
const COLUMNS = [
  ["number", /application|permit\s*#/i],
  ["dateIn", /date\s*in/i],
  ["issueDate", /issue\s*date/i],
  ["status", /permit\s*status/i],
  ["project", /project\s*name/i],
  ["address", /^address/i],
  ["applicant", /contractor|applicant/i],
  ["scope", /scope/i],
  ["valuation", /valuation/i],
];

// A page's columns: the table's vertical rules, each band named from the
// header text that falls inside it. Without rules (a layout change), the
// header runs themselves mark the bands.
function planColumns(page, headerTop, headerBottom) {
  const header = page.items.filter((i) => i.top >= headerTop - 1 && i.top <= headerBottom + 1);
  let xs = [...new Set(page.vlines.filter((v) => v.top2 - v.top1 > 40).map((v) => Math.round(v.x)))].sort((a, b) => a - b);
  if (xs.length < 4) {
    const starts = [...new Set(header.map((i) => Math.round(i.x)))].sort((a, b) => a - b);
    xs = [0, ...starts.slice(1).map((x) => x - 4), page.width];
  }
  const bands = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const x1 = xs[k], x2 = xs[k + 1];
    if (x2 - x1 < 8) continue;
    const name = header.filter((i) => i.x >= x1 - 1 && i.x < x2 - 1).sort((a, b) => a.top - b.top || a.x - b.x).map((i) => i.str).join(" ");
    const hit = COLUMNS.find(([, re]) => re.test(name));
    bands.push({ x1, x2, key: hit ? hit[0] : null, name });
  }
  // "Application Permit #" also matches /applicant/ — the first band wins.
  const seen = new Set();
  for (const b of bands) { if (b.key && seen.has(b.key)) b.key = null; else if (b.key) seen.add(b.key); }
  return bands;
}

function money(s) {
  const n = Number(String(s || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && /\d/.test(String(s || "")) ? n : null;
}

// A plan review PDF Buffer (or the readPdf result) -> { asOf, rows }.
function parsePlanReview(pdf) {
  const doc = Buffer.isBuffer(pdf) ? PT.readPdf(pdf) : pdf;
  let asOf = null;
  const rows = [];
  for (const page of doc.pages) {
    const all = PT.lines(page);
    if (!asOf) {
      const t = all.find((l) => /plan review status/i.test(l.text));
      const d = t && /date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(t.text);
      if (d) asOf = isoDate(d[1]);
    }
    // The header is the block of lines between the title and the first row.
    const first = page.items.filter((i) => PERMIT_NO.test(i.str)).sort((a, b) => a.top - b.top)[0];
    if (!first) continue;
    const headerLines = all.filter((l) => l.top < first.top - 2 && /date in|project name|scope|valuation|address|status/i.test(l.text));
    if (!headerLines.length) continue;
    const bands = planColumns(page, headerLines[0].top, headerLines[headerLines.length - 1].top);
    const numBand = bands.find((b) => b.key === "number");
    if (!numBand) continue;
    const anchors = page.items.filter((i) => PERMIT_NO.test(i.str) && i.x >= numBand.x1 - 2 && i.x < numBand.x2).sort((a, b) => a.top - b.top);
    // The last row ends where the table's rules do; the page footer ("Page 1
    // of 6") sits below them, inside the applicant column's x range.
    const ruled = page.vlines.filter((v) => v.top2 - v.top1 > 40).map((v) => v.top2);
    const bottom = ruled.length ? Math.max(...ruled) + 2 : Math.max(...page.items.map((i) => i.top)) + 1;
    const cellItems = page.items.filter((i) => !/^Page \d+ of \d+$/i.test(i.str));
    anchors.forEach((a, k) => {
      const top = a.top - 2, end = k + 1 < anchors.length ? anchors[k + 1].top - 2 : bottom;
      const cell = {};
      for (const b of bands) {
        if (!b.key) continue;
        const parts = cellItems.filter((i) => i.top >= top && i.top < end && i.x >= b.x1 - 1 && i.x < b.x2 - 1)
          .sort((p, q) => p.top - q.top || p.x - q.x).map((i) => i.str);
        // The status cell is narrow enough to break a word ("Over-the-Cou" /
        // "nter Review"); a line that starts lower-case there continues one.
        cell[b.key] = (b.key === "status"
          ? parts.reduce((acc, x) => (acc && /[a-z]$/i.test(acc) && /^[a-z]/.test(x) ? acc + x : acc ? acc + " " + x : x), "")
          : parts.join(" ")).replace(/\s+/g, " ").trim();
      }
      const scope = cell.scope || "";
      rows.push({
        permit_number: a.str.toUpperCase(),
        date_in: isoDate(cell.dateIn),
        issue_date: isoDate(cell.issueDate),
        status: cell.status || null,
        project_name: cell.project || null,
        address: cell.address || null,
        applicant: cell.applicant || null,
        scope: scope || null,
        valuation: money(cell.valuation),
      });
    });
  }
  return { asOf, rows };
}

// ---------------------------------------------------------------------------
// The permit activity report (weekly or monthly; label: value records)
// ---------------------------------------------------------------------------
const LABELS = ["Tax Account:", "Urban Renewal Area:", "Unit:", "Permit Number:", "Situs:", "Issue Date:", "Project Name:", "Scope of Work:"];

// One line's "Label: value" pairs.
function pairs(line) {
  const out = {};
  let key = null;
  for (const it of line.items) {
    const label = LABELS.find((l) => it.str === l || it.str.startsWith(l + " "));
    if (label) {
      key = label.slice(0, -1);
      const rest = it.str.slice(label.length).trim();
      out[key] = rest ? [rest] : [];
      out[key + "@x"] = it.x;
      continue;
    }
    if (key) { out[key].push(it.str); if (out[key + "@vx"] == null) out[key + "@vx"] = it.x; }
  }
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = out[k].join(" ").trim();
  return out;
}

// A permit activity PDF -> { from, to, rows } (the Commercial section only).
function parseActivityReport(pdf) {
  const doc = Buffer.isBuffer(pdf) ? PT.readPdf(pdf) : pdf;
  let from = null, to = null, section = null;
  const rows = [];
  let rec = null, mode = null, cols = null;
  const close = () => { if (rec && rec.permit_number && section === "commercial") rows.push(finish(rec)); rec = null; mode = null; };
  for (const page of doc.pages) {
    for (const line of PT.lines(page)) {
      const text = line.text;
      const range = /^(\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})$/.exec(text);
      if (range) { if (!from) { from = isoDate(range[1]); to = isoDate(range[2]); } continue; }
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$|Page \d+ of \d+/.test(text) || /^C ITY OF|Department of Building Safety|Permit Activity Type Report|^500 12th Ave|^Office:|^Website/.test(text)) continue;
      const pt = /^Project Type:\s*(.+)$/.exec(text);
      if (pt) { close(); section = pt[1].trim().toLowerCase(); continue; }
      if (/^(Occupancy By Group|Structure Use):/.test(text) || /Permit\(s\)|Valuation (SubTotal|Total)/.test(text)) { close(); continue; }
      const p = pairs(line);
      if ("Tax Account" in p) {
        close();
        rec = { valuation: money((line.items[line.items.length - 1] || {}).str), contacts: [] };
        cols = { person: p["Urban Renewal Area@x"] != null ? p["Urban Renewal Area@x"] : 240, company: p["Unit@x"] != null ? p["Unit@x"] : 395 };
        continue;
      }
      if (!rec) continue;
      if ("Permit Number" in p) { rec.permit_number = p["Permit Number"]; if ("Situs" in p) rec.situs = p.Situs; mode = null; continue; }
      if ("Issue Date" in p) { rec.issue_date = isoDate(p["Issue Date"]); if ("Project Name" in p) { rec.project_name = p["Project Name"]; rec.projectX = p["Project Name@vx"]; mode = "project"; } continue; }
      if ("Scope of Work" in p) { rec.scope = p["Scope of Work"]; rec.scopeX = p["Scope of Work@vx"]; mode = "scope"; continue; }
      // A continuation: wrapped project name or scope (indented to its value),
      // or a contact line (a role at the left margin).
      const firstX = line.items[0].x;
      if (mode === "project" && rec.projectX != null && firstX >= rec.projectX - 2) { rec.project_name += " " + text; continue; }
      if (mode === "scope" && rec.scopeX != null && firstX >= rec.scopeX - 2 && firstX < cols.person - 2) { rec.scope += " " + text; continue; }
      mode = "contacts";
      const role = line.items.filter((i) => i.x < cols.person - 2).map((i) => i.str).join(" ");
      const person = line.items.filter((i) => i.x >= cols.person - 2 && i.x < cols.company + 2).map((i) => i.str).join(" ");
      const company = line.items.filter((i) => i.x >= cols.company + 2).map((i) => i.str).join(" ");
      const last = rec.contacts[rec.contacts.length - 1];
      if (!person && !company && last) last.roles += " " + role;
      else rec.contacts.push({ roles: role, person, company });
    }
  }
  close();
  return { from, to, rows };

  function finish(r) {
    const address = situsAddress(r.situs);
    const roles = (c, re) => re.test(c.roles);
    const contractor = r.contacts.find((c) => roles(c, /contractor/i) && c.company);
    const applicant = r.contacts.find((c) => roles(c, /applicant/i) && c.company);
    return {
      permit_number: String(r.permit_number || "").trim().toUpperCase(),
      issue_date: r.issue_date || null,
      address,
      project_name: (r.project_name || "").trim() || null,
      scope: (r.scope || "").trim() || null,
      valuation: r.valuation,
      applicant_company: applicant ? applicant.company.trim() : null,
      contractor_company: contractor ? contractor.company.trim() : null,
    };
  }
}

// "993 S Almond St Nampa, Id 83686" -> "993 S Almond St, Nampa, ID 83686", so
// the street line (everything before the first comma, permit-filings.js's
// match key) is the street alone, as a firm's board carries it. The city is
// the report's own (a street can end in a word that looks like a city).
function situsAddress(s, city = "Nampa") {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const c = String(city || "").replace(/[^A-Za-z .'-]/g, "");
  const m = new RegExp(`^(.*\\S)\\s+(${c}),\\s*(?:Id|ID|Idaho)\\s+(\\d{5}(?:-\\d{4})?)$`, "i").exec(t);
  return m ? `${m[1]}, ${c}, ID ${m[3]}` : t;
}

// ---------------------------------------------------------------------------
// What a permit is, and which status wins
// ---------------------------------------------------------------------------
// The kind, from the words — or null, which means the sweep does not store
// it. Boise's and Meridian's sweeps read only some permit types (new and
// added buildings, shells, additions, tenant improvements, racking, modular
// buildings: permit-portals.js's discovery lists); Nampa's report lists every
// commercial permit, re-roofs, fences, demolitions, signs and "occupancy only,
// no work" included. Storing those would make Nampa's "filed a month" count
// work the other two cities never count, so a permit is stored only when its
// words name one of the same kinds. The labels are the portals' own, so
// permit-pulse.js groups them with no Nampa rule ("Tenant Improvement" is a
// build-out; "New Commercial", "Commercial Addition" and "Commercial
// Modular" are new buildings; "Rack/Shelving" is other). Under-claim: a
// permit whose words do not say is left out, never guessed into a kind.
const NOT_WORK = /\b(occupancy only|seeking (a )?(certificate of )?occupancy|moving in as[- ]is|move in as[- ]is|moving in\.|as is with no|no (tenant )?improvements?|no (new )?work|no construction|no remodel|name change|change of (use|occupancy) only|solar|pergola|patio covers?|carports?|shade structure|temporary tents?)\b/i;
// Multi-family housing: off in Boise's and Meridian's sweeps on purpose
// (permit-portals.js's registry), and Nampa files apartments, 4-plexes and
// residential care homes as commercial permits, so they are left out here
// too or Nampa would count homes the other two cities never count.
const MULTIFAMILY = /\bapartments?\b|\b\d-?plex(es)?\b|\bquadra?plex(es)?\b|\btri-?plex(es)?\b|\bmulti-?family\b|\bwalk[- ]?up\b|\bdwelling\b|\bresidential care\b|\btownhomes?\b|\btownhouses?\b/i;
// The buildings a "new …" or "construction of …" has to name.
const BUILDING_NOUN = "(buildings?|warehouses?|stores?|apartments?|\\d-?plex(es)?|four-?plex(es)?|duplex(es)?|shops?|facility|car wash|restaurant|church|school|hotel|clubhouse)";
const KIND_RULES = [
  ["Rack/Shelving", /\b(pallet|storage|high[- ]pile[d]?|cantilever|selective|steel)[- ]rack|\bracking\b|\bstorage racks?\b|\bshelving\b/i, /\b(no|possible|future) racking\b|\bracking in the future\b/i],
  ["Commercial Modular", /\bmodular\b|\b(temp(orary)?|construction|mobile)\s+(\w+\s+)?(office\s+)?(trailers?|office|unit)\b|\b(sales|office|construction|toilet)\s+trailers?\b|\btemporary (display|sales) unit\b/i],
  ["Tenant Improvement", new RegExp([
    /\btenant improvement|\bT\.?I\.?\b|\bvanilla\b|\bbuild[- ]?out\b|\bfinish[- ]out\b|\bupfit\b|\btenant (finish|fit|expansion)/,
    /\b(demising|dividing|partition) walls?\b|\binterior partitions?\b|\balter(ing|ations?)\b/,
    /\binterior (remodel|alteration|improvement|renovation|finish|construction)|\bremodel|\brenovat(e|ion)\b/,
    // "Build small office with restroom and mezzanine in warehouse unit"
    /\b(build|construct)\s+(an? |new |small |\d+ )*(offices?|mezzanine)\b/,
  ].map((r) => r.source).join("|"), "i")],
  ["Commercial Addition", /\baddition\b/i],
  ["New Commercial", new RegExp([
    /\bnew (commercial )?(construction|structure)\b|\bnew build\b|\bground[- ]up\b|\bPEMB\b|\bpre-?engineered (metal )?building\b/.source,
    /\bnew shell\b|\bshell only\b|\bcore (and|&) shell\b/.source,
    // "New AutoZone Auto Parts Store", "A new 3,000 s.f. pre-engineered building"
    // ("Add new door to the store" is not one.)
    `\\bnew\\s+(?!doors?\\b|windows?\\b|signs?\\b)([\\w.,'’&/-]+\\s+){0,4}?${BUILDING_NOUN}\\b`,
    // "Construction of a new 7,745 sq.ft. masonry and structural steel auto parts store"
    `\\b(construct(ion|ing)?( of)?|erect(ion of)?|build(ing)? of)\\s+(a |an |one |two |three |\\(?\\d+\\)? )?(new )?([\\w.,'’/-]+\\s+){0,9}?${BUILDING_NOUN}\\b`,
    // "4-Plex multifamily housing apartment building", "5-unit Apartment"
    /\b\d-?plex(es)?\b|\bquadra?plex(es)?\b|\b\d+-unit apartment/.source,
    /\b(one|two|three|four|five|\d+)[- ]stor(y|ies)\b[^.]{0,60}\b(building|apartment|walk[- ]?up)/.source,
  ].join("|"), "i")],
];
function kindOf(projectName, scope) {
  const words = `${projectName || ""} ${scope || ""}`;
  if (NOT_WORK.test(words) || MULTIFAMILY.test(words)) return null;
  // A civil / site-only permit rides beside the building's own permit;
  // counting both would count one project twice.
  if (/\bcivil\b|\bsite (work )?only\b/i.test(projectName || "")) return null;
  const hit = KIND_RULES.find(([, re, not]) => re.test(words) && !(not && not.test(words)));
  return hit ? hit[0] : null;
}

// Is (status, asOf) newer than what is stored? A stored row with no asOf is
// older than any dated one; two undated statuses compare as not newer.
function statusIsNewer(incomingAsOf, storedAsOf) {
  if (!incomingAsOf) return false;
  if (!storedAsOf) return true;
  return String(incomingAsOf).slice(0, 10) >= String(storedAsOf).slice(0, 10);
}

// Does an incoming status replace the stored one? Mostly "is it newer", with
// the two exceptions the reports force:
//  - an ISSUE is an event, a plan review status a snapshot: a permit the
//    activity report lists as issued on Sep 2 is issued even if a plan review
//    report dated Sep 3 still printed "In Review" (the snapshot missed it);
//  - an issued permit is never walked back to a step before it — only a newer
//    void, withdrawal or expiry (permit-watch.js's "ended") ends it.
// The status words are read the market section's way (permit-pulse.js).
function shouldReplaceStatus(stored, incoming) {
  const s = stored || {}, n = incoming || {};
  if (!n.status || n.status === s.status) return false;
  if (!s.status) return true;
  const was = PULSE.stateOf(s.status), now = PULSE.stateOf(n.status);
  if (was === "issued" && now === "open") return false;
  if (now === "issued" && was === "open") return true;
  return statusIsNewer(n.asOf, s.asOf);
}

// The company named on a plan review row: "Person, Company" -> "Company".
function companyOf(contact) {
  const s = String(contact || "").trim();
  if (!s) return null;
  const i = s.lastIndexOf(",");
  const c = (i >= 0 ? s.slice(i + 1) : s).trim();
  return c || null;
}

// A filing date the city's system did not really record (see the header).
function realDateIn(row) {
  const d = row && row.date_in;
  if (!d) return null;
  if (/-01-01$/.test(d)) return null;
  if (row.issue_date && row.issue_date < d) return null;
  return d;
}

// Read reports -> one record per permit, ready for the table, plus the
// counts a sweep summary carries. `plans`: [{ asOf, rows, url }], `activity`:
// [{ from, to, rows, url }].
function mergeReports({ plans = [], activity = [] } = {}) {
  const byNo = new Map();
  const tally = { planRows: 0, activityRows: 0, droppedDates: 0, intakeFailed: 0, otherWork: 0, issuedUnfiled: 0 };
  const sortedPlans = plans.slice().sort((a, b) => String(a.asOf || "").localeCompare(String(b.asOf || "")));
  for (const p of sortedPlans) {
    for (const r of p.rows || []) {
      tally.planRows += 1;
      const applied = realDateIn(r);
      if (!applied) { tally.droppedDates += 1; continue; }
      // Refused at intake, as of the report: most come back under a new
      // number (The Highline's March buildings were refiled in April), so
      // counting these would count a project twice.
      if (/intake failed/i.test(r.status || "")) { tally.intakeFailed += 1; continue; }
      const kind = kindOf(r.project_name, r.scope);
      if (!kind) { tally.otherWork += 1; continue; }
      const issued = /\b(issued|complete|finaled?)\b/i.test(r.status || "") && r.issue_date;
      const prev = byNo.get(r.permit_number);
      const asOf = issued ? r.issue_date : p.asOf;
      const next = {
        permit_number: r.permit_number,
        applied_date: applied,
        project_name: r.project_name,
        description: r.scope,
        address: r.address,
        applicant_company: companyOf(r.applicant),
        contractor_company: null,
        permit_type: kind,
        status: r.status,
        status_as_of: asOf || p.asOf,
        source_url: p.url || null,
        valuation: r.valuation,
      };
      // A later report about the same permit (rare) wins only when it is newer.
      if (!prev || statusIsNewer(next.status_as_of, prev.status_as_of)) byNo.set(r.permit_number, { ...prev, ...next });
    }
  }
  const sortedActivity = activity.slice().sort((a, b) => String(a.to || "").localeCompare(String(b.to || "")));
  const issuedOnly = new Map();
  for (const a of sortedActivity) {
    for (const r of a.rows || []) {
      tally.activityRows += 1;
      const prev = byNo.get(r.permit_number);
      if (!prev) { issuedOnly.set(r.permit_number, r); continue; }
      prev.contractor_company = r.contractor_company || prev.contractor_company;
      prev.applicant_company = prev.applicant_company || r.applicant_company;
      prev.address = /,|\bid\b \d{5}/i.test(r.address || "") ? r.address : prev.address;
      if (r.issue_date && shouldReplaceStatus({ status: prev.status, asOf: prev.status_as_of }, { status: "Issued", asOf: r.issue_date })) {
        prev.status = "Issued";
        prev.status_as_of = r.issue_date;
      }
    }
  }
  tally.issuedUnfiled = issuedOnly.size;
  // The issued rows no plan review row in this read explains, newest last.
  return { permits: [...byNo.values()], tally, issued: [...issuedOnly.values()] };
}

module.exports = {
  NEWEST, MONTHS, KIND_RULES, NOT_WORK, MULTIFAMILY,
  isoDate, situsAddress, parseReportIndex, pickReports, parsePlanReview, parseActivityReport,
  kindOf, statusIsNewer, shouldReplaceStatus, companyOf, realDateIn, mergeReports,
};
