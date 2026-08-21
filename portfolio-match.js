// ---------------------------------------------------------------------------
// "Have I already saved this property?"
//
// The desk upserts on the property, so every save has to answer that question
// first — and it answered it by comparing the address the visitor TYPED,
// character for character. One building typed three ways is three rows:
//
//     1210N17th st
//     1210 N 17th st Boise Idaho 83702
//     1210N17th st Boise Id
//
// all of which the app had already geocoded to one place before running the
// report, and all of which appeared separately on a real owner's desk, each
// with its own value history, inflating the combined total the desk leads with.
//
// Normalizing the typed string does not fix that: two of those carry a city
// and one does not, so no amount of case-folding makes them equal. What makes
// them equal is the thing the confirm dialog already knows and threw away —
// the address the geocoder VERIFIED, which is identical for all three.
//
// Deliberately PURE, like entitlements.js and valuation.js: no I/O, no clock,
// no requires. server.js owns the reads and the writes.
//
// THE FAILURE MODE IS CHOSEN. A miss (two rows that should have been one)
// leaves exactly today's behavior and costs a duplicate row the owner can
// delete. A wrong merge silently folds two different buildings into one
// property and destroys one of their value histories, which nothing on the
// desk would reveal. So every rule here is written to miss rather than to
// guess: a key is used only when it is present on BOTH sides, an empty or
// malformed key never matches, and the type must match exactly even when the
// location does.
// ---------------------------------------------------------------------------

// The same shape broker-vault.js's addressKey uses (lowercase, drop the
// punctuation that varies between geocoders, collapse whitespace). It is
// applied to a VERIFIED label rather than to typed input, so it is only
// absorbing formatting differences between two answers to the same lookup,
// never trying to make two different human spellings agree.
function normalizeVerified(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A verified label is only usable as an identity if it actually names a
// place. The floor is deliberately low — this is a sanity check on a string
// our own geocoder produced, not a parser — but it does refuse the empty and
// near-empty answers, which would otherwise all collide with each other and
// merge every unplaceable property on a desk into one row.
const MIN_KEY_LENGTH = 6;
const MAX_KEY_LENGTH = 300;

function verifiedKeyFor(label) {
  const key = normalizeVerified(label);
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return "";
  // Must contain a digit and a letter: "boise, id" is a real geocoder answer
  // for a city-only lookup, and using it as a property identity would merge
  // every unnumbered address in that city.
  if (!/[0-9]/.test(key) || !/[a-z]/.test(key)) return "";
  return key;
}

/**
 * Find the saved property a report belongs to.
 *
 * @param {Array} items        the caller's own portfolio rows (user-scoped by
 *                             the caller — this file never sees a user id and
 *                             so can never widen a read past one account)
 * @param {object} q           { address, propertyType, verifiedKey }
 * @returns the matching row, or null
 *
 * Verified location first, typed address second. The second is today's rule
 * unchanged, which is what keeps every row saved before this existed — and
 * every report restored from history or a share, where nothing was verified —
 * behaving exactly as it did.
 */
function findMatch(items, { address, propertyType, verifiedKey } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const type = String(propertyType == null ? "" : propertyType);
  const key = verifiedKeyFor(verifiedKey);
  if (key) {
    // `verified_key` on the row is stored already-normalized, but it is
    // re-normalized here rather than trusted: it may predate a change to
    // normalizeVerified, and a stored value is not an excuse to skip the
    // function that defines what the value means.
    const hit = rows.find((r) => r && String(r.property_type) === type
      && verifiedKeyFor(r.verified_key) === key);
    if (hit) return hit;
  }
  const addr = String(address == null ? "" : address);
  return rows.find((r) => r && r.address === addr && String(r.property_type) === type) || null;
}

module.exports = { findMatch, verifiedKeyFor, normalizeVerified, MIN_KEY_LENGTH, MAX_KEY_LENGTH };
