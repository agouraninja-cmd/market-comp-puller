"use strict";
// ---------------------------------------------------------------------------
// The firm's buildings: what may be stored on the firm's board, and how the
// list is summarized.
//
// Plan:   ~/.claude/plans/could-you-help-me-mighty-crane.md (Three Spaces, slice 3)
// Spec:   docs/superpowers/specs/2026-09-01-three-spaces-design.md
// Schema: migrations/046-org-buildings.sql
//
// PURE, like org-access.js and org-contacts.js: no I/O, no requires, no
// clock. server.js owns the reads and writes and hands rows in, which is what
// lets `npm test` prove every refusal below with no database.
//
// ---------------------------------------------------------------------------
// NO THIRD KEY IS INVENTED HERE.
// ---------------------------------------------------------------------------
// A building is identified by `address_key` (broker-vault.js's addressKey —
// what broker_comps and broker_properties already carry) and, when a verified
// location is known, by `verified_key` (portfolio-match.js's verifiedKeyFor).
// Both functions are INJECTED by the caller rather than required, the
// broker-leads.js `siblingsOf` precedent: this file does not know what an
// address is, and a second implementation of either key would be a second
// thing to keep in step. The same goes for `marketOf` — market is attached in
// server.js so it agrees byte for byte with comp_corpus.market.
//
// ---------------------------------------------------------------------------
// IT REFUSES RATHER THAN GUESSES (broker-vault.js's rule).
// ---------------------------------------------------------------------------
// A building on the firm's board is a shared record every colleague reads and
// that slices 5 and 6 hang notes, comps and leases off. A row filed under a
// city-only address, or with a size that was really a price, is a wrong
// record nobody will notice; a refused row is a message somebody can act on.
// ---------------------------------------------------------------------------

// The owner's overflow rule (slice 4): the Workspace shows this many rows and
// past it one control links to the whole list. Matches index.html's
// FILTER_AT / COLLAPSE_AT, not the firm shelf's six — that six answers a
// different question ("is a filter box furniture").
const OVERFLOW_AT = 8;
// The list read's ceiling, /vault's rule: past it the page SAYS it is
// truncated rather than under-reporting.
const MAX_BUILDINGS = 1000;

const MAX_ADDRESS = 200;
const MAX_NAME = 120;
// A building bigger than this is a typo. Fifty million square feet is roughly
// ten times the largest building in the world.
const MAX_SIZE_SQFT = 50000000;
const MIN_YEAR = 1600;

function str(v) { return v == null ? "" : String(v); }

// Control characters are stripped because these strings are rendered on a
// page, and collapsed because "100  Main St" and "100 Main St" are one
// building whichever way the address arrived.
function cleanText(v, max) {
  return str(v).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// "12,500 SF" / "12500" / 12500 → 12500. Refuses rather than guesses: a
// "1.2M"-style shorthand is exactly the input the vault refuses, and here it
// would be a building the size of a city block.
function parseSize(v) {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= MAX_SIZE_SQFT
    ? { ok: true, value: Math.round(v) } : { ok: false };
  const s = str(v).trim().toLowerCase().replace(/\s*(sq\.?\s*ft\.?|sf|square feet)$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const n = Number(s);
  return n > 0 && n <= MAX_SIZE_SQFT ? { ok: true, value: Math.round(n) } : { ok: false };
}

function parseYear(v, thisYear) {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const s = str(v).trim();
  if (!/^\d{4}$/.test(s)) return { ok: false };
  const n = Number(s);
  return n >= MIN_YEAR && n <= thisYear + 2 ? { ok: true, value: n } : { ok: false };
}

function parseCoord(v, limit) {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(str(v).trim());
  return Number.isFinite(n) && Math.abs(n) <= limit ? { ok: true, value: n } : { ok: false };
}

/**
 * What one building becomes before it is stored.
 *
 * @param {object} input  { address, propertyType, sizeSqft, yearBuilt,
 *                          verifiedKey, lat, lng } — as the browser sent it
 * @param {object} deps   { addressKey, verifiedKeyFor, marketOf, hasMarket, types, year }
 *                        addressKey / verifiedKeyFor / marketOf are the
 *                        repo's own functions, injected (see the header);
 *                        `types` is the property-type vocabulary; `year` is
 *                        the current year (no clock reads here).
 * @returns {{ row: object|null, errors: string[] }}
 */
function normalizeBuilding(input, deps) {
  const d = deps || {};
  const addressKey = typeof d.addressKey === "function" ? d.addressKey : null;
  const verifiedKeyFor = typeof d.verifiedKeyFor === "function" ? d.verifiedKeyFor : () => "";
  const marketOf = typeof d.marketOf === "function" ? d.marketOf : null;
  // marketOf() returns SOMETHING for any string ("100 Main St" comes back as
  // "100 Main St"); whether that something is a market is server.js's
  // addressHasMarket, injected here for the same reason the keys are.
  const hasMarket = typeof d.hasMarket === "function" ? d.hasMarket : null;
  const types = Array.isArray(d.types) ? d.types : [];
  const thisYear = Number.isFinite(d.year) ? d.year : 2100;
  if (!addressKey || !marketOf || !hasMarket) {
    // A caller that forgot the injections would store keyless rows the
    // upsert can never match. Loud, not lenient.
    return { row: null, errors: ["normalizeBuilding needs addressKey, marketOf and hasMarket."] };
  }
  const src = input && typeof input === "object" ? input : {};
  const errors = [];

  const address = cleanText(src.address, MAX_ADDRESS);
  if (!address) errors.push("An address is required.");
  // portfolio-match's rule, for its reason: "boise, id" is a real geocoder
  // answer, and a building with no street number is a city, not a building.
  else if (!/\d/.test(address)) errors.push("A building needs a street number.");
  // The vault's rule on the same door: an address the market parser cannot
  // place is filed under a market that does not exist, and then it never
  // meets the comps that belong with it.
  else if (!hasMarket(address)) errors.push("Add the city and state, like \"100 Main St, Boise, ID\".");

  let property_type = "";
  const typed = cleanText(src.propertyType, 40);
  if (typed) {
    const hit = types.find((t) => String(t).toLowerCase() === typed.toLowerCase());
    if (hit) property_type = hit;
    else errors.push(`Property type must be one of: ${types.join(", ")}.`);
  }

  const size = parseSize(src.sizeSqft);
  if (!size.ok) errors.push("Size must be a number of square feet, like 12,500.");
  const year = parseYear(src.yearBuilt, thisYear);
  if (!year.ok) errors.push(`Year built must be a four-digit year between ${MIN_YEAR} and ${thisYear + 2}.`);

  // Coordinates come from a machine (a verified portfolio row), never a
  // person, so a bad one is a caller bug: refused, since a wrong coordinate
  // puts the building on the wrong continent and nobody would recognise it.
  const lat = parseCoord(src.lat, 90);
  const lng = parseCoord(src.lng, 180);
  const half = (lat.value === null) !== (lng.value === null);
  if (!lat.ok || !lng.ok || half) errors.push("Location must be a latitude and a longitude together, or neither.");

  if (errors.length) return { row: null, errors };
  const key = addressKey(address);
  if (!key) return { row: null, errors: ["An address is required."] };
  const vkey = verifiedKeyFor(str(src.verifiedKey)) || null;
  return {
    row: {
      address,
      address_key: key,
      verified_key: vkey,
      market: marketOf(address),
      property_type,
      size_sqft: size.value,
      year_built: year.value,
      lat: lat.value,
      lng: lng.value,
    },
    errors: [],
  };
}

// One line for the whole set, always the WHOLE set — the shelf's rule that a
// header count never describes a filtered or truncated view. "14 buildings ·
// 6 Industrial · 5 Retail · 3 Office"; untyped rows are counted but not named.
function summarize(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byType = new Map();
  for (const r of list) {
    const t = str(r && r.property_type).trim();
    if (!t) continue;
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const types = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const count = list.length;
  const head = count === 0 ? "" : `${count} ${count === 1 ? "building" : "buildings"}`;
  const line = count === 0 ? "" : [head, ...types.map(([t, n]) => `${n} ${t}`)].join(" · ");
  return { count, byType: types, line };
}

// The wire shape, as an ALLOWLIST — vault-api.js's rule. A new storage
// column cannot reach the browser by default. `addressKey` and `verifiedKey`
// ARE sent, unlike the vault's plumbing: they are the firm's own index, derived
// from an address the firm typed, and the desk's "already on the board"
// check reads them so it never grows a key implementation of its own.
function toBuilding(row, viewerId) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    address: str(row.address),
    addressKey: str(row.address_key),
    verifiedKey: row.verified_key ? str(row.verified_key) : "",
    market: str(row.market),
    type: str(row.property_type),
    sizeSqft: row.size_sqft == null ? null : Number(row.size_sqft),
    yearBuilt: row.year_built == null ? null : Number(row.year_built),
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    addedBy: str(row.added_by_name),
    mine: Boolean(row.added_by_user_id && viewerId && String(row.added_by_user_id) === String(viewerId)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// Is this address already on the board? The desk's doors ask before offering
// "Add to the firm's buildings". Verified key first (the same building typed
// two ways), then the exact address key — both read off the server's own
// rows, so this is a lookup and not a third key.
function findBuilding(buildings, { addressKey, verifiedKey } = {}) {
  const list = Array.isArray(buildings) ? buildings : [];
  const vk = str(verifiedKey);
  if (vk) {
    const hit = list.find((b) => b && b.verifiedKey && b.verifiedKey === vk);
    if (hit) return hit;
  }
  const ak = str(addressKey);
  if (!ak) return null;
  return list.find((b) => b && b.addressKey === ak) || null;
}

// ---------------------------------------------------------------------------
// The building sheet (slice 5, migration 047).
// ---------------------------------------------------------------------------

// Editing a building on the board: the three descriptive fields, and never
// the address. The address IS the key — changing it would be a different
// building, and every comp, report, note and (slice 6) lease hangs off the
// key. Validated as the WHOLE row it would become, through normalizeBuilding
// with the stored address, broker-vault.js's validateEdit rule: an edit
// cannot accept what an add refuses.
const EDITABLE_FIELDS = ["propertyType", "sizeSqft", "yearBuilt"];
function validateBuildingEdit(existing, patch, deps) {
  const cur = existing && typeof existing === "object" ? existing : {};
  const p = patch && typeof patch === "object" ? patch : {};
  const merged = {
    address: cur.address,
    propertyType: Object.prototype.hasOwnProperty.call(p, "propertyType") ? p.propertyType : cur.property_type,
    sizeSqft: Object.prototype.hasOwnProperty.call(p, "sizeSqft") ? p.sizeSqft : cur.size_sqft,
    yearBuilt: Object.prototype.hasOwnProperty.call(p, "yearBuilt") ? p.yearBuilt : cur.year_built,
  };
  const unknown = Object.keys(p).filter((k) => EDITABLE_FIELDS.indexOf(k) < 0);
  if (unknown.length) {
    return { row: null, errors: [`Only ${EDITABLE_FIELDS.join(", ")} can be changed here; the address is the building's identity.`] };
  }
  const r = normalizeBuilding(merged, deps);
  if (!r.row) return { row: null, errors: r.errors };
  return {
    row: { property_type: r.row.property_type, size_sqft: r.row.size_sqft, year_built: r.row.year_built },
    errors: [],
  };
}

// A note is typed, and it is text a colleague will read on a shared sheet.
const MAX_NOTE = 2000;
function validateNote(body) {
  const text = cleanText(body, MAX_NOTE + 1);
  if (!text) return { body: null, errors: ["Write something first."] };
  if (text.length > MAX_NOTE) return { body: null, errors: [`A note can be up to ${MAX_NOTE} characters.`] };
  return { body: text, errors: [] };
}

function keyOf(addressKey, address) {
  return addressKey(str(address));
}

// Everything a sheet shows, composed from reads server.js made SEPARATELY.
//
// This function is the privacy wall's last line and it is tested on exactly
// that: it is handed the firm's shared comps and the viewer's OWN vault comps
// as two different arrays from two different reads, it never merges them,
// and it DROPS anything in the viewer's arrays that is not the viewer's — so
// a caller bug that handed it another member's rows would show nothing
// rather than something. Two rules from the plan, both enforced here:
//
//   1. A colleague's private vault comp can never appear. mineComps rows
//      must carry the viewer's user_id; the firm's comps are the org_comps
//      rows the colleague chose to share, attributed.
//   2. Valuations are the viewer's own portfolio snapshots plus values read
//      off the firm's SHARED reports — never a colleague's portfolio.
//      portfolio rows must carry the viewer's user_id.
//
// Read-only rows carry attribution; the only editable things on a sheet are
// the building's own three fields and the notes.
function composeSheet(parts) {
  const p = parts && typeof parts === "object" ? parts : {};
  const addressKey = typeof p.addressKey === "function" ? p.addressKey : null;
  const building = p.building && typeof p.building === "object" ? p.building : null;
  if (!addressKey || !building) return null;
  const viewerId = str(p.viewerId);
  const key = str(building.address_key);
  const vkey = str(building.verified_key);
  const mine = (row, col) => Boolean(viewerId) && row && String(row[col] || "") === viewerId;
  const shared = new Set((Array.isArray(p.sharedIds) ? p.sharedIds : []).map(String));
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

  // The firm's transactions: org_comps the colleagues shared, on this key.
  // The viewer's own shared comps are left OUT of this list — they appear
  // under "yours" with the share toggle, and a deal listed twice reads as two
  // deals.
  const firm = (Array.isArray(p.firmComps) ? p.firmComps : [])
    .filter((r) => r && r.comp && typeof r.comp === "object")
    .filter((r) => keyOf(addressKey, r.comp.address) === key)
    .filter((r) => !mine(r, "shared_by_user_id"))
    .map((r) => ({
      id: r.id,
      date: r.deal_date || r.comp.date || null,
      transaction: str(r.comp.transaction),
      price: num(r.comp.price_or_rate),
      sizeSqft: num(r.comp.size_sqft),
      pricePerSqft: num(r.comp.price_per_sqft),
      sharedBy: str(r.shared_by_name) || "a colleague",
    }));

  // The viewer's own vault comps on this key. Rule 1: anything not theirs is
  // dropped here, whatever the caller did.
  const own = (Array.isArray(p.mineComps) ? p.mineComps : [])
    .filter((r) => r && mine(r, "user_id"))
    .filter((r) => str(r.address_key) === key)
    .map((r) => ({
      id: r.id,
      date: r.deal_date || null,
      transaction: str(r.transaction),
      price: num(r.price),
      sizeSqft: num(r.size_sqft),
      pricePerSqft: num(r.price_per_sqft),
      rentPsfYr: num(r.rent_psf_yr),
      published: r.published === true,
      shared: shared.has(String(r.id)),
    }));

  // Reports on the firm's shelf about this building.
  const reports = (Array.isArray(p.shelf) ? p.shelf : [])
    .filter((r) => r && r.meta && keyOf(addressKey, r.meta.address) === key)
    .map((r) => ({
      id: r.id,
      url: "/r/" + r.id,
      type: str(r.meta.type),
      sharedBy: str(r.shared_by_name) || "a colleague",
      mine: mine(r, "user_id"),
      createdAt: r.created_at || null,
    }));

  // Valuations. Rule 2: the viewer's own snapshots (their portfolio row must
  // be theirs), plus whatever the caller valued off the firm's shared
  // reports. A colleague's portfolio never reaches this function.
  const valuations = [];
  for (const row of Array.isArray(p.portfolio) ? p.portfolio : []) {
    if (!row || !mine(row, "user_id")) continue;
    const hit = (vkey && str(row.verified_key) === vkey) || keyOf(addressKey, row.address) === key;
    if (!hit) continue;
    for (const snap of Array.isArray(row.snapshots) ? row.snapshots : []) {
      if (!snap || !num(snap.likely)) continue;
      valuations.push({ ts: snap.ts || null, low: num(snap.low), likely: num(snap.likely), high: num(snap.high), source: "yours" });
    }
  }
  for (const v of Array.isArray(p.reportValues) ? p.reportValues : []) {
    if (!v || !num(v.likely)) continue;
    valuations.push({ ts: v.ts || null, low: num(v.low), likely: num(v.likely), high: num(v.high),
      source: "report", reportId: v.reportId || null, sharedBy: str(v.sharedBy) || "a colleague" });
  }
  valuations.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

  const contacts = (Array.isArray(p.contacts) ? p.contacts : [])
    .filter((c) => c && c.name)
    .map((c) => ({ id: c.id, name: str(c.name), company: str(c.company), email: str(c.email),
      addedBy: str(c.added_by_name), mine: mine(c, "added_by_user_id") }));

  const notes = (Array.isArray(p.notes) ? p.notes : [])
    .filter((n) => n && n.body)
    .map((n) => ({ id: n.id, body: str(n.body), addedBy: str(n.added_by_name) || "a colleague",
      mine: mine(n, "added_by_user_id"), createdAt: n.created_at || null }));

  // Leases (slice 6): already shaped by the caller (org-leases.js's toLease);
  // this only keeps the ones on THIS building, since the caller's read is
  // by firm.
  const leases = (Array.isArray(p.leases) ? p.leases : [])
    .filter((l) => l && String(l.buildingId || "") === String(building.id || ""));

  return { building: toBuilding(building, viewerId), firmComps: firm, mineComps: own, reports, valuations, contacts, notes, leases };
}

module.exports = {
  normalizeBuilding,
  summarize,
  toBuilding,
  findBuilding,
  validateBuildingEdit,
  validateNote,
  composeSheet,
  EDITABLE_FIELDS,
  MAX_NOTE,
  OVERFLOW_AT,
  MAX_BUILDINGS,
  MAX_ADDRESS,
  MAX_NAME,
  MAX_SIZE_SQFT,
};
