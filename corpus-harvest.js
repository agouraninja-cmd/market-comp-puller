"use strict";

const { isAggregateAddress } = require("./corpus-audit");

const HARVESTABLE_SOURCES = ["public_record", "listing"];

function sourceOf(comp) {
  return String((comp && comp.source_type) || "").trim().toLowerCase();
}

function hasAddress(comp) {
  return Boolean(comp && String(comp.address || "").trim());
}

function hasPriceString(comp) {
  return Boolean(String((comp && comp.price_or_rate) || "").trim() ||
                 String((comp && comp.price_per_sqft) || "").trim());
}

function rawDate(comp) {
  return String((comp && (comp.date || comp.deal_date)) || "");
}

function shouldHarvest(comp) {
  if (!hasAddress(comp)) return false;
  if (!hasPriceString(comp)) return false;
  if (isAggregateAddress(comp.address)) return false;
  return HARVESTABLE_SOURCES.includes(sourceOf(comp));
}

function listingDateForHarvest(comp) {
  const d = rawDate(comp).trim();
  if (sourceOf(comp) === "listing" && !d) return "Active";
  return d;
}

function isOnMarketListing(row, parseDealDate) {
  if (sourceOf(row) !== "listing") return false;
  const n = Number(String((row && (row.price_or_rate || row.price_per_sqft)) || "").replace(/[^0-9.]/g, ""));
  if (!(Number.isFinite(n) && n > 0)) return false;
  return parseDealDate(row.deal_date || row.date) == null;
}

function splitRetrieved(rows, opts) {
  const parseDealDate = opts.parseDealDate;
  const cutoffFrac = opts.cutoffFrac;
  const corpusNum = opts.corpusNum;
  const usable = [];
  const listed = [];
  for (const r of rows || []) {
    const st = sourceOf(r);
    const priced = corpusNum(r.price_or_rate) || corpusNum(r.price_per_sqft);
    if (st === "listing" && priced && parseDealDate(r.deal_date) == null) {
      listed.push(r);
      continue;
    }
    if (st === "estimate" || st === "news") continue;
    const d = parseDealDate(r.deal_date);
    if (priced && d != null && d >= cutoffFrac) usable.push(r);
  }
  return { usable, listed };
}

module.exports = {
  HARVESTABLE_SOURCES,
  shouldHarvest,
  listingDateForHarvest,
  isOnMarketListing,
  splitRetrieved,
};
