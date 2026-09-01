#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Hand a named account or firm the product, without Stripe.
//
//   node scripts/grant.js status  owner@adlerindustrial.com
//   node scripts/grant.js vault   owner@adlerindustrial.com          --confirm
//   node scripts/grant.js pro     owner@adlerindustrial.com --months 6 --confirm
//   node scripts/grant.js firm    "Adler Industrial"        --months 6 --confirm
//
// WHY THIS EXISTS: onboarding a first customer runs into a loop the product
// cannot unwind on its own. Creating a firm needs `canUseOrg`, which tracks a
// paid plan — and the firm is the thing that would grant the plan. So a
// brand-new account cannot create the firm it is being onboarded into, and the
// only sanctioned doors (TESTER_PASSKEY, VAULT_PASSKEY) both deliberately
// withhold bulk valuation, which is the single most persuasive thing to put in
// front of a portfolio owner on day one.
//
// The unwind is two hand-grants that already have precedent in this codebase:
// `users.vault_beta` (migration 023, "set by hand in the SQL editor, one
// broker at a time") and a comped subscription row. This is that SQL editor,
// with the guards written down instead of remembered.
//
// WHAT A COMPED SUBSCRIPTION ROW ACTUALLY GRANTS. `getEntitlements` consults a
// firm subscription as an ORDINARY subscription row (entitlements.js knows
// nothing about firms), so one row with status `active` gives every SEATED
// member the whole product: Pro reports, the ten-year window, unlimited
// exports, the vault, the Address Explorer, search demand, branding, and bulk
// valuation. That is the point — and it is also why this script refuses more
// than it accepts.
//
// FOUR RULES, each of which is a way this could go wrong quietly:
//
//   1. IT NEVER CREATES A PERSON. Identity is the email (migration 018's
//      rule), and an account carries a password nobody here can set. Everyone
//      signs themselves up first; this only ever finds a row that exists.
//
//   2. IT NEVER TOUCHES A ROW THAT HAS BEEN NEAR STRIPE. A subscription
//      carrying a stripe_subscription_id belongs to somebody who is paying,
//      and both writing over it and deleting it are ways to hand a paying
//      customer a free plan — or take one away — with nothing on either
//      screen explaining it. Cancelling belongs in Stripe, so this refuses.
//
//   3. AN AMBIGUOUS FIRM IS NOT A FIRM. Names are free text; two firms can
//      share one. Granting "the first match" is how the wrong firm gets a
//      plan, so 0 matches and 2+ matches are both refusals that print what
//      they found.
//
//   4. IT WRITES NOTHING WITHOUT --confirm. outreach.js's rule: the default
//      run says what it would do and stops.
//
// Revoking is the same command with --revoke. The grants deliberately do not
// ride the lapse rules (they were never billing), so a comp ends when somebody
// ends it and not before.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function loadEnv() {
  // server.js's own tiny loader, minus the server.
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch (_) { /* no .env — the refusal below names what is missing */ }
}

// ---------------------------------------------------------------------------
// PostgREST, with server.js's own header rule.
// ---------------------------------------------------------------------------
let SUPABASE_URL = "";
let SUPABASE_SERVICE_KEY = "";

function headers(extra) {
  // Legacy service_role keys are JWTs and go in BOTH headers. New-style
  // sb_secret_... keys are not JWTs — sending one as a bearer makes the
  // gateway reject the whole request (401), so it gets apikey only.
  const h = { "content-type": "application/json", apikey: SUPABASE_SERVICE_KEY };
  if (SUPABASE_SERVICE_KEY.startsWith("eyJ")) {
    h.authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
  }
  return Object.assign(h, extra || {});
}

async function sb(method, pathAndQuery, body, extra) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: headers(extra),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Supabase ${method} ${pathAndQuery.split("?")[0]} failed ` +
      `(${r.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;
const REPRESENT = { prefer: "return=representation" };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Identity is the email, normalized the way org-access.js normalizes it, so a
// grant typed with different capitalization still lands on the right row.
const normEmail = (s) => String(s || "").trim().toLowerCase();

async function findUser(email) {
  const rows = await sb("GET",
    `users?email=eq.${enc(email)}&select=id,email,pro_tester,vault_beta&limit=2`);
  if (!rows || !rows.length) return null;
  if (rows.length > 1) throw new Error(`more than one account for ${email}`);
  return rows[0];
}

// select=* on purpose: `orgs` has gained columns over four migrations (kind in
// 036, seats and share_default in 030/031) and naming one this deployment has
// not run yet would 400 the whole script on an operator's first use.
async function findOrgs(name) {
  return (await sb("GET", `orgs?name=eq.${enc(name)}&select=*&limit=5`)) || [];
}

async function allOrgs() {
  return (await sb("GET", "orgs?select=id,name&order=created_at.asc&limit=50")) || [];
}

async function orgMembers(orgId) {
  return (await sb("GET", `org_members?org_id=eq.${enc(orgId)}` +
    "&select=email,role,joined_at,removed_at&order=joined_at.asc.nullslast&limit=200")) || [];
}

async function findSub(table, column, id) {
  const rows = await sb("GET", `${table}?${column}=eq.${enc(id)}&select=*&limit=1`);
  return (rows && rows[0]) || null;
}

// ---------------------------------------------------------------------------
// The Stripe guard (rule 2). Applied identically to a person's subscription
// and a firm's, because the failure is the same on both.
// ---------------------------------------------------------------------------
function refuseIfBilled(sub, what) {
  if (!sub) return;
  const id = sub.stripe_subscription_id || sub.stripe_customer_id;
  if (!id) return;
  throw new Error(
    `${what} already has a subscription attached to Stripe (${id}).\n` +
    "  Refusing: writing over it would give a paying customer a comp, and deleting it\n" +
    "  would cancel a real plan with nothing on their screen saying so. Use Stripe.");
}

const periodEnd = (months) =>
  new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStatus(email) {
  const user = await findUser(email);
  if (!user) {
    console.log(`No account for ${email}.`);
    console.log("  They sign themselves up at compninja.co first — this tool never creates a person.");
    return;
  }
  console.log(`Account ${user.email}`);
  console.log(`  id            ${user.id}`);
  console.log(`  pro_tester    ${user.pro_tester === true}   (comped Pro reports; NOT vault, NOT bulk)`);
  console.log(`  vault_beta    ${user.vault_beta === true}   (vault + can create a firm; NOT Pro reports)`);

  const sub = await findSub("subscriptions", "user_id", user.id);
  console.log(sub
    ? `  subscription  ${sub.plan} · ${sub.status} · ends ${String(sub.current_period_end).slice(0, 10)}` +
      `${sub.stripe_subscription_id ? " · STRIPE" : " · comped"}`
    : "  subscription  none");

  const memberships = await sb("GET",
    `org_members?email=eq.${enc(user.email)}&select=org_id,role,joined_at,removed_at`) || [];
  const live = memberships.filter((m) => !m.removed_at);
  if (!live.length) { console.log("  firms         none"); return; }
  for (const m of live) {
    const org = (await sb("GET", `orgs?id=eq.${enc(m.org_id)}&select=*&limit=1`) || [])[0];
    const osub = await findSub("org_subscriptions", "org_id", m.org_id);
    const state = m.joined_at ? m.role : `${m.role} · INVITED, not accepted`;
    console.log(`  firm          ${(org && org.name) || m.org_id} — ${state}`);
    console.log(`                seats ${org ? org.seats : "?"} · kind ${org ? (org.kind || "broker") : "?"}`);
    console.log(osub
      ? `                plan ${osub.plan} · ${osub.status} · ends ${String(osub.current_period_end).slice(0, 10)}` +
        `${osub.stripe_subscription_id ? " · STRIPE" : " · comped"}`
      : "                plan none — members get their own plan only");
  }
}

async function cmdUserFlag(email, field, opts) {
  const user = await findUser(email);
  if (!user) {
    throw new Error(`no account for ${email} — they sign up first, this never creates a person`);
  }
  const value = !opts.revoke;
  if (user[field] === value) {
    console.log(`${email} already has ${field} = ${value}. Nothing to do.`);
    return;
  }
  console.log(`${opts.revoke ? "REVOKE" : "GRANT"} ${field} for ${email} (${user.id})`);
  if (!opts.confirm) return;
  await sb("PATCH", `users?id=eq.${enc(user.id)}`, { [field]: value }, REPRESENT);
  console.log(`  done — ${field} = ${value}`);
}

async function cmdPro(email, opts) {
  const user = await findUser(email);
  if (!user) {
    throw new Error(`no account for ${email} — they sign up first, this never creates a person`);
  }
  const existing = await findSub("subscriptions", "user_id", user.id);
  refuseIfBilled(existing, email);

  if (opts.revoke) {
    if (!existing) { console.log(`${email} has no subscription row. Nothing to do.`); return; }
    console.log(`REVOKE comped subscription for ${email} (deletes the row)`);
    if (!opts.confirm) return;
    await sb("DELETE", `subscriptions?user_id=eq.${enc(user.id)}`);
    console.log("  done — back to the free tier");
    return;
  }

  const ends = periodEnd(opts.months);
  console.log(`GRANT comped Pro to ${email} until ${ends.slice(0, 10)} (${opts.months} months)`);
  console.log("  gives: Pro reports, ten-year window, unlimited exports, vault, Explorer,");
  console.log("         search demand, branding, bulk valuation");
  if (!opts.confirm) return;
  await sb("POST", "subscriptions?on_conflict=user_id", [{
    user_id: user.id,
    plan: "pro_monthly",
    status: "active",
    current_period_end: ends,
    cancel_at_period_end: false,
  }], { prefer: "resolution=merge-duplicates,return=representation" });
  console.log("  done");
}

async function cmdFirm(name, opts) {
  const matches = await findOrgs(name);
  if (!matches.length) {
    console.log(`No firm named "${name}".`);
    console.log("  A firm is created in the app by its owner (who needs `vault` or `pro` first).");
    const all = await allOrgs();
    if (all.length) {
      console.log("  Firms that do exist:");
      for (const o of all) console.log(`    ${o.name}`);
    } else {
      console.log("  There are no firms at all yet.");
    }
    return;
  }
  if (matches.length > 1) {
    throw new Error(`${matches.length} firms are called "${name}" — refusing to guess which one.\n` +
      matches.map((o) => `    ${o.id}`).join("\n"));
  }
  const org = matches[0];
  const members = await orgMembers(org.id);
  const active = members.filter((m) => m.joined_at && !m.removed_at);
  const invited = members.filter((m) => !m.joined_at && !m.removed_at);

  console.log(`Firm "${org.name}" (${org.kind || "broker"} shop)`);
  console.log(`  id      ${org.id}`);
  console.log(`  seats   ${org.seats}`);
  console.log(`  members ${active.length} joined, ${invited.length} invited`);
  for (const m of active) console.log(`    ${m.email} · ${m.role}`);
  for (const m of invited) console.log(`    ${m.email} · ${m.role} · has NOT accepted`);

  const existing = await findSub("org_subscriptions", "org_id", org.id);
  refuseIfBilled(existing, `"${org.name}"`);

  if (opts.revoke) {
    if (!existing) { console.log("  No subscription row. Nothing to do."); return; }
    console.log(`\nREVOKE the comped plan for "${org.name}" (deletes the row)`);
    if (!opts.confirm) return;
    await sb("DELETE", `org_subscriptions?org_id=eq.${enc(org.id)}`);
    console.log("  done — members fall back to their own plans");
    return;
  }

  const ends = periodEnd(opts.months);
  console.log(`\nGRANT a comped firm plan until ${ends.slice(0, 10)} (${opts.months} months)`);
  console.log(`  every SEATED member gets the whole product — ${active.length} people today`);
  if (invited.length) {
    console.log(`  the ${invited.length} who have not accepted get it the moment they do`);
  }
  // Seats are the commercial cap and already default to 200, so this only
  // writes when asked. Below the current headcount it would drop named
  // colleagues to free the moment it landed, which is the checkout route's own
  // `seats_below_headcount` refusal.
  if (opts.seats != null) {
    const headcount = active.length + invited.length;
    if (opts.seats < headcount) {
      throw new Error(`--seats ${opts.seats} is below the firm's headcount of ${headcount}. ` +
        "That would drop colleagues to free; raise it or leave it alone.");
    }
    console.log(`  and sets seats ${org.seats} -> ${opts.seats}`);
  }
  if (!opts.confirm) return;

  await sb("POST", "org_subscriptions?on_conflict=org_id", [{
    org_id: org.id,
    plan: "firm_monthly",
    status: "active",
    current_period_end: ends,
    cancel_at_period_end: false,
  }], { prefer: "resolution=merge-duplicates,return=representation" });
  if (opts.seats != null) {
    await sb("PATCH", `orgs?id=eq.${enc(org.id)}`, { seats: opts.seats }, REPRESENT);
  }
  console.log("  done");
}

// ---------------------------------------------------------------------------

const USAGE = `Hand a named account or firm the product, without Stripe.

  node scripts/grant.js status <email>
  node scripts/grant.js vault  <email>              [--revoke] [--confirm]
  node scripts/grant.js tester <email>              [--revoke] [--confirm]
  node scripts/grant.js pro    <email>  [--months N] [--revoke] [--confirm]
  node scripts/grant.js firm   "<name>" [--months N] [--seats N] [--revoke] [--confirm]

  vault   users.vault_beta  — the vault, and the ability to CREATE a firm.
                              Not Pro reports. The onboarding grant: the person
                              who will own the firm needs this before they can
                              make one.
  tester  users.pro_tester  — comped Pro reports. Not the vault, not bulk.
  pro     a comped subscriptions row — the WHOLE product for one person,
                              bulk valuation included.
  firm    a comped org_subscriptions row — the whole product for every seated
                              member of that firm.

Writes nothing without --confirm. Refuses to touch anything Stripe knows about.
Never creates an account; people sign themselves up first.`;

function parseArgs(argv) {
  const opts = { confirm: false, revoke: false, months: 6, seats: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--confirm") opts.confirm = true;
    else if (a === "--revoke") opts.revoke = true;
    else if (a === "--months") opts.months = Number(argv[++i]);
    else if (a === "--seats") opts.seats = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else rest.push(a);
  }
  if (!Number.isFinite(opts.months) || opts.months <= 0 || opts.months > 60) {
    throw new Error("--months must be a number of months between 1 and 60");
  }
  if (opts.seats != null && (!Number.isInteger(opts.seats) || opts.seats < 1)) {
    throw new Error("--seats must be a whole number of seats, 1 or more");
  }
  return { opts, rest };
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const [command, subject] = rest;
  // exitCode + return throughout, never process.exit() — see the catch at the
  // bottom for the Windows abort that rule exists to avoid. These two run
  // before any query and would be safe either way; one pattern is worth more
  // than the distinction.
  if (!command || !subject) { console.log(USAGE); process.exitCode = 1; return; }

  loadEnv();
  SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // Names WHERE to get them, because this repo's own .env deliberately does
    // not carry them: it holds API keys only, and the eval docs tell anyone
    // setting up a worktree to copy that one line and nothing else, precisely
    // so a stray script cannot reach production. So the honest instruction is
    // "fetch these from Render for one command", not "put them in .env".
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY are required — accounts and firms live " +
      "only in the database.\n" +
      "  This repo's .env carries API keys only, on purpose. Copy both values from the\n" +
      "  Render dashboard (Environment) and pass them for the one command:\n" +
      "    $env:SUPABASE_URL=\"https://…\"; $env:SUPABASE_SERVICE_KEY=\"…\"\n" +
      "    node scripts/grant.js status you@example.com");
  }
  // Said out loud every run: this tool's whole job is production, so the one
  // thing an operator must never be unsure about is which database they are in.
  console.log(`Database: ${SUPABASE_URL}`);
  if (!opts.confirm && command !== "status") console.log("DRY RUN — nothing will be written. Add --confirm.\n");

  const email = normEmail(subject);
  switch (command) {
    case "status": return cmdStatus(email);
    case "vault":  return cmdUserFlag(email, "vault_beta", opts);
    case "tester": return cmdUserFlag(email, "pro_tester", opts);
    case "pro":    return cmdPro(email, opts);
    case "firm":   return cmdFirm(String(subject).trim(), opts);
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\ngrant failed: ${err.message}`);
    // exitCode, never process.exit(). Forcing an exit while an HTTP
    // keep-alive socket is still closing aborts the process on Windows with a
    // libuv assertion — "!(handle->flags & UV_HANDLE_CLOSING)" — and an exit
    // code of 3221226505, so a refusal that had just printed perfectly looked
    // like a crash to anything reading the status. Every refusal here happens
    // AFTER at least one query, so this path always has a live connection pool
    // behind it; the ordinary success paths already end by returning and Node
    // exits on its own once that pool drains.
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, refuseIfBilled, normEmail, periodEnd };
