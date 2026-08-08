// ---------------------------------------------------------------------------
// Report branding — what mark goes on a member's own report.
//
// Spec: docs/superpowers/specs/2026-08-07-report-branding-design.md
//
// PURE, like entitlements.js, comp-gate.js and report-access.js: no I/O, no
// requires, no clock reads. server.js owns the reads and writes and hands the
// data in. That is what lets `npm test` exercise the whole decision table with
// no database.
//
// CO-BRANDED, NEVER WHITE LABEL. This module returns the MEMBER's mark. The
// CompNinja attribution and the automated-estimate line are rendered by the
// surfaces themselves and are not this module's to remove. The owner is not a
// licensed broker; a report carrying only a brokerage's mark would read as that
// brokerage's own appraisal work.
// ---------------------------------------------------------------------------

// camelCase (API + render) -> snake_case (PostgREST column) -> max length.
const FIELDS = [
  ["firmName", "firm_name", 80],
  ["preparerName", "preparer_name", 80],
  ["phone", "phone", 40],
  ["email", "email", 120],
  ["licenseNumber", "license_number", 40],
  ["disclaimer", "disclaimer", 300],
];

const TEXT_LIMITS = Object.fromEntries(FIELDS.map(([k, , max]) => [k, max]));

// The logo is stored INLINE as a data URI, never as a URL, and this regex is
// what enforces it. A cross-origin image taints the html2canvas canvas, and a
// tainted canvas makes the PNG export throw — so one pasted logo URL would
// silently break image export for every report that member touches.
const LOGO_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

// Two limits, deliberately different. Saving refuses above 150KB. Rendering
// tolerates a little more, so a logo saved under some earlier cap is still
// drawn rather than silently vanishing from a member's letterhead; render only
// refuses things that are not images at all.
const LOGO_SAVE_MAX = 150000;
const LOGO_RENDER_MAX = 200000;

function clean(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * A stored row or an API body -> the block the surfaces render, or null.
 * Accepts either shape, so the same function serves a PostgREST row and a
 * `meta.branding` snapshot that has already been camelCased.
 */
// ⚠ MIRROR: index.html's normalizeBrandBlock() is a deliberately NARROWED
// copy of this function (camelCase/`logo` only — the browser never sees a
// raw snake_case row). Same field limits, same logo rule; keep both in step.
function normalizeBrand(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [camel, snake, max] of FIELDS) {
    const v = clean(raw[camel] !== undefined ? raw[camel] : raw[snake], max);
    if (v) out[camel] = v;
  }
  const logo = String(raw.logo !== undefined ? raw.logo : (raw.logo_url || "")).trim();
  if (logo && logo.length <= LOGO_RENDER_MAX && LOGO_RE.test(logo)) out.logo = logo;

  // Contact details alone are not a brand. Without a logo or a firm name there
  // is nothing that makes the page look like anyone's document, and a
  // letterhead consisting of a bare phone number reads as a bug.
  if (!out.logo && !out.firmName) return null;
  return out;
}

/**
 * What mark does THIS render use?
 *
 * @param {object|null} profile        the viewer's own stored profile
 * @param {boolean}     canBrand       report-scoped entitlement (never a plan test)
 * @param {object|null} sharedBranding meta.branding from a shared report
 * @param {boolean}     isShared       is the thing on screen someone else's share?
 */
function brandForRender({ profile, canBrand, sharedBranding, isShared } = {}) {
  // A shared report is decided ENTIRELY by its own snapshot, and returns here
  // whatever the answer is. Never fall through to the viewer's profile: a Pro
  // member opening a report their broker sent them must not see their own logo
  // on it. The sender's entitlement was checked when the share was created.
  if (isShared) return normalizeBrand(sharedBranding);
  if (!canBrand) return null;
  return normalizeBrand(profile);
}

/**
 * An API body -> a PostgREST row, or an error message for the member.
 * Rejects rather than truncates: silently shortening someone's firm name on
 * their own letterhead is worse than telling them it is too long.
 */
function validateForSave(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Bad request." };
  }
  const row = {};
  for (const [camel, snake, max] of FIELDS) {
    const s = String(raw[camel] == null ? "" : raw[camel]).replace(/\s+/g, " ").trim();
    if (s.length > max) {
      const label = camel.replace(/([A-Z])/g, " $1").toLowerCase();
      return { error: `Your ${label} is too long (limit ${max} characters).` };
    }
    row[snake] = s;
  }
  const logo = String(raw.logo == null ? "" : raw.logo).trim();
  if (logo) {
    if (!LOGO_RE.test(logo)) {
      return { error: "The logo must be a PNG or JPEG image." };
    }
    if (logo.length > LOGO_SAVE_MAX) {
      return { error: "That logo is too large. Please use an image under 150KB." };
    }
  }
  row.logo_url = logo;
  return { row };
}

module.exports = { brandForRender, normalizeBrand, validateForSave, TEXT_LIMITS, LOGO_SAVE_MAX, LOGO_RENDER_MAX };
