"use strict";
// permit-alerts.js — a member's permit alerts on the Permit tracker
// (2026-10-01, the owner's pick of Draft B from the Permit Alerts drafts:
// "I like B build it"). A member saves what they follow — a city, a property
// type, a kind (tenant build-outs or new buildings) and optional words — and
// gets the new permits that fit it by email each weekday morning.
//
// Pure: no I/O, no clock reads (the caller passes `now`). It requires only the
// other pure permit modules: permit-pulse.js for what a permit's KIND is (the
// market pages' grouping, so "tenant build-outs" means one thing on both
// surfaces) and permit-filings.js for the portal's calendar date.
//
// WHAT "NEW" MEANS. A permit is new to an alert when the sweep first STORED it
// after the alert's `notified_through` mark — not when it was filed: the sweep
// reads a portal a day or more after a filing, and a permit read late is still
// news. But the history pass (permits.md) also stores old permits it has never
// seen, so a permit filed more than EMAIL_FRESH_DAYS ago is never news, however
// recently it was stored. A new alert's mark starts at its creation, so saving
// one never mails the past.
//
// MARKED ONLY AFTER THE SEND (CLAUDE.md rule 12). The sweep sends a member one
// email for all their alerts' new permits, and only then moves each included
// alert's mark to the moment the permits were read. A failed or switched-off
// send leaves the marks, and the next weekday run sends the same permits.
//
// AN AREA (2026-10-01, step 2, the owner's pick of Draft B: "B, build it"):
// an alert may also follow a circle — within AREA_MILES of an address. The
// address is placed on the map when the alert is saved (the route asks the
// site's Census geocoder; nothing here does I/O) and stored as a point, so a
// permit matches when it has a place of its own within that distance. A
// permit that could not be placed never matches an area; the page says how
// many there are, so a quiet area reads as quiet rather than broken.
//
// ⚠ PAIR: `matches` below and `alertMatches` in permits-page.js's script are
// one rule in two places (the browser cannot require this file): the page uses
// its copy for the counts, the feed tags and the form's preview. Change both;
// test/permit-alerts.test.js runs the two over the same permits.

const PULSE = require("./permit-pulse");
const F = require("./permit-filings");

const MAX_ALERTS_PER_USER = 10;
const NAME_MAX = 80;
const WORDS_MAX = 60;
// A permit filed longer ago than this is not news, however late it was stored.
const EMAIL_FRESH_DAYS = 14;
// …except in a city read from its published reports (Nampa, 2026-10-01): its
// monthly report lands up to a month after a filing, so 14 days would never
// let one through. Its permits are news for this long after filing instead.
const REPORT_FRESH_DAYS = 45;
// One alert's lines in one email; the rest are counted and the page has them.
const EMAIL_MAX_PER_ALERT = 12;
const KINDS = Object.freeze({ ti: "Tenant build-outs", new: "New buildings & additions" });
// The property types an alert can name: permit-zoning.js's list, less "Other",
// which is the absence of a type rather than one somebody follows.
const PROPERTY_TYPES = Object.freeze(["Industrial", "Office", "Retail", "Multifamily", "Mixed use"]);
// The distances an area may be, in miles.
const AREA_MILES = Object.freeze([0.5, 1, 2, 5]);
const AREA_ADDRESS_MAX = 120;

function milesWords(m) { return m === 0.5 ? "½ mile" : m === 1 ? "1 mile" : `${m} miles`; }
// The street line of a placed address, for the alert's own words.
function areaLabel(a) { return String((a && a.area_address) || "").split(",")[0].trim(); }
function hasArea(a) { return Boolean(a) && Number.isFinite(Number(a.area_lat)) && Number.isFinite(Number(a.area_lng)) && a.area_lat !== null && Number(a.area_miles) > 0; }
// Great-circle miles between two [lat, lng] points.
function milesBetween(lat1, lng1, lat2, lng2) {
  const t = (x) => (x * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLng = t(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

function clean(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }

// The words an alert's filters say, for its own line on the page and the email.
function describe(a, cityOf) {
  const city = a.jurisdiction ? (typeof cityOf === "function" ? cityOf(a.jurisdiction) : a.jurisdiction) : "";
  return [
    a.kind ? KINDS[a.kind] : "Every kind",
    a.property_type || "Every property type",
    city || "every city we read",
    hasArea(a) ? `within ${milesWords(Number(a.area_miles))} of ${areaLabel(a)}` : "",
    a.words ? `mentions “${a.words}”` : "",
  ].filter(Boolean).join(" · ");
}

// The name an alert gets when the member does not type one.
function defaultName(a, cityOf) {
  const city = a.jurisdiction ? (typeof cityOf === "function" ? cityOf(a.jurisdiction) : a.jurisdiction) : "";
  const what = a.kind === "ti" ? `${a.property_type ? a.property_type + " build-outs" : "Tenant build-outs"}`
    : a.kind === "new" ? `${a.property_type ? "New " + a.property_type.toLowerCase() + " buildings" : "New buildings"}`
      : a.property_type || "Every permit";
  const where = hasArea(a) ? `within ${milesWords(Number(a.area_miles))} of ${areaLabel(a)}` : city ? `in ${city}` : "in every city";
  const words = a.words ? ` mentioning “${a.words}”` : "";
  return clean(`${what} ${where}${words}`).slice(0, NAME_MAX);
}

// POST and PATCH bodies -> the columns. `cities` are the jurisdiction keys the
// sweep reads: an alert on a city we do not read would never fire, which is
// the page claiming to watch something it cannot see (permits.md §7).
function normalizeFilters(b, { cities }) {
  const out = {};
  const j = clean(b.jurisdiction).toLowerCase();
  if (j && !(cities || []).includes(j)) return { error: "Pick a city we read permits in." };
  out.jurisdiction = j || null;
  const pt = clean(b.propertyType);
  if (pt && !PROPERTY_TYPES.includes(pt)) return { error: "Pick a property type from the list." };
  out.property_type = pt || null;
  const kind = clean(b.kind);
  if (kind && !KINDS[kind]) return { error: "Pick tenant build-outs, new buildings, or every kind." };
  out.kind = kind || null;
  const words = clean(b.words);
  if (words.length > WORDS_MAX) return { error: `Keep the words under ${WORDS_MAX} characters.` };
  out.words = words || null;
  return { value: out };
}

// The area a body asks for, before it is placed: { area: null } for none,
// { area: { address, miles } }, or { error }. The route places the address
// and hands the point to withArea.
function areaRequest(b) {
  const address = clean(b && b.areaAddress);
  if (!address) return { area: null };
  if (address.length > AREA_ADDRESS_MAX) return { error: "Keep the address under 120 characters." };
  const miles = Number(b.areaMiles);
  if (!AREA_MILES.includes(miles)) return { error: "Pick ½, 1, 2 or 5 miles." };
  return { area: { address, miles } };
}
// The area columns, from a placed point ({ lat, lng, matchedAddress }) or none.
function withArea(area, placed) {
  if (!area) return { area_address: null, area_lat: null, area_lng: null, area_miles: null };
  return {
    area_address: clean(placed.matchedAddress || area.address).slice(0, AREA_ADDRESS_MAX),
    area_lat: placed.lat, area_lng: placed.lng, area_miles: area.miles,
  };
}

function validateAlertInput(body, { cities, cityOf } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const f = normalizeFilters(b, { cities });
  if (f.error) return { ok: false, error: f.error };
  const name = clean(b.name).slice(0, NAME_MAX) || defaultName(f.value, cityOf);
  return { ok: true, value: { ...f.value, name, notify_email: b.email !== false } };
}

// A PATCH may change the name, the email switch, or the filters (all four
// together, as the form sends them). A filter change also moves the mark to
// now, so widening an alert never mails the permits it newly takes in.
function validateAlertPatch(body, row, { cities, cityOf, now } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const patch = {};
  const filtersSent = ["jurisdiction", "propertyType", "kind", "words"].some((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (filtersSent) {
    const f = normalizeFilters(b, { cities });
    if (f.error) return { ok: false, error: f.error };
    const r = row || {};
    const changed = ["jurisdiction", "property_type", "kind", "words"].some((k) => (f.value[k] || null) !== (r[k] || null));
    Object.assign(patch, f.value);
    if (changed) patch.notified_through = new Date(now).toISOString();
  }
  // The area, already placed by the route (`b.area`: the withArea columns).
  if (b.area && typeof b.area === "object") {
    const r = row || {};
    const moved = ["area_lat", "area_lng", "area_miles"].some((k) => (b.area[k] == null ? null : Number(b.area[k])) !== (r[k] == null ? null : Number(r[k])));
    Object.assign(patch, b.area);
    if (moved) patch.notified_through = new Date(now).toISOString();
  }
  if (Object.prototype.hasOwnProperty.call(b, "name")) {
    patch.name = clean(b.name).slice(0, NAME_MAX) || defaultName({ ...(row || {}), ...patch }, cityOf);
  }
  if (typeof b.email === "boolean") patch.notify_email = b.email;
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to change." };
  return { ok: true, patch };
}

// Does a permit fit an alert? `p` is a filing view as the tracker draws it:
// { jurisdiction, propertyType, kind, address, description, projectName,
//   applicant, contractor, permitNumber }. ⚠ PAIR with permits-page.js.
function matches(a, p) {
  if (!a || !p) return false;
  if (a.jurisdiction && p.jurisdiction !== a.jurisdiction) return false;
  if (a.property_type && p.propertyType !== a.property_type) return false;
  if (a.kind && p.kind !== a.kind) return false;
  if (a.words) {
    const hay = [p.address, p.description, p.projectName, p.applicant, p.contractor, p.permitNumber].join(" ").toLowerCase();
    if (hay.indexOf(String(a.words).toLowerCase()) < 0) return false;
  }
  if (hasArea(a)) {
    if (p.lat == null || p.lng == null || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
    if (milesBetween(Number(a.area_lat), Number(a.area_lng), p.lat, p.lng) > Number(a.area_miles)) return false;
  }
  return true;
}

// One stored alert -> what the page draws. camelCase, nothing it does not use.
function alertView(row, { cityOf } = {}) {
  const r = row || {};
  return {
    id: r.id, name: r.name || "", jurisdiction: r.jurisdiction || "", propertyType: r.property_type || "",
    kind: r.kind || "", words: r.words || "", email: r.notify_email === true,
    lastEmailedAt: r.last_emailed_at || null, describe: describe(r, cityOf),
    area: hasArea(r) ? { address: r.area_address || "", lat: Number(r.area_lat), lng: Number(r.area_lng), miles: Number(r.area_miles) } : null,
  };
}

// One member's alerts + the permits stored since the oldest of their marks ->
// the email's items, [{ alert, permits }], alerts in the member's own order,
// permits newest first. `views` carry `firstSeenAt` and `appliedDate`.
// `cutoff` is when the permits were read: nothing stored after it counts, so a
// permit the sweep stores while this runs is the next run's news.
// `lateCities`: the jurisdiction keys read from published reports, whose
// permits stay news for REPORT_FRESH_DAYS (views carry `jurisdiction`).
function digestFor(alerts, views, { now, cutoff, lateCities } = {}) {
  const freshFrom = F.localIsoDate(now - EMAIL_FRESH_DAYS * 86400000);
  const lateFrom = F.localIsoDate(now - REPORT_FRESH_DAYS * 86400000);
  const late = new Set(Array.isArray(lateCities) ? lateCities : []);
  const fresh = (p) => String(p.appliedDate || "") >= (late.has(p.jurisdiction) ? lateFrom : freshFrom);
  const until = cutoff ? Date.parse(cutoff) : Infinity;
  const out = [];
  for (const a of Array.isArray(alerts) ? alerts : []) {
    if (!a || a.notify_email !== true) continue;
    const since = Date.parse(String(a.notified_through || ""));
    const permits = (views || []).filter((p) => {
      const seen = Date.parse(String(p.firstSeenAt || ""));
      return Number.isFinite(seen) && (!Number.isFinite(since) || seen > since) && seen <= until &&
        fresh(p) && matches(a, p);
    }).sort((x, y) => String(y.appliedDate || "").localeCompare(String(x.appliedDate || ""))
      || String(x.permitNumber || "").localeCompare(String(y.permitNumber || "")));
    if (permits.length) out.push({ alert: a, permits });
  }
  return out;
}

function shortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${Number(m[3])}`;
}

// The weekday email: every alert with something new, its permits listed.
function buildDigestEmail({ items, siteUrl, cityOf } = {}) {
  const list = (items || []).filter((x) => x && x.alert && Array.isArray(x.permits) && x.permits.length);
  if (!list.length) return null;
  const total = list.reduce((n, x) => n + x.permits.length, 0);
  const subject = list.length === 1
    ? `${total} new permit${total === 1 ? "" : "s"}: ${list[0].alert.name}`
    : `${total} new permits for your alerts`;
  const city = (k) => (typeof cityOf === "function" ? cityOf(k) : k) || "";
  const blocks = list.map(({ alert: a, permits }) => {
    const lines = [`${a.name} (${permits.length} new)`];
    for (const p of permits.slice(0, EMAIL_MAX_PER_ALERT)) {
      const kind = p.kind === "ti" ? "tenant build-out" : p.kind === "new" ? "new building" : clean(p.type);
      lines.push(`• ${[shortDay(p.appliedDate), clean(p.address) || "no address on the permit", city(p.jurisdiction), kind, p.propertyType && p.propertyType !== "Other" ? p.propertyType.toLowerCase() : ""].filter(Boolean).join(" · ")}` +
        ` (${clean(p.permitNumber)})${p.sourceUrl ? `\n  ${p.sourceUrl}` : ""}`);
    }
    if (permits.length > EMAIL_MAX_PER_ALERT) lines.push(`…and ${permits.length - EMAIL_MAX_PER_ALERT} more on the Permit tracker.`);
    return lines.join("\n");
  });
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const text = [
    total === 1 ? "A new permit fits one of your alerts on CompNinja." : "New permits fit your alerts on CompNinja.",
    "",
    blocks.join("\n\n"),
    "",
    `See every permit, or change your alerts: ${base}/permits`,
    "",
    "CompNinja reads each city's public permit portal on weekday mornings, so a permit can appear on the portal a day before we see it. You're getting this because you set up these alerts on the Permit tracker; switch an alert's email off, or delete it, there.",
  ].join("\n");
  return { subject, text };
}

module.exports = {
  MAX_ALERTS_PER_USER, NAME_MAX, WORDS_MAX, EMAIL_FRESH_DAYS, REPORT_FRESH_DAYS, EMAIL_MAX_PER_ALERT, KINDS, PROPERTY_TYPES,
  AREA_MILES, hasArea, milesBetween, areaRequest, withArea,
  describe, defaultName, validateAlertInput, validateAlertPatch, matches, alertView, digestFor, buildDigestEmail,
  kindOf: PULSE.groupOf,
};
