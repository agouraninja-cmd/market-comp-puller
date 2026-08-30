const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

// migrations/verify.js, actually run.
//
// test/migrations.test.js proves its two LISTS are complete — every `create
// table` has a TABLES row, numbers are unique. Neither of those can reach the
// part that decides whether a verification means anything: the HTTP probe. A
// row that silently checks nothing looks identical to a row that checked and
// passed, and the output is the same either way, which is the exact shape of
// the 2026-07 corpus outage this whole folder was built after — fire-and-forget
// code swallowing its errors while the logs read healthy.
//
// So this spawns the real script against a stub answering PostgREST's own
// signals (404/PGRST205 for an absent table, 400/PGRST204 for an absent
// column) and reads what it concluded, the way routes.test.js boots a real
// server to prove the gates are WIRED rather than merely correct in isolation.
//
// The property that matters most here is the one in verify.js's own output:
// a 500 is "NOT proof of absence". A checker that reports an outage as a
// missing table sends somebody to run DDL against a database that is fine.

const VERIFY = path.join(__dirname, "..", "migrations", "verify.js");

// Answers every probe 200 except the names given, which get the status and
// error code PostgREST really sends. `select=*` is verify.js's table probe;
// `select=<col>` is its column probe.
function stub({ missingTables = [], missingColumns = [], breakTables = [] } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const [table, query] = req.url.replace(/^\/rest\/v1\//, "").split("?");
    const select = new URLSearchParams(query || "").get("select") || "*";
    seen.push(select === "*" ? table : `${table}.${select}`);

    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (breakTables.includes(table)) {
      return json(500, { message: "upstream connect error" });
    }
    if (missingTables.includes(table)) {
      return json(404, { code: "PGRST205",
        message: `Could not find the table 'public.${table}' in the schema cache` });
    }
    if (select !== "*" && missingColumns.includes(`${table}.${select}`)) {
      return json(400, { code: "PGRST204",
        message: `column ${table}.${select} does not exist` });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  });
  return { server, seen };
}

// Runs verify.js against a stub and returns everything it said and did.
// SUPABASE_URL/_SERVICE_KEY are passed EXPLICITLY and always non-empty: they
// are truthy, so verify.js's .env loader (which only fills what is undefined)
// cannot substitute a developer's real credentials and point this test at
// production. `seen` is asserted on below so that even if it somehow did, the
// test fails rather than quietly verifying the live database.
function runVerify(opts) {
  return new Promise((resolve) => {
    const { server, seen } = stub(opts);
    server.listen(0, "127.0.0.1", () => {
      const child = spawn(process.execPath, [VERIFY], {
        env: {
          ...process.env,
          SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
          SUPABASE_SERVICE_KEY: "stub-key-authorizes-nothing",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { out += d; });
      child.on("exit", (code) => { server.close(() => resolve({ out, code, seen })); });
    });
  });
}

test("a healthy schema reports everything present and exits 0", async () => {
  const { out, code, seen } = await runVerify();
  assert.match(out, /Everything present/);
  assert.doesNotMatch(out, /has not been run/);
  assert.strictEqual(code, 0);
  // Proof this ran against the stub and not a real database — without it a
  // passing test could mean "verified production", which is not this test's
  // job and would depend on whose .env is on the machine.
  assert.ok(seen.length > 60, `expected many probes, saw ${seen.length}`);
  assert.ok(seen.includes("users"), "expected a table probe for users");
});

test("an absent table is named under the migration that creates it", async () => {
  const { out, code } = await runVerify({ missingTables: ["broker_bovs"] });
  assert.match(out, /broker_bovs/);
  assert.match(out, /019-broker-bovs\.sql/);
  assert.match(out, /has not been run/);
  assert.strictEqual(code, 1);
});

test("an absent column is named under the migration that adds it", async () => {
  const { out, code } = await runVerify({
    missingColumns: ["portfolio_items.verified_key"],
  });
  assert.match(out, /portfolio_items\.verified_key/);
  assert.match(out, /035-portfolio-verified-key\.sql/);
  assert.strictEqual(code, 1);
});

test("an absent table suppresses its own column probes", async () => {
  // Not a nicety: org_contacts has both a table row and column rows, and
  // reporting "org_contacts missing" plus "org_contacts.email missing" is the
  // same fact told twice, in a report somebody reads under pressure.
  const { out, code, seen } = await runVerify({ missingTables: ["org_contacts"] });
  assert.match(out, /org_contacts/);
  assert.ok(!seen.includes("org_contacts.email"),
    "column probes must not run for a table already reported absent");
  assert.doesNotMatch(out, /org_contacts\.email/);
  assert.strictEqual(code, 1);
});

test("verify.js never calls process.exit()", () => {
  // Found by this file, not by reading: the suite runs test files
  // concurrently, and under that load process.exit() tore the script down
  // while its fetch sockets were still open — 0xC0000409 on Windows, 13 of 16
  // concurrent runs, 0 of 16 once the exit became natural. It matters beyond
  // the suite because a crash is a non-zero exit exactly like a missing table
  // is, so it reads as "the schema is wrong" while destroying the output that
  // said which migration to run. Setting process.exitCode and returning also
  // guarantees stdout flushes, which is how this tool's result becomes
  // evidence in APPLIED.md.
  const src = require("node:fs").readFileSync(VERIFY, "utf8");
  const live = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(live, /process\.exit\(/,
    "use `process.exitCode = N` and return — see the comment above main()");
});

test("an error that is not a 404 is NOT reported as a missing table", async () => {
  // The load-bearing honesty property, and verify.js says it in its own
  // output: an outage is not evidence the schema is wrong. Reporting one as a
  // missing table sends somebody to run DDL against a database that is fine —
  // and 016 is the scar that says re-running DDL by hand is not free.
  const { out, code } = await runVerify({ breakTables: ["users"] });
  assert.match(out, /could not check/i);
  assert.match(out, /NOT proof of absence/);
  assert.doesNotMatch(out, /has not been run/);
  // Still non-zero: unable to verify is not the same as verified.
  assert.strictEqual(code, 1);
});
