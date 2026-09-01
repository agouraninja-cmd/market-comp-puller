"use strict";
// ---------------------------------------------------------------------------
// A firm's own tenant contacts: what may be stored, and what a CSV of them
// means.
//
// Plan:   docs/superpowers/plans/2026-08-21-divide-and-conquer-to-aug-27.md (O5)
// Schema: migrations/039-org-contacts.sql
//
// PURE, like org-access.js and broker-vault.js's parsers: no I/O, no requires,
// no clock. server.js owns the reads and writes and hands rows in. That is what
// lets `npm test` prove every refusal below with no database.
//
// ---------------------------------------------------------------------------
// THIS LIST IS TYPED OR IMPORTED. IT IS NEVER COLLECTED.
// ---------------------------------------------------------------------------
// The plan makes that a condition of the feature existing, and the migration
// says why at length. The consequence for THIS file is that it holds no
// mapping from a lead, a hub participant or a BOV: there is deliberately no
// `fromLead()` here to be called by accident later. A future import from
// somewhere the product already knows a tenant's email is a new consent
// surface, not a new function in this file.
//
// ---------------------------------------------------------------------------
// IT REFUSES RATHER THAN GUESSES, which is broker-vault.js's rule and it
// applies for a sharper reason here: these rows are ADDRESSES SOMEBODY WILL
// MAIL. A silently mangled price is a wrong number in a report; a silently
// mangled email is a message to a stranger, or to nobody, with the sender
// believing it arrived. So a malformed address is reported by line number and
// the row is refused, never stored as a best effort and never "cleaned up".
// ---------------------------------------------------------------------------

// Free text is CAPPED rather than refused — length is not a correctness
// question and truncating a note is not the same class of error as inventing
// an address. broker-vault.js's MAX_TEXT / MAX_SHORT_TEXT, same numbers.
const MAX_TEXT = 500;
const MAX_SHORT_TEXT = 120;
const MAX_EMAIL = 200;

// One import, bounded. Not a licensing limit — a guard against a runaway paste
// turning one request into ten thousand inserts, exactly MAX_ROWS_PER_UPLOAD's
// job in the vault.
const MAX_ROWS_PER_IMPORT = 2000;

// The columns an import may fill, and the header spellings that reach them.
// Narrow on purpose: a wrong guess here silently files a company as a person.
const FIELDS = ["name", "email", "company", "notes"];
const HEADER_ALIASES = {
  name: ["contact", "contact_name", "full_name", "tenant", "tenant_name", "person"],
  email: ["email_address", "e_mail", "mail"],
  company: ["organisation", "organization", "firm", "business", "tenant_company", "account"],
  notes: ["note", "comment", "comments", "detail", "details"],
};

function str(v) { return v == null ? "" : String(v); }

// Control characters are stripped because these strings are rendered on a page
// and written into a CSV export — validateIdentity's rule, same reason. A
// formula-shaped value (`=`, `+`, `-`, `@`) is deliberately NOT touched here:
// that is `guardFormula`'s job at the CSV boundary, so a company really called
// "+Plus Logistics" keeps its name in the product.
function clean(v, max) {
  // \x00-\x1F and \x7F written as ESCAPES, never as literal bytes. A literal
  // control character in source survives an editor, a copy-paste and a diff
  // looking exactly like whitespace, and this repo has been bitten by that
  // before; the first draft of this line lost its range entirely on the way
  // to disk and silently stopped stripping anything.
  return str(v).replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, max);
}

// Deliberately permissive about what an address may CONTAIN and strict about
// its shape: one @, something either side, a dot in the domain, no spaces.
//
// It is not RFC 5322 and does not try to be — a full grammar accepts things no
// mail server will and rejects nothing anybody actually types. What this
// catches is the real import failure: a name in the email column, a phone
// number, two addresses in one cell, a trailing comma from a paste.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

function validEmail(raw) {
  const s = clean(raw, MAX_EMAIL).toLowerCase();
  if (!s) return { ok: true, value: null };
  if (!EMAIL_RE.test(s)) return { ok: false, error: `"${str(raw).trim().slice(0, 60)}" is not an email address` };
  return { ok: true, value: s };
}

// One contact, validated. Returns { row, errors } — never throws, and never
// returns a half-built row alongside errors, so a caller cannot store one by
// forgetting to check.
function normalizeContact(src) {
  const errors = [];
  const row = {};

  row.name = clean(src && src.name, MAX_SHORT_TEXT);
  // The only required field. A tenant rep who knows a person and a company but
  // not yet an address still has a contact worth keeping; a row with no name
  // at all is a blank line somebody pasted.
  if (!row.name) errors.push("name is required");

  const email = validEmail(src && src.email);
  if (email.ok) row.email = email.value; else errors.push(email.error);

  row.company = clean(src && src.company, MAX_SHORT_TEXT) || null;
  row.notes = clean(src && src.notes, MAX_TEXT) || null;

  return errors.length ? { row: null, errors } : { row, errors: [] };
}

// A patch over a stored contact, validated as the WHOLE row it would become.
//
// broker-vault.js's `validateEdit` rule and its reason: re-running the merged
// row through the same function every written row goes through is what stops
// an edit accepting something an import would refuse. Keys outside FIELDS are
// dropped rather than rejected, so a browser sending an extra field gets the
// edit it asked for rather than an error it cannot act on.
function validateContactEdit(existing, patch) {
  const merged = {};
  for (const f of FIELDS) {
    merged[f] = (patch && Object.prototype.hasOwnProperty.call(patch, f))
      ? patch[f]
      : (existing ? existing[f] : null);
  }
  return normalizeContact(merged);
}

// Which column of a CSV feeds which field.
//
// A header maps only when it is EXACTLY a field name or EXACTLY one of that
// field's aliases, and only when exactly ONE column claims it — the CSV
// mapper's rule (2026-08-10) and its reason: two columns both looking like
// "name" should map neither rather than pick the first, because picking wrong
// files a company as a person and nothing on screen would say so.
function mapHeaders(headers, normalizeHeader) {
  const norm = (headers || []).map((h) => normalizeHeader(h));
  const claims = new Map();
  norm.forEach((h, i) => {
    if (!h) return;
    for (const field of FIELDS) {
      if (h === field || (HEADER_ALIASES[field] || []).includes(h)) {
        if (!claims.has(field)) claims.set(field, []);
        claims.get(field).push(i);
      }
    }
  });
  const map = {};
  for (const [field, idxs] of claims) if (idxs.length === 1) map[field] = idxs[0];
  return map;
}

// A whole CSV, as rows to insert plus the reasons anything was refused.
//
// `parseCsv` and `isCommentRow` are INJECTED rather than required, so this file
// keeps its no-requires rule and the vault's own reader stays the single
// implementation — a second CSV parser would be a second answer to what a
// quoted comma means. Comment rows (`#` in the first cell) are skipped and
// COUNTED, the template's rule: a silent drop is the failure that rule exists
// to prevent.
//
// Nothing is stored if the file names no `name` column. A file we cannot find
// names in produces zero contacts however many rows it has, and saying so is
// far better than importing two thousand blanks.
function parseContactsCsv(text, { parseCsv, isCommentRow, normalizeHeader }) {
  return parseContactsGrid(parseCsv(str(text)), { isCommentRow, normalizeHeader });
}

// The same rules, over a grid somebody else split.
//
// It exists because a CSV is no longer the only door. xlsx.js hands back rows
// in exactly the shape parseCsv produces — cells, blank rows already dropped,
// a non-enumerable `line` — and a spreadsheet import has to obey the identical
// header mapping, the identical refusals and the identical cap. A second copy
// of this loop is how one door quietly starts accepting a row the other one
// rejects.
function parseContactsGrid(rows, { isCommentRow, normalizeHeader }) {
  if (!Array.isArray(rows) || !rows.length) {
    return { rows: [], errors: ["That file is empty."], commented: 0, total: 0 };
  }

  const headers = rows[0] || [];
  const map = mapHeaders(headers, normalizeHeader);
  if (map.name == null) {
    return {
      rows: [], commented: 0, total: 0,
      errors: ['No "name" column. Name the column holding the person — "name", "contact" or "tenant" all work.'],
    };
  }

  const out = [];
  const errors = [];
  let commented = 0;
  let total = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] || [];
    // A wholly blank line costs nothing and is not worth an error.
    if (!cells.some((c) => str(c).trim())) continue;
    if (isCommentRow(cells)) { commented += 1; continue; }
    total += 1;

    if (out.length >= MAX_ROWS_PER_IMPORT) {
      errors.push(`Stopped at ${MAX_ROWS_PER_IMPORT} contacts — split the file and import the rest.`);
      break;
    }

    const src = {};
    for (const f of FIELDS) if (map[f] != null) src[f] = cells[map[f]];
    const { row, errors: rowErrors } = normalizeContact(src);
    // The number a person can act on is the one in THEIR sheet, so it comes
    // off the row's own `line` stamp — broker-vault.js:1158's rule, adopted
    // here late. `i + 1` counts the compacted grid, which has had blank rows
    // dropped out of it, so one spacer row above a bad address pointed the
    // refusal at the wrong line; a quoted cell spanning several lines pushed
    // it further still. Kept as the fallback for a splitter that stamps
    // nothing.
    const lineNo = Number.isFinite(cells.line) ? cells.line : i + 1;
    if (rowErrors.length) errors.push(`Line ${lineNo}: ${rowErrors.join("; ")}`);
    else out.push(row);
  }

  return { rows: out, errors, commented, total };
}

// Two contacts are the same person when they share an email, compared
// case-insensitively. Contacts WITHOUT an email are never merged: we cannot
// know whether two people called "Dana Wu" are one, and guessing would quietly
// destroy one of them. The database index says exactly the same thing, so a
// race that slips past this still cannot write a duplicate.
function dedupeKey(row) {
  const email = str(row && row.email).trim().toLowerCase();
  return email || null;
}

// Drop contacts already held by the firm, and duplicates inside the file
// itself. Reports what it dropped rather than silently importing fewer than
// the file held — parseUpload's "imported N of M" rule.
function dropExisting(rows, existingEmails) {
  const have = new Set((existingEmails || [])
    .map((e) => str(e).trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const kept = [];
  let duplicates = 0;
  for (const row of rows || []) {
    const key = dedupeKey(row);
    if (key && (have.has(key) || seen.has(key))) { duplicates += 1; continue; }
    if (key) seen.add(key);
    kept.push(row);
  }
  return { rows: kept, duplicates };
}

module.exports = {
  normalizeContact,
  validateContactEdit,
  parseContactsCsv,
  parseContactsGrid,
  mapHeaders,
  dropExisting,
  dedupeKey,
  FIELDS,
  MAX_ROWS_PER_IMPORT,
  MAX_TEXT,
  MAX_SHORT_TEXT,
};
