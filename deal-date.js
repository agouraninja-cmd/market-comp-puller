"use strict";

const MONTHS_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "2025" | "Q1 2025" | "Apr 2026" | "April 2026" | "04/2026" | "2026-04(-15)"
// -> fractional year (mid-period), else null.
function parseDealDate(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(19|20)\d{2}$/))) return Number(t) + 0.5;
  if ((m = t.match(/^q([1-4])\s*((19|20)\d{2})$/))) return Number(m[2]) + (Number(m[1]) * 3 - 1.5) / 12;
  if ((m = t.match(/^([a-z]{3,9})\.?\s+((19|20)\d{2})$/))) {
    const mo = MONTHS_IDX[m[1].slice(0, 3)];
    return mo ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^(\d{1,2})\/((19|20)\d{2})$/))) {
    const mo = Number(m[1]);
    return mo >= 1 && mo <= 12 ? Number(m[2]) + (mo - 0.5) / 12 : null;
  }
  if ((m = t.match(/^((19|20)\d{2})-(\d{2})(-\d{2})?$/))) {
    const mo = Number(m[3]);
    return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : null;
  }
  return null;
}

module.exports = { parseDealDate };
