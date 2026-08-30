const fs = require("fs");
let s = fs.readFileSync("outreach-draft.js", "utf8");
const a =
  "  // A unit designator names one tenant's suite, not the property somebody\n" +
  "  // owns. index.html refuses to measure or photograph these for the same\n" +
  "  // reason; writing to \"Suite 200\" is writing to the wrong person.\n";
if (!s.includes(a)) { console.error("MISS comment"); process.exit(1); }

const b =
  "  // A unit designator names one tenant's suite, not the property somebody\n" +
  "  // owns. index.html refuses to measure or photograph these for the same\n" +
  "  // reason; writing to \"Suite 200\" is writing to the wrong person.\n" +
  "  //\n" +
  "  // ⚠ UNIT_KEYWORDS and UNIT_DESIGNATOR_RE are a deliberate mirror of\n" +
  "  // index.html's, pinned character-for-character by test/outreach-draft.js's\n" +
  "  // \"the two copies of the unit vocabulary agree\" case. This file is Node and\n" +
  "  // that one is a static page that cannot require a module, so the pair is\n" +
  "  // kept honest by a test rather than by sharing code — the ORG.SHOP_COPY\n" +
  "  // precedent.\n" +
  "  //\n" +
  "  // The copy that used to live here was written loose and cost real coverage:\n" +
  "  // \"lot|building|space|room|fl\" matched any following word, so \"500 Lot Ave\",\n" +
  "  // \"900 Building Materials Way\" and \"100 Space Center Blvd\" were all read as\n" +
  "  // units — and because FL is a state, EVERY Florida address was excluded from\n" +
  "  // outreach targeting. Silently: a refusal here just means the building is\n" +
  "  // never written to.\n";
s = s.replace(a, b);

const oldRe =
  "  if (/\b(apt|apartment|unit|ste|suite|spc|space|trailer|lot|bldg|building|rm|room|fl|floor)\b\.?\s*[#]?\s*[a-z0-9-]+/i.test(addr)) return false;\n" +
  "  if (/#\s*[a-z0-9-]+/i.test(addr)) return false;\n";
if (!s.includes(oldRe)) { console.error("MISS regex"); process.exit(1); }
s = s.replace(oldRe, "  if (unitDesignatorOf(addr)) return false;\n");

// The shared vocabulary, above isTargetable.
const anchor = "function isTargetable(row) {";
const decl = [
  "// The unit vocabulary, mirrored from index.html (see the note inside",
  "// isTargetable). After a keyword the identifier must carry a digit (\"Apt 3B\",",
  "// \"Ste 200\") or be one or two bare letters after whitespace (\"Bldg B\") —",
  "// matching any following word instead reads \"3 Ste Genevieve Ave\" as suite",
  "// Genevieve, and a keyword plus one or two letters spells ordinary words",
  "// (\"Roomy\" is room + y, \"Lotus\" is lot + us, \"United\" is unit + ed).",
  "const UNIT_KEYWORDS = \"apt|apartment|unit|ste|suite|spc|space|lot|trlr|trailer\" +",
  "  \"|bldg|building|rm|room|fl|floor|penthouse|ph\";",
  "const UNIT_DESIGNATOR_RE = new RegExp(",
  "  \"(?:^|[\\s,])(?:#\\s*[a-z0-9-]+|(?:\" + UNIT_KEYWORDS + \")\\.?\" +",
  "  \"(?:\\s*[a-z0-9-]*\\d[a-z0-9-]*|\\s+[a-z]{1,2}))(?=$|[\\s,])\", \"i\");",
  "",
  "// A trailing state + ZIP is dropped BEFORE the vocabulary is applied: \"fl\" is",
  "// a keyword and FL is a state, so without this every Florida address reads as",
  "// floor 33101. Stripping the tail rather than special-casing FL is the",
  "// general fix — that suffix is never a unit designator whatever the keyword",
  "// list grows to, and a genuine \"Fl 3\" still matches once it is gone.",
  "const ADDRESS_TAIL_RE = ADDRESS_TAIL_SOURCE;",
  "function unitDesignatorOf(address) {",
  "  const m = UNIT_DESIGNATOR_RE.exec(String(address || \"\").replace(ADDRESS_TAIL_RE, \"\"));",
  "  return m ? m[0].trim() : null;",
  "}",
  "",
].join("\n");
s = s.replace(anchor, decl + anchor);
s = s.replace("module.exports = { addressKeyOf,",
  "module.exports = { unitDesignatorOf, UNIT_KEYWORDS, addressKeyOf,");

fs.writeFileSync("outreach-draft.js", s);
console.log("outreach-draft.js patched");
