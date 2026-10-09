// The Comp report page has no property type box (2026-10-09). One address is
// looked up as it is typed and run as the type found; a list sends no type and
// the server finds each row's. These run the page's real script against a tiny
// stand-in page, because the failure that matters (a run sent with the wrong
// type, or with a type found for an address since edited away) is invisible on
// screen.

const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const MOD = require("../bulk-page");

test("the page has no type box, and says where the type comes from instead", () => {
  const page = MOD.renderBulkPageBody({ s: 200, j: { jobs: [] } });
  assert.equal(page.includes('id="bulkType"'), false, "the type select is gone");
  assert.match(page, /<span class="flab">Property type<\/span>\s*<div class="found" id="bulkTypeFound">Found from the address<\/div>/);
  assert.equal(MOD.BULK_JS.includes('$("bulkType")'), false, "nothing reads the old select");
});

// A stand-in page: every element the script asks for, created on first ask.
function makePage() {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, value: "", textContent: "", innerHTML: "", title: "", className: "", hidden: false,
    disabled: false, style: {}, options: [], files: null, handlers: {},
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    querySelectorAll() { return []; },
    focus() {}, click() {},
    fire(type) { for (const fn of this.handlers[type] || []) fn({ key: "", preventDefault() {} }); },
  });
  const timers = [];
  const fetches = [];
  const apiCalls = [];
  const ctx = {
    document: { getElementById: el, querySelectorAll: () => [] },
    window: { scrollTo() {} },
    location: { search: "", href: "" },
    URLSearchParams,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    fetch: (url, init) => {
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      fetches.push({ url, body: JSON.parse(init.body), answer: (json) => resolve({ ok: true, json: () => json }) });
      return p;
    },
    BULKRUN: {
      init() {}, setJobs() {}, poll() {}, setMax() {}, msg() {}, showNotes() {}, showRun() {},
      state: () => ({ job: null }),
      countLines: (t) => String(t || "").split(/\r?\n/).filter((l) => l.trim()).length,
      api: (method, url, body) => { apiCalls.push({ method, url, body }); return Promise.resolve({ job: { id: "j1", total: 1 }, items: [] }); },
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(MOD.BULK_JS, ctx);
  vm.runInContext("BULKPAGE.start({ s: 200, j: { jobs: [] } })", ctx);
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  const settle = () => new Promise((r) => setImmediate(r));
  const type = (text) => { el("bulkText").value = text; el("bulkText").fire("input"); };
  return { el, fetches, apiCalls, flushTimers, settle, type };
}

test("one address is looked up, shown, and run as the type found", async () => {
  const p = makePage();
  p.type("4080 N Pecos Rd, Las Vegas, NV 89115");
  p.flushTimers();
  assert.equal(p.fetches.length, 1);
  assert.equal(p.fetches[0].url, "/api/property-type");
  assert.equal(p.fetches[0].body.address, "4080 N Pecos Rd, Las Vegas, NV 89115");
  assert.equal(p.el("bulkTypeFound").textContent, "Looking it up…");
  p.fetches[0].answer({ type: "Industrial", confidence: "high", evidence: "A 33,075 SF warehouse." });
  await p.settle();
  assert.match(p.el("bulkTypeFound").innerHTML, /^Industrial<span class="sub"> · found from the address<\/span>$/);
  assert.match(p.el("bulkTypeFound").title, /33,075 SF warehouse/);
  assert.match(p.el("bulkSubjectFields").innerHTML, /Clear height/, "that type's own fields appear");
  p.el("run").fire("click");
  await p.settle();
  assert.equal(p.apiCalls[0].url, "/api/bulk");
  assert.equal(p.apiCalls[0].body.type, "Industrial");
});

test("an answer for an address since edited away is never shown or sent", async () => {
  const p = makePage();
  p.type("100 First St, Boise, ID");
  p.flushTimers();
  p.type("200 Second St, Boise, ID");
  p.fetches[0].answer({ type: "Office", confidence: "high", evidence: "" });
  await p.settle();
  assert.ok(!/Office/.test(p.el("bulkTypeFound").innerHTML + p.el("bulkTypeFound").textContent));
  p.el("run").fire("click");
  await p.settle();
  assert.equal(p.apiCalls[0].body.type, "", "the stale answer must not ride with the new address");
});

test("a list sends no type, so the server finds each row's", async () => {
  const p = makePage();
  p.type("100 First St, Boise, ID\n200 Second St, Boise, ID");
  p.flushTimers();
  assert.equal(p.fetches.length, 0, "a list is not looked up in the browser");
  assert.equal(p.el("bulkTypeFound").textContent, "Found for each address");
  p.el("run").fire("click");
  await p.settle();
  assert.equal(p.apiCalls[0].body.type, "");
});

test("an address nothing could type still runs, and says so", async () => {
  const p = makePage();
  p.type("999 Nowhere Rd, Boise, ID");
  p.flushTimers();
  p.fetches[0].answer({ type: null });
  await p.settle();
  assert.equal(p.el("bulkTypeFound").textContent, "Found when the report runs");
  p.el("run").fire("click");
  await p.settle();
  assert.equal(p.apiCalls[0].body.type, "");
});
