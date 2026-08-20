// The From address on outbound mail: what counts as a valid one, and which one
// wins. Pure rules, no database, no network — see sender-email.js's header for
// the three failures these exist to prevent.

const test = require("node:test");
const assert = require("node:assert");
const { normalizeSender, effectiveSender, describeSender, domainOf } = require("../sender-email.js");

test("a bare address and a named address both normalize", () => {
  assert.equal(normalizeSender("reports@compninja.co").value, "reports@compninja.co");
  assert.equal(normalizeSender("CompNinja <reports@compninja.co>").value, "CompNinja <reports@compninja.co>");
  assert.equal(normalizeSender("  CompNinja   <reports@compninja.co>  ").value, "CompNinja <reports@compninja.co>");
});

test("the domain is lowercased and the local part is not", () => {
  // Domains are case-insensitive; local parts are not, and rewriting one can
  // route mail to a different mailbox.
  const n = normalizeSender("Owen.Reports@CompNinja.CO");
  assert.equal(n.value, "Owen.Reports@compninja.co");
  assert.equal(n.domain, "compninja.co");
});

test("a display name holding a comma or an @ is quoted, not passed through raw", () => {
  assert.equal(normalizeSender("Adler, Industrial <a@b.com>").value, '"Adler, Industrial" <a@b.com>');
  assert.equal(normalizeSender("sales@x <a@b.com>").value, '"sales@x" <a@b.com>');
});

test("an already-quoted name survives a round trip without gaining quotes", () => {
  // Saving twice must be idempotent, or every save adds a layer.
  const once = normalizeSender('"Adler, Industrial" <a@b.com>').value;
  assert.equal(once, '"Adler, Industrial" <a@b.com>');
  assert.equal(normalizeSender(once).value, once);
});

test("RULE 2 — a newline or control character is refused, never stripped", () => {
  const withLf = "CompNinja <a@b.com>" + String.fromCharCode(10) + "bcc: victim@x.com";
  const withCrLf = "CompNinja <a@b.com>" + String.fromCharCode(13, 10) + "Subject: hi";
  const withTab = "Comp" + String.fromCharCode(9) + "Ninja <a@b.com>";
  for (const bad of [withLf, withCrLf, withTab]) {
    const n = normalizeSender(bad);
    assert.equal(n.ok, false, "should refuse a control character");
    assert.match(n.error, /line break|control/i);
  }
});

test("RULE 3 — only one mailbox", () => {
  assert.equal(normalizeSender("a@b.com, c@d.com").ok, false);
  assert.equal(normalizeSender("a@b.com; c@d.com").ok, false);
  // The dangerous shape: a second address smuggled in as part of the address.
  assert.equal(normalizeSender("a@b.com@d.com").ok, false);
});

test("malformed addresses are refused with copy a person can act on", () => {
  for (const bad of ["reports", "reports@", "@compninja.co", "reports@localhost",
                     "reports@compninja", "a b@c.com", "reports@-x.com", "reports@x-.com",
                     "reports@x..com", ".a@b.com", "a.@b.com", "<a@b.com", "Name <a@b.com"]) {
    assert.equal(normalizeSender(bad).ok, false, `should refuse: ${bad}`);
  }
  assert.match(normalizeSender("nope").error, /not a valid email address/);
});

test("an empty value is refused rather than treated as clearing the override", () => {
  // Clearing is DELETE, a separate act. A blank PUT is a slip, and treating it
  // as "revert to EMAIL_FROM" silently changes who mail comes from.
  for (const empty of ["", "   ", null, undefined]) {
    const n = normalizeSender(empty);
    assert.equal(n.ok, false);
    assert.match(n.error, /Enter a from address/);
  }
});

test("length ceilings", () => {
  assert.equal(normalizeSender("a".repeat(65) + "@b.com").ok, false, "local part over 64");
  assert.equal(normalizeSender("x".repeat(101) + " <a@b.com>").ok, false, "display name over 100");
  assert.equal(normalizeSender("a".repeat(400) + "@b.com").ok, false, "value over 320");
});

test("RULE 1 — an override that does not parse falls back to EMAIL_FROM, never to nothing", () => {
  // The failure this prevents: a bad settings row silently stopping password
  // reset email, which is the worst possible thing to break quietly.
  assert.equal(effectiveSender("not an address", "CompNinja <reports@compninja.co>"),
    "CompNinja <reports@compninja.co>");
  assert.equal(effectiveSender("", "CompNinja <reports@compninja.co>"),
    "CompNinja <reports@compninja.co>");
  assert.equal(effectiveSender(null, "CompNinja <reports@compninja.co>"),
    "CompNinja <reports@compninja.co>");
});

test("a valid override beats EMAIL_FROM", () => {
  assert.equal(effectiveSender("Owen <owen@compninja.co>", "CompNinja <reports@compninja.co>"),
    "Owen <owen@compninja.co>");
});

test("with neither set there is no sender, which is what turns outbound mail off", () => {
  assert.equal(effectiveSender("", ""), "");
  assert.equal(effectiveSender(undefined, undefined), "");
});

test("an EMAIL_FROM this parser dislikes is still used verbatim", () => {
  // This parser is stricter than Resend's. A deployment whose mail works today
  // must not stop working because a new validator arrived, so an unparseable
  // env value passes through untouched — the override is the only value this
  // file is allowed to reject into a fallback.
  assert.equal(effectiveSender("", "CompNinja <onboarding@resend.dev>"),
    "CompNinja <onboarding@resend.dev>");
  assert.equal(effectiveSender("", "weird-but-live@thing"), "weird-but-live@thing");
});

test("describeSender names the source, including the ignored-override case", () => {
  assert.equal(describeSender({ stored: "a@b.com", envFrom: "c@d.com", hasApiKey: true }).source, "override");
  assert.equal(describeSender({ stored: "", envFrom: "c@d.com", hasApiKey: true }).source, "env");
  assert.equal(describeSender({ stored: "", envFrom: "", hasApiKey: true }).source, "none");
  // The one the card exists to surface: a stored value that is being ignored
  // looks exactly like no stored value unless it is said out loud.
  const bad = describeSender({ stored: "junk", envFrom: "c@d.com", hasApiKey: true });
  assert.equal(bad.source, "invalid");
  assert.equal(bad.effective, "c@d.com");
  assert.equal(bad.override, "");
});

test("describeSender.live mirrors OUTBOUND_EMAIL_LIVE — an address is not mail", () => {
  assert.equal(describeSender({ stored: "a@b.com", envFrom: "", hasApiKey: false }).live, false);
  assert.equal(describeSender({ stored: "", envFrom: "", hasApiKey: true }).live, false);
  assert.equal(describeSender({ stored: "a@b.com", envFrom: "", hasApiKey: true }).live, true);
});

test("domainOf answers only for a value that parses", () => {
  assert.equal(domainOf("CompNinja <reports@compninja.co>"), "compninja.co");
  assert.equal(domainOf("junk"), "");
});
