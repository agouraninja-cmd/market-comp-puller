#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Put the Supabase access token into .env, without anyone having to find the
// file, know the format, or paste a secret somewhere it gets recorded.
//
//   node scripts/setup-supabase-token.js
//
// WHY THIS EXISTS: the answer to "how do I put the token in .env" was four
// steps, one of which was "find the project root" and another was "one line,
// nothing after it, no smart dash" -- a rule that exists because a stray
// character on the same line silently corrupts a key, and the failure surfaces
// later as something else entirely. That is a script's job, not a person's.
//
// It never echoes the token, never takes it as a command-line argument (which
// would land it in shell history and in terminal scrollback), and never sends
// it anywhere -- it writes one line to a gitignored file on this machine and
// stops.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", ".env");
const DEFAULT_URL = "https://bqdgthxkdnpofgzfcyhl.supabase.co"; // "Market comp puller"

// --- pure helpers (exported; see test/setup-supabase-token.test.js) ---------

// An `sbp_` token, and nothing that merely looks like one. The service key is
// the likeliest wrong paste -- it is the credential this repo carries
// everywhere else -- and it is a JWT, so it is worth naming rather than
// failing as a generic "invalid".
function validateToken(raw) {
  const token = String(raw || "").trim();
  if (!token) return { ok: false, why: "Nothing was entered." };
  if (/^eyJ/.test(token)) {
    return { ok: false, why: "That is a service key (a JWT), not an access token. PostgREST cannot run DDL, which is the whole reason this needs the other one - https://supabase.com/dashboard/account/tokens" };
  }
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(token)) {
    return { ok: false, why: "An access token looks like `sbp_` followed by letters and digits. Copy the whole thing, with no quotes or spaces." };
  }
  return { ok: true, token };
}

// Show enough to confirm the right token was pasted and not enough to reuse.
function maskToken(token) {
  return `${token.slice(0, 8)}${"*".repeat(12)}${token.slice(-4)}`;
}

// Replace the ACTIVE assignment if there is one, otherwise append. A commented
// line (the .env.example template) is left exactly where it is: it documents
// the variable, and rewriting somebody's comments to set a value is a surprise.
function upsertEnvLine(text, key, value) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = String(text).split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("#")) continue;
    if (re.test(lines[i])) { lines[i] = `${key}=${value}`; replaced = true; break; }
  }
  if (!replaced) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(`${key}=${value}`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");   // trailing newline
  return { text: lines.join(eol), replaced };
}

function readActive(text, key) {
  const re = new RegExp(`^\\s*${key}\\s*=(.*)$`);
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

// --- the prompt -------------------------------------------------------------

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DEL = String.fromCharCode(127);
const SPACE = String.fromCharCode(32);

// A paste arrives as one chunk, not one keystroke at a time, so this walks the
// chunk. Written that way because the whole point is pasting a 44-character
// token nobody is going to type.
function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Piped input (a test, or `echo ... | node ...`). Read one line plainly;
      // there is no terminal to hide it from.
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => { buf += d; });
      stdin.on("end", () => resolve(buf.split(/\r?\n/)[0]));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") return done(buf);
        if (ch === CTRL_C) { process.stdout.write("\n"); process.exit(130); }
        if (ch === BACKSPACE || ch === DEL) {
          if (buf) { buf = buf.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        if (ch < SPACE) continue;
        buf += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  console.log(`\n.env for this checkout is:\n  ${ENV_FILE}\n`);

  let text = "";
  let existed = false;
  try { text = fs.readFileSync(ENV_FILE, "utf8"); existed = true; } catch (_) {}
  if (!existed) console.log("It does not exist yet - it will be created.\n");

  console.log("Paste the access token from https://supabase.com/dashboard/account/tokens");
  console.log("(it starts sbp_ ; nothing is echoed, and Enter finishes)\n");

  const answer = await promptHidden("Token: ");
  const check = validateToken(answer);
  if (!check.ok) {
    console.error(`\nRefused - ${check.why}`);
    console.error("Nothing was written.");
    process.exit(2);
  }

  const already = readActive(text, "SUPABASE_ACCESS_TOKEN");
  const next = upsertEnvLine(text, "SUPABASE_ACCESS_TOKEN", check.token);
  text = next.text;

  // The runner derives WHICH project it may touch from this, so it is required
  // and it is not a secret. Never overwrite one already set: a deliberate value
  // here (a scratch project) must win over this default.
  const url = readActive(text, "SUPABASE_URL");
  let urlAction = `left as-is (${url})`;
  if (!url) {
    text = upsertEnvLine(text, "SUPABASE_URL", DEFAULT_URL).text;
    urlAction = `set to ${DEFAULT_URL}`;
  }

  fs.writeFileSync(ENV_FILE, text);

  console.log(`\nWritten to ${ENV_FILE}`);
  console.log(`  SUPABASE_ACCESS_TOKEN  ${next.replaced ? "replaced" : "added"}  ${maskToken(check.token)}`);
  console.log(`  SUPABASE_URL           ${urlAction}`);
  if (already && already !== check.token) {
    console.log("\n  (An older token was there and has been overwritten - revoke it in the dashboard.)");
  }
  console.log("\n.env is gitignored, so this cannot be committed by accident.");
  console.log("\nNow check it works - this only READS, it changes nothing:\n");
  console.log("  node migrations/apply.js --check\n");
}

module.exports = { validateToken, maskToken, upsertEnvLine, readActive, DEFAULT_URL };

if (require.main === module) {
  main().catch((err) => {
    console.error("setup failed:", err.message);
    process.exit(2);
  });
}
