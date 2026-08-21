#!/usr/bin/env node
// Claude Code PostToolUse hook: regenerate the vendored tailwind.css whenever
// index.html is edited in a session.
//
// Why this exists: tailwind.css is a pre-generated build committed to the repo
// (it replaced the Play CDN). A NEW utility class added to index.html is not in
// that file, so it silently does not style -- the page looks subtly wrong and
// nothing errors. This regenerates the file so that cannot happen.
//
// Why it lives in setup/ rather than in .claude/hooks/ in git: .gitignore
// ignores all of .claude/ except skills/, so a hook committed there would be
// invisible to a fresh clone. The installer copies this file into place.
//
// Rules:
//   - It NEVER blocks an edit. Every failure path exits 0 with a note.
//   - It only fires for index.html, and only in a checkout that really is this
//     project (tailwind.config.js + tailwind.input.css must both be present).
//   - It reports the byte delta, because "it ran" and "the class landed" are
//     different claims and only the second one matters.
//
// Installed by setup-windows.ps1 / setup-mac.sh. Registered in .claude/settings.json.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TAILWIND = "tailwindcss@3.4.17";

function done(msg) {
  if (msg) process.stdout.write(`[regen-tailwind] ${msg}\n`);
  process.exit(0); // always 0 -- this hook must never fail an edit
}

let payload = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim()) payload = JSON.parse(raw);
} catch {
  // No stdin (run by hand) -- fall through and regenerate unconditionally.
}

const edited = payload?.tool_input?.file_path || payload?.tool_input?.filePath || "";
const viaHook = Boolean(payload?.tool_name);

if (viaHook && path.basename(edited).toLowerCase() !== "index.html") done();

const root = payload?.cwd || process.cwd();
const config = path.join(root, "tailwind.config.js");
const input = path.join(root, "tailwind.input.css");
const output = path.join(root, "tailwind.css");

if (!fs.existsSync(config) || !fs.existsSync(input)) done();

const before = fs.existsSync(output) ? fs.statSync(output).size : 0;

try {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", TAILWIND, "-c", config, "-i", input, "-o", output, "--minify"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }
  );
} catch (err) {
  done(
    `could not regenerate tailwind.css (${err.code || "failed"}). ` +
      `Run it by hand before committing:\n  npx --yes ${TAILWIND} -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify`
  );
}

const after = fs.existsSync(output) ? fs.statSync(output).size : 0;
if (after === before) done(`tailwind.css unchanged (${after} bytes) -- no new utility classes.`);
done(`tailwind.css regenerated: ${before} -> ${after} bytes. Commit it alongside index.html.`);
