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
//
// `phone` joined on 2026-11-23 (migration 066). A broker told the owner the
// hard part of the job is getting in front of a landlord, and a list with no
// phone column cannot hold the one thing a broker dials. It is a field like
// the others: typed, imported or edited.
const FIELDS = ["name", "email", "phone", "company", "notes"];
const HEADER_ALIASES = {
  name: ["contact", "contact_name", "full_name", "tenant", "tenant_name", "person"],
  email: ["email_address", "e_mail", "mail"],
  phone: ["phone_number", "telephone", "tel", "mobile", "cell", "cell_phone", "direct", "direct_phone", "office_phone"],
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

// A phone number is kept AS TYPED (cleaned and capped), never reformatted:
// an extension, a country code and "cell" in brackets are all things a person
// writes on purpose. What is refused is what is not a number at all, for the
// email rule's reason: a name or a street pasted into this column is a row
// nobody can dial, and saying so by line number is the fix.
const MAX_PHONE = 40;
const PHONE_CHARS_RE = /^[0-9+().,:\-\s/#*a-z]+$/i;
// Bounded by "not a letter" rather than \b, so the x of "x12" counts.
const PHONE_WORDS_RE = /(?<![a-z])(x|ext|extension|cell|mobile|office|direct|main|tel|phone|fax|o|c|m|d)(?![a-z])\.?/gi;
function validPhone(raw) {
  const s = clean(raw, 80);
  if (!s) return { ok: true, value: null };
  const digits = s.replace(/\D/g, "").length;
  // Letters are allowed only as the words people put beside a number.
  const stray = /[a-z]/i.test(s.replace(PHONE_WORDS_RE, ""));
  if (digits < 7 || digits > 20 || s.length > MAX_PHONE || !PHONE_CHARS_RE.test(s) || stray) {
    return { ok: false, error: `"${str(raw).trim().slice(0, 60)}" is not a phone number` };
  }
  return { ok: true, value: s };
}

// Where a contact came from, when it was not typed or imported (066).
//
// THE LIST IS STILL NEVER COLLECTED (the rule at the top of this file). A
// contact marked "lookup" was found by a search the member asked for and was
// saved by the member pressing Save on that one person: nothing writes a row
// here on its own. The mark and the page it was read from are kept so the
// list can say, years later, which of its numbers somebody typed and which
// came off a web page that may since have changed.
const SOURCES = ["lookup"];
const MAX_URL = 500;
function cleanSourceUrl(v) {
  const s = clean(v, MAX_URL + 1);
  return s.length <= MAX_URL && /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null;
}

// The three columns 066 added. server.js names them only once it has SEEN
// them (a probe, 061's and 063's pattern), so a deploy that runs ahead of the
// migration keeps every contact route working with the four old fields.
const V2_COLUMNS = ["phone", "source", "source_url"];
function withoutV2(row) {
  const out = {};
  for (const k of Object.keys(row || {})) if (!V2_COLUMNS.includes(k)) out[k] = row[k];
  return out;
}

// One contact, validated. Returns { row, errors } — never throws, and never
// returns a half-built row alongside errors, so a caller cannot store one by
// forgetting to check.
//
// `withSource` is passed by ONE caller, the single typed add. An import and
// an edit leave it off, so neither can write `source`: a spreadsheet cannot
// claim its rows were looked up, and editing a name does not erase where the
// number came from (the PATCH writes only the keys this returns).
function normalizeContact(src, { withSource = false } = {}) {
  const errors = [];
  const row = {};

  row.name = clean(src && src.name, MAX_SHORT_TEXT);
  // The only required field. A tenant rep who knows a person and a company but
  // not yet an address still has a contact worth keeping; a row with no name
  // at all is a blank line somebody pasted.
  if (!row.name) errors.push("name is required");

  const email = validEmail(src && src.email);
  if (email.ok) row.email = email.value; else errors.push(email.error);

  const phone = validPhone(src && src.phone);
  if (phone.ok) row.phone = phone.value; else errors.push(phone.error);

  row.company = clean(src && src.company, MAX_SHORT_TEXT) || null;
  row.notes = clean(src && src.notes, MAX_TEXT) || null;

  if (withSource) {
    row.source = SOURCES.includes(src && src.source) ? src.source : null;
    // A page with no lookup behind it is not a source, so it is not kept.
    row.source_url = row.source ? cleanSourceUrl(src && src.source_url) : null;
  }

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
  validPhone,
  withoutV2,
  FIELDS,
  SOURCES,
  V2_COLUMNS,
  MAX_ROWS_PER_IMPORT,
  MAX_TEXT,
  MAX_SHORT_TEXT,
};
