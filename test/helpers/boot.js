// Boot server.js as a child process and wait for /healthz. Shared by the
// route-level suites. Not named *.test.js on purpose: package.json runs
// `node --test "test/*.test.js"`, so this file is a helper, not a suite.
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "..", "server.js");

// Ports are OS-assigned per boot, never a fixed counter. Fixed bases (39140 /
// 39500) collided the day `prestart` made concurrent suite runs routine: two
// runs boot servers on the SAME deterministic ports, and a boot whose child
// dies on EADDRINUSE would happily adopt the OTHER run's server — wrong
// environment and all — because "something answers /healthz on my port" is
// not "my child is ready". Reproduced 2026-08-08 with a decoy server parked
// on 39140: the suite adopted it and failed on the decoy's env. Asking the
// OS for a free port removes the determinism; the child-alive check after a
// healthy /healthz closes the remaining adoption window.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// `env` REPLACES rather than extends the parent environment for the keys that
// matter, so a developer's local .env cannot change what these tests prove.
let bootSeq = 0;
async function boot(env) {
  const port = await freePort();
  // The responder-identity nonce: /healthz echoes TEST_BOOT_ID, and this boot
  // accepts only a responder echoing ITS nonce. "Something answers on my
  // port" is not "my child is ready" — a foreign server (another suite run,
  // an orphan from an interrupted one) answering instead means this child
  // died on EADDRINUSE, and adopting the foreigner runs every assertion
  // against the wrong environment.
  const bootId = `${process.pid}-${++bootSeq}`;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      TEST_BOOT_ID: bootId,
      ANTHROPIC_API_KEY: "",
      ADMIN_KEY: "",
      APP_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      STRIPE_SECRET_KEY: "",
      PRO_ENABLED: "",
      TESTER_PASSKEY: "",
      ...env,
    },
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited early, code " + child.exitCode);
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) {
        const body = await r.json();
        if (body.boot_id === bootId) return { base, stop: () => child.kill() };
        // Healthy answer, wrong (or no) nonce: a foreign process holds the
        // port. The child is dead or doomed; the top-of-loop check or the
        // timeout will fail this boot loudly instead of adopting a stranger.
      }
    } catch (_) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server never became healthy on port " + port + " (or a foreign process held it)");
}

module.exports = { boot, freePort };
