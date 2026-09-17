// permit-portals.js — clients for the city permit portals the permit sweep
// reads, and the registry of which cities those are.
//
// Ported 2026-09-16 from the owner's separate permit tracker
// (agouraninja-cmd/adler-permit-tracker: scrapers/accela.js,
// scrapers/energov.js, jurisdictions.js, and the filters in discovery.js),
// which verified every selector and body shape below against the live
// portals between 2026-07-28 and 2026-08-10. Spec:
// docs/superpowers/specs/2026-09-16-permit-signals-design.md.
//
// PURE ON PURPOSE. Nothing in this file touches the network on its own: every
// function that would takes `deps.fetch` (and `deps.sleep`), which is what
// lets npm test replay captured portal responses with no network — the
// city-check.js / market-hero-judge.js shape. server.js owns the real fetch,
// the politeness pause, the sweep loop and the writes.
//
// Two platforms, two very different portals:
//
//  * Accela CitizenAccess (Boise, Meridian) is classic ASP.NET WebForms. Every
//    postback must replay the WHOLE form field set — posting only a few
//    fields lands on Error.aspx — so harvestForm() reads every named input
//    and select off the search page and the POST sends them all back with a
//    handful overridden. Results come back as HTML: a detail page for an
//    exact hit, a results grid for several, or a "returned no results" line.
//  * Tyler EnerGov Self Service (Nampa) is a JSON API with no login and no
//    cookies; the tenant rides in plain request headers. The search body
//    template was captured verbatim from the SPA's own request (2026-07-28)
//    because rebuilding it from the criteria endpoint 500s — do not slim it
//    down without re-verifying against the live portal.
//
// Every parser here is exported so a test can pin it against a fixture, and
// every "portal-changed" throw names what stopped matching, because the
// failure this code will actually have is a redesign, and a redesign that
// reads as "no filings this week" is the failure the spec's §7 exists to make
// visible.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CompNinjaPermitSweep/1.0";

// ---------------------------------------------------------------------------
// The registry. Adding a city is one entry here (plus a client above if it
// is a new platform). `state` is what marketOf() reads to file the city's
// filings under the same "City, ST" key the corpus and the firm's buildings
// use; `county` selects the parcel layer permit-zoning.js can ask (only
// "ada" is wired — Canyon County has no equivalent service, so Nampa keeps
// the keyword fallback).
//
// `discovery.types` are the Accela permit-type dropdown values scanned per
// sweep — one search POST each, the dropdown being single-select — harvested
// live 2026-07-29. Multi-family types are deliberately off on both cities;
// each is a one-line add. EnerGov has no type list, so Nampa's CaseType
// strings are filtered by keepEnergovRow() below.
// ---------------------------------------------------------------------------
const JURISDICTIONS = Object.freeze({
  boise: Object.freeze({
    key: "boise",
    label: "Boise",
    state: "ID",
    platform: "accela",
    county: "ada",
    base: "https://permits.cityofboise.org/CitizenAccess",
    module: "Building",
    tabName: "Building",
    portalUrl: "https://permits.cityofboise.org/CitizenAccess/Cap/CapHome.aspx?module=Building&TabName=Building",
    discovery: Object.freeze({
      types: Object.freeze([
        { value: "Building/Building/502-New or Added Commercial/NA", label: "New/Added Commercial" },
        { value: "Building/Building/514-Commercial Modular Bld/NA", label: "Commercial Modular" },
        { value: "Building/Building/516-Commercial Rack-Shelving/NA", label: "Rack/Shelving" },
        { value: "Building/Building/518-520-Tenant Improvement/NA", label: "Tenant Improvement" },
      ]),
    }),
  }),
  meridian: Object.freeze({
    key: "meridian",
    label: "Meridian",
    state: "ID",
    platform: "accela",
    county: "ada",
    base: "https://aca-prod.accela.com/MERIDIAN",
    module: "Dev-Services",
    tabName: "Home",
    portalUrl: "https://aca-prod.accela.com/MERIDIAN/Cap/CapHome.aspx?module=Dev-Services&TabName=Home",
    discovery: Object.freeze({
      types: Object.freeze([
        { value: "Dev-Services/DS Commercial/New/NA", label: "New Commercial" },
        { value: "Dev-Services/DS Commercial/New/Shell Only", label: "Commercial Shell Only" },
        { value: "Dev-Services/DS Commercial/Tenant Improvement/NA", label: "Tenant Improvement" },
        { value: "Dev-Services/DS Commercial/Additions/NA", label: "Commercial Addition" },
      ]),
    }),
  }),
  nampa: Object.freeze({
    key: "nampa",
    label: "Nampa",
    state: "ID",
    platform: "energov",
    county: "canyon",
    // NOT SWEPT as of 2026-09-16. The Tyler host now sits behind an AWS load
    // balancer that answers 403 to any user agent naming a bot (measured: the
    // tracker's own "AdlerPermitTracker/1.0" is refused, a browser string is
    // served). Disguising this sweep as a browser to get past a filter the
    // operator chose is not a call this code makes on its own; the client and
    // its tests stay so the city can be switched back on the day the owner
    // decides, or the day the portal answers a named agent again.
    sweep: false,
    blocked: "portal answers 403 to a non-browser user agent (awselb, 2026-09-16)",
    base: "https://nampaid-energovpub.tylerhost.net",
    tenant: "NampaIDProd",
    tenantId: 1,
    portalUrl: "https://nampaid-energovpub.tylerhost.net/Apps/SelfService#/search",
    discovery: Object.freeze({}),
  }),
});

const JURISDICTION_KEYS = Object.freeze(Object.keys(JURISDICTIONS));
// The cities a sweep actually reads: every entry not switched off above.
const SWEEP_KEYS = Object.freeze(JURISDICTION_KEYS.filter((k) => JURISDICTIONS[k].sweep !== false));

function getJurisdiction(key) {
  return JURISDICTIONS[String(key || "").toLowerCase()] || null;
}

// The sweep's face takes a key OR an entry, so a caller that re-pointed an
// entry with withOrigin() can hand the result straight in.
function resolveJurisdiction(keyOrEntry) {
  if (keyOrEntry && typeof keyOrEntry === "object") return keyOrEntry.key ? keyOrEntry : null;
  return getJurisdiction(keyOrEntry);
}

// The "City, ST" string a city's filings are filed under. Passed through the
// caller's marketOf() so it is byte-identical to the corpus / vault key.
function marketLabel(j) {
  return j ? `${j.label}, ${j.state}` : "";
}

// Test-only: re-point every portal at one origin (the RESEND_API_URL /
// CENSUS_API_URL precedent). Paths are preserved, so a stub server routes on
// them; the original hosts survive in `portalUrl` for display. Never called
// in production — server.js reads PERMIT_PORTAL_ORIGIN and passes the result
// in; an unset env means this is never reached.
function withOrigin(j, origin) {
  if (!j || !origin) return j;
  const o = String(origin).replace(/\/+$/, "");
  const swap = (url) => {
    try { const u = new URL(url); return o + u.pathname + u.search; } catch (_) { return url; }
  };
  return Object.freeze({ ...j, base: swap(j.base) });
}

// ---------------------------------------------------------------------------
// Accela (Boise, Meridian)
// ---------------------------------------------------------------------------

function collectCookies(res, jar) {
  const h = res && res.headers;
  const set = h && typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  for (const c of set) {
    const [pair] = String(c).split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// Every named <input> and <select> on the page, so the postback can replay
// the whole form (hidden fields carry the ASP.NET state). Submit/button/image
// inputs are skipped, as are unchecked checkboxes and radios, exactly as a
// browser would leave them out.
function harvestForm(html) {
  const fields = {};
  let m;
  const inputRe = /<input\b[^>]*>/gi;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]+)"/) || [])[1];
    if (!name) continue;
    const type = ((tag.match(/type="([^"]+)"/) || [])[1] || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "image") continue;
    if ((type === "checkbox" || type === "radio") && !/\schecked\b/i.test(tag)) continue;
    fields[name] = (tag.match(/value="([^"]*)"/) || [])[1] || "";
  }
  const selectRe = /<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  while ((m = selectRe.exec(html))) {
    const [, name, body] = m;
    // The selected option, else the first — read attribute-order-blind. The
    // search page writes `selected="selected" value="…"` and the RESULT page
    // writes `value="…" selected="selected"` (measured 2026-09-16); an
    // order-bound match read the result page's type dropdown as its first
    // option, and the pager postback then asked for the wrong type.
    const options = [...body.matchAll(/<option\b([^>]*)>/gi)];
    const chosen = options.find((o) => /\sselected\b/i.test(o[1])) || options[0];
    fields[name] = chosen ? ((chosen[1].match(/value="([^"]*)"/) || [])[1] || "") : "";
  }
  return fields;
}

function usToIsoDate(mdY) {
  const m = String(mdY || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}
function isoToUsDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

function accelaSearchUrl(j) {
  return `${j.base}/Cap/CapHome.aspx?module=${j.module}&TabName=${j.tabName}`;
}

// GET the search page, replay the whole form with `overrides`, return the
// response's { html, url, jar }. Shared by the status check and discovery.
async function accelaPostSearch(overrides, j, deps) {
  const f = deps.fetch;
  const SEARCH_URL = accelaSearchUrl(j);
  const jar = {};
  const r1 = await f(SEARCH_URL, { headers: { "User-Agent": UA } });
  collectCookies(r1, jar);
  if (!r1.ok) throw new Error(`portal-error: search page returned ${r1.status}`);
  const page = await r1.text();

  const fields = harvestForm(page);
  if (!fields["__VIEWSTATE"]) {
    throw new Error("portal-changed: no __VIEWSTATE on search page (redesign?)");
  }
  fields["__EVENTTARGET"] = "ctl00$PlaceHolderMain$btnNewSearch";
  fields["__EVENTARGUMENT"] = "";
  Object.assign(fields, overrides);

  const r2 = await f(SEARCH_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookieHeader(jar),
      "Referer": SEARCH_URL,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: "follow",
  });
  if (!r2.ok) throw new Error(`portal-error: search POST returned ${r2.status}`);
  if (/Error\.aspx/i.test(String(r2.url || ""))) {
    throw new Error("portal-error: search POST landed on Error.aspx");
  }
  return { html: await r2.text(), url: String(r2.url || SEARCH_URL), jar };
}

// The status of ONE record by number: { found, status }. Exact matches
// redirect straight to the detail page; several matches render a grid, and
// only the row whose number equals ours counts.
function parseAccelaStatus(html, wanted) {
  const detail = html.match(/id="ctl00_PlaceHolderMain_lblRecordStatus"[^>]*>([^<]*)</);
  if (detail) {
    const status = decodeEntities(detail[1]).trim();
    return { found: true, status: status || "(blank)" };
  }
  if (/returned no results/i.test(html)) return { found: false };
  const rows = [...html.matchAll(/gdvPermitList_(ctl\d+)_lblPermitNumber1"[^>]*>([^<]*)</g)];
  for (const [, ctl, num] of rows) {
    if (decodeEntities(num).trim().toUpperCase() === String(wanted).toUpperCase()) {
      const s = html.match(new RegExp(`gdvPermitList_${ctl}_lblStatus"[^>]*>([^<]*)<`));
      if (s) {
        const status = decodeEntities(s[1]).trim();
        return { found: true, status: status || "(blank)" };
      }
    }
  }
  if (rows.length > 0) return { found: false };
  throw new Error("portal-changed: response was neither detail page, results grid, nor no-results");
}

async function fetchAccelaStatus(permitNumber, j, deps) {
  const wanted = String(permitNumber || "").trim();
  if (!wanted) throw new Error("no permit number given");
  const { html } = await accelaPostSearch({
    "ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber": wanted,
  }, j, deps);
  return parseAccelaStatus(html, wanted);
}

// Results grid -> plain rows. Cell ids verified live 2026-07-29:
// lblUpdatedTime (date), lblPermitNumber1 (inside the hlPermitNumber link),
// lblStatus, lblDescription, lblProjectName, lblAddress / lblPermitAddress.
function parseAccelaGrid(html, base) {
  const rows = [];
  const ctls = [...new Set([...html.matchAll(/gdvPermitList_(ctl\d+)_lblPermitNumber1"/g)].map((m) => m[1]))];
  const cell = (ctl, id) => {
    const m = html.match(new RegExp(`gdvPermitList_${ctl}_${id}"[^>]*>([^<]*)<`));
    return m ? decodeEntities(m[1]).trim() : "";
  };
  for (const ctl of ctls) {
    const hrefM = html.match(new RegExp(`id="[^"]*gdvPermitList_${ctl}_hlPermitNumber"[^>]*href="([^"]+)"`));
    const href = hrefM ? decodeEntities(hrefM[1]) : "";
    let detailUrl = "";
    if (href) { try { detailUrl = new URL(href, base + "/").href; } catch (_) { detailUrl = ""; } }
    rows.push({
      permit_number: cell(ctl, "lblPermitNumber1"),
      status: cell(ctl, "lblStatus"),
      description: cell(ctl, "lblDescription"),
      project_name: cell(ctl, "lblProjectName"),
      address: cell(ctl, "lblAddress") || cell(ctl, "lblPermitAddress"),
      applied_date: usToIsoDate(cell(ctl, "lblUpdatedTime")),
      ref: { detailUrl },
    });
  }
  return rows;
}

// Visible text of a labeled section on a CapDetail page. The summary blocks
// render as <span id="..._label_xxx">Label:</span> followed by a small table
// whose first cell is an empty spacer (class td_child_left); the content is
// in the cell after it.
function detailSectionText(html, labelRe) {
  const m = html.match(labelRe);
  if (!m) return "";
  const section = html.slice(m.index, m.index + 2500);
  const cellM = section.match(/td_child_left[^>]*>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  const raw = cellM ? cellM[1] : "";
  return stripFootnote(decodeEntities(raw.replace(/<[^>]+>/g, " ")));
}

// The portal renders a blue asterisk after some values as a footnote marker
// ("3468 CENTREPOINT *", "Parcel Number:R2598270010 *"). It is not part of
// the value.
function stripFootnote(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
}

// The work-location block on a detail page prints the street in a bold span
// and the city/state on the line after it with no comma between them —
// "8000 S FEDERAL WAY" then "Boise ID" — while the results grid prints
// "8000 S FEDERAL WAY, Boise ID 83716". Both must yield the same street
// line, so the two are rejoined with a comma here; a block with only the
// street (Meridian, measured 2026-09-16) yields the street alone.
function detailAddress(html) {
  const m = html.match(/label_address/i);
  if (!m) return "";
  const section = html.slice(m.index, m.index + 2500);
  const cellM = section.match(/td_child_left[^>]*>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (!cellM) return "";
  const cell = cellM[1];
  const bold = cell.match(/<span[^>]*fontbold[^>]*>([\s\S]*?)<\/span>/i);
  if (!bold) return stripFootnote(decodeEntities(cell.replace(/<[^>]+>/g, " ")));
  const street = stripFootnote(decodeEntities(bold[1].replace(/<[^>]+>/g, " ")));
  const tail = stripFootnote(decodeEntities(cell.replace(bold[0], " ").replace(/<[^>]+>/g, " ")));
  return tail ? `${street}, ${tail}` : street;
}

// One record read off its own detail page (the exact-hit redirect case).
function parseAccelaDetail(html, url) {
  const num = html.match(/id="ctl00_PlaceHolderMain_lblPermitNumber"[^>]*>([^<]*)</);
  const status = html.match(/id="ctl00_PlaceHolderMain_lblRecordStatus"[^>]*>([^<]*)</);
  return {
    permit_number: num ? decodeEntities(num[1]).trim() : "",
    status: status ? decodeEntities(status[1]).trim() : "",
    description: detailSectionText(html, />Project Description:</i),
    project_name: detailSectionText(html, />Project Name:</i),
    address: detailAddress(html),
    applied_date: "",
    ref: { detailUrl: url },
  };
}

// Parcel number from a detail page's "Parcel Information" block, e.g.
//   Parcel Number:R2598270010 * Block:01 Lot:01 Subdivision:EVEREST SUB
// (the asterisk is a footnote marker the portal renders inline). "" when
// absent. Feeds the Ada County zoning lookup in permit-zoning.js.
function parseParcelNumber(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/Parcel\s*Number:?\s*\*?\s*([A-Z0-9]{8,20})/i);
  return m ? m[1].toUpperCase() : "";
}

// Applicant / contractor / parcel number off a detail page. Verified live
// 2026-07-29 (Boise): the summary block's contact spans carry semantic
// classes — <span class='contactinfo_businessname'>Micron Technology,
// Inc.</span> under an <span id="..._label_applicant...">Applicant:</span>.
// {} for anything missing; never throws.
function parseAccelaCompanies(html) {
  const sectionCompany = (labelRe) => {
    const m = html.match(labelRe);
    if (!m) return "";
    const section = html.slice(m.index, m.index + 2500);
    const biz = section.match(/contactinfo_businessname'?"?[^>]*>([^<]*)</);
    if (biz && biz[1].trim()) return decodeEntities(biz[1]).trim();
    const first = section.match(/contactinfo_firstname'?"?[^>]*>([^<]*)</);
    const last = section.match(/contactinfo_lastname'?"?[^>]*>([^<]*)</);
    const person = [first && first[1], last && last[1]]
      .map((s) => decodeEntities(s || "").trim()).filter(Boolean).join(" ");
    if (person) return person;
    // Meridian's "Licensed Professional" block carries no classed spans at
    // all (measured 2026-09-16): plain lines separated by <br/> — an email,
    // then the company, then the street. The first line that is not an
    // email address is the name.
    const cellM = section.match(/td_child_left[^>]*>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!cellM) return "";
    const lines = cellM[1].split(/<br\s*\/?>/i)
      .map((l) => decodeEntities(l.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
      .filter((l) => l && !/@/.test(l));
    return lines[0] || "";
  };
  const out = {};
  const applicant = sectionCompany(/>Applicant:</);
  const contractor = sectionCompany(/>(?:Licensed Professional|Contractor)s?:</i);
  if (applicant) out.applicant_company = applicant;
  if (contractor) out.contractor_company = contractor;
  const parcel = parseParcelNumber(html);
  if (parcel) out.parcel_number = parcel;
  return out;
}

async function fetchAccelaCompanies(detailUrl, j, deps) {
  try {
    if (!detailUrl) return {};
    const res = await deps.fetch(detailUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok || /Error\.aspx/i.test(String(res.url || ""))) return {};
    return parseAccelaCompanies(await res.text());
  } catch (_) {
    return {};
  }
}

// Every record of the configured types opened in [from, to] (ISO dates).
// Returns { rows, truncated }: truncated when a grid rendered a pager (only
// the first page is read; a few days' window makes that unlikely, and the
// sweep reports it rather than pretending the page was the whole answer).
async function discoverAccela({ from, to }, j, deps) {
  const types = (j.discovery && j.discovery.types) || [];
  const sleep = deps.sleep || (async () => {});
  const all = [];
  let truncated = false;

  for (let i = 0; i < types.length; i++) {
    if (i > 0) await sleep();
    const type = types[i];
    const { html, url } = await accelaPostSearch({
      "ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber": "",
      "ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate": isoToUsDate(from),
      "ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate": isoToUsDate(to),
      "ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType": type.value,
    }, j, deps);

    if (/CapDetail\.aspx/i.test(url)) {
      all.push({ ...parseAccelaDetail(html, url), permit_type: type.label });
      continue;
    }
    if (/returned no results/i.test(html)) continue;

    const rows = parseAccelaGrid(html, j.base);
    if (rows.length === 0) {
      // Zero results is not always announced: Meridian sometimes re-renders
      // the plain search form with no message (seen live 2026-07-29). Only a
      // page that ALSO lost the search form counts as a redesign.
      if (/txtGSPermitNumber/.test(html)) continue;
      throw new Error("portal-changed: date search was neither grid, detail page, nor no-results");
    }
    for (const r of rows) all.push({ ...r, permit_type: type.label });

    // Accela pages its grid (Meridian at ten rows — a 7-day tenant-improvement
    // search overflowed it, measured 2026-09-16). "Next" is a postback
    // against the RESULT page's own form, so it is replayed the same way the
    // search was, up to MAX_PAGES; only hitting the cap counts as truncated.
    let pageHtml = html;
    let pages = 1;
    let target = nextPageTarget(pageHtml);
    while (target && pages < MAX_PAGES) {
      await sleep();
      pageHtml = await accelaPostback(pageHtml, target, j, deps);
      pages += 1;
      for (const r of parseAccelaGrid(pageHtml, j.base)) all.push({ ...r, permit_type: type.label });
      target = nextPageTarget(pageHtml);
    }
    if (target) truncated = true;
  }

  const seen = new Set();
  const rows = all.filter((r) => {
    const k = String(r.permit_number || "").toUpperCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { rows, truncated };
}

const MAX_PAGES = 5;

// The __doPostBack target of the pager's "Next" link, or "" on the last (or
// only) page. The pagination table renders on a single page too (with just
// a "1"), so its presence proves nothing — only a Next ANCHOR does.
function nextPageTarget(html) {
  const m = String(html || "").match(
    /__doPostBack\(&#39;([^&]+)&#39;,&#39;&#39;\)"[^>]*>\s*Next\s*&gt;/i
  );
  return m ? m[1] : "";
}

// Replay a result page's own form with __EVENTTARGET set — how every grid
// control (paging, sorting) is driven on this platform.
async function accelaPostback(pageHtml, target, j, deps) {
  const SEARCH_URL = accelaSearchUrl(j);
  const fields = harvestForm(pageHtml);
  if (!fields["__VIEWSTATE"]) throw new Error("portal-changed: no __VIEWSTATE on result page");
  fields["__EVENTTARGET"] = target;
  fields["__EVENTARGUMENT"] = "";
  const r = await deps.fetch(SEARCH_URL, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Referer": SEARCH_URL },
    body: new URLSearchParams(fields).toString(),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`portal-error: pager POST returned ${r.status}`);
  return r.text();
}

// Harvest the record-type dropdown (a maintenance helper for adding a city:
// the values in JURISDICTIONS came from this).
async function listAccelaPermitTypes(j, deps) {
  const res = await deps.fetch(accelaSearchUrl(j), { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`portal-error: search page returned ${res.status}`);
  const html = await res.text();
  const sel = html.match(/<select[^>]*name="[^"]*ddlGSPermitType[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
  if (!sel) throw new Error("portal-changed: no ddlGSPermitType dropdown on search page");
  return [...sel[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</g)]
    .map(([, value, label]) => ({ value: decodeEntities(value), label: decodeEntities(label).trim() }))
    .filter((o) => o.value);
}

// ---------------------------------------------------------------------------
// EnerGov (Nampa)
// ---------------------------------------------------------------------------

const paged = { PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false };

// The SPA's own search request, verbatim. SearchModule 1 = global keyword
// search, FilterModule 2 = permits only; with SearchModule 2 the server reads
// paging from PermitCriteria instead (which discovery below relies on).
function energovSearchBody(keyword) {
  return {
    Keyword: keyword, ExactMatch: true, SearchModule: 1, FilterModule: 2, SearchMainAddress: false,
    PlanCriteria: { PlanNumber: null, PlanTypeId: null, PlanWorkclassId: null, PlanStatusId: null, ProjectName: null, ApplyDateFrom: null, ApplyDateTo: null, ExpireDateFrom: null, ExpireDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, Description: null, SearchMainAddress: false, ContactId: null, ParcelNumber: null, TypeId: null, WorkClassIds: null, ExcludeCases: null, EnableDescriptionSearch: false, ...paged },
    PermitCriteria: { PermitNumber: null, PermitTypeId: "none", PermitWorkclassId: null, PermitStatusId: "none", ProjectName: null, IssueDateFrom: null, IssueDateTo: null, Address: null, Description: null, ExpireDateFrom: null, ExpireDateTo: null, FinalDateFrom: null, FinalDateTo: null, ApplyDateFrom: null, ApplyDateTo: null, SearchMainAddress: false, ContactId: null, TypeId: null, WorkClassIds: null, ParcelNumber: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: "PermitNumber.keyword", SortAscending: false },
    InspectionCriteria: { Keyword: null, ExactMatch: false, Complete: null, InspectionNumber: null, InspectionTypeId: null, InspectionStatusId: null, RequestDateFrom: null, RequestDateTo: null, ScheduleDateFrom: null, ScheduleDateTo: null, Address: null, SearchMainAddress: false, ContactId: null, TypeId: [], WorkClassIds: [], ParcelNumber: null, DisplayCodeInspections: false, ExcludeCases: [], ExcludeFilterModules: [], HiddenInspectionTypeIDs: null, ...paged },
    CodeCaseCriteria: { CodeCaseNumber: null, CodeCaseTypeId: null, CodeCaseStatusId: null, ProjectName: null, OpenedDateFrom: null, OpenedDateTo: null, ClosedDateFrom: null, ClosedDateTo: null, Address: null, ParcelNumber: null, Description: null, SearchMainAddress: false, RequestId: null, ExcludeCases: null, ContactId: null, EnableDescriptionSearch: false, ...paged },
    RequestCriteria: { RequestNumber: null, RequestTypeId: null, RequestStatusId: null, ProjectName: null, EnteredDateFrom: null, EnteredDateTo: null, DeadlineDateFrom: null, DeadlineDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, ParcelNumber: null, SearchMainAddress: false, ...paged },
    BusinessLicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, LicenseYear: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, ...paged },
    ProfessionalLicenseCriteria: { LicenseNumber: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, HolderCompanyName: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, ApplicationDateFrom: null, ApplicationDateTo: null, Address: null, MainParcel: null, SearchMainAddress: false, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, ...paged },
    LicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, MainParcel: null, EnableDescriptionSearchForBLicense: false, EnableDescriptionSearchForPLicense: false, EnableDescriptionSearchForOperationalPermit: false, IsOperationalPermit: false, ...paged },
    ProjectCriteria: { ProjectNumber: null, ProjectName: null, Address: null, ParcelNumber: null, StartDateFrom: null, StartDateTo: null, ExpectedEndDateFrom: null, ExpectedEndDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Description: null, SearchMainAddress: false, ContactId: null, TypeId: null, ExcludeCases: null, EnableDescriptionSearch: false, ...paged },
    PlanSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "PlanNumber.keyword", Value: "Plan Number" }, { Key: "ProjectName.keyword", Value: "Project" }, { Key: "MainAddress", Value: "Address" }, { Key: "ApplyDate", Value: "Apply Date" }],
    PermitSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "PermitNumber.keyword", Value: "Permit Number" }, { Key: "ProjectName.keyword", Value: "Project" }, { Key: "MainAddress", Value: "Address" }, { Key: "IssueDate", Value: "Issued Date" }, { Key: "FinalDate", Value: "Finalized Date" }],
    InspectionSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "InspectionNumber.keyword", Value: "Inspection Number" }, { Key: "MainAddress", Value: "Address" }, { Key: "ScheduledDate", Value: "Schedule Date" }, { Key: "RequestDate", Value: "Request Date" }],
    CodeCaseSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "CaseNumber.keyword", Value: "Code Case Number" }, { Key: "ProjectName.keyword", Value: "Project" }, { Key: "MainAddress", Value: "Address" }, { Key: "OpenedDate", Value: "Opened Date" }, { Key: "ClosedDate", Value: "Closed Date" }],
    RequestSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "RequestNumber.keyword", Value: "Request Number" }, { Key: "ProjectName.keyword", Value: "Project Name" }, { Key: "MainAddress", Value: "Address" }, { Key: "EnteredDate", Value: "Date Entered" }, { Key: "CompleteDate", Value: "Completion Date" }],
    LicenseSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "LicenseNumber.keyword", Value: "License Number" }, { Key: "LicenseNumber.keyword", Value: "Operational Permit Number" }, { Key: "CompanyName.keyword", Value: "Company Name" }, { Key: "AppliedDate", Value: "Applied Date" }, { Key: "MainAddress", Value: "Address" }],
    ProjectSortList: [{ Key: "relevance", Value: "Relevance" }, { Key: "ProjectNumber.keyword", Value: "Project Number" }, { Key: "ProjectName.keyword", Value: "Project Name" }, { Key: "StartDate", Value: "Start Date" }, { Key: "CompleteDate", Value: "Completed Date" }, { Key: "ExpectedEndDate", Value: "Expected End Date" }, { Key: "MainAddress", Value: "Address" }],
    ExcludeCases: null,
    SortOrderList: [{ Key: true, Value: "Ascending" }, { Key: false, Value: "Descending" }],
    HiddenInspectionTypeIDs: null,
    PageNumber: 1, PageSize: 10, SortBy: "PermitNumber.keyword", SortAscending: true,
  };
}

function energovHeaders(j) {
  return {
    "User-Agent": UA,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "tenantId": String(j.tenantId),
    "tenantName": j.tenant,
    "Tyler-TenantUrl": j.tenant,
    "Tyler-Tenant-Culture": "en-US",
  };
}

const ENERGOV_SEARCH_PATH = "/apps/selfservice/api/energov/search/search";
const ENERGOV_CONTACTS_PATH = "/apps/selfservice/api/energov/entity/contacts/search/search";
const ENERGOV_PERMIT_PATH = "/apps/selfservice/api/energov/permits/";

async function energovPost(path, body, j, deps) {
  const res = await deps.fetch(`${j.base}${path}`, {
    method: "POST", headers: energovHeaders(j), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`portal-error: energov ${path.split("/").pop()} returned ${res.status}`);
  try { return await res.json(); } catch (_) { throw new Error("portal-error: energov returned non-JSON"); }
}

// Keyword search is fuzzy ("18509" also returns "ELE-18509-2022") and
// CaseNumber comes back space-padded — only the exact trimmed match counts.
function parseEnergovStatus(data, wanted) {
  const rows = data && data.Result && data.Result.EntityResults;
  if (!Array.isArray(rows)) {
    throw new Error("portal-changed: energov response missing Result.EntityResults");
  }
  for (const r of rows) {
    if (String(r.CaseNumber || "").trim().toUpperCase() === String(wanted).toUpperCase()) {
      const status = String(r.CaseStatus || "").trim();
      return { found: true, status: status || "(blank)" };
    }
  }
  return { found: false };
}

async function fetchEnergovStatus(permitNumber, j, deps) {
  const wanted = String(permitNumber || "").trim();
  if (!wanted) throw new Error("no permit number given");
  const data = await energovPost(ENERGOV_SEARCH_PATH, energovSearchBody(wanted), j, deps);
  return parseEnergovStatus(data, wanted);
}

function parseEnergovSearchRows(result) {
  return (result.EntityResults || []).map((r) => ({
    permit_number: String(r.CaseNumber || "").trim(),
    permit_type: String(r.CaseType || "").trim(),
    workclass: String(r.CaseWorkclass || "").trim(),
    status: String(r.CaseStatus || "").trim(),
    description: String(r.Description || "").trim(),
    project_name: String(r.ProjectName || "").trim(),
    address: String(r.AddressDisplay || "").trim(),
    applied_date: String(r.ApplyDate || "").slice(0, 10),
    ref: { caseId: r.CaseId },
  }));
}

const ENERGOV_PAGE_SIZE = 100; // verified live 2026-07-29; the portal accepts it

// Every permit applied for in [from, to]. Criteria search needs
// SearchModule 2, and with SearchModule 2 the server reads paging from
// PermitCriteria, which therefore must be > 0 — the exact inverse of the
// keyword-search rule above.
async function discoverEnergov({ from, to }, j, deps) {
  const sleep = deps.sleep || (async () => {});
  const rows = [];
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const body = energovSearchBody(null);
    body.SearchModule = 2;
    body.Keyword = null;
    body.PermitCriteria.ApplyDateFrom = `${from}T00:00:00.000Z`;
    body.PermitCriteria.ApplyDateTo = `${to}T23:59:59.000Z`;
    body.PermitCriteria.PageNumber = page;
    body.PermitCriteria.PageSize = ENERGOV_PAGE_SIZE;
    const data = await energovPost(ENERGOV_SEARCH_PATH, body, j, deps);
    const result = data && data.Result;
    if (!result || !Array.isArray(result.EntityResults)) {
      throw new Error("portal-changed: energov discovery response missing Result.EntityResults");
    }
    totalPages = Number(result.TotalPages) || 1;
    rows.push(...parseEnergovSearchRows(result));
    page += 1;
    if (page <= totalPages) await sleep();
  }
  return { rows, truncated: false };
}

// Applicant + contractor company names for one permit (the SPA's own
// request, verified live 2026-07-29). {} when nothing is there.
function parseEnergovContacts(data) {
  const rows = (data && data.Result) || [];
  const nameOf = (c) => {
    const company = String(c.GlobalEntityName || "").trim();
    if (company) return company;
    return [c.FirstName, c.LastName].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
  };
  const out = {};
  for (const c of rows) {
    const type = String(c.ContactTypeName || "");
    if (/applicant/i.test(type) && !out.applicant_company) out.applicant_company = nameOf(c);
    if (/contractor/i.test(type) && !out.contractor_company) out.contractor_company = nameOf(c);
  }
  return out;
}

async function fetchEnergovContacts(caseId, j, deps) {
  try {
    if (!caseId) return {};
    const data = await energovPost(ENERGOV_CONTACTS_PATH, {
      EntityId: caseId, ModuleId: 1, PageNumber: 1, PageSize: 10, SortBy: "", SortAscending: true,
    }, j, deps);
    return parseEnergovContacts(data);
  } catch (_) {
    return {};
  }
}

// The search response's Description is blank for most Nampa records even
// when the record has one; the per-permit endpoint is where it lives
// (verified live 2026-08-10). {} on anything unexpected.
async function fetchEnergovDetail(caseId, j, deps) {
  try {
    if (!caseId) return {};
    const res = await deps.fetch(`${j.base}${ENERGOV_PERMIT_PATH}${encodeURIComponent(caseId)}`, {
      headers: energovHeaders(j),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const r = data && data.Result;
    if (!r) return {};
    const out = {};
    const desc = String(r.Description || "").trim();
    if (desc) out.description = desc;
    const project = String(r.ProjectName || "").trim();
    if (project) out.project_name = project;
    return out;
  } catch (_) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Filters shared by both platforms
// ---------------------------------------------------------------------------

// Nampa has no type-filtered search, so its CaseType strings are filtered
// here. The anchors matter: "^certificate of" drops the closeout records
// ("Certificate of Completion - Commercial") while keeping real filings whose
// names merely mention one ("Commercial Tenant Improvement (Certificate of
// Completion)"). The include test reads type AND workclass; the exclude test
// reads the type alone, so a "Commercial" type with a "Residential" workclass
// is still kept (it is what the portal calls a mixed-use record).
const ENERGOV_INCLUDE_RE = /commercial/i;
const ENERGOV_EXCLUDE_RE = /residential|^certificate of|^(electrical|plumbing|mechanical|erosion|row)\b|reroof|\bsign\b|fence|pool|demolition|temp pole|solar/i;

function keepEnergovRow(r) {
  const type = `${r.permit_type || ""} ${r.workclass || ""}`;
  return ENERGOV_INCLUDE_RE.test(type) && !ENERGOV_EXCLUDE_RE.test(String(r.permit_type || ""));
}

// The keyword fallback for "is this industrial", matched against description,
// project name and type. The portals have no industrial category (industrial
// buildings file under commercial types). Where the parcel's zoning is known
// permit-zoning.js's verdict wins instead: measured on the tracker, zoning
// caught an I-1 warehouse this missed and cleared an L-O office this flagged
// on the word "shell".
const INDUSTRIAL_RE = /\b(warehouse|industrial|manufactur\w*|distribution|shell|flex)\b/i;

function flagIndustrial(r) {
  return INDUSTRIAL_RE.test(`${r.description || ""} ${r.project_name || ""} ${r.permit_type || ""}`);
}

// ---------------------------------------------------------------------------
// The platform-neutral face the sweep calls
// ---------------------------------------------------------------------------

// { rows, truncated } for one city over [from, to]. Rows carry a
// platform-opaque `ref` (accela { detailUrl }, energov { caseId }) to hand
// back to enrichFiling unchanged. Nampa's rows are already filtered to the
// commercial shapes the Accela type lists select by construction.
async function discoverFilings(key, window, deps) {
  const j = resolveJurisdiction(key);
  if (!j) throw new Error(`portal-error: unknown jurisdiction "${key}"`);
  if (j.platform === "accela") return discoverAccela(window, j, deps);
  if (j.platform === "energov") {
    const out = await discoverEnergov(window, j, deps);
    return { rows: out.rows.filter(keepEnergovRow), truncated: false };
  }
  throw new Error(`portal-error: unknown platform "${j.platform}"`);
}

// The per-record facts the listing did not carry: applicant and contractor
// company, the parcel number (Accela), and the description EnerGov's search
// rows omit. Best effort — {} or partial on any failure, never throws, so a
// missing detail page costs a company name and never the filing.
async function enrichFiling(key, ref, deps) {
  try {
    const j = resolveJurisdiction(key);
    if (!j || !ref) return {};
    if (j.platform === "accela") return await fetchAccelaCompanies(ref.detailUrl, j, deps);
    if (j.platform === "energov") {
      const [contacts, detail] = await Promise.all([
        fetchEnergovContacts(ref.caseId, j, deps),
        fetchEnergovDetail(ref.caseId, j, deps),
      ]);
      return { ...detail, ...contacts };
    }
    return {};
  } catch (_) {
    return {};
  }
}

// The current status of ONE record: { found, status }. Throws on a portal
// error or a redesign, so a caller can tell "not on the portal" from "the
// portal is down" — the tracker's checker made that distinction and so does
// the spec's §7.
async function fetchFilingStatus(key, permitNumber, deps) {
  const j = resolveJurisdiction(key);
  if (!j) throw new Error(`portal-error: unknown jurisdiction "${key}"`);
  if (j.platform === "accela") return fetchAccelaStatus(permitNumber, j, deps);
  if (j.platform === "energov") return fetchEnergovStatus(permitNumber, j, deps);
  throw new Error(`portal-error: unknown platform "${j.platform}"`);
}

module.exports = {
  UA,
  JURISDICTIONS, JURISDICTION_KEYS, SWEEP_KEYS, getJurisdiction, resolveJurisdiction,
  marketLabel, withOrigin,
  // accela
  harvestForm, usToIsoDate, isoToUsDate, accelaSearchUrl, parseAccelaStatus,
  parseAccelaGrid, parseAccelaDetail, detailSectionText, detailAddress, stripFootnote,
  nextPageTarget, MAX_PAGES, parseParcelNumber,
  parseAccelaCompanies, fetchAccelaStatus, fetchAccelaCompanies, discoverAccela,
  listAccelaPermitTypes,
  // energov
  energovSearchBody, energovHeaders, parseEnergovStatus, parseEnergovSearchRows,
  parseEnergovContacts, fetchEnergovStatus, fetchEnergovContacts, fetchEnergovDetail,
  discoverEnergov, ENERGOV_SEARCH_PATH, ENERGOV_CONTACTS_PATH, ENERGOV_PERMIT_PATH,
  // filters
  ENERGOV_INCLUDE_RE, ENERGOV_EXCLUDE_RE, INDUSTRIAL_RE, keepEnergovRow, flagIndustrial,
  // the sweep's face
  discoverFilings, enrichFiling, fetchFilingStatus,
};
