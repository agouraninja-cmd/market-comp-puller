// What brand renders, and what may be saved. Pure like entitlements.test.js:
// no server, no database, no clock.
const test = require("node:test");
const assert = require("node:assert");
const { brandForRender, validateForSave, normalizeBrand, LOGO_SAVE_MAX } = require("../branding.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
const ROW = {
  logo_url: PNG, firm_name: "Adler Industrial", preparer_name: "Jacob Adler",
  phone: "208-555-0100", email: "jacob@example.com", license_number: "SP12345",
  disclaimer: "Prepared for discussion purposes.",
};

test("a DB row normalizes to camelCase with every field carried", () => {
  const b = normalizeBrand(ROW);
  assert.equal(b.firmName, "Adler Industrial");
  assert.equal(b.preparerName, "Jacob Adler");
  assert.equal(b.licenseNumber, "SP12345");
  assert.equal(b.logo, PNG);
});

test("empty fields are omitted rather than carried as empty strings", () => {
  const b = normalizeBrand({ firm_name: "Adler Industrial", phone: "  " });
  assert.equal("phone" in b, false);
  assert.equal(b.firmName, "Adler Industrial");
});

test("a brand needs a logo or a firm name; contact details alone are not a brand", () => {
  assert.equal(normalizeBrand({ phone: "208-555-0100", email: "a@b.co" }), null);
  assert.notEqual(normalizeBrand({ firm_name: "Adler Industrial" }), null);
  assert.notEqual(normalizeBrand({ logo_url: PNG }), null);
});

test("a logo that is not a data: image URI is dropped, and the text survives", () => {
  // A URL here would taint the html2canvas canvas and break PNG export.
  const b = normalizeBrand({ ...ROW, logo_url: "https://example.com/logo.png" });
  assert.equal("logo" in b, false);
  assert.equal(b.firmName, "Adler Industrial");
});

test("junk in, null out, without throwing", () => {
  assert.equal(normalizeBrand(null), null);
  assert.equal(normalizeBrand("nope"), null);
  assert.equal(normalizeBrand([]), null);
  assert.equal(normalizeBrand({}), null);
});

test("over-long text is truncated at render, not dropped", () => {
  const b = normalizeBrand({ firm_name: "x".repeat(200) });
  assert.equal(b.firmName.length, 80);
});

// --- brandForRender: the decision ------------------------------------------

test("no entitlement means no brand, however complete the profile", () => {
  assert.equal(brandForRender({ profile: ROW, canBrand: false }), null);
});

test("an entitled member with a profile gets their brand", () => {
  const b = brandForRender({ profile: ROW, canBrand: true });
  assert.equal(b.firmName, "Adler Industrial");
});

test("an entitled member with no profile gets null, not an empty block", () => {
  assert.equal(brandForRender({ profile: null, canBrand: true }), null);
});

test("a SHARED report renders the sender's brand", () => {
  const b = brandForRender({ isShared: true, sharedBranding: { firmName: "Sender Co" } });
  assert.equal(b.firmName, "Sender Co");
});

test("a shared report NEVER falls back to the viewer's own profile", () => {
  // The trap this module exists to make impossible: a Pro client opening their
  // broker's report must not see their own logo on it.
  const b = brandForRender({
    isShared: true, sharedBranding: null,
    profile: ROW, canBrand: true,
  });
  assert.equal(b, null);
});

test("a shared report with junk branding is unbranded, not viewer-branded", () => {
  const b = brandForRender({
    isShared: true, sharedBranding: { phone: "208-555-0100" },
    profile: ROW, canBrand: true,
  });
  assert.equal(b, null);
});

// --- the firm fallback (041) -----------------------------------------------

const FIRM_ROW = { firm_name: "Colliers Boise", license_number: "FB-99" };

test("a member with no profile of their own falls back to the firm's", () => {
  const b = brandForRender({ profile: null, canBrand: true, firmProfile: FIRM_ROW });
  assert.equal(b.firmName, "Colliers Boise");
});

test("the member's own profile always beats the firm's — fallback, never override", () => {
  const b = brandForRender({ profile: ROW, canBrand: true, firmProfile: FIRM_ROW });
  assert.equal(b.firmName, "Adler Industrial");
});

test("no entitlement means no brand, firm profile or not", () => {
  assert.equal(brandForRender({ profile: null, canBrand: false, firmProfile: FIRM_ROW }), null);
});

test("a firm profile that is not a brand (no logo, no name) falls to null, not {}", () => {
  const b = brandForRender({ profile: null, canBrand: true, firmProfile: { phone: "208-555-0100" } });
  assert.equal(b, null);
});

test("a shared report never falls back to the viewer's FIRM profile either", () => {
  const b = brandForRender({
    isShared: true, sharedBranding: null,
    profile: null, canBrand: true, firmProfile: FIRM_ROW,
  });
  assert.equal(b, null);
});

// --- validateForSave -------------------------------------------------------

test("a good profile saves as a snake_case row", () => {
  const r = validateForSave({
    logo: PNG, firmName: "Adler Industrial", preparerName: "Jacob Adler",
    phone: "208-555-0100", email: "jacob@example.com", licenseNumber: "SP12345",
    disclaimer: "Prepared for discussion purposes.",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.row.firm_name, "Adler Industrial");
  assert.equal(r.row.license_number, "SP12345");
  assert.equal(r.row.logo_url, PNG);
});

test("saving rejects rather than truncates an over-long field, and names it", () => {
  const r = validateForSave({ firmName: "x".repeat(200) });
  assert.match(r.error, /firm/i);
  assert.equal(r.row, undefined);
});

test("saving rejects a logo that is not a data: image URI", () => {
  const r = validateForSave({ firmName: "A", logo: "https://example.com/logo.png" });
  assert.match(r.error, /PNG or JPEG/i);
});

test("saving rejects an oversized logo and names the limit", () => {
  const big = "data:image/png;base64," + "A".repeat(LOGO_SAVE_MAX + 10);
  const r = validateForSave({ firmName: "A", logo: big });
  assert.match(r.error, /150/);
});

test("an empty profile saves as an all-empty row, which is how a member clears it", () => {
  const r = validateForSave({});
  assert.equal(r.error, undefined);
  assert.equal(r.row.firm_name, "");
  assert.equal(r.row.logo_url, "");
});
