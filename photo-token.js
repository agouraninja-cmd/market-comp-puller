// photo-token.js — an address-free URL for a building's street photo
// (2026-10-09).
//
// Home's and The Board's street photos are looked up BY ADDRESS (the owner's
// call that day: "Yes, all of them"), because Google aims its camera at an
// address far better than at a point we guess: it knows where the building
// sits on its parcel, and our geocoder only knows the street in front of it.
// That puts an address in the request our server makes to Google, which is
// allowed now. It must still never sit in a URL (CLAUDE.md never-break rule
// 7): an <img src> lands in access logs, in the browser's history and in
// every Referer. So the photo's URL carries a TOKEN, the address sealed with
// AES-256-GCM under a key only the server holds, and the server opens it
// again when the image is asked for.
//
// Deterministic on purpose: the same address always seals to the same token,
// so the same photo has one URL and the browser's 30-day cache holds it (a
// fresh URL per page view would bill Google per page view). The nonce is
// derived from the address under a second key (a synthetic IV, the SIV idea),
// which is safe here because the only thing a repeated nonce can reveal is
// that two tokens hold the same address, and equal tokens already say so.
// Authenticated: a token the server did not mint opens to null, so nobody can
// point the route at an address of their choosing without asking the POST
// route first.
//
// The key is derived from a server secret (the Street View key itself, which
// is the one secret this feature cannot run without). Rotating that key makes
// every old token open to null: those cards fall back to the aerial and ask
// again, nothing breaks.
//
// Pure, Node only: no I/O, no clock.

"use strict";

const crypto = require("crypto");

const VERSION = "1";

function keysFor(secret) {
  const s = String(secret || "");
  if (!s) return null;
  const derive = (label) => crypto.createHash("sha256").update("compninja photo token v" + VERSION + "\0" + label + "\0" + s).digest();
  return { enc: derive("enc"), iv: derive("iv") };
}

// One spelling per address: case, runs of spaces and a trailing comma are
// not different buildings.
function normalizeAddress(address) {
  return String(address || "").replace(/\s+/g, " ").trim().replace(/[\s,]+$/, "").toLowerCase().slice(0, 300);
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// address -> token string, or null with no secret or no address.
function seal(address, secret) {
  const k = keysFor(secret);
  const plain = normalizeAddress(address);
  if (!k || !plain) return null;
  const iv = crypto.createHmac("sha256", k.iv).update(plain).digest().subarray(0, 12);
  const c = crypto.createCipheriv("aes-256-gcm", k.enc, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return VERSION + b64url(Buffer.concat([iv, ct, c.getAuthTag()]));
}

// token -> the normalized address it was minted for, or null for anything the
// server did not mint (tampered, truncated, another key, another version).
function open(token, secret) {
  const k = keysFor(secret);
  const t = String(token || "");
  if (!k || t[0] !== VERSION || t.length > 1000) return null;
  try {
    const raw = fromB64url(t.slice(1));
    if (raw.length < 12 + 1 + 16) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const d = crypto.createDecipheriv("aes-256-gcm", k.enc, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
    return plain || null;
  } catch (_) {
    return null;
  }
}

module.exports = { normalizeAddress, seal, open };
