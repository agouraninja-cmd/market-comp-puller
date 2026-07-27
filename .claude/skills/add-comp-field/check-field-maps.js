// Consistency check for CompNinja's per-type field maps. Free, no server, no
// API calls. Run from the repo root:
//
//   "$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" \
//     .claude/skills/add-comp-field/check-field-maps.js
//
// It extracts the real maps out of server.js and index.html and evaluates them
// in their own scope (plain eval() would scope `const` to the eval and lose
// it). It never imports server.js, so nothing starts listening.
//
// What it catches, all of which fail SILENTLY in production:
//   1. A subject input whose key is not a declared comp field for that type —
//      sanitizeSubjectDetails() whitelists against TYPE_COMP_FIELDS, so the
//      value is dropped before it ever reaches the model.
//   2. A comp field with no table column — fetched, stored, never displayed.
//   3. An ALT_BASIS entry naming a field that type does not collect.
//   4. A column anchored `after` a column that does not exist — it silently
//      fails to splice and the column vanishes from the table.

const fs = require("fs");

const grab = (file, re, name) => {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(re);
  if (!m) throw new Error(`${name} not found in ${file}`);
  return new Function(`${m[0]}\nreturn ${name};`)();
};

const TYPE_COMP_FIELDS = grab("server.js", /const TYPE_COMP_FIELDS = \{[\s\S]*?\n\};/, "TYPE_COMP_FIELDS");
const TYPE_COLUMNS = grab("index.html", /const TYPE_COLUMNS = \{[\s\S]*?\n  \};/, "TYPE_COLUMNS");
const TYPE_SUBJECT_FIELDS = grab("index.html", /const TYPE_SUBJECT_FIELDS = \{[\s\S]*?\n  \};/, "TYPE_SUBJECT_FIELDS");
const ALT_BASIS = grab("index.html", /const ALT_BASIS = \{[\s\S]*?\n  \};/, "ALT_BASIS");

// Columns every type already has, so `after` anchors can resolve against them.
const BASE_KEYS = new Set([
  "address", "date", "transaction", "size_sqft", "price_or_rate",
  "price_per_sqft", "cap_rate", "notes", "source_url", "tenancy", "year_built",
]);

let problems = 0;
const fail = (msg) => { console.log("  FAIL " + msg); problems++; };

for (const type of Object.keys(TYPE_COMP_FIELDS)) {
  const compKeys = new Set(TYPE_COMP_FIELDS[type].fields);
  const cols = TYPE_COLUMNS[type] || [];
  const colKeys = new Set(cols.map((c) => c.key));
  const subj = TYPE_SUBJECT_FIELDS[type] || [];

  console.log(`\n${type}`);
  console.log(`  comp fields : ${[...compKeys].join(", ") || "(none)"}`);
  console.log(`  columns     : ${[...colKeys].join(", ") || "(none)"}`);
  console.log(`  subject     : ${subj.map((f) => f.key).join(", ") || "(none)"}`);

  // 1. Subject keys must be declared comp fields or the server strips them.
  subj.filter((f) => !compKeys.has(f.key))
    .forEach((f) => fail(`subject input "${f.key}" is not a ${type} comp field — sanitizeSubjectDetails will drop it`));

  // 2. Every comp field should be displayable somewhere.
  [...compKeys].filter((k) => !colKeys.has(k))
    .forEach((k) => fail(`comp field "${k}" has no column in TYPE_COLUMNS.${type} — collected but never shown`));

  // 3. Column anchors must resolve.
  cols.filter((c) => c.after && !BASE_KEYS.has(c.after) && !colKeys.has(c.after))
    .forEach((c) => fail(`column "${c.key}" is anchored after "${c.after}", which does not exist — it will not splice in`));
}

// 4. ALT_BASIS must reference fields the type actually collects.
for (const [type, spec] of Object.entries(ALT_BASIS)) {
  const compKeys = new Set((TYPE_COMP_FIELDS[type] || { fields: [] }).fields);
  const subjKeys = new Set((TYPE_SUBJECT_FIELDS[type] || []).map((f) => f.key));
  if (!compKeys.has(spec.compKey)) fail(`ALT_BASIS.${type}.compKey "${spec.compKey}" is not a ${type} comp field`);
  if (!subjKeys.has(spec.subjKey)) fail(`ALT_BASIS.${type}.subjKey "${spec.subjKey}" is not a ${type} subject input`);
}

console.log(problems
  ? `\n${problems} problem(s) found.`
  : "\nAll per-type field maps agree.");
process.exitCode = problems ? 1 : 0;
