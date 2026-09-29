"use strict";
// member-card.js — what a colleague's profile card may say (2026-09-29, the
// owner's pick: Draft A of https://claude.ai/artifact/WY7eTbXd345KM84GruDx12).
//
// Pure: no I/O, no requires. server.js reads the rows (the roster, the
// person's account, their lead coverage, what they shared with THIS firm) and
// hands them here; this file decides what reaches the viewer.
//
// THE CARD SHOWS ONLY WHAT A COLLEAGUE SHARED WITH THE FIRM. Counts come from
// the firm's own tables (shared_reports with the firm's org_id, org_comps,
// org_buildings, permit watches tracked for the firm) and never from a
// person's vault, portfolio, searches or unshared reports — not even as a
// count, since a count of private rows still says something about them. The
// firm feature rests on "your book stays yours"; this card must not be the
// place that stops being true.
//
// "COVERS" IS SHOWN TO COLLEAGUES BY DEFAULT (owner's call, 2026-09-29). It
// is broker_coverage: the markets and property types a broker picked for
// lead alerts. Inside one firm that is ordinary shop knowledge; it is still
// never public (broker-directory.js's two-consents rule is about the public
// directory, which this is not).
//
// THE SEAT LINE IS FOR OWNERS. Whether a colleague is on Pro decides whether
// firm permit notices reach them, and an owner is the one who can buy a seat.
// Nobody else is told another person's plan, and nobody is shown their own
// here (the account menu already says it).

const TITLE_MAX = 80;

// A job title the person typed about themselves, e.g. "Associate · Retail".
// It reaches colleagues' screens, so control characters go and the length is
// capped by REFUSAL rather than truncation (branding.js's rule: a silently
// shortened title is a different title). Empty clears it.
function validateTitle(raw) {
  if (raw == null) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, error: "Title must be text." };
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (v.length > TITLE_MAX) return { ok: false, error: `Keep your title to ${TITLE_MAX} characters.` };
  return { ok: true, value: v };
}

function count(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

// Everything the card draws, relative to who is looking.
//   member   — the target's org_members row (active; the caller checked)
//   person   — their users row: name, email, title, avatar_rev
//   viewer   — the viewer's own org_members row
//   coverage — broker_coverage rows, or null when that read failed
//   shared   — { reports, comps, buildings, permits }: each an integer, or
//              null when that read failed (a failed read is left OUT, never
//              drawn as 0 — "shared nothing" and "couldn't check" differ)
//   seat     — { pro, viaFirm } from the target's entitlements, or null
function cardView({ member, person, viewer, coverage, shared, seat } = {}) {
  const m = member || {};
  const p = person || {};
  const v = viewer || {};
  const self = Boolean(m.id && v.id && String(m.id) === String(v.id));
  const viewerIsOwner = v.role === "owner" && Boolean(v.joined_at) && !v.removed_at;
  const s = shared || {};
  const counts = {};
  for (const k of ["reports", "comps", "buildings", "permits"]) {
    const n = count(s[k]);
    if (n !== null) counts[k] = n;
  }
  const covers = Array.isArray(coverage)
    ? coverage
      .filter((c) => c && c.market && c.property_type)
      .map((c) => ({ market: String(c.market), type: String(c.property_type) }))
      .sort((a, b) => a.market.localeCompare(b.market) || a.type.localeCompare(b.type))
    : null;
  return {
    id: String(m.id || ""),
    userId: String(m.user_id || p.id || ""),
    name: String(p.name || "").trim(),
    email: String(m.email || p.email || ""),
    title: String(p.title || "").trim(),
    role: ["owner", "admin", "member"].includes(m.role) ? m.role : "member",
    joinedAt: m.joined_at || null,
    self,
    hasPhoto: Boolean(p.avatar_rev),
    photoRev: String(p.avatar_rev || ""),
    // null = the read failed; the card then says nothing about coverage
    // rather than "No markets picked yet", which would be a claim.
    covers,
    shared: counts,
    seat: viewerIsOwner && !self && seat ? { pro: seat.pro === true, viaFirm: Boolean(seat.viaFirm) } : null,
  };
}

module.exports = { TITLE_MAX, validateTitle, cardView };
