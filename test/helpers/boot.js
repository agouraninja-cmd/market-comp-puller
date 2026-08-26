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
//
// freePort() is inherently a race: the probe socket closes before the child
// binds, so anything else on the machine can take the port in that window and
// the child dies on EADDRINUSE with exit code 1. Rare locally, real on CI
// runners (it failed the main build after passing the identical tree twice,
// 2026-08-20) — and because `prestart` runs this suite, the same race can
// block a production deploy. So boot() retries on a NEW port, but only when
// the child's stderr proves it was the port race: a deterministic boot crash
// (e.g. the bogus-SEARCH_PROVIDER test, which asserts on "exited early") must
// still fail on the first attempt, loudly, with its stderr in the message —
// the CI failure this fixes was undiagnosable precisely because stderr went
// to stdio: "ignore".
let bootSeq = 0;
async function boot(env) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bootOnce(env);
    } catch (err) {
      lastErr = err;
      if (!err.portRace) throw err;
    }
  }
  throw lastErr;
}

async function bootOnce(env) {
  // An explicit PORT is honoured, which is what lets a caller know the URL
  // BEFORE the server starts — scripts/firm-sandbox.js needs it, because
  // SITE_URL is read once at startup and every link the app generates is
  // built from it. Every suite omits it and keeps the OS-assigned port.
  const fixedPort = env && env.PORT ? Number(env.PORT) : 0;
  const port = fixedPort || await freePort();
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
      // Blanked for the same reason as the Anthropic key, and it became
      // load-bearing the day SEARCH_PROVIDER started defaulting to gemini: with
      // this unset the child inherits a real key from the developer's .env, the
      // missing-key guard stops firing, and a suite this file guarantees to be
      // free would start making BILLED search calls.
      GEMINI_API_KEY: "",
      // Blanked so a developer with MODEL= in their own .env cannot change what
      // these tests prove — server.js's loader only fills a var that is
      // undefined, so an empty string here stays empty and MODEL falls back to
      // the provider's default, which is what the /healthz assertion pins.
      MODEL: "",
      ADMIN_KEY: "",
      APP_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      STRIPE_SECRET_KEY: "",
      PRO_ENABLED: "",
      TESTER_PASSKEY: "",
      // Same reason as TESTER_PASSKEY above, and load-bearing for the same
      // assertion: "the route does not exist when no passkey is set" boots
      // with neither, so a developer's own VAULT_PASSKEY would turn that 404
      // into a 401 and fail a test about a deployment they are not running.
      VAULT_PASSKEY: "",
      // Same argument again: "the Google routes 404 when unconfigured" boots
      // with neither set, and a developer holding a real OAuth client in their
      // environment would turn that 404 into a live redirect to Google.
      GOOGLE_OAUTH_CLIENT_ID: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      GOOGLE_OAUTH_TOKEN_URL: "",
      ...env,
    },
    // stderr is piped (stdout stays ignored: the startup banner is noise)
    // so an early exit can say WHY — and so the EADDRINUSE race is
    // distinguishable from a real crash. Capped: a crash message is small,
    // and this must never buffer a runaway log.
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { if (stderr.length < 8192) stderr += c; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) {
      const excerpt = stderr.trim().split("\n").slice(0, 3).join(" | ").slice(0, 300);
      const err = new Error("server exited early, code " + child.exitCode
        + (excerpt ? " — " + excerpt : ""));
      // Only this one failure retries (see boot()): the port was stolen in
      // freePort()'s close-to-bind window, which says nothing about the code.
      // Never retried when the caller named the port: a different port is not
      // what they asked for, and retrying the SAME one would just loop.
      err.portRace = !fixedPort && /EADDRINUSE/.test(stderr);
      throw err;
    }
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
