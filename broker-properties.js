// ---------------------------------------------------------------------------
// The property dimension — one row per building, per broker.
//
// Migration: migrations/016-broker-comps-star.sql
//
// PURE, like broker-vault.js, entitlements.js and comp-gate.js: no I/O, no
// requires, no clock reads. server.js owns the upsert and the user_id scoping;
// this decides only what a property row should SAY.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// `address_key` has been written on every vault comp since 013 and read by
// nothing — no index, no table, no foreign key. It is the one dimension a
// broker actually slices by ("everything I have done on this building"), and
// it was the only one of the four in the brief that was genuinely missing.
// broker, date and market were already clean.
//
// ---------------------------------------------------------------------------
// THIS MIRRORS THE SQL BACKFILL IN 016, DELIBERATELY
// ---------------------------------------------------------------------------
// The migration backfills existing rows in SQL; this derives the same rows for
// new uploads in JS. They must agree, or a comp imported today would describe
// its building differently from one imported yesterday. Both take the address,
// market and type from the MOST RECENT deal for that building, and both take
// first/last seen from the full date range. There is a test pinning the rule.
//
// A mirrored pair is a hazard this repo takes seriously (compWeight carries a
// ⚠ for the same reason). It is accepted here because the alternative — having
// the application re-run a SQL backfill on every upload — would mean a write
// path that rewrites rows it does not own.
// ---------------------------------------------------------------------------

// Which of two comps describes the building more currently. Newest deal wins;
// a comp with no date loses to one that has a date, because "no date" is not
// evidence of recency. Ties break on nothing — the first seen wins, which is
// stable given the caller's ordering.
function isMoreRecent(candidate, current) {
  const a = candidate && candidate.deal_date ? String(candidate.deal_date) : "";
  const b = current && current.deal_date ? String(current.deal_date) : "";
  if (a && !b) return true;
  if (!a) return false;
  return a > b;
}

// Comp rows (already carrying user_id, address_key, market, property_type)
// -> the property dimension rows they imply.
//
// Rows missing the natural key are skipped rather than grouped under "": a
// property row with no address_key could never be matched back to a comp, so
// it would be a permanent orphan in the dimension.
function propertyRowsFrom(comps) {
  if (!Array.isArray(comps)) return [];
  const byKey = new Map();

  for (const c of comps) {
    if (!c || typeof c !== "object") continue;
    const key = c.address_key;
    const userId = c.user_id;
    if (!key || !userId) continue;

    const id = `${userId}\u0000${key}`;
    const existing = byKey.get(id);
    const date = c.deal_date ? String(c.deal_date) : "";

    if (!existing) {
      byKey.set(id, {
        user_id: userId,
        address_key: key,
        address: c.address || "",
        market: c.market || "",
        property_type: c.property_type || "",
        first_seen: date || null,
        last_seen: date || null,
        _newest: c,
      });
      continue;
    }

    // Descriptive fields follow the most recent deal.
    if (isMoreRecent(c, existing._newest)) {
      existing.address = c.address || existing.address;
      existing.market = c.market || existing.market;
      existing.property_type = c.property_type || existing.property_type;
      existing._newest = c;
    }
    // The date range spans every deal, recent or not.
    if (date) {
      if (!existing.first_seen || date < existing.first_seen) existing.first_seen = date;
      if (!existing.last_seen || date > existing.last_seen) existing.last_seen = date;
    }
  }

  return [...byKey.values()].map(({ _newest, ...row }) => row);
}

// The coordinates an upload supplies for its buildings, one entry per building.
//
// Migration: migrations/017-broker-property-coordinates.sql
// Spec:      docs/superpowers/specs/2026-08-06-private-comp-geocoding.md
//
// SEPARATE FROM propertyRowsFrom ON PURPOSE, and the reason is the upsert, not
// tidiness. The property upsert runs with `resolution=merge-duplicates`, which
// replaces the columns present in its payload. If coordinates travelled in
// that payload, a broker's second upload — the one where they did not bother
// filling in lat/lng again — would carry nulls and WIPE the coordinates their
// first upload supplied. Every re-import would quietly un-locate their book.
//
// So coordinates are applied by server.js as a separate, guarded write that
// only ever fills a building that has none. That also satisfies the spec's §6
// obligation that a property with broker-supplied coordinates is never
// re-derived, however many times its comps are re-uploaded.
//
// Reads the underscore-prefixed keys broker-vault.js parked on each comp
// (`_lat`/`_lng`): they are carried between functions and are never columns —
// broker_comps has no coordinate columns, and sending one would 400 the whole
// insert.
//
// Newest deal wins, the same rule the descriptive fields follow above, for the
// same reason: if a broker re-typed the coordinates on a later deal for the
// same building, the later typing is the one they believe today.
function propertyCoordsFrom(comps) {
  if (!Array.isArray(comps)) return [];
  const byKey = new Map();

  for (const c of comps) {
    if (!c || typeof c !== "object") continue;
    if (!c.address_key || !c.user_id) continue;
    // Both or neither — broker-vault.js already refuses a lone coordinate, and
    // this is the second gate on the same rule rather than a new one.
    if (!Number.isFinite(c._lat) || !Number.isFinite(c._lng)) continue;

    const id = `${c.user_id}|${c.address_key}`;
    const existing = byKey.get(id);
    if (!existing || isMoreRecent(c, existing._newest)) {
      byKey.set(id, {
        user_id: c.user_id,
        address_key: c.address_key,
        lat: c._lat,
        lng: c._lng,
        // 'broker' because it came from their spreadsheet and contacted
        // nobody. 'census' is the import-time-geocoding value (step 2 of the
        // spec, shipped 2026-08-29) and is written only by server.js's
        // scheduleVaultGeocode — never by this function, which only ever
        // describes what the broker themselves supplied. The broker's value
        // always wins: the census PATCH is guarded lat=is.null.
        geo_source: "broker",
        _newest: c,
      });
    }
  }

  return [...byKey.values()].map(({ _newest, ...row }) => row);
}

// Which of a set of broker_properties rows the import-time geocode should even
// attempt (spec §3 step 2). A pure filter + cap so the rule is testable: only
// rows still unlocated (lat null — the caller's read and PATCH both carry
// lat=is.null; this is the belt to those suspenders), with a real id to PATCH
// and a non-blank address to send. The cap bounds Census calls per trigger;
// rows past it simply wait, because every trigger re-reads whatever is still
// null — nothing is lost by stopping, only postponed.
function propertiesNeedingGeocode(rows, cap) {
  const out = [];
  const max = Number.isFinite(cap) && cap > 0 ? cap : 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (out.length >= max) break;
    if (!r || typeof r !== "object" || !r.id) continue;
    if (r.lat !== null && r.lat !== undefined) continue;
    if (typeof r.address !== "string" || !r.address.trim()) continue;
    out.push(r);
  }
  return out;
}

// The keys broker-vault.js carries between functions that are NOT columns on
// broker_comps. Sending one to PostgREST 400s the whole insert, and on the
// upload path that means a broker's spreadsheet is refused wholesale.
const CARRIED_KEYS = Object.freeze(["_lat", "_lng"]);

/** A comp row as broker_comps will actually accept it. */
function stripCarriedKeys(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    if (!CARRIED_KEYS.includes(k)) out[k] = row[k];
  }
  return out;
}

// address_key -> property id, from the rows the database handed back. The
// upsert returns representation, and the caller needs to turn that into the
// property_id it stamps on each comp.
function indexById(propertyRows) {
  const out = new Map();
  for (const p of propertyRows || []) {
    if (p && p.address_key && p.id) out.set(p.address_key, p.id);
  }
  return out;
}

module.exports = {
  propertyRowsFrom, propertyCoordsFrom, propertiesNeedingGeocode,
  stripCarriedKeys, indexById, isMoreRecent, CARRIED_KEYS,
};
