"use strict";
// ---------------------------------------------------------------------------
// The "From" address on outbound mail, and the rules for changing it.
//
// PURE, like entitlements.js, report-access.js and comp-gate.js: no I/O, no
// requires, no clock reads. server.js owns the read (the app_settings row) and
// the cache; this file only decides what a valid From is and which one wins.
// That is what lets `npm test` prove the rules with no database.
//
// WHY THIS EXISTS. Until now the From address was EMAIL_FROM, read once at
// startup, so changing it meant editing a Render environment variable and
// waiting out a redeploy. It is also the single gate on outbound mail existing
// at all (see OUTBOUND_EMAIL_LIVE in server.js), which makes it the one
// setting most likely to be wrong on the day a domain is finally verified.
//
// THREE RULES, and each one is a failure that has a name:
//
//   1. INVALID NEVER WINS. effectiveSender() re-validates the stored override
//      on every call and falls back to EMAIL_FROM when it does not parse. A
//      bad row in a settings table must degrade to the old address, never to
//      no mail at all — password resets ride this path.
//
//   2. NO HEADER INJECTION. A newline or a control character in a From value
//      is refused outright rather than stripped. Resend takes JSON rather than
//      raw SMTP, so this is defence in depth and not the only thing standing
//      between us and a spliced header, but a From address is attacker-shaped
//      input the moment anything but the owner can write it.
//
//   3. ONE MAILBOX. A comma-separated list parses cleanly as "a display name
//      containing a comma" and would silently send as the wrong address, so a
//      second @ or a comma outside a quoted name is a refusal.
//
// What this file deliberately does NOT know: whether the domain is verified in
// Resend. Nothing in this process can know that — the provider answers it at
// send time — which is why the admin card offers a test send instead of a
// green tick, and why domainOf() exists only so the UI can say "this is a
// different domain from the one you were sending as".
// ---------------------------------------------------------------------------

// 254 is the RFC 5321 ceiling on an address; the display name is capped well
// under any header limit because a long one is a mistake, not a use case.
const MAX_ADDRESS = 254;
const MAX_NAME = 100;
const MAX_VALUE = 320;

// Everything below space, plus DEL. Covers CR and LF, which are the two that
// matter, and refuses the rest rather than deciding which exotic control
// character is harmless in a mail header.
function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// RFC-special characters that force a display name to be quoted. A name
// holding one of these unquoted changes where the mail appears to come from.
const NAME_SPECIALS = /[()<>[\]:;@\\,."]/;

function quoteName(name) {
  if (!NAME_SPECIALS.test(name)) return name;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function validAddress(addr) {
  if (!addr || addr.length > MAX_ADDRESS) return false;
  const at = addr.indexOf("@");
  // Exactly one @: lastIndexOf catches the second one, which is the shape a
  // smuggled second mailbox takes.
  if (at <= 0 || at !== addr.lastIndexOf("@")) return false;
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (local.length > 64) return false;
  // Dot-atom only. Quoted local parts ("odd name"@x.com) are legal and are
  // refused anyway: nobody sends transactional mail from one, and accepting
  // them means parsing quotes in the one place a mistake sends every email to
  // the wrong place.
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return false;
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(l) && l.length <= 63);
}

/**
 * Validate and normalize one From value.
 *
 * Accepts `reports@compninja.co` or `CompNinja <reports@compninja.co>`, and
 * returns the canonical string to store and send. Errors are written for the
 * person typing into the admin card, not for a log.
 *
 * @returns {{ok: true, value: string, address: string, name: string, domain: string}
 *          |{ok: false, error: string}}
 */
function normalizeSender(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: false, error: "Enter a from address, e.g. CompNinja <reports@compninja.co>." };
  if (hasControlChars(s)) return { ok: false, error: "That address contains a line break or control character." };
  if (s.length > MAX_VALUE) return { ok: false, error: `Keep the from address under ${MAX_VALUE} characters.` };

  let name = "";
  let address = s;
  const angled = s.match(/^(.*)<([^<>]*)>$/);
  if (angled) {
    name = angled[1].trim();
    address = angled[2].trim();
    // A quoted name arrives already quoted; unwrap it so the value is
    // normalized once rather than gaining a layer of quotes per save.
    if (name.length > 1 && name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).replace(/\\(["\\])/g, "$1").trim();
    }
  } else if (/[<>]/.test(s)) {
    return { ok: false, error: "That looks like an unfinished name and address. Use: Name <address@domain.com>." };
  }

  if (!angled && /[,;]/.test(s)) {
    return { ok: false, error: "Only one from address is allowed." };
  }
  if (name.length > MAX_NAME) return { ok: false, error: `Keep the display name under ${MAX_NAME} characters.` };
  if (!validAddress(address)) {
    return { ok: false, error: `"${address}" is not a valid email address.` };
  }

  // The domain is lowercased (it is case-insensitive); the local part is left
  // exactly as typed, because it is not.
  const at = address.indexOf("@");
  const canonical = address.slice(0, at) + "@" + address.slice(at + 1).toLowerCase();
  return {
    ok: true,
    value: name ? `${quoteName(name)} <${canonical}>` : canonical,
    address: canonical,
    name,
    domain: canonical.slice(canonical.indexOf("@") + 1),
  };
}

/** The bare domain of a From value, or "" if it does not parse. */
function domainOf(value) {
  const n = normalizeSender(value);
  return n.ok ? n.domain : "";
}

/**
 * Which From address mail actually goes out as.
 *
 * The stored override wins when it parses, EMAIL_FROM otherwise. Rule 1 above:
 * a stored value that does not validate is ignored rather than sent, so a bad
 * settings row costs the override and never the mail.
 */
function effectiveSender(stored, envFrom) {
  const s = normalizeSender(stored);
  if (s.ok) return s.value;
  const env = normalizeSender(envFrom);
  if (env.ok) return env.value;
  // Not normalizable but non-empty: hand back whatever EMAIL_FROM literally
  // says. It has been the live value since before this file existed and a
  // deployment sending fine today must not stop because this parser is
  // stricter than Resend's.
  return String(envFrom == null ? "" : envFrom).trim();
}

/**
 * Everything the admin card needs to describe the current state in one read.
 * `live` mirrors OUTBOUND_EMAIL_LIVE in server.js: an address is not mail.
 */
function describeSender({ stored, envFrom, hasApiKey } = {}) {
  const effective = effectiveSender(stored, envFrom);
  const storedOk = normalizeSender(stored).ok;
  return {
    effective,
    envFrom: String(envFrom == null ? "" : envFrom).trim(),
    override: storedOk ? normalizeSender(stored).value : "",
    // "invalid" is its own source so the card can say the stored value is
    // being ignored, which is otherwise indistinguishable from never having
    // set one.
    source: storedOk ? "override" : (String(stored || "").trim() ? "invalid" : (effective ? "env" : "none")),
    live: Boolean(hasApiKey && effective),
    domain: domainOf(effective),
  };
}

module.exports = { normalizeSender, effectiveSender, describeSender, domainOf, MAX_VALUE };
