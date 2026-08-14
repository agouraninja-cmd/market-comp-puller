"use strict";
// ---------------------------------------------------------------------------
// A comp a PARTICIPANT typed in — the building a tenant found themselves —
// turned into a row we are willing to store.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md (slice 2,
// question 4). NOT the connection hub at /brokers.
//
// PURE, and it requires exactly one thing: broker-vault.js, for its number and
// date parsers. That is the backtest.js → valuation.js precedent — a pure
// module may build on another pure module, and here it MUST, because the
// alternative is a second set of rules for what "1.2M" means. A broker's CSV
// and a tenant's typed box have to agree about that or the same string becomes
// a rejection in one place and a wrong number in the other.
//
// Two rules shape everything below, and they are broker-vault.js's own:
//
//   1. REJECT, NEVER GUESS. A field we cannot read with certainty comes back
//      as an error naming it, not as a best effort. This is somebody's space
//      search; a wrong price they did not type is worse than a form they have
//      to fix.
//
//   2. NOTHING HERE THROWS. This is untrusted input arriving over HTTP.
//
// And one rule that is this file's own:
//
//   3. IT CLAIMS NO PROVENANCE. The output carries no `verified`, no
//      `source_type`, and no broker attribution of any kind. A tenant pasting
//      a listing they saw is the weakest evidence in the product, and the
//      whole comp-provenance system exists to stop weak evidence wearing
//      strong clothes. Who added it is recorded on the ROW
//      (hub_items.added_by_email), never inside the snapshot where it would
//      read as a source.
// ---------------------------------------------------------------------------

const VAULT = require("./broker-vault.js");

// What a participant may fill in. Deliberately short: this is a building they
// want to talk about, not a book entry. Per-type spec columns (clear height,
// units, acres) are absent on purpose — a tenant does not have them, and a
// form that asks reads as homework.
const MANUAL_FIELDS = [
  "address", "property_type", "transaction", "deal_date",
  "price", "size_sqft", "notes", "source_url",
];

const MAX_ADDRESS = 300;
const MAX_NOTES = 500;

function str(v) { return String(v == null ? "" : v).trim(); }

// broker-vault.js's parsers answer with a RESULT OBJECT, `{ok: true, value}`
// or `{ok: false, error}` — not a bare value and not null. Treating one as a
// value is silent and total: the first draft of this file did exactly that,
// so `price: "1.2M"` was stored as the parser's own result object and the
// "reject, never guess" promise in the header above was false on the line
// under it. Found by running it, not by reading it.
//
// The parser's `error` is passed through rather than replaced, because those
// strings are already written for the person who typed the value ("write
// 1200000, not 1.2M") and a second voice saying the same thing worse helps
// nobody.
function take(field, raw, parse, errors, fallbackMsg) {
  const r = parse(raw);
  if (r && r.ok === true) return r.value;
  errors.push((r && r.error) || fallbackMsg);
  return undefined;
}

/**
 * @param {object} input  whatever the browser posted
 * @returns {{comp: object|null, errors: string[]}}  errors are product copy
 */
function normalizeManualComp(input) {
  const src = input && typeof input === "object" ? input : {};
  const errors = [];
  const comp = {};

  // The one required field. A comp with no address is not a comp, it is a
  // note — and the hub already has notes.
  const address = str(src.address);
  if (!address) errors.push("Give the building an address or a name.");
  else if (address.length > MAX_ADDRESS) errors.push("That address is too long.");
  else comp.address = address;

  // Everything below is optional, and an EMPTY value is never an error — a
  // tenant who knows only the address should still be able to add it.
  const type = str(src.property_type);
  if (type) {
    const v = take("property_type", type, VAULT.parsePropertyType, errors,
      `"${type}" is not a property type we recognize.`);
    if (v !== undefined) comp.property_type = v;
  }

  const transaction = str(src.transaction);
  if (transaction) {
    const v = take("transaction", transaction, VAULT.parseTransaction, errors,
      `"${transaction}" should be a sale or a lease.`);
    if (v !== undefined) comp.transaction = v;
  }

  const dealDate = str(src.deal_date);
  if (dealDate) {
    const v = take("deal_date", dealDate, VAULT.parseDate, errors,
      "Write the date as YYYY-MM-DD.");
    if (v !== undefined) comp.deal_date = v;
  }

  // parseMoney and parseNumber are the vault's, so "1.2M" is refused here for
  // exactly the reason it is refused in an import: it could mean 1,200,000 or
  // it could be a typo, and we do not guess at somebody's money.
  const price = str(src.price);
  if (price) {
    const v = take("price", price, VAULT.parseMoney, errors,
      "Write the price as a plain number, like 2850000.");
    if (v !== undefined) comp.price = v;
  }

  const size = str(src.size_sqft);
  if (size) {
    const v = take("size_sqft", size, VAULT.parseNumber, errors,
      "Write the size as a plain number of square feet.");
    if (v !== undefined) comp.size_sqft = v;
  }

  const notes = str(src.notes);
  if (notes.length > MAX_NOTES) errors.push("That note is too long.");
  else if (notes) comp.notes = notes;

  // A link is the only provenance a tenant-added comp can honestly offer, and
  // it is offered as a link and nothing more. http(s) only: a javascript: or
  // data: URL would become an anchor href on a page other people open.
  const url = str(src.source_url);
  if (url) {
    if (!/^https?:\/\/[^\s]+$/i.test(url)) errors.push("A link has to start with http:// or https://.");
    else comp.source_url = url;
  }

  // $/SF only for a SALE with both numbers, which is broker-vault.js's rule
  // and matters for the same reason: an annual rent divided by size is
  // $/SF/year, a different unit, and putting it in this column would corrupt
  // any comparison a reader makes down it.
  if (comp.transaction === "sale" && comp.price > 0 && comp.size_sqft > 0) {
    comp.price_per_sqft = Math.round((comp.price / comp.size_sqft) * 100) / 100;
  }

  return { comp: errors.length ? null : comp, errors };
}

module.exports = { normalizeManualComp, MANUAL_FIELDS, MAX_ADDRESS, MAX_NOTES };
