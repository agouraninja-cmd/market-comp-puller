// The Stripe price check (2026-09-25), against a real server and a stub
// Stripe.
//
// Run: npm test   (node --test, no dependencies, no network)
//
// The pages show PRICING's figures and Stripe charges whatever price id the
// environment names. At boot the server asks Stripe what each sold price
// charges; a confirmed mismatch pauses that plan's checkout rather than send
// somebody who read $49 to pay $100. This is what makes a price change safe to
// deploy before the environment is updated.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const BUYER = { id: "99999999-9999-4999-8999-999999999999", email: "buyer@example.com", name: "Buyer" };

// Answers GET /v1/prices/<id> from a table, and anything else with a
// checkout-session body (the handler reads only `url` and `id`).
async function startStubStripe(prices) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ method: req.method, path: req.url });
      res.writeHead(200, { "content-type": "application/json" });
      const m = req.method === "GET" && req.url.match(/^\/v1\/prices\/([^/?]+)/);
      if (m) return res.end(JSON.stringify(prices[decodeURIComponent(m[1])] || { error: { message: "No such price" } }));
      res.end(JSON.stringify({ id: "cs_test_session", url: "https://checkout.stripe.com/c/pay/cs_test_session", customer: "cus_stub" }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { base: `http://localhost:${server.address().port}/v1`, calls, stop: () => new Promise((r) => server.close(r)) };
}

const P = (unit_amount, interval) => ({ object: "price", unit_amount, currency: "usd", recurring: { interval, interval_count: 1 } });

test("a price that disagrees with the page pauses that checkout, and only that one", async (t) => {
  const stub = await startStubStripe({
    price_old_100: P(10000, "month"),   // the env still names the $100 price...
    price_yearly_490: P(49000, "year"), // ...while the yearly price is right.
  });
  const db = await fake.start({ tables: {
    users: [{ ...BUYER, pro_tester: false, vault_beta: false, created_at: "2025-01-01T00:00:00Z" }],
    sessions: [{ token_hash: sha256("tok-" + BUYER.id), user_id: BUYER.id, expires_at: YEAR_OUT }],
    subscriptions: [], export_usage: [], analytics_events: [],
  } });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
    STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
    STRIPE_PRICE_PRO_MONTHLY: "price_old_100",
    STRIPE_PRICE_PRO_ANNUAL: "price_yearly_490",
    STRIPE_API_URL: stub.base,
  });
  t.after(async () => { srv.stop(); await stub.stop(); await db.stop(); });

  // The check runs just after the port is bound; wait for both reads.
  for (let i = 0; i < 80 && stub.calls.filter((c) => c.method === "GET").length < 2; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 100));

  const buy = (plan) => fetch(srv.base + "/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `cn_session=tok-${BUYER.id}` },
    body: JSON.stringify({ plan }),
  });

  const monthly = await buy("pro_monthly");
  assert.equal(monthly.status, 503, "the page says $49 and Stripe would charge $100: pause, never charge");
  assert.equal((await monthly.json()).code, "price_mismatch");

  const yearly = await buy("pro_annual");
  assert.equal(yearly.status, 200, "a price that agrees keeps selling");
  assert.equal((await yearly.json()).url, "https://checkout.stripe.com/c/pay/cs_test_session");
});

test("the founding plan is no longer sold", async (t) => {
  const stub = await startStubStripe({});
  const db = await fake.start({ tables: {
    users: [{ ...BUYER, pro_tester: false, vault_beta: false, created_at: "2025-01-01T00:00:00Z" }],
    sessions: [{ token_hash: sha256("tok-" + BUYER.id), user_id: BUYER.id, expires_at: YEAR_OUT }],
    subscriptions: [], export_usage: [], analytics_events: [],
  } });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", SITE_URL: "https://compninja.co",
    STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
    STRIPE_PRICE_PRO_MONTHLY: "price_49",
    STRIPE_PRICE_PRO_ANNUAL_FOUNDING: "price_840",
    STRIPE_API_URL: stub.base,
  });
  t.after(async () => { srv.stop(); await stub.stop(); await db.stop(); });
  const r = await fetch(srv.base + "/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `cn_session=tok-${BUYER.id}` },
    body: JSON.stringify({ plan: "pro_annual_founding" }),
  });
  assert.equal(r.status, 400, "an absent plan is a 400, never a charge for a different one");
});
