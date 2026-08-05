// Boot server.js as a child process and wait for /healthz. Shared by the
// route-level suites. Not named *.test.js on purpose: package.json runs
// `node --test "test/*.test.js"`, so this file is a helper, not a suite.
const { spawn } = require("node:child_process");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "..", "server.js");

// High ports, clear of the dev servers this repo uses (3000, 3117-3121). Each
// test FILE is its own process under `node --test`, so the port counters in
// this file and in test/routes.test.js (which starts at 39140) cannot see
// each other and cannot coordinate — the only thing that keeps their actual
// port NUMBERS from colliding is a wide gap between the two bases, not the
// process isolation itself. routes.test.js boots enough servers per run to
// approach its own base from below; 39500 leaves generous headroom on both
// sides rather than the two blocks growing to meet each other unnoticed.
let nextPort = 39500;

// `env` REPLACES rather than extends the parent environment for the keys that
// matter, so a developer's local .env cannot change what these tests prove.
async function boot(env) {
  const port = nextPort++;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      ANTHROPIC_API_KEY: "",
      ADMIN_KEY: "",
      APP_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      STRIPE_SECRET_KEY: "",
      PRO_ENABLED: "",
      ...env,
    },
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited early, code " + child.exitCode);
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) return { base, stop: () => child.kill() };
    } catch (_) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server never became healthy on port " + port);
}

module.exports = { boot };
