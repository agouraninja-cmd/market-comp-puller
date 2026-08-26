#!/usr/bin/env node
// Is the momentum read on the market pages still going to be there next month?
//
// WHY THIS EXISTS. freshDirection() publishes a market's expanding/flat/
// contracting read for DIRECTION_MAX_AGE_DAYS after the snapshot was
// generated, and every seeded page carries the stamp of the run that made it.
// The seeded set is regenerated in one go, so its reads do not fade one by
// one — they all expire on the SAME DAY. Before the momentum map that meant a
// badge quietly going dark; now momentum is the first thing on /markets, so
// the whole map turning hollow is a visible event, and it should be seen
// coming rather than reported by a customer.
//
// WHAT IT CANNOT DO. There is no way to refresh a read without refreshing the
// data under it. `scripts/derive-market-direction.js` only fills in a
// direction for a page that lacks one — it reads the trend sentence the page
// already carries and never touches `generatedAt`, which is what the age is
// measured from. Re-running it on a stale page changes nothing here, and a
// script that bumped the stamp would be publishing an old market read as a
// current one. The real refresh is a regeneration:
//
//     npm start                     # in one shell
//     node gen-market-seed.js       # in another — one billed search per market
//
// and then commit the new market-seed.json. That costs money, which is why it
// is a decision this script reports rather than takes.
//
//   node scripts/check-market-freshness.js           # report, exit 0 unless expired
//   node scripts/check-market-freshness.js --warn-days 45
//
// Exit codes: 0 healthy, 1 something has already expired or is inside the
// warning window (so a scheduled job's failure notification is the alarm).
"use strict";
const path = require("path");
const { freshDirection, DIRECTION_MAX_AGE_DAYS } = require(path.join(__dirname, "..", "market-snapshot"));
const seed = require(path.join(__dirname, "..", "market-seed.json"));

const args = process.argv.slice(2);
// Refused, never guessed (desktop.js's flag rule): a typo'd or non-positive
// --warn-days silently becoming 30 would alarm on a healthy runway — or
// worse, a deliberate "--warn-days 45" that misparsed would quietly narrow
// the warning window with nothing saying so.
let warnAt = 30;
const warnIdx = args.indexOf("--warn-days");
if (warnIdx !== -1) {
  const parsed = Number(args[warnIdx + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`--warn-days wants a positive number of days, got "${args[warnIdx + 1]}"`);
    process.exit(1);
  }
  warnAt = parsed;
}
const now = Date.now();

let withDirection = 0, live = 0, expired = 0;
let soonest = Infinity;
const byExpiry = new Map();

for (const [slug, p] of Object.entries(seed)) {
  if (!p.direction) continue;
  withDirection++;
  const stamp = Date.parse(`${String(p.generatedAt || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(stamp)) { expired++; continue; }
  const daysLeft = Math.floor(DIRECTION_MAX_AGE_DAYS - (now - stamp) / 86400000);
  if (freshDirection(p, now)) {
    live++;
    soonest = Math.min(soonest, daysLeft);
    const key = new Date(stamp + DIRECTION_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
    byExpiry.set(key, (byExpiry.get(key) || 0) + 1);
  } else {
    expired++;
  }
  if (args.includes("--verbose")) console.log(`  ${slug}: ${p.direction}, ${daysLeft} day(s) left`);
}

const total = Object.keys(seed).length;
console.log(`${total} seeded market page(s): ${withDirection} carry a momentum read.`);
console.log(`  live today: ${live}`);
console.log(`  expired:    ${expired}`);
for (const [when, n] of [...byExpiry].sort()) console.log(`  ${n} read(s) expire on ${when}`);

if (!live) {
  console.error(`\nNo market page is publishing a momentum read. The /markets map is all-hollow ` +
    `and every Explorer badge is dark. Regenerate: npm start, then node gen-market-seed.js.`);
  process.exit(1);
}
// Partial expiry is still an alarm — the exit contract in the header says
// "1 something has already expired", and a partial regeneration (a subset of
// TARGETS re-run, or one mangled stamp) can leave most of the map hollow
// while the survivors have months of runway. Healthy means EVERY read that
// exists is being published.
if (expired > 0) {
  console.error(`\n${expired} momentum read(s) have already expired — those markets are hollow on the ` +
    `/markets map and dark in the Explorer dropdown today, whatever the survivors' runway. ` +
    `Regenerate: npm start, then node gen-market-seed.js (one billed search per market), ` +
    `and commit market-seed.json.`);
  process.exit(1);
}
if (soonest <= warnAt) {
  console.error(`\nThe soonest momentum read expires in ${soonest} day(s), inside the ${warnAt}-day ` +
    `warning window. These expire together, so this is most of the map at once. ` +
    `Regenerate: npm start, then node gen-market-seed.js (one billed search per market), ` +
    `and commit market-seed.json.`);
  process.exit(1);
}
console.log(`\nHealthy — the soonest read expires in ${soonest} day(s).`);
