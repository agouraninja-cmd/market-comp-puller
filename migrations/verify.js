#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Does the live database actually have every table the code expects?
//
//   node migrations/verify.js
//
// Zero dependencies, READ-ONLY. It cannot create, alter or drop anything — it
// asks PostgREST for zero rows from each table and reports which ones answer
// 404. Running DDL still means the Supabase SQL editor; see README.md.
//
// WHY THIS EXISTS: this folder's whole cautionary tale is a migration that was
// written, committed, and never run. The ALTER in 004 shipped in code in July
// 2026 and sat unapplied for weeks while every corpus insert silently failed
// and the logs looked healthy. APPLIED.md is the written record of what was
// run; this is the way to check that the record is TRUE, in ten seconds,
// without pasting SQL into a web UI and reading the result by eye.
//
// It replaces the hand-run verification query APPLIED.md used to carry, so the
// list of expected tables lives in exactly one place: TABLES, below.
//
// Not part of CI, deliberately: CI holds no secrets (a fork PR could
// exfiltrate them), and this needs the service key. It is a local command, run
// before or after a deploy that changes the schema.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

// Every table the application expects to exist, with the migration that
// creates it. KEEP IN STEP WITH APPLIED.md — a new migration adds a line here.
const TABLES = [
  ["leads",               "000-baseline-hand-created.sql"],
  ["search_cache",        "000-baseline-hand-created.sql"],
  ["shared_reports",      "000-baseline-hand-created.sql"],
  ["analytics_events",    "000-baseline-hand-created.sql"],
  ["comp_submissions",    "000-baseline-hand-created.sql"],
  ["comp_corpus",         "001-comp-corpus.sql"],
  ["users",               "002-accounts.sql"],
  ["sessions",            "002-accounts.sql"],
  ["portfolio_items",     "002-accounts.sql"],
  ["watchlist_items",     "002-accounts.sql"],
  ["password_resets",     "002-accounts.sql"],
  ["broker_profiles",     "003-broker-network.sql"],
  ["dev_ideas",           "005-dev-ideas.sql"],
  ["devlog_overrides",    "006-devlog-overrides.sql"],
  ["contacts",            "007-contacts.sql"],
  ["subscriptions",       "008-pro-billing.sql"],
  ["branding_profiles",   "008-pro-billing.sql"],
  ["report_purchases",    "008-pro-billing.sql"],
  ["export_usage",        "008-pro-billing.sql"],
  ["stripe_events",       "008-pro-billing.sql"],
  ["subject_sizes",       "009-subject-sizes.sql"],
  ["market_pages",        "010-market-pages.sql"],
  ["guest_search_quota",  "011-guest-search-quota.sql"],
  ["broker_uploads",      "013-broker-vault.sql"],
  ["broker_comps",        "013-broker-vault.sql"],
  ["broker_coverage",     "015-broker-lead-inbox.sql"],
  ["lead_intro_requests", "015-broker-lead-inbox.sql"],
  ["broker_properties",   "016-broker-comps-star.sql"],
  ["report_viewers",      "018-report-sharing.sql"],
  ["hubs",                "024-messaging-hub.sql"],
  ["hub_participants",    "024-messaging-hub.sql"],
  ["hub_items",           "024-messaging-hub.sql"],
  ["hub_messages",        "024-messaging-hub.sql"],
  ["user_avatars",        "027-account-avatar.sql"],
  ["orgs",                "030-enterprise-orgs.sql"],
  ["org_members",         "030-enterprise-orgs.sql"],
  ["org_comps",           "032-org-shared-comps.sql"],
  ["org_subscriptions",   "033-org-billing.sql"],
];

// Migrations that ALTER an existing table are the dangerous ones, and a
// table-existence check cannot see them at all: `comp_corpus` existed
// throughout the 004 outage — ten COLUMNS were missing, every insert 400'd,
// and the table check would have reported everything fine.
//
// PostgREST answers a select for an unknown column with 400/PGRST204, which is
// the same signal the app itself trips over, so this asks the same question the
// broken code would.
const COLUMNS = [
  ["comp_submissions",  ["cited_count"],                        "003-broker-network.sql"],
  ["comp_corpus",       ["building_class", "floor_plate", "center_type", "anchor_tenant",
                         "units", "price_per_unit", "lot_acres", "price_per_acre",
                         "zoning", "beds_baths"],               "004-comp-corpus-per-type-columns.sql"],
  // Named here for the same reason as 004's ten: harvest and corpus retrieval
  // both name every per-type column, so a missing one silently freezes the
  // corpus rather than raising anything.
  ["comp_corpus",       ["condition"],                          "028-comp-condition.sql"],
  ["users",             ["stripe_customer_id"],                 "008-pro-billing.sql"],
  ["analytics_events",  ["duration_ms", "searches", "out_tokens", "rescue"],
                                                                "012-search-timings.sql"],
  // 013's own columns, so a partially-applied file is caught too — the vault's
  // dedupe_key and published flag are load-bearing and easy to drop by hand.
  ["broker_comps",      ["dedupe_key", "market", "published", "deal_date", "price_per_sqft"],
                                                                "013-broker-vault.sql"],
  // Without this column unpublish cannot reliably find the public copy, and a
  // comp the broker believes they retracted keeps being offered to reports.
  ["broker_comps",      ["published_submission_id"],             "014-vault-publish-link.sql"],
  // 016 links each comp to its building. Without it linkVaultProperties()
  // logs and gives up on every upload — which it is designed to survive, so
  // nothing looks broken and the dimension just stays empty. Exactly the
  // silent-failure shape 004 taught this folder to check for.
  ["broker_comps",      ["property_id"],                         "016-broker-comps-star.sql"],
  // 029 is the lease half of the vault, and its shape is the WRITE-path kind
  // this list exists for: normalizeRow puts all four keys on the row server.js
  // inserts wholesale, so a missing one makes PostgREST 400 the insert and
  // refuse the broker's ENTIRE spreadsheet, lease rows and sale rows alike.
  // Louder than the silent failures above, but still worth naming here — this
  // file is how "the owner said they ran it" becomes a fact.
  ["broker_comps",      ["rent_psf", "rent_basis", "lease_type", "rent_psf_yr"],
                                                                "029-vault-lease-rent.sql"],
  // 017 puts the building's location on the dimension so a private comp can be
  // mapped without its address being geocoded. Same silent shape as the rest
  // of this list: the coordinate PATCH is inside linkVaultProperties(), which
  // swallows its own errors by design, so a missing column means every upload
  // looks perfectly healthy and no building is ever located.
  ["broker_properties", ["lat", "lng", "geo_source", "geocoded_at"],
                                                                "017-broker-property-coordinates.sql"],
  // 018 makes a share ownable and revocable. Without these columns every
  // sharing route 400s at PostgREST, and getShareRecord's DB-configured read
  // rethrows rather than falling back to the file store — so GET
  // /api/shared answers 503 for EVERY share, including every legacy public
  // link already mailed out before this feature existed. It does NOT fall
  // back to treating a permissioned share as a public one; there is total
  // unavailability instead, and there are no permissioned shares yet to
  // mistreat in that window. Corrected 2026-08-06 review (item 3) after the
  // original wording here described a downgrade that cannot happen.
  ["shared_reports",    ["user_id", "visibility", "include_private", "revoked_at"],
                                                                "018-report-sharing.sql"],
  // 015 alters two existing tables; a table check cannot see either change.
  // A missing broker_profiles.user_id silently re-orphans profiles on email
  // change; a missing leads.size_sqft 400s every sized lead insert into the
  // ephemeral file fallback (the 004 failure shape, on PII this time).
  ["broker_profiles",   ["user_id"],                            "015-broker-lead-inbox.sql"],
  ["leads",             ["size_sqft", "id"],                    "015-broker-lead-inbox.sql"],
  // 022 and 023 hang per-account grants off `users`. Neither was checked here
  // until 2026-08-12, and they are the sharpest case in this list: both are
  // read through getSessionUser's narrowed object, so a missing column reads
  // as undefined, then false, all the way to the entitlement. The feature is
  // simply OFF for everyone it was granted to, every request succeeds, and no
  // log line is written. 023 shipped with that exact failure for a day — the
  // column was migrated and the grant set, and the vault still refused,
  // because the flag never reached computeEntitlements. Checking the column
  // here is what turns "the migration was run" from a claim into a fact.
  ["users",             ["pro_tester"],                         "022-tester-passkey.sql"],
  ["users",             ["vault_beta"],                         "023-vault-beta.sql"],
  // 024's load-bearing columns. token_hash and removed_at are the hub's
  // entire access story (one hashed token per participant, and the removal
  // that beats ownership), and hub_items.snapshot is what makes a sent comp a
  // record of what was disclosed rather than a live join into the vault.
  // Missing either is not a degraded hub, it is a 400 on every read — which
  // is the intended loud failure, but only if someone can see it named here.
  ["hub_participants",  ["token_hash", "removed_at", "role"],    "024-messaging-hub.sql"],
  ["hub_items",         ["snapshot", "private", "source_ref"],   "024-messaging-hub.sql"],
  // 026 is the one migration in this list whose absence breaks the WRITE
  // path rather than a read: logEvent inserts these two columns, and
  // PostgREST 400s an insert naming a column that does not exist, so every
  // analytics event diverts to the ephemeral file fallback and the dashboard
  // silently flattens. Checking it here is cheaper than noticing the graph.
  ["analytics_events",  ["visitor_id", "user_id", "plan"],      "026-analytics-visitor.sql"],
  // 025's absence is caught by the digest route's own 503, but only after
  // somebody triggers it. Checking here says so before the first send rather
  // than during it.
  ["watchlist_items",   ["last_digest_at"],                     "025-watchlist-digest.sql"],
  ["users",             ["digest_optout"],                      "025-watchlist-digest.sql"],
  // 027 keeps the photo bytes off `users` so getSessionUser's SELECT * never
  // pulls them. A missing table makes PUT fail (loud); a missing avatar_rev
  // reads as undefined → "" and every visitor is simply without a photo
  // (quiet). Checking both here is what turns "the migration was run" from
  // a report into a fact — same standing as 025/026 until a machine holding
  // the service key actually runs this.
  ["users",             ["avatar_rev"],                         "027-account-avatar.sql"],
  // 028 is 018's hazard again, and worse: getShareRecord SELECTs org_id by
  // name on EVERY share read, so without this column PostgREST 400s and the
  // deliberately fail-closed catch turns every legacy public link — including
  // ones already mailed to property owners with no account — into a 503. The
  // membership columns only cost the new feature; this one costs the old one.
  ["shared_reports",    ["org_id"],                             "030-enterprise-orgs.sql"],
  ["org_members",       ["joined_at", "removed_at", "role"],    "030-enterprise-orgs.sql"],
  // 029 is the member's half of the firm's auto-share default. Its absence is
  // quiet rather than fatal — every member reads as "has not chosen" and
  // follows the firm — which is exactly why it is named here: a member who
  // said NO would silently start following the firm again.
  ["org_members",       ["auto_share"],                         "031-org-auto-share.sql"],
];

// Same tiny .env reader server.js uses, so this works the same way locally.
function loadEnv() {
  const file = path.join(__dirname, "..", ".env");
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const k = t.slice(0, eq).trim();
      if (!out[k]) out[k] = t.slice(eq + 1).trim();
    }
  } catch (_) { /* no .env is fine if the vars are already exported */ }
  return out;
}

async function main() {
  const env = loadEnv();
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_KEY || "");
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required (put them in .env).");
    process.exit(2);
  }
  // Never print the key, and print only enough of the host to prove which
  // project was checked — this output gets pasted into chats and issues.
  const columnChecks = COLUMNS.reduce((n, c) => n + c[1].length, 0);
  console.log(`Checking ${url.replace(/^https?:\/\//, "").slice(0, 12)}… — ` +
    `${TABLES.length} tables, ${columnChecks} columns\n`);

  const missing = [];
  const failed = [];
  const present = new Set();

  const ask = async (query) => {
    const r = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    return { ok: r.ok, status: r.status, body: r.ok ? "" : await r.text() };
  };

  for (const [table, migration] of TABLES) {
    try {
      const r = await ask(`${table}?select=*&limit=0`);
      if (r.ok) { present.add(table); continue; }
      // PGRST205 is specifically "table not found in the schema cache".
      if (r.status === 404 || /PGRST205/.test(r.body)) missing.push([`${table}`, migration]);
      else failed.push([table, `${r.status} ${r.body.slice(0, 80)}`]);
    } catch (err) {
      failed.push([table, err.message.slice(0, 80)]);
    }
  }

  for (const [table, cols, migration] of COLUMNS) {
    // A missing table is already reported; asking about its columns would just
    // repeat the same failure in a more confusing way.
    if (!present.has(table)) continue;
    for (const col of cols) {
      try {
        const r = await ask(`${table}?select=${encodeURIComponent(col)}&limit=0`);
        if (r.ok) continue;
        if (r.status === 400 || /PGRST204|does not exist/i.test(r.body)) {
          missing.push([`${table}.${col}`, migration]);
        } else {
          failed.push([`${table}.${col}`, `${r.status} ${r.body.slice(0, 80)}`]);
        }
      } catch (err) {
        failed.push([`${table}.${col}`, err.message.slice(0, 80)]);
      }
    }
  }

  if (failed.length) {
    console.log("Could not check (network or permissions, NOT proof of absence):");
    for (const [t, why] of failed) console.log(`  ?  ${t.padEnd(20)} ${why}`);
    console.log("");
  }

  if (!missing.length && !failed.length) {
    console.log("Everything present — the live schema matches the code.");
    process.exit(0);
  }
  if (missing.length) {
    console.log("MISSING from the live database:");
    const byMigration = new Map();
    for (const [t, m] of missing) {
      if (!byMigration.has(m)) byMigration.set(m, []);
      byMigration.get(m).push(t);
    }
    for (const [m, ts] of byMigration) {
      console.log(`\n  ${m}  has not been run`);
      for (const t of ts) console.log(`     - ${t}`);
    }
    console.log(`\nRun the file(s) above in the Supabase SQL editor, then re-run this.`);
    console.log(`Until then, anything reading those tables fails.`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("verify failed:", err.message);
  process.exit(2);
});
