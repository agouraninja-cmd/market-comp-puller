#!/usr/bin/env node
// Stages the one half of the extraction verdict a machine cannot measure:
// spec §9's correction time, which is a person with a stopwatch fixing a
// ~10-comp file by hand. See docs/evals/extract-2026-08-27-verdict.md.
//
//   node scripts/make-correction-exercise.js <run.json> <file-substring>
//
// Writes an HTML sheet holding ONLY what the extractor returned — never the
// truth file, never the errors marked. That is the whole point: the measure
// is how long it takes somebody to FIND the mistakes against the source
// document, and a sheet that pointed at them would measure typing speed.
//
// Requiring this module starts nothing.

const fs = require("fs");
const path = require("path");

function build(runPath, want) {
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  const entry = run.raw.find((f) => f.file.includes(want));
  if (!entry) throw new Error(`no file matching "${want}" in ${runPath}`);

  const rows = entry.rows.filter((r) => r.values);
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r.values)) if (!cols.includes(k)) cols.push(k);

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows.map((r, i) => {
    const tds = cols.map((c) => `<td contenteditable>${esc(r.values[c])}</td>`).join("");
    return `<tr><td class=n>${i + 1}</td>${tds}<td class=fix><input type=checkbox></td></tr>`;
  }).join("\n");

  return `<!doctype html><meta charset=utf-8>
<title>Correction exercise — ${esc(entry.file)}</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#111}
 h1{font-size:18px;margin:0 0 4px}
 p{margin:4px 0 16px;color:#444;max-width:70ch}
 table{border-collapse:collapse;font-size:13px}
 th,td{border:1px solid #ccc;padding:4px 7px;text-align:left}
 th{background:#f3f3f3;white-space:nowrap}
 td[contenteditable]:focus{outline:2px solid #2b6cb0;background:#fffbe6}
 .n{background:#fafafa;color:#888;text-align:right}
 .fix{text-align:center}
 kbd{background:#eee;border:1px solid #bbb;border-radius:3px;padding:0 4px;font-size:12px}
</style>
<h1>Correction exercise — ${esc(entry.file)}</h1>
<p><b>Start a timer, then work down the table against the source PDF.</b> Correct any
cell that disagrees with the document by typing over it, and tick the last column on
every row you had to touch. Stop the timer when you reach the bottom. Report the
elapsed time and the number of rows ticked.</p>
<p>These are the extractor's own answers, exactly as returned. The mistakes are
<b>not</b> marked — finding them is the thing being measured.</p>
<table>
<thead><tr><th class=n>#</th>${head}<th class=fix>fixed?</th></tr></thead>
<tbody>
${body}
</tbody></table>
<p style="margin-top:16px">${rows.length} row(s).</p>
`;
}

if (require.main === module) {
  const [runPath, want] = process.argv.slice(2);
  if (!runPath || !want) {
    console.error("usage: node scripts/make-correction-exercise.js <run.json> <file-substring>");
    process.exit(1);
  }
  const html = build(runPath, want);
  const out = path.join("extract-eval", `correction-exercise-${want}.html`);
  fs.writeFileSync(out, html);
  console.log("wrote", out);
}

module.exports = { build };
