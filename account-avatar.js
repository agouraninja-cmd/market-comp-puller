// ---------------------------------------------------------------------------
// Account profile photo — the picture in the account circle.
//
// PURE: no I/O. crypto is Node built-in. server.js owns the reads and writes.
//
// Stored as a data URI, the same shape as a branding logo, but it lives OFF
// the users row (user_avatars) so the session lookup that runs on every
// authenticated request never pulls the bytes. users.avatar_rev is a short
// content hash that rides along for free: presence means the circle should
// show a photo, and the value cache-busts GET /api/account/avatar.
//
// NEVER a URL. A stored URL would be fetched by the browser and is an
// SSRF/hotlink footgun for a field the member chooses. The data-URI regex
// is what enforces that. SVG is refused: served as image/svg+xml it is a
// script, not a picture.
// ---------------------------------------------------------------------------

const crypto = require("crypto");

const AVATAR_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

// Two limits, same split as branding.js. Saving refuses above 80KB. Serving
// tolerates a little more so a photo saved under an earlier cap still draws
// rather than vanishing from the circle.
const AVATAR_SAVE_MAX = 80000;
const AVATAR_SERVE_MAX = 100000;

function avatarRev(dataUri) {
  return crypto.createHash("sha256").update(String(dataUri || "")).digest("hex").slice(0, 12);
}

function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function mimeOf(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "png") return "image/png";
  if (k === "jpg" || k === "jpeg") return "image/jpeg";
  if (k === "webp") return "image/webp";
  return null;
}

/**
 * A stored data URI -> { mime, bytes }, or null if it is not a real image.
 * The declared type has to MATCH the bytes: a PDF labeled image/png is
 * refused rather than served.
 */
function decodeAvatar(dataUri) {
  const raw = String(dataUri || "").trim();
  if (raw.length > AVATAR_SERVE_MAX) return null;
  const m = raw.match(AVATAR_RE);
  if (!m) return null;
  let buf;
  try { buf = Buffer.from(m[2], "base64"); } catch (_) { return null; }
  if (!buf.length) return null;
  const sniffed = sniffImage(buf);
  const declared = mimeOf(m[1]);
  if (!sniffed || sniffed !== declared) return null;
  return { mime: sniffed, bytes: buf };
}

/**
 * An API body -> a data URI to store, a clear, or an error for the member.
 * Empty / missing avatar is a clear, not an error: that is how Remove works.
 */
function validateAvatar(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Bad request." };
  }
  const avatar = String(raw.avatar == null ? "" : raw.avatar).trim();
  if (!avatar) return { clear: true };
  if (avatar.length > AVATAR_SAVE_MAX) {
    return { error: "That photo is too large. Please use an image under 80KB." };
  }
  const decoded = decodeAvatar(avatar);
  if (!decoded) {
    return { error: "The photo must be a PNG or JPEG image." };
  }
  return { dataUri: avatar, mime: decoded.mime, rev: avatarRev(avatar) };
}

module.exports = {
  validateAvatar, decodeAvatar, avatarRev, sniffImage,
  AVATAR_SAVE_MAX, AVATAR_SERVE_MAX,
};
