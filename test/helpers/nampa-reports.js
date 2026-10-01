// test/helpers/nampa-reports.js
// Nampa's published permit reports, made to order (2026-10-01): real PDFs in
// the layout the city's own report generator writes — the plan review table
// and the permit activity records, at the positions captured from the live
// reports (test/fixtures/nampa-reports/) — and the Permit Reports page that
// links them. A run test needs reports dated relative to TODAY (the market
// section reads complete months back from now), which no captured file can be;
// permit-reports.test.js proves these parse exactly like the captured ones.
//
// nampaRoutes(state) answers the two paths the sweep asks, through the
// test-only PERMIT_PORTAL_ORIGIN: /427/Permit-Reports and
// /DocumentCenter/View/<id>/<slug>. Every portal stub hands Nampa's paths to
// it, so a suite that never thinks about Nampa still gets a clean (empty)
// read rather than an error line.

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86400000;

// ---------------------------------------------------------------------------
// A minimal PDF: one Helvetica font, uncompressed content, a real xref.
// pages: [{ width, height, texts: [{ x, top, size, str }], vlines: [{ x, top1, top2 }] }]
// ---------------------------------------------------------------------------
function pdfString(s) {
  return "(" + String(s).replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?") + ")";
}
function tinyPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const p of pages) {
    const ops = [];
    for (const v of p.vlines || []) ops.push(`${v.x} ${p.height - v.top1} m ${v.x} ${p.height - v.top2} l S`);
    for (const t of p.texts) ops.push(`BT /F1 ${t.size || 8} Tf 1 0 0 1 ${t.x} ${p.height - t.top} Tm ${pdfString(t.str)} Tj ET`);
    const content = ops.join("\n");
    const c = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.7\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const us = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const short = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;

// The plan review table (landscape, the live report's column rules and runs).
// rows: [{ number, dateIn, issueDate?, status, project, address, applicant, scope, valuation? }]
const PLAN_RULES = [37, 108, 163, 217, 271, 407, 512, 607, 658, 708, 758, 809, 861, 911, 961, 1114, 1188];
function planReportPdf({ asOf, rows = [] }) {
  const perPage = 10, pages = [];
  for (let k = 0; k === 0 || k < rows.length; k += perPage) {
    const texts = [
      { x: 39, top: 50.25, size: 16, str: "Commercial Permit - Plan Review Status" },
      { x: 355, top: 50.25, size: 16, str: `Date: ${short(asOf)}` },
      { x: 1077, top: 50.25, size: 16, str: "City of Nampa" },
      { x: 612, top: 118.1, str: "Building &" }, { x: 1139, top: 118.1, str: "Stated" },
      { x: 53, top: 128.6, str: "Application" }, { x: 122, top: 128.6, str: "Date In" }, { x: 170, top: 128.6, str: "Issue Date" },
      { x: 231, top: 128.6, str: "Permit" }, { x: 315, top: 128.6, str: "Project Name" }, { x: 445, top: 128.6, str: "Address" },
      { x: 521, top: 128.6, str: "Contractor/Applicant" }, { x: 619, top: 128.6, str: "Energy" }, { x: 1010, top: 128.6, str: "Scope of Work" },
      { x: 1141, top: 128.6, str: "Project" },
      { x: 59, top: 139.1, str: "Permit #" }, { x: 231, top: 139.1, str: "Status" }, { x: 619, top: 139.1, str: "Review" },
      { x: 1134, top: 139.1, str: "Valuation" },
    ];
    rows.slice(k, k + perPage).forEach((r, i) => {
      const top = 163.9 + i * 44;
      texts.push(
        { x: 43, top, str: r.number }, { x: 115, top, str: us(r.dateIn) },
        ...(r.issueDate ? [{ x: 170, top, str: us(r.issueDate) }] : []),
        { x: 224, top, str: r.status }, { x: 275, top, str: r.project || "" }, { x: 412, top, str: r.address || "" },
        { x: 525, top, str: r.applicant || "" }, { x: 626, top, str: "N/A" }, { x: 969, top, str: r.scope || "" },
        { x: 1150, top, str: `$${Number(r.valuation || 0).toFixed(2)}` });
    });
    texts.push({ x: 590, top: 760, str: `Page ${pages.length + 1} of ${Math.max(1, Math.ceil(rows.length / perPage))}` });
    pages.push({ width: 1224, height: 792, texts, vlines: PLAN_RULES.map((x) => ({ x, top1: 106.65, top2: 676.1 })) });
  }
  return tinyPdf(pages);
}

// The permit activity report (portrait, label: value records). rows:
// [{ number, issueDate, address (with "Nampa, Id 836xx"), project, scope,
//    contacts: [{ roles, person, company }], valuation? }], plus `residential`
// rows printed in the Residential section the sweep must skip.
function activityReportPdf({ from, to, rows = [], residential = [] }) {
  const texts = [
    { x: 201, top: 60.75, size: 12, str: "Permit Activity Type Report" },
    { x: 228, top: 135, size: 10, str: `${us(from)} to ${us(to)}` },
  ];
  let top = 151.35;
  const section = (name, list) => {
    texts.push({ x: 24, top, size: 10, str: `Project Type: ${name}` }); top += 11;
    texts.push({ x: 24, top, size: 10, str: "Occupancy By Group: <undefined>" }); top += 14.5;
    for (const r of list) {
      texts.push({ x: 24, top, str: "Tax Account:" }, { x: 240, top, str: "Urban Renewal Area:" }, { x: 354, top, str: "No" },
        { x: 395, top, str: "Unit:" }, { x: 465, top, str: ".............." }, { x: 545, top, str: `$${Number(r.valuation || 0).toLocaleString("en-US")}` });
      top += 12;
      texts.push({ x: 24, top, str: "Permit Number:" }, { x: 102, top, str: r.number }, { x: 240, top, str: "Situs:" }, { x: 312, top, str: r.address });
      top += 12;
      texts.push({ x: 24, top, str: "Issue Date:" }, { x: 102, top, str: us(r.issueDate) }, { x: 240, top, str: "Project Name:" }, { x: 312, top, str: r.project });
      top += 13.5;
      texts.push({ x: 24, top, str: "Scope of Work:" }, { x: 102, top, str: r.scope });
      top += 12;
      for (const c of r.contacts || []) {
        texts.push({ x: 24, top, str: c.roles }, ...(c.person ? [{ x: 246, top, str: c.person }] : []), ...(c.company ? [{ x: 414, top, str: c.company }] : []));
        top += 12;
      }
      top += 4;
    }
    texts.push({ x: 200, top, str: "Permit(s)" }, { x: 250, top, str: String(list.length) }, { x: 300, top, str: "Structure Use Valuation SubTotal:" });
    top += 16;
  };
  section("Commercial", rows);
  if (residential.length) section("Residential", residential);
  return tinyPdf([{ width: 612, height: 792, texts, vlines: [] }]);
}

// The Permit Reports page. entries: [{ id, kind: "plan"|"activity", month? | from/to }]
function reportsIndexHtml(entries) {
  const link = (e) => {
    if (e.kind === "plan") {
      const name = MON[Number(e.month.slice(5, 7)) - 1];
      return `<a href="/DocumentCenter/View/${e.id}/Commercial-Permit---Plan-Review-Status---${name}">${name} ${e.month.slice(0, 4)}</a>`;
    }
    if (e.month) {
      const name = MON[Number(e.month.slice(5, 7)) - 1];
      return `<a href="/DocumentCenter/View/${e.id}/Monthly-Permit-Activity-Report---${name}-${e.month.slice(0, 4)}">${name} ${e.month.slice(0, 4)}</a>`;
    }
    const d = (iso) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
    return `<a href="/DocumentCenter/View/${e.id}/Weekly-Permit-Activity-Report-${d(e.from)}---${d(e.to)}">${us(e.from)} &ndash; ${us(e.to)}</a>`;
  };
  return `<html><body><h1>Permit Reports</h1><ul>${entries.map((e) => `<li>${link(e)}</li>`).join("")}</ul>` +
    `<a href="/DocumentCenter/View/10618/NAMPA-2040-COMPREHENSIVE-PLAN---FINAL">Comprehensive plan</a></body></html>`;
}

// A state the stub serves from: reports by id (Buffers), the order they were
// posted (ids grow), and a way to make the page or one report fail.
function nampaState() {
  return { reports: new Map(), entries: [], indexStatus: 200, failing: new Set(), hits: [] };
}
function addReport(state, entry, buf) {
  state.entries.push(entry);
  state.reports.set(String(entry.id), buf);
  return state;
}
// The default every suite gets: one empty plan review report for last month,
// so the sweep reads Nampa cleanly and stores nothing.
function quietNampa(now = Date.now()) {
  const d = new Date(now);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const asOf = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + 2 * DAY).toISOString().slice(0, 10);
  return addReport(nampaState(), { id: 900001, kind: "plan", month: last }, planReportPdf({ asOf, rows: [] }));
}

// Answers Nampa's paths; returns false for anything else.
function nampaRoutes(state) {
  return (req, res, url) => {
    if (url.pathname === "/427/Permit-Reports") {
      state.hits.push(url.pathname);
      res.writeHead(state.indexStatus, { "content-type": "text/html" });
      res.end(state.indexStatus === 200 ? reportsIndexHtml(state.entries) : "unavailable");
      return true;
    }
    const m = /^\/DocumentCenter\/View\/(\d+)\//.exec(url.pathname);
    if (m) {
      state.hits.push(url.pathname);
      const buf = state.reports.get(m[1]);
      if (!buf || state.failing.has(m[1])) { res.writeHead(buf ? 500 : 404); res.end("no"); return true; }
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(buf);
      return true;
    }
    return false;
  };
}

module.exports = { tinyPdf, planReportPdf, activityReportPdf, reportsIndexHtml, nampaState, addReport, quietNampa, nampaRoutes };
