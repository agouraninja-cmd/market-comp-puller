"use strict";
// ---------------------------------------------------------------------------
// Has this account proven it owns its email address?
//
// Why it exists (2026-11-10): identity here is the EMAIL (migration 018).
// A report shared with client@acme.com, a firm invitation, a deal room and a
// broker profile are all handed to whichever account carries that address,
// and sign-up never checked that the person typing it could read its inbox.
// So anybody who knew an address had been sent something could sign up with
// it first and read it.
//
// PURE, like report-access.js, hub-access.js and entitlements.js: no I/O, no
// clock reads, no environment. server.js owns the reads and the mail and hands
// everything in, which is what lets `npm test` prove the rules with no
// database.
//
// THE RULES
//   1. An address counts as proven by exactly three things, each of which
//      puts the inbox's owner in the chair: a Google sign-in (Google verified
//      it), a completed password reset (the link went to the inbox), or the
//      confirm link mailed at sign-up.
//   2. Until then the account works for everything of its OWN. What it may
//      not do is be RECOGNIZED by its address: provenEmail() answers "" and
//      every email-keyed read in server.js asks through it.
//   3. The confirm link only works for a caller signed in to that account
//      (the token names no account; it is a MAC over the session's own id
//      and address). A mail scanner following links, or the inbox's real
//      owner clicking a link they never asked for, confirms nothing.
//   4. FAILS CLOSED everywhere a caller could forget something: a session
//      object with no `email_verified` flag is unverified.
//   5. ONE deliberate fail-open, and it is about deploy order, not access:
//      a users row that has NO `email_verified_at` key at all comes from a
//      database where migration 062 has not run (PostgREST returns every
//      column, nulls included, so a present column is always a present key).
//      There the check is not on yet and everybody reads as verified, which
//      is exactly how the app behaved before this file. Without it, a deploy
//      that lands ahead of the migration would lock every member out of
//      their firm. The file store's rows work the same way: one written
//      before this shipped has no key and is grandfathered, one written
//      after carries a null.
// ---------------------------------------------------------------------------

const crypto = require("node:crypto");

// A confirm link is good for a week. Long on purpose: rule 3 means the link
// alone opens nothing, so the short life a password reset needs buys nothing
// here, and a client who signs up on Friday should still be able to confirm
// on Monday.
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/**
 * Is this users ROW verified?
 * @param {object|null} row       a users row as stored (carries email_verified_at)
 * @param {boolean}     enforced  EMAIL_VERIFICATION; false is the rollback lever
 */
function verifiedOf(row, enforced) {
  if (enforced === false) return true;
  if (!row || typeof row !== "object") return false;
  // Rule 5: no key at all means the column does not exist yet.
  if (!Object.prototype.hasOwnProperty.call(row, "email_verified_at")) return true;
  return Boolean(row.email_verified_at);
}

/**
 * Does this row still need the Google door to retire its password? True only
 * for a row that HAS the column and has it empty: with no column there is
 * nothing to stamp, and a verified row is already its owner's.
 */
function needsProof(row) {
  return Boolean(row) && typeof row === "object" &&
    Object.prototype.hasOwnProperty.call(row, "email_verified_at") &&
    !row.email_verified_at;
}

/**
 * The address this SESSION user may be recognized by, or "".
 * @param {object|null} user  from getSessionUser(): { email, email_verified }
 */
function provenEmail(user) {
  if (!user || typeof user !== "object") return "";
  if (user.email_verified !== true) return "";
  return normalizeEmail(user.email);
}

function macFor({ userId, email, expiresAt, secret }) {
  return crypto.createHmac("sha256", String(secret))
    // Domain-separated, so no other use of the same key can mint one.
    .update(`email-confirm:${userId}:${normalizeEmail(email)}:${expiresAt}`)
    .digest("base64url");
}

/** A confirm token for one account's one address. Stores nothing. */
function mintToken({ userId, email, secret, now, ttlMs }) {
  if (!userId || !normalizeEmail(email) || !secret) return "";
  const expiresAt = Number(now) + (Number(ttlMs) > 0 ? Number(ttlMs) : TOKEN_TTL_MS);
  return `${expiresAt.toString(36)}.${macFor({ userId, email, expiresAt, secret })}`;
}

/**
 * Is this the token minted for THIS account and THIS address, and still live?
 * The caller passes the signed-in account's own id and email (rule 3), so a
 * token minted for anybody else simply does not match.
 */
function checkToken(token, { userId, email, secret, now }) {
  if (!userId || !normalizeEmail(email) || !secret) return false;
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{20,})$/.exec(String(token || ""));
  if (!m) return false;
  const expiresAt = parseInt(m[1], 36);
  if (!Number.isFinite(expiresAt) || expiresAt < Number(now)) return false;
  const want = Buffer.from(macFor({ userId, email, expiresAt, secret }));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/**
 * Where the confirm link may land. A shared report's own page and nothing
 * else: that is the one place somebody is standing when they are asked to
 * confirm, and sending them back to it is the whole point. Anything else is
 * "" and the link opens the app's sign-in door.
 */
function safeNext(path) {
  const p = String(path == null ? "" : path);
  return /^\/r\/[A-Za-z0-9_-]{6,32}$/.test(p) ? p : "";
}

/** The link itself. The token rides the FRAGMENT, so it is never in a log. */
function confirmUrl({ siteUrl, token, next }) {
  const path = safeNext(next) || "/?auth=signin";
  return `${String(siteUrl || "").replace(/\/+$/, "")}${path}#confirm=${token}`;
}

/** The email's words. One place, so the sign-up mail and a resend agree. */
function confirmMail(link) {
  return {
    subject: "Confirm your email for CompNinja",
    text:
      `Confirm that this is your email address so CompNinja can show you ` +
      `the reports, firm invitations and deal rooms sent to it.\n\n` +
      `Confirm it here (the link works for 7 days, while you are signed in):\n${link}\n\n` +
      `If you did not create a CompNinja account, ignore this email. ` +
      `Nothing is confirmed unless the link is opened by someone signed in to that account.`,
  };
}

module.exports = {
  TOKEN_TTL_MS, verifiedOf, needsProof, provenEmail,
  mintToken, checkToken, safeNext, confirmUrl, confirmMail,
};
