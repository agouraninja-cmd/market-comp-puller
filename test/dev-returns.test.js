// Development returns — cost -> stabilized value -> return.
//
// Every formula a development shop would make a go/no-go call on is pinned
// here, because this is the first module in the repo that produces a number
// nobody can eyeball: a wrong valuation gets argued with, a wrong IRR gets
// believed. The IRR tests verify by INDEPENDENT NPV rather than against a
// hard-coded percentage — a number I computed with the same code I am testing
// would only prove it is self-consistent.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dev-returns.js");

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// --- parsing: refuse rather than guess -------------------------------------

test("money accepts what a person types, and refuses shorthand outright", () => {
  assert.equal(D.money(1250000), 1250000);
  assert.equal(D.money("1250000"), 1250000);
  assert.equal(D.money("1,250,000"), 1250000);
  assert.equal(D.money("$1,250,000"), 1250000);
  assert.equal(D.money("0"), 0);
  // The broker-vault rule. "1.2M" read as 1.2 understates a cost a
  // million-fold and produces a spectacular IRR nobody would question.
  assert.equal(D.money("1.2M"), null);
  assert.equal(D.money("1.2m"), null);
  assert.equal(D.money("about 1200000"), null);
  assert.equal(D.money(-5), null, "a cost is never negative");
  assert.equal(D.money("-5"), null);
  assert.equal(D.money(""), null);
  assert.equal(D.money(null), null);
  assert.equal(D.money(Infinity), null);
});

test("pct accepts a bare number or a trailing %, and months are bounded", () => {
  assert.equal(D.pct("6.25%"), 6.25);
  assert.equal(D.pct(6.25), 6.25);
  assert.equal(D.pct("six"), null);
  assert.equal(D.months(18), 18);
  assert.equal(D.months("18"), 18);
  assert.equal(D.months(0), null, "a build takes at least a month");
  // Bounded so a typo cannot hand IRR a 240,000-element array to iterate.
  assert.equal(D.months(240000), null);
});

// --- cost ------------------------------------------------------------------

test("contingency is a percentage of hard + soft, never of land", () => {
  const c = D.totalCost({ land: 1000000, hard: 4000000, soft: 800000, contingencyPct: 5 });
  near(c.contingency, 240000);                  // 5% of 4.8M, NOT of 5.8M
  near(c.total, 6040000);
});

test("no costs entered is null, never a zero-cost project", () => {
  const c = D.totalCost({});
  assert.equal(c.total, null);
  assert.equal(c.contingency, null);
  // A partial entry is real: land bought, construction not yet priced.
  assert.equal(D.totalCost({ land: 1000000 }).total, 1000000);
});

test("an unparseable cost is dropped, not silently read as another number", () => {
  const c = D.totalCost({ land: "1.2M", hard: 4000000, soft: 0, contingencyPct: 0 });
  near(c.total, 4000000, 0);
  assert.equal(c.land, 0, "the refused land cost contributes nothing rather than 1.2");
});

// --- IRR -------------------------------------------------------------------

test("IRR: the rate it returns actually zeroes the NPV", () => {
  const cost = D.totalCost({ land: 1000000, hard: 4000000, soft: 800000, contingencyPct: 5 });
  const flows = D.cashflows(cost, 18, 7500000);
  const r = D.irr(flows);
  assert.ok(r > 0, "a profitable project has a positive IRR");
  const npv = flows.reduce((a, cf, t) => a + cf / Math.pow(1 + r, t), 0);
  // Independent check, relative to project size.
  assert.ok(Math.abs(npv) / cost.total < 1e-7, `NPV ${npv} does not close`);
});

test("IRR is scale-free: the same deal ten times bigger returns the same rate", () => {
  const mk = (k) => D.cashflows(
    D.totalCost({ land: 1e6 * k, hard: 4e6 * k, soft: 8e5 * k, contingencyPct: 5 }), 18, 7.5e6 * k);
  near(D.irr(mk(1)), D.irr(mk(10)), 1e-9);
  near(D.irr(mk(1)), D.irr(mk(1000)), 1e-9);
});

test("IRR refuses a series it cannot answer for, rather than returning zero", () => {
  assert.equal(D.irr([]), null);
  assert.equal(D.irr([-100]), null, "one flow is not a series");
  assert.equal(D.irr([-100, -100, -100]), null, "all outflows: no rate exists");
  assert.equal(D.irr([100, 100]), null, "all inflows: no rate exists");
  assert.equal(D.irr(null), null);
});

test("IRR is negative when the project loses money", () => {
  const cost = D.totalCost({ land: 1000000, hard: 4000000, soft: 800000, contingencyPct: 0 });
  const r = D.irr(D.cashflows(cost, 12, 4000000));   // exits below cost
  assert.ok(r < 0, `expected a loss, got ${r}`);
});

test("a break-even project returns ~0%, not null", () => {
  const cost = D.totalCost({ land: 1000000, hard: 0, soft: 0, contingencyPct: 0 });
  const r = D.irr(D.cashflows(cost, 1, 1000000));
  near(r, 0, 1e-6);
});

// --- the scorecard ----------------------------------------------------------

const DEAL = {
  cost: { land: 1000000, hard: 4000000, soft: 800000, contingencyPct: 5, buildMonths: 18 },
  stabilizedValue: 7500000,
  stabilizedNoi: 525000,
  marketCapPct: 6.5,
  sizeSqft: 50000,
};

test("the scorecard's figures agree with each other", () => {
  const s = D.summarize(DEAL);
  near(s.cost.total, 6040000);
  near(s.profit, 1460000);
  near(s.profitOnCostPct, (1460000 / 6040000) * 100);
  near(s.yieldOnCostPct, (525000 / 6040000) * 100);
  // Spread in basis points over the market cap rate — the unit the build-vs-buy
  // decision is actually made in.
  assert.equal(s.spreadBps, Math.round((s.yieldOnCostPct - 6.5) * 100));
  near(s.costPerSqft, 6040000 / 50000);
  near(s.valuePerSqft, 7500000 / 50000);
  assert.deepEqual(s.missing, []);
});

test("IRR is annualized by compounding, not by multiplying the monthly rate", () => {
  const s = D.summarize(DEAL);
  const monthly = D.irr(D.cashflows(D.totalCost(DEAL.cost), 18, DEAL.stabilizedValue));
  near(s.irrPct, (Math.pow(1 + monthly, 12) - 1) * 100, 1e-9);
  assert.ok(Math.abs(s.irrPct - monthly * 12 * 100) > 1,
    "multiplying by 12 would understate this return — the two must not coincide");
});

test("each figure is gated on its own inputs and says what is missing", () => {
  const noNoi = D.summarize({ ...DEAL, stabilizedNoi: null });
  assert.equal(noNoi.yieldOnCostPct, null, "no NOI, no yield on cost");
  assert.equal(noNoi.spreadBps, null);
  assert.ok(noNoi.profit != null, "profit needs no NOI and must still compute");
  assert.ok(noNoi.irrPct != null, "IRR needs no NOI either");
  assert.ok(noNoi.missing.includes("a stabilized NOI"));

  const noCost = D.summarize({ ...DEAL, cost: {} });
  assert.equal(noCost.profit, null);
  assert.equal(noCost.irrPct, null);
  assert.ok(noCost.missing.includes("project costs"));

  const noMonths = D.summarize({ ...DEAL, cost: { ...DEAL.cost, buildMonths: null } });
  assert.equal(noMonths.irrPct, null, "no build length, no IRR");
  assert.ok(noMonths.profit != null, "but profit does not need one");
  assert.ok(noMonths.missing.includes("a build length in months"));
});

test("nothing entered produces nulls, never a zero-cost project at 0% return", () => {
  const s = D.summarize({});
  for (const k of ["profit", "profitOnCostPct", "yieldOnCostPct", "spreadBps", "irrPct",
                   "costPerSqft", "valuePerSqft", "stabilizedValue"]) {
    assert.equal(s[k], null, `${k} should be null on an empty input`);
  }
  assert.ok(s.missing.length >= 2);
});

test("a zero total cost never divides — no Infinity reaches a card", () => {
  const s = D.summarize({ cost: { land: 0, hard: 0, soft: 0, buildMonths: 12 },
                          stabilizedValue: 1000000, stabilizedNoi: 50000 });
  assert.equal(s.profitOnCostPct, null);
  assert.equal(s.yieldOnCostPct, null);
  assert.ok(Number.isFinite(s.profit));
});

// --- portfolio --------------------------------------------------------------

test("rollup sums only what was priced, and says how much it could not price", () => {
  const a = D.summarize(DEAL);
  const b = D.summarize({ ...DEAL, cost: { ...DEAL.cost, land: 2000000 }, stabilizedValue: 9000000 });
  const blank = D.summarize({});
  const r = D.rollup([a, b, blank]);
  assert.equal(r.projects, 3);
  assert.equal(r.costed, 2);
  assert.equal(r.unpriced, 1, "the empty project is reported, not silently counted as zero");
  near(r.totalCost, a.cost.total + b.cost.total);
  near(r.totalValue, 16500000);
  near(r.totalProfit, 16500000 - (a.cost.total + b.cost.total));
});

test("portfolio yield on cost is recomputed from the sums, never averaged", () => {
  // A tiny project with a wild yield must not swing the portfolio headline.
  const big = { cost: { total: 10000000 }, stabilizedValue: 12000000, stabilizedNoi: 700000 };
  const tiny = { cost: { total: 100000 }, stabilizedValue: 150000, stabilizedNoi: 50000 };
  const r = D.rollup([big, tiny]);
  near(r.yieldOnCostPct, (750000 / 10100000) * 100);
  const averaged = ((700000 / 10000000) + (50000 / 100000)) / 2 * 100;
  assert.ok(Math.abs(r.yieldOnCostPct - averaged) > 10,
    "averaging the two percentages would report ~28% instead of ~7%");
});

test("rollup of nothing is nulls, not zeros", () => {
  const r = D.rollup([]);
  assert.equal(r.totalCost, null);
  assert.equal(r.totalValue, null);
  assert.equal(r.totalProfit, null);
  assert.equal(r.projects, 0);
});
