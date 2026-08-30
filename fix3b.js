const fs = require("fs");
let s = fs.readFileSync("market-snapshot.js", "utf8");
const bad = [
  "const RATE_PER_YEAR = /([d,.]+)s*/s*sfs*/s*(?:yr|year)/i;",
  "const RATE_PER_MONTH = /([d,.]+)s*/s*sfs*/s*(?:mo|month)/i;",
];
const good = [
  String.raw`const RATE_PER_YEAR = /([\d,.]+)\s*\/\s*sf\s*\/\s*(?:yr\b|year)/i;`,
  String.raw`const RATE_PER_MONTH = /([\d,.]+)\s*\/\s*sf\s*\/\s*(?:mo\b|month)/i;`,
];
bad.forEach((b, i) => {
  if (!s.includes(b)) { console.error("MISSING: " + b); process.exit(1); }
  s = s.replace(b, good[i]);
});
fs.writeFileSync("market-snapshot.js", s);
console.log("constants repaired");
