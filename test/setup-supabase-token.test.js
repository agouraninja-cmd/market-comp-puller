"use strict";

// scripts/setup-supabase-token.js writes a secret into a file somebody else
// already has content in, so its refusals and its don't-touch-that rules are
// the whole job. Requiring it must start NOTHING (the require.main guard).

const test = require("node:test");
const assert = require("node:assert");
const SETUP = require("../scripts/setup-supabase-token.js");

const SBP = "sbp_" + "a".repeat(40);

// --- what counts as a token --------------------------------------------------

test("validateToken accepts an sbp_ token and trims what a paste brings", () => {
  assert.equal(SETUP.validateToken(SBP).ok, true);
  assert.equal(SETUP.validateToken(`  ${SBP}\n`).token, SBP);
});

test("validateToken names the service key rather than failing generically", () => {
  // The likeliest wrong paste by far: it is the credential this repo carries
  // everywhere else, and "invalid token" would send somebody looking for a
  // typo in the right string instead of reaching for the other one.
  const r = SETUP.validateToken("eyJhbGciOiJIUzI1NiJ9.abc.def");
  assert.equal(r.ok, false);
  assert.match(r.why, /service key/i);
});

test("validateToken refuses empty, quoted and space-carrying pastes", () => {
  assert.equal(SETUP.validateToken("").ok, false);
  assert.equal(SETUP.validateToken(null).ok, false);
  assert.equal(SETUP.validateToken(`"${SBP}"`).ok, false);
  assert.equal(SETUP.validateToken(`${SBP} # my token`).ok, false);
  assert.equal(SETUP.validateToken("sbp_short").ok, false);
});

test("maskToken proves which token without handing it over", () => {
  const masked = SETUP.maskToken(SBP);
  assert.ok(masked.startsWith("sbp_aaaa"));
  assert.ok(!masked.includes(SBP));
  assert.ok(masked.length < SBP.length);
});

// --- writing into a file that is already somebody's --------------------------

test("upsertEnvLine appends when the key is absent, leaving the rest alone", () => {
  const before = "ANTHROPIC_API_KEY=sk-ant-x\n";
  const { text, replaced } = SETUP.upsertEnvLine(before, "SUPABASE_ACCESS_TOKEN", SBP);
  assert.equal(replaced, false);
  assert.ok(text.startsWith("ANTHROPIC_API_KEY=sk-ant-x"));
  assert.ok(text.includes(`SUPABASE_ACCESS_TOKEN=${SBP}`));
});

test("upsertEnvLine replaces in place, so re-running never duplicates a key", () => {
  const before = `SUPABASE_ACCESS_TOKEN=sbp_old\nOTHER=1\n`;
  const { text, replaced } = SETUP.upsertEnvLine(before, "SUPABASE_ACCESS_TOKEN", SBP);
  assert.equal(replaced, true);
  assert.equal(text.match(/^SUPABASE_ACCESS_TOKEN=/gm).length, 1);
  assert.ok(text.includes("OTHER=1"));
  assert.ok(!text.includes("sbp_old"));
});

test("a commented line is documentation and is never rewritten into a value", () => {
  // .env.example ships these commented. Turning somebody's comment into a live
  // assignment is a surprise, and it would also hide which line is in force.
  const before = "# SUPABASE_ACCESS_TOKEN=sbp_...\n";
  const { text, replaced } = SETUP.upsertEnvLine(before, "SUPABASE_ACCESS_TOKEN", SBP);
  assert.equal(replaced, false);
  assert.ok(text.includes("# SUPABASE_ACCESS_TOKEN=sbp_..."));
  assert.ok(text.includes(`SUPABASE_ACCESS_TOKEN=${SBP}`));
});

test("CRLF files stay CRLF — this runs on the owner's Windows machine", () => {
  const { text } = SETUP.upsertEnvLine("A=1\r\nB=2\r\n", "SUPABASE_URL", SETUP.DEFAULT_URL);
  assert.ok(text.includes("\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "no bare LF should be introduced");
});

test("upsertEnvLine ends the file with exactly one newline", () => {
  const { text } = SETUP.upsertEnvLine("A=1\n\n\n", "B", "2");
  assert.ok(text.endsWith("B=2\n"));
  assert.ok(!text.endsWith("\n\n"));
});

// --- reading what is already set ---------------------------------------------

test("readActive ignores commented lines and reports the live value", () => {
  const text = "# SUPABASE_URL=https://commented.supabase.co\nSUPABASE_URL=https://real.supabase.co\n";
  assert.equal(SETUP.readActive(text, "SUPABASE_URL"), "https://real.supabase.co");
  assert.equal(SETUP.readActive("# SUPABASE_URL=x\n", "SUPABASE_URL"), null);
  assert.equal(SETUP.readActive("", "SUPABASE_URL"), null);
});

test("the default URL is the project the deploy skill names", () => {
  // apply.js derives which database it may touch from this, so a wrong default
  // here is the 036 wrong-project failure with a friendlier face.
  assert.equal(SETUP.DEFAULT_URL, "https://bqdgthxkdnpofgzfcyhl.supabase.co");
  const APPLY = require("../migrations/apply.js");
  assert.equal(APPLY.projectRefFrom(SETUP.DEFAULT_URL), "bqdgthxkdnpofgzfcyhl");
});
