// ---------------------------------------------------------------------------
// Who may read a shared report.
//
// Spec: docs/superpowers/specs/2026-08-06-client-sharing-design.md
//
// PURE, like entitlements.js and comp-gate.js: no I/O, no requires, no clock
// reads. server.js owns the reads (the share row, its viewer rows, the
// session) and hands them in. That is what lets `npm test` prove the gate
// holds with no database.
//
// One function answers the question, and nothing else in the codebase may
// answer it. Scattered checks are how a paywall grows holes, and this one
// guards a broker's private comps rather than a comp count.
//
// EVERYTHING FAILS CLOSED. An unrecognized visibility is treated as invited,
// not as public: a typo in a column must never publish a report.
// ---------------------------------------------------------------------------

// A share id in a URL is public knowledge; an email is not. Matching is done
// on the normalized form so "Client@Acme.COM " on the invite and
// "client@acme.com" on the account are the same person.
function normalizeEmail(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  // Deliberately loose: one @, something either side, no whitespace. Real
  // deliverability is Resend's problem; this only has to stop junk becoming a
  // viewer row that can never match.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

/**
 * @param {object|null}  share    a shared_reports row: { user_id, visibility, revoked_at, org_id }
 * @param {Array}        viewers  report_viewers rows for that share: [{ email }]
 * @param {object|null}  user     from getSessionUser(): { id, email } or null
 * @param {Array<string>} orgIds  org ids this user is an ACTIVE member of —
 *                                org-access.js's activeOrgIds(), which owns
 *                                what "active" means (accepted, not removed).
 *                                Absent or empty is a caller who is in no
 *                                firm, which is the safe default: this
 *                                argument can only ever grant, never widen an
 *                                audience the other branches already decided.
 * @returns {{ok: boolean, reason: string}}
 */
function canReadShare({ share, viewers, user, orgIds }) {
  if (!share || typeof share !== "object") return { ok: false, reason: "not_invited" };

  // Checked first, above every other rule: revocation is the one control a
  // broker has after a link has left their hands, and it has to beat their own
  // ownership too, or "revoked" would mean "revoked for other people".
  if (share.revoked_at) return { ok: false, reason: "revoked" };

  if (share.visibility === "public") return { ok: true, reason: "public" };

  // Invited from here down (including any unrecognized visibility).
  if (user && share.user_id && String(user.id) === String(share.user_id)) {
    return { ok: true, reason: "owner" };
  }
  if (!user) return { ok: false, reason: "signin_required" };

  // The firm audience (migration 028, spec §6). Deliberately NOT a fourth
  // top-level branch beside public/invited: it sits INSIDE the invited path,
  // below revocation and below the sign-in requirement, so a firm share
  // inherits every protection an invited one already has and can only ever
  // ADD a named set of people to it.
  //
  // BOTH conditions, never either alone. `visibility === "org"` alone would
  // let a stray org_id on an invited share widen it; a non-null org_id alone
  // would do the same from the other direction. Requiring both means a
  // mistake in either column fails toward the viewer list — i.e. toward LESS
  // access — which is this file's governing rule.
  //
  // Membership itself is not decided here. `orgIds` arrives already filtered
  // by org-access.js's activeOrgIds(), which is the single place that knows a
  // pending invite is not a membership and that removed_at beats ownership.
  // Two opinions about who is in a firm is exactly how this grows a hole.
  if (share.visibility === "org" && share.org_id) {
    const mineOrgs = Array.isArray(orgIds) ? orgIds : [];
    if (mineOrgs.some((id) => id != null && String(id) === String(share.org_id))) {
      return { ok: true, reason: "firm" };
    }
  }

  const mine = normalizeEmail(user.email);
  const list = Array.isArray(viewers) ? viewers : [];
  const invited = mine && list.some((v) => normalizeEmail(v && v.email) === mine);
  return invited ? { ok: true, reason: "invited" } : { ok: false, reason: "not_invited" };
}

module.exports = { canReadShare, normalizeEmail };
