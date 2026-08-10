"use strict";

const test = require("node:test");
const assert = require("node:assert");
const LC = require("../link-check");

test("checkableUrl accepts ordinary http/https listing URLs", () => {
  assert.equal(LC.checkableUrl("https://www.showcase.com/1200-w-industrial-blvd/12345"), true);
  assert.equal(LC.checkableUrl("http://county-assessor.example.gov/parcel?id=9"), true);
});

test("checkableUrl refuses non-http schemes, credentials, IPs, localhost, single labels", () => {
  assert.equal(LC.checkableUrl("ftp://example.com/file"), false);
  assert.equal(LC.checkableUrl("javascript:alert(1)"), false);
  assert.equal(LC.checkableUrl("https://user:pw@example.com/x"), false);
  assert.equal(LC.checkableUrl("http://192.168.1.10/admin"), false);
  assert.equal(LC.checkableUrl("http://10.0.0.1/x"), false);
  assert.equal(LC.checkableUrl("http://localhost:3000/x"), false);
  assert.equal(LC.checkableUrl("http://intranet/x"), false);
  assert.equal(LC.checkableUrl("http://[::1]/x"), false);
  assert.equal(LC.checkableUrl(""), false);
  assert.equal(LC.checkableUrl(null), false);
});

test("hostClass blocks the bot-wall list including subdomains, case-insensitively", () => {
  assert.equal(LC.hostClass("https://www.loopnet.com/Listing/123"), "blocked");
  assert.equal(LC.hostClass("https://images.crexi.com/x"), "blocked");
  assert.equal(LC.hostClass("https://WWW.REALTOR.COM/x"), "blocked");
  assert.equal(LC.hostClass("https://www.propertyshark.com/x"), "blocked");
  assert.equal(LC.hostClass("https://commercialcafe.com/x"), "fetchable");
  // Suffix match must be label-bounded: notloopnet.com is NOT loopnet.com.
  assert.equal(LC.hostClass("https://notloopnet.com/x"), "fetchable");
});

test("verdictFor: dead only for dnsNotFound, 404, 410", () => {
  assert.equal(LC.verdictFor({ dnsNotFound: true }), "dead");
  assert.equal(LC.verdictFor({ status: 404 }), "dead");
  assert.equal(LC.verdictFor({ status: 410 }), "dead");
});

test("verdictFor: 2xx/3xx are live", () => {
  assert.equal(LC.verdictFor({ status: 200 }), "live");
  assert.equal(LC.verdictFor({ status: 301 }), "live");
});

test("verdictFor: everything ambiguous is unknown", () => {
  for (const status of [400, 401, 403, 405, 429, 500, 503]) {
    assert.equal(LC.verdictFor({ status }), "unknown", `status ${status}`);
  }
  assert.equal(LC.verdictFor({ error: true }), "unknown");
  assert.equal(LC.verdictFor({}), "unknown");
  assert.equal(LC.verdictFor(null), "unknown");
});

test("applyLinkVerdicts demotes dead-linked comps to estimate and keeps the URL", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://a.example.com/1" },
    { address: "2 B St", source_type: "public_record", source_url: "https://b.example.com/2" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://a.example.com/1": "dead" });
  assert.equal(n, 1);
  assert.equal(payload.comps[0].source_type, "estimate");
  assert.equal(payload.comps[0].source_url, "https://a.example.com/1");
  assert.equal(payload.comps[1].source_type, "public_record");
});

test("applyLinkVerdicts skips verified comps and existing estimates", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://x.example.com/1", verified: true },
    { address: "2 B St", source_type: "estimate", source_url: "https://x.example.com/1" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://x.example.com/1": "dead" });
  assert.equal(n, 0);
  assert.equal(payload.comps[0].source_type, "listing");
  assert.equal(payload.comps[1].source_type, "estimate");
});

test("applyLinkVerdicts ignores live/unknown verdicts and tolerates junk shapes", () => {
  const payload = { comps: [
    { address: "1 A St", source_type: "listing", source_url: "https://a.example.com/1" },
    null,
    { address: "3 C St", source_type: "news" },
  ] };
  const n = LC.applyLinkVerdicts(payload, { "https://a.example.com/1": "live" });
  assert.equal(n, 0);
  assert.equal(payload.comps[0].source_type, "listing");
  assert.equal(LC.applyLinkVerdicts({}, {}), 0);
  assert.equal(LC.applyLinkVerdicts(null, null), 0);
});
