// ---------------------------------------------------------------------------
// Bulk valuation — the rules for turning a pasted or uploaded list of
// addresses into one portfolio of values.
//
// PURE, like entitlements.js, comp-gate.js and corpus-audit.js: no I/O, no
// fetch, no clock reads (the caller passes `now`). server.js owns the job
// table, the worker and the search pipeline; this file owns what counts as an
// address, what a finished row is worth, and what the totals say.
//
// Two requires, both to pure modules, and both deliberate:
//
//   valuation.js — because the number a bulk row prints has to be the SAME
//   number the single-property report prints for that address. A second
//   valuation path is exactly the hazard valuation.js was extracted to
//   prevent (its own header says so), and a portfolio that disagreed with the
//   report behind it by a few percent would be worse than no portfolio: every
//   row would need checking by hand, which is the work this feature exists to
//   remove.
//
//   broker-vault.js — for parseCsv/csvCell/isCommentRow only. A broker
//   pasting a list is the same person who uploads a comp sheet, arriving with
//   the same Excel export: a UTF-8 BOM on the first header, quoted cells
//   holding commas, `#` note lines. That parser already handles all three and
//   is tested against real broker files. Writing a second one here would mean
//   getting the BOM wrong again in a new place.
//
// See docs/superpowers/specs/2026-08-21-bulk-valuation-design.md.
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");
const VAULT = require("./broker-vault");

// The hard ceiling, regardless of what an entitlement says. It is a SPEND
// limit before it is a product limit: every address that misses the cache is
// a billed search of its own (~$0.36 and 40-70 seconds, measured — see the
// live-progress note in CLAUDE.md), so a job is a real invoice, not a click.
// 50 addresses is up to ~30 minutes and ~$18 on a cold list, which is a
// number a person can be shown before they commit to it. Higher belongs
// behind a conversation, not behind a paste box.
const MAX_ADDRESSES = 50;

// Job and row vocabulary. Validated on write, so a typo cannot invent a state
// the page has no rendering for.
const JOB_STATUSES = ["running", "done", "cancelled", "interrupted", "failed"];
const ITEM_STATUSES = ["queued", "running", "done", "failed", "skipped"];

// A job whose heartbeat is older than this is no longer being worked on:
// the process that owned it was restarted (a deploy, a Render sleep, a
// crash). Generous — a single cold search can take four minutes on a slow
// upstream, and calling a live job dead is worse than calling a dead one
// live, because the second self-corrects on the next read and the first
// abandons work already paid for.
const STALL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

// Column names a broker's own export is likely to use, normalized through the
// vault's own header normalizer so "Property Address", "property_address" and
// "PROPERTY ADDRESS" all land together.
// Spellings are the OUTPUT of VAULT.normalizeHeader, which lowercases and
// turns spaces and hyphens into underscores — so "Size SqFt" arrives here as
// "size_sqft", not "sizesqft". Getting that wrong silently costs the column
// rather than failing, which is why there is a test asserting a real
// spreadsheet header lands on each of these.
const ADDRESS_HEADERS = ["address", "property_address", "site_address", "street_address", "property", "location"];
const SIZE_HEADERS = ["size_sqft", "size", "sqft", "sq_ft", "square_feet", "building_size", "building_sf", "rsf", "gla", "sf"];
const LABEL_HEADERS = ["label", "name", "property_name", "id", "reference", "ref"];
// The single-property form's per-property inputs, as upload columns
// (2026-09-04): bulk is the comp-report tool, so a list can bring the facts
// the form asks for one address at a time. Same normalizeHeader spellings as
// the three lists above. The per-TYPE detail columns (units, clear_height,
// lot_acres…) are not listed here: their keys come in as `opts.detailKeys`,
// because TYPE_COMP_FIELDS is server.js's and this module requires nothing
// of the server's.
const ASKING_HEADERS = ["asking_price", "asking", "ask", "list_price", "price"];
const NOI_HEADERS = ["noi", "net_operating_income"];
const CAP_RATE_HEADERS = ["cap_rate", "cap", "caprate", "going_in_cap"];

// The whole job's transaction focus, exactly the single form's three values.
// Empty means the default; anything else unrecognized is null, so the route
// refuses it by name rather than quietly running "both" for a typo.
const TX_FOCUSES = ["both", "sales", "leases"];
function normalizeTxFocus(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "both";
  return TX_FOCUSES.includes(s) ? s : null;
}

/**
 * The per-property facts for ONE row, from the form (a one-address run) —
 * the shape index.html keeps in meta.subject, minus the size, which has its
 * own column and its own precedence. Numbers are cleaned, never guessed: a
 * cap rate above 100 or an asking price of "call" is dropped, and the
 * per-type details are whitelisted to the keys the caller names (the
 * server re-runs sanitizeSubjectDetails on them for enum normalization).
 * Returns null when nothing survives, so a caller can store nothing.
 */
function normalizeSubject(raw, detailKeys) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const keys = Array.isArray(detailKeys) ? detailKeys : [];
  const money = (v) => {
    const n = typeof v === "string" ? (VAULT.parseMoney(v).value) : Number(v);
    return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n) : null;
  };
  const out = {};
  const asking = money(r.asking);
  if (asking) out.asking = asking;
  const noi = money(r.noi);
  if (noi) out.noi = noi;
  const cap = typeof r.capRate === "string" ? (VAULT.parsePercent(r.capRate).value) : Number(r.capRate);
  if (Number.isFinite(cap) && cap > 0 && cap <= 100) out.capRate = Math.round(cap * 1000) / 1000;
  const d = r.details && typeof r.details === "object" && !Array.isArray(r.details) ? r.details : {};
  const details = {};
  for (const k of keys) {
    const v = String(d[k] == null ? "" : d[k]).trim().slice(0, 40);
    if (v) details[k] = v;
  }
  if (Object.keys(details).length) out.details = details;
  return Object.keys(out).length ? out : null;
}

function headerIndex(headers, names) {
  for (let i = 0; i < headers.length; i++) {
    if (names.includes(headers[i])) return i;
  }
  return -1;
}

// A key for "is this the same building", used ONLY to drop repeats within one
// pasted list. Deliberately blunt — lowercase, strip everything that is not a
// letter or a digit — because the failure it prevents is paying twice for
// "123 Main St, Boise ID" and "123 Main St., Boise, ID" in the same job, and
// over-merging two genuinely different rows in one list is far less likely
// than the punctuation drift a spreadsheet produces. It is NOT an identity
// test for storage: the corpus and the vault have their own, stricter ones.
function dedupeKey(address) {
  return String(address || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// A subject address with no digit anywhere in it is a place, not a property:
// "Downtown Boise", "Financial District", "Ontario CA". The single-property
// flow catches this at the address-confirm dialog, which bulk has no room
// for — 50 confirmations is not a workflow — so it is caught here instead,
// and REPORTED rather than silently valued. The alternative is spending a
// billed search on a submarket and printing a dollar figure under it, which
// is the exact failure isAggregateAddress exists to stop in the comp data.
//
// Deliberately a digit test and not a leading-street-number test: "One
// Bethesda Metro Center" is rare but real, while the leading-number rule
// would also refuse "Unit 4, 200 Front St" and every address a European
// export writes house-number-last. Under-refusing is the safe direction here
// because the search itself still has to find the building.
function looksLikeAddress(text) {
  const s = String(text || "").trim();
  return s.length >= 6 && /\d/.test(s);
}

/**
 * Turn pasted text or an uploaded CSV into the rows a job will run.
 *
 * Two shapes, and the distinction between them is load-bearing:
 *
 *   WITH a header row naming an address column, the text is parsed as CSV and
 *   the other columns (size, label) are read alongside.
 *
 *   WITHOUT one, EVERY LINE IS ONE WHOLE ADDRESS and nothing is split on
 *   commas. This is not a shortcut, it is the only correct reading: "123 Main
 *   St, Boise, ID 83702" is one address containing two commas, and a parser
 *   that split it would run a search for "123 Main St" in no particular city
 *   and quietly attach "83702" as a square footage. A pasted list is the
 *   common case and it must never need quoting.
 *
 * @returns {{rows: Array, skipped: Array, warnings: Array, duplicates: number, truncated: number}}
 */
function parseAddressList(text, opts) {
  const o = opts || {};
  const max = Number.isFinite(Number(o.max)) ? Math.max(0, Math.min(MAX_ADDRESSES, Number(o.max))) : MAX_ADDRESSES;
  const src = String(text == null ? "" : text);

  const grid = VAULT.parseCsv(src);
  const headers = grid.length ? grid[0].map((h) => VAULT.normalizeHeader(h)) : [];
  const addrCol = headerIndex(headers, ADDRESS_HEADERS);
  const hasHeader = addrCol >= 0 && grid.length > 1;
  const sizeCol = hasHeader ? headerIndex(headers, SIZE_HEADERS) : -1;
  const labelCol = hasHeader ? headerIndex(headers, LABEL_HEADERS) : -1;
  // The form's other inputs, per row (2026-09-04). Only a header can carry
  // them — a pasted list is addresses and nothing else.
  const askCol = hasHeader ? headerIndex(headers, ASKING_HEADERS) : -1;
  const noiCol = hasHeader ? headerIndex(headers, NOI_HEADERS) : -1;
  const capCol = hasHeader ? headerIndex(headers, CAP_RATE_HEADERS) : -1;
  const detailKeys = Array.isArray(o.detailKeys) ? o.detailKeys.map(String) : [];
  const detailCols = {};
  for (const k of detailKeys) detailCols[k] = hasHeader ? headerIndex(headers, [k]) : -1;

  // Line numbers are reported back to the person who pasted the list, so they
  // count from 1 and include the header — the number they see in the file.
  //
  // The header branch reads parseCsv's own `line` stamp rather than the array
  // index: parseCsv drops blank rows, so the index counts SURVIVING rows and a
  // single spacer line reported a rejection one line above where it actually
  // sat. The `i + 2` fallback is the old arithmetic, kept for a grid that
  // carries no stamp. The no-header branch splits `src` directly and was always
  // right, which is why it is untouched.
  const lines = hasHeader
    ? grid.slice(1).map((cells, i) => ({
        cells, line: Number.isFinite(cells.line) ? cells.line : i + 2,
      }))
    : src.split(/\r\n|\r|\n/).map((raw, i) => ({ cells: [raw], line: i + 1 }));

  const rows = [];
  const skipped = [];
  const warnings = [];
  const seen = new Set();
  let duplicates = 0;
  let truncated = 0;

  for (const { cells, line } of lines) {
    const rawAddress = String((hasHeader ? cells[addrCol] : cells[0]) || "").trim();
    if (!rawAddress) continue;                       // blank lines cost nothing and are not errors
    if (VAULT.isCommentRow([rawAddress])) continue;  // the vault template's `#` convention, same reading

    if (!looksLikeAddress(rawAddress)) {
      skipped.push({ line, address: rawAddress.slice(0, 300), reason: "That doesn't look like a street address." });
      continue;
    }
    const key = dedupeKey(rawAddress);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);

    if (rows.length >= max) { truncated++; continue; }

    // parseNumber returns {ok, value} and accepts "12,500 SF" — the shape a
    // broker's export actually holds. A cell it REFUSES is reported rather
    // than dropped: the row still runs (we look the size up instead), but a
    // size somebody typed and we ignored, with nothing on screen saying so,
    // is the silent-drop failure the vault's column mapper exists to prevent.
    let size = null;
    if (hasHeader && sizeCol >= 0) {
      const raw = String(cells[sizeCol] || "").trim();
      const parsed = VAULT.parseNumber(raw);
      if (!parsed.ok) {
        warnings.push({ line, address: rawAddress.slice(0, 300), reason: `Size "${raw.slice(0, 40)}" isn't a number — we'll look it up instead.` });
      } else if (parsed.value > 0) {
        size = parsed.value;
      }
    }
    const label = hasHeader && labelCol >= 0 ? String(cells[labelCol] || "").trim().slice(0, 120) : "";

    // The row's own property facts, when the file has columns for them. A
    // cell that does not parse is WARNED about and left out, the size rule:
    // the row still runs, but a number somebody typed and we ignored must not
    // vanish silently.
    let subject = null;
    if (hasHeader) {
      const s = {};
      const moneyAt = (col, label, key) => {
        if (col < 0) return;
        const raw = String(cells[col] || "").trim();
        if (!raw) return;
        const p = VAULT.parseMoney(raw);
        if (!p.ok) warnings.push({ line, address: rawAddress.slice(0, 300), reason: `${label} "${raw.slice(0, 40)}" isn't a number — left out.` });
        else if (p.value > 0) s[key] = Math.round(p.value);
      };
      moneyAt(askCol, "Asking price", "asking");
      moneyAt(noiCol, "NOI", "noi");
      if (capCol >= 0) {
        const raw = String(cells[capCol] || "").trim();
        if (raw) {
          const p = VAULT.parsePercent(raw);
          if (!p.ok) warnings.push({ line, address: rawAddress.slice(0, 300), reason: `Cap rate "${raw.slice(0, 40)}" isn't a percentage — left out.` });
          else if (p.value > 0) s.capRate = p.value;
        }
      }
      const details = {};
      for (const k of detailKeys) {
        const col = detailCols[k];
        if (col < 0) continue;
        const v = String(cells[col] || "").trim().slice(0, 40);
        if (v) details[k] = v;
      }
      if (Object.keys(details).length) s.details = details;
      if (Object.keys(s).length) subject = s;
    }
    rows.push({
      subject,
      address: rawAddress.slice(0, 300),
      // A size the broker already knows is worth carrying: it skips the
      // model's own two-search size lookup on that address (see
      // searchBudgetFor), so a list that brings its own square footage is
      // materially cheaper AND cannot be valued off the wrong building's
      // footprint — the failure that put a $52,000 mobile home at $795,000.
      size_sqft: size > 0 ? Math.round(size) : null,
      label: label || null,
      line,
    });
  }

  return { rows, skipped, warnings, duplicates, truncated, header: hasHeader };
}

// ---------------------------------------------------------------------------
// Valuing one finished report
// ---------------------------------------------------------------------------

function num(v) { return VALUATION.numericValue(v); }

// The subject $/SF implied by a live listing, used as a compWeight factor.
// Mirrors index.html's weightOpts(): same bounds, same "missing is neutral"
// reading. It is here rather than inlined so the bulk row and the report it
// links to weight their comps identically — if this drifts, a portfolio total
// stops reconciling with the reports underneath it and there is no way to see
// that from either screen.
function subjectPsfOf(report, sizeSqft) {
  const ask = num(report && report.subject_asking && report.subject_asking.price);
  if (!(ask > 0) || !(sizeSqft > 0)) return 0;
  const psf = ask / sizeSqft;
  return psf >= 1 && psf <= 100000 ? psf : 0;
}

/**
 * The value of one report, as a bulk row.
 *
 * This is index.html's renderOwnerHero reduced to its arithmetic, and it must
 * STAY that: same comps (sales only, which valueFromComps enforces), same
 * asOf, same trend, same weighting options. The composition itself is
 * valuation.js's, not a copy of it.
 *
 * `subjectSizeSqft` is the size the person supplied for THIS address (a
 * column in their upload). It wins over the report's own looked-up size, the
 * same precedence the form's size box has, because someone who typed a square
 * footage knows their own building better than a public record does.
 *
 * Returns null when there is nothing to value — no sale comps at all. A row
 * with a $/SF band but no size is NOT null: it returns `sized: false` and no
 * dollar figures, because "we found the market but not your building's size"
 * is a different, fixable answer from "we found nothing", and collapsing the
 * two would send someone hunting for comps that are already there.
 */
function valueFromReport(report, opts) {
  const o = opts || {};
  const rep = report || {};
  const comps = Array.isArray(rep.comps) ? rep.comps : [];

  const typed = num(o.subjectSizeSqft);
  const found = num(rep.subject_size_sqft);
  const sizeSqft = typed > 0 ? typed : (found > 0 ? found : 0);
  const sizeSource = typed > 0 ? null : (sizeSqft > 0 ? (rep.subject_size_source || "estimate") : null);

  const val = VALUATION.valueFromComps(comps, {
    subjectSF: sizeSqft,
    asOf: Number.isFinite(Number(o.asOf)) ? Number(o.asOf) : Date.now(),
    trendPct: rep.annual_price_trend_pct,
    subjectYear: VALUATION.yearOf(rep.subject_year_built),
    propertyType: o.propertyType,
    radiusMiles: VALUATION.parseRadiusMiles(o.note),
    subjectPsf: subjectPsfOf(rep, sizeSqft),
  });
  if (!val) return null;

  const saleComps = comps.filter(
    (c) => c && !String(c.transaction || "").toLowerCase().startsWith("lease"));

  return {
    sized: sizeSqft > 0,
    size_sqft: sizeSqft || null,
    size_source: sizeSource,
    // Zeroes when unsized (valueFromComps multiplies by 0), and `sized`
    // above is what the caller reads rather than inferring it from a 0.
    value_low: sizeSqft > 0 ? val.low : null,
    value_likely: sizeSqft > 0 ? val.mid : null,
    value_high: sizeSqft > 0 ? val.high : null,
    psf_low: val.psfLow,
    psf_mid: val.psfMid,
    psf_high: val.psfHigh,
    // The count the band was actually computed from, not the comp count: a
    // 10-comp lease-heavy report can carry two sale comps, and the row has to
    // be able to say so rather than implying ten deals stand behind it.
    sale_comps: val.n,
    comp_count: comps.length,
    lease_comps: comps.length - saleComps.length,
    // Below four sale comps the band is the full observed spread rather than
    // the interquartile one (see robustPpsfRange). That is a materially
    // weaker number and the page says so, so it has to ride out of here.
    trimmed: val.trimmed === true,
  };
}

// ---------------------------------------------------------------------------
// The portfolio view
// ---------------------------------------------------------------------------

/**
 * Job totals.
 *
 * The one rule worth stating: a total sums ONLY the rows that produced a
 * dollar figure, and `valued` says how many that was. A portfolio total that
 * silently treated a failed lookup as $0 would read as a cheap portfolio
 * rather than an incomplete one — the same misreport-absence-as-a-number trap
 * the vault's empty states and the broker inbox each had to fix.
 */
function summarize(items) {
  const list = Array.isArray(items) ? items : [];
  const out = {
    total: list.length,
    valued: 0, failed: 0, skipped: 0, pending: 0,
    low: 0, likely: 0, high: 0,
    unsized: 0,
  };
  for (const it of list) {
    const st = String((it && it.status) || "queued");
    if (st === "failed") out.failed++;
    else if (st === "skipped") out.skipped++;
    else if (st !== "done") out.pending++;

    const likely = Number(it && it.value_likely);
    if (st === "done" && Number.isFinite(likely) && likely > 0) {
      out.valued++;
      out.low += Number(it.value_low) || 0;
      out.likely += likely;
      out.high += Number(it.value_high) || 0;
    } else if (st === "done") {
      // Valued the market but not the building — a $/SF band with no size.
      out.unsized++;
    }
  }
  return out;
}

/**
 * The whole job as a CSV, one row per address.
 *
 * Formula-guarded through the vault's own csvCell, for the vault's reason:
 * every CSV this product emits is opened in a spreadsheet by design, and an
 * address really beginning with "-" or "=" must arrive as text.
 */
const EXPORT_COLUMNS = [
  "address", "label", "property_type", "status",
  "value_low", "value_likely", "value_high",
  "psf_low", "psf_mid", "psf_high",
  "size_sqft", "size_source", "sale_comps", "comp_count",
  "market", "note",
];
// The row's own inputs (051), APPENDED after the classic columns so a
// header-keyed consumer sees new columns and a positional one sees nothing
// move: the first sixteen columns and the totals row's positions are pinned by
// test/bulk.test.js and must stay byte-identical. The type's detail keys come
// in as `opts.detailKeys` (TYPE_COMP_FIELDS is server.js's), then the job's
// focus last — one column, every row the same value, because a CSV read
// without its title row still has to say whether it was a sales-only search.
const EXPORT_SUBJECT_COLUMNS = ["asking_price", "noi", "cap_rate"];

function exportCsv(job, items, opts) {
  const j = job || {};
  const list = Array.isArray(items) ? items : [];
  const detailKeys = (opts && Array.isArray(opts.detailKeys)) ? opts.detailKeys.map(String) : [];
  const columns = [...EXPORT_COLUMNS, ...EXPORT_SUBJECT_COLUMNS, ...detailKeys, "tx_focus"];
  const subjectCell = (it, c) => {
    const s = (it && it.subject) || {};
    if (c === "asking_price") return s.asking;
    if (c === "noi") return s.noi;
    if (c === "cap_rate") return s.capRate;
    if (c === "tx_focus") return j.tx_focus || "both";
    return s.details ? s.details[c] : "";
  };
  const sum = summarize(list);
  const lines = [];
  // A title row before the header, the same disclosure pattern the report's
  // own CSV uses: the file outlives the screen that explained it, and a
  // column of dollar figures with no provenance line is the kind of thing
  // that ends up in a client email as if it were an appraisal.
  lines.push(VAULT.csvCell(
    `CompNinja bulk valuation${j.label ? " — " + j.label : ""} · ` +
    `${sum.valued} of ${sum.total} valued · ` +
    `${j.property_type || ""} · ${j.months || ""}-month lookback · ` +
    `automated estimates, not appraisals`));
  lines.push(columns.map(VAULT.csvCell).join(","));
  for (const it of list) {
    lines.push(columns.map((c) => VAULT.csvCell(
      c === "property_type" ? (it && it.property_type) || j.property_type || ""
        : c === "note" ? (it && it.error) || ""
        : EXPORT_COLUMNS.includes(c) ? (it ? it[c] : "")
        : subjectCell(it, c))).join(","));
  }
  // The totals ride in the file, not just on the page, for the same reason
  // the title does — and they are labelled with the count they cover so a
  // partial job cannot be read as a complete one.
  lines.push("");
  lines.push([VAULT.csvCell(`Total (${sum.valued} valued)`), "", "", "",
    VAULT.csvCell(Math.round(sum.low)), VAULT.csvCell(Math.round(sum.likely)), VAULT.csvCell(Math.round(sum.high)),
  ].join(","));
  return lines.join("\n") + "\n";
}

module.exports = {
  MAX_ADDRESSES,
  JOB_STATUSES,
  ITEM_STATUSES,
  STALL_MS,
  TX_FOCUSES,
  normalizeTxFocus,
  normalizeSubject,
  parseAddressList,
  looksLikeAddress,
  dedupeKey,
  valueFromReport,
  summarize,
  exportCsv,
  EXPORT_COLUMNS,
  EXPORT_SUBJECT_COLUMNS,
};
