// The outbound email letterhead (design-system, owner-approved 2026-08-09).
//
// Every customer-facing email (share invites, BOV follow-ups, broker
// confirmations, password resets, market alerts) goes through server.js's
// sendOutboundEmail, which passes its existing PLAIN TEXT body here to gain a
// branded HTML part. The text is the source of truth: this module never adds,
// drops, or rewrites a word of it — it escapes it, splits it into paragraphs,
// turns bare URLs into links, and dresses it in the letterhead the printed
// report already carries (wordmark over the red rule, brand-line footer).
// A call site that wants different copy edits its text, never this shell.
//
// Email-client constraints, so nobody "modernizes" this into breakage:
//   - table layout and inline styles only (Gmail strips <style> in places,
//     Outlook renders via Word);
//   - system fonts only — Georgia and Arial ship everywhere, webfonts do not;
//   - no images: the wordmark is text, because remote images are blocked by
//     default in most clients and the letterhead must survive that.
//
// The footer is brand contact only. Compliance lines (automated estimate, not
// an appraisal) stay in each email's own text where they already live —
// putting one here as well would double it on the emails that carry it.
//
// Pure: no I/O, no requires, no clock. Covered by npm test
// (test/email-shell.test.js).

"use strict";

const INK = "#1A2433";
const BODY = "#374253";
const MUTED = "#68707E";
const RED = "#B91C1C";
const PAPER = "#FBFBF9";
const HAIRLINE = "#E4E2DA";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Turn bare URLs in ALREADY-ESCAPED text into links. Escaping first means a
// crafted "URL" cannot smuggle markup; the conservative charset stops before
// quotes, brackets and escaped entities. Trailing punctuation stays outside
// the link so "View it here: https://x.co/r/abc." links without the period.
//
// `&amp;` IS PART OF THE URL, and that alternation is the whole reason this
// is not a plain character class. escapeHtml has already run, so a query
// string arrives as `?u=abc&amp;t=xyz`; a class that stopped at `&` cut the
// href there and dropped every parameter after the first. Both unsubscribe
// links in this product authenticate with a `&t=<mac>` token, so every
// "turn these emails off" link in every digest, renewal notice and hub note
// pointed at a URL the route could only refuse - and the refusal page blamed
// the reader's email client for a truncation we were doing here.
//
// Matching the ENTITY rather than adding `&` to the class is deliberate: a
// bare `&` still ends the URL, so `https://x.co/a&#39;s` (an apostrophe after
// a link) stops at the apostrophe rather than swallowing it, and `&quot;`
// still terminates the match - which is what keeps a crafted URL from
// escaping the href attribute.
function linkify(escaped) {
  return escaped.replace(/https?:\/\/(?:&amp;|[A-Za-z0-9\-._~:/?#@!$*+,;=%])+/g, (url) => {
    const m = url.match(/[.,;:!)]+$/);
    let trail = m ? m[0] : "";
    let clean = trail ? url.slice(0, -trail.length) : url;
    // `&amp;` ends in a semicolon, which the trim above would otherwise
    // shear into a malformed `&amp`. A URL genuinely ending in an entity
    // keeps it and gives up the trailing-punctuation nicety.
    if (/&[a-z]+$/i.test(clean)) { clean = url; trail = ""; }
    return `<a href="${clean}" style="color:${RED};text-decoration:underline;">${clean}</a>${trail}`;
  });
}

// Plain text -> paragraphs. Blank lines split paragraphs; single newlines
// become <br> so aligned lines (e.g. "Address: ..." blocks) keep their shape.
function paragraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${BODY};">` +
      linkify(escapeHtml(p)).replace(/\n/g, "<br/>") +
      `</p>`)
    .join("");
}

// The full HTML part for one outbound email. `subject` renders as the
// document title only — clients show their own subject line, and repeating it
// as a heading reads as a form letter.
function renderEmailHtml(subject, text) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"/><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:6px;">
<tr><td style="padding:24px 28px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:12px;border-bottom:2px solid ${RED};">
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;letter-spacing:3px;color:${INK};">COMP<span style="color:${RED};">NINJA</span></span>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:20px 28px 8px;">
${paragraphs(text)}
</td></tr>
<tr><td style="padding:14px 28px 22px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-top:12px;border-top:1px solid ${HAIRLINE};">
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">CompNinja &middot; <a href="mailto:info@compninja.co" style="color:${MUTED};text-decoration:underline;">info@compninja.co</a> &middot; <a href="https://compninja.co" style="color:${MUTED};text-decoration:underline;">compninja.co</a></span>
  </td></tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { renderEmailHtml, escapeHtml, linkify, paragraphs };
