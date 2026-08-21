"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDealDate } = require("../deal-date");
const H = require("../corpus-harvest");

function corpusNum(v) {
  const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const pricedListing = {
  address: "100 Main St, Boise, ID",
  source_type: "listing",
  price_or_rate: "$1,200,000",
  date: "Mar 2025",
};

test("shouldHarvest keeps priced listing and public_record", () => {
  assert.equal(H.shouldHarvest(pricedListing), true);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "public_record" }), true);
});

test("shouldHarvest refuses estimate, news, empty source, unpriced, aggregate, missing address", () => {
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "estimate" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "news" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, price_or_rate: "", price_per_sqft: "" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, address: "Market Median, Boise, ID" }), false);
  assert.equal(H.shouldHarvest({ ...pricedListing, address: "" }), false);
});

test("shouldHarvest does not let verified open a back door for an estimate", () => {
  assert.equal(H.shouldHarvest({ ...pricedListing, source_type: "estimate", verified: true }), false);
});

test("listingDateForHarvest fills Active only for empty listing dates", () => {
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "" }), "Active");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "   " }), "Active");
  assert.equal(H.listingDateForHarvest(pricedListing), "Mar 2025");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, date: "Listed Mar 2025" }), "Listed Mar 2025");
  assert.equal(H.listingDateForHarvest({ ...pricedListing, source_type: "public_record", date: "" }), "");
});

test("isOnMarketListing is true only for priced listings with an unparseable date", () => {
  assert.equal(H.isOnMarketListing({ ...pricedListing, deal_date: "Active" }, parseDealDate, corpusNum), true);
  assert.equal(H.isOnMarketListing({ ...pricedListing, deal_date: "Mar 2025" }, parseDealDate, corpusNum), false);
  assert.equal(H.isOnMarketListing({ ...pricedListing, source_type: "estimate", deal_date: "Active" }, parseDealDate, corpusNum), false);
  assert.equal(H.isOnMarketListing({ ...pricedListing, price_or_rate: "", price_per_sqft: "", deal_date: "Active" }, parseDealDate, corpusNum), false);
  assert.equal(H.isOnMarketListing({
    ...pricedListing,
    price_or_rate: "0",
    price_per_sqft: "$85/SF",
    deal_date: "Active",
  }, parseDealDate, corpusNum), true);
});

test("splitRetrieved puts dated listings in usable and Active listings in listed", () => {
  const rows = [
    { address: "1 A St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "2 B St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Apr 2025" },
    { address: "3 C St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "May 2025" },
    { address: "4 D St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Jun 2025" },
    { address: "5 E St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Active" },
    { address: "6 F St, Boise, ID", source_type: "listing", price_or_rate: "100", deal_date: "Listed Mar 2025" },
    { address: "7 G St, Boise, ID", source_type: "estimate", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "8 H St, Boise, ID", source_type: "news", price_or_rate: "100", deal_date: "Mar 2025" },
    { address: "9 I St, Boise, ID", source_type: "public_record", price_or_rate: "100", deal_date: "Mar 2025" },
  ];
  const { usable, listed } = H.splitRetrieved(rows, {
    parseDealDate, cutoffFrac: 2025.0, corpusNum,
  });
  assert.equal(usable.length, 5); // 4 dated listings + 1 public_record
  assert.equal(listed.length, 2);
  assert.equal(listed.every((r) => r.deal_date === "Active" || r.deal_date.startsWith("Listed")), true);
  assert.equal(usable.some((r) => r.deal_date === "Active"), false);
});
