// The "Confirm your email" notice (2026-11-10), one definition for the app
// (index.html) and every server-rendered member page (ACCOUNT_NAV_JS in
// server.js loads this file only for an account that needs it).
//
// Why it exists: an account that has not proven it owns its address works
// for everything of its own, but is not shown what was SENT to that address
// (a shared report, a firm invitation, a deal room; email-verify.js has the
// rules). Without a notice those pages would simply look empty, and a client
// who was told "I shared the report with you" would have no way to know why
// it is not there.
//
// Four rules:
//   1. It shows on a LITERAL `emailVerified === false` from /api/account/me
//      and on nothing else. A missing field (an older server, a failed read)
//      shows nothing: a notice nobody can act on is worse than none.
//   2. It says the same thing to everybody. It never says whether anything
//      is waiting, because the server never tells an unconfirmed account
//      that, and a notice that did would be the leak.
//   3. Copy says "confirm", never "verified": that word is reserved for the
//      badge the server awards a comp (CLAUDE.md rule 8).
//   4. Built with createElement and textContent only, and it writes through
//      window.fetch only (CLAUDE.md rule 15), and only when clicked.
//
// Dual-exported: the browser global CONFIRMNOTICE, and module.exports so
// test/confirm-notice.test.js can run it against a stand-in document.
(function (root) {
  "use strict";

  var ID = "confirmNotice";
  var DISMISS_KEY = "cn.confirmNotice.hidden";

  // Tokens are theme.js's; the literals after each comma are what a page
  // without them would show, never what a themed page shows.
  var CSS =
    "#" + ID + "{position:fixed;right:16px;bottom:72px;z-index:1100;width:min(360px,calc(100vw - 32px));" +
    "box-sizing:border-box;padding:14px 38px 14px 16px;background:var(--card,#fff);color:var(--ink,#15191f);" +
    "border:1px solid var(--line,#d9dde3);border-left:3px solid var(--red,#c8102e);border-radius:var(--r-md,10px);" +
    "box-shadow:0 6px 24px rgba(16,20,26,.18);font:inherit;font-size:13.5px;line-height:1.45}" +
    "#" + ID + "[hidden]{display:none}" +
    "#" + ID + " .cfn-t{margin:0 0 4px;font-weight:700;font-size:14px}" +
    "#" + ID + " .cfn-b{margin:0;color:var(--ink-body,#3a424d);overflow-wrap:anywhere}" +
    "#" + ID + " .cfn-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:10px}" +
    "#" + ID + " .cfn-send{font:inherit;font-size:13px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;" +
    "background:var(--card,#fff);color:var(--ink,#15191f);border:1px solid var(--line,#d9dde3)}" +
    "#" + ID + " .cfn-send:hover{border-color:var(--ink-3,#6b7480)}" +
    "#" + ID + " .cfn-send:disabled{opacity:.6;cursor:default}" +
    "#" + ID + " .cfn-send:focus-visible,#" + ID + " .cfn-x:focus-visible{outline:2px solid var(--red,#c8102e);outline-offset:2px}" +
    "#" + ID + " .cfn-say{margin:0;font-size:12.5px;color:var(--ink-3,#6b7480)}" +
    "#" + ID + " .cfn-say.bad{color:var(--red,#c8102e)}" +
    "#" + ID + " .cfn-x{position:absolute;top:6px;right:6px;width:28px;height:28px;border:0;background:none;cursor:pointer;" +
    "color:var(--ink-3,#6b7480);font-size:18px;line-height:1;border-radius:6px}" +
    "#" + ID + " .cfn-x:hover{color:var(--ink,#15191f)}" +
    "#" + ID + ".done{border-left-color:var(--ok-rule,#1f8a4c)}" +
    // A phone has no spare corner: floating, the card sat on top of Home's
    // address box and its button (photographed 2026-11-10). There it is an
    // ordinary block at the very top of the page, which pushes the page down
    // and covers nothing. It is the first child of <body> for this reason.
    "@media (max-width:700px){#" + ID + "{position:static;width:auto;margin:10px 12px 0;box-shadow:none}}" +
    "@media print{#" + ID + "{display:none}}";

  // --- the rules, pure -----------------------------------------------------

  /** Does this /api/account/me answer need the notice? Rule 1. */
  function needs(me) {
    return Boolean(me) && typeof me === "object" && me.emailVerified === false;
  }

  /** The words. One place, so every page says the same thing (rule 2). */
  function copy(email) {
    var to = String(email || "").trim();
    return {
      title: "Confirm your email",
      body: (to ? "We sent a link to " + to + ". " : "We sent you a link. ") +
        "Reports, firm invitations and deal rooms sent to this address open once you confirm it.",
      send: "Send it again",
      hide: "Hide this notice",
      done: "Email confirmed.",
    };
  }

  /** What to say after asking the server to send the link again. */
  function sendResult(status, body) {
    var b = body && typeof body === "object" ? body : {};
    if (status === 200 && b.already) return { tone: "ok", confirmed: true, text: copy().done };
    if (status === 200 && b.sent) return { tone: "ok", text: "Sent. Check your inbox and your spam folder." };
    if (status === 200) return { tone: "bad", text: "We couldn't send the email just now. Please try again in a few minutes." };
    if (status === 401) return { tone: "bad", text: "Please sign in again, then send it." };
    return { tone: "bad", text: String(b.error || "We couldn't send the email just now. Please try again in a few minutes.") };
  }

  /** The page a confirm link should come back to: a shared report, or nothing. */
  function nextFor(pathname) {
    var p = String(pathname || "");
    return /^\/r\/[A-Za-z0-9_-]{6,32}$/.test(p) ? p : "";
  }

  // --- the element ---------------------------------------------------------

  var doc = root.document;
  var hideTimer = null;

  function hiddenFor(email) {
    try { return root.sessionStorage.getItem(DISMISS_KEY) === String(email || ""); }
    catch (_) { return false; }
  }
  function rememberHidden(email) {
    try { root.sessionStorage.setItem(DISMISS_KEY, String(email || "")); } catch (_) { /* shows again next page */ }
  }

  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // First in <body>, not last: on a wide screen it is fixed and its place in
  // the document does not matter, on a phone it is in the flow and has to be
  // at the top (see the media rule in CSS).
  function place(box) {
    doc.body.insertBefore(box, doc.body.firstChild);
  }

  function build(email) {
    if (!doc.getElementById(ID + "Css")) {
      var st = doc.createElement("style");
      st.id = ID + "Css";
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    var words = copy(email);
    var box = el("div");
    box.id = ID;
    box.setAttribute("role", "status");
    box.className = "no-print no-capture";
    box.appendChild(el("p", "cfn-t", words.title));
    box.appendChild(el("p", "cfn-b", words.body));
    var row = el("div", "cfn-row");
    var send = el("button", "cfn-send", words.send);
    send.type = "button";
    var say = el("p", "cfn-say");
    say.setAttribute("aria-live", "polite");
    row.appendChild(send);
    row.appendChild(say);
    box.appendChild(row);
    var x = el("button", "cfn-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", words.hide);
    box.appendChild(x);

    send.addEventListener("click", function () {
      send.disabled = true;
      say.className = "cfn-say";
      say.textContent = "Sending…";
      var status = 0;
      root.fetch("/api/account/confirm/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ next: nextFor(root.location && root.location.pathname) }),
      }).then(function (r) {
        status = r.status;
        return r.json().catch(function () { return {}; });
      }).then(function (body) {
        var out = sendResult(status, body);
        if (out.confirmed) return confirmed();
        say.className = "cfn-say" + (out.tone === "bad" ? " bad" : "");
        say.textContent = out.text;
      }).catch(function () {
        say.className = "cfn-say bad";
        say.textContent = "Couldn't reach the server. Please try again.";
      }).then(function () { send.disabled = false; });
    });
    x.addEventListener("click", function () {
      rememberHidden(email);
      box.hidden = true;
    });
    place(box);
    return box;
  }

  function remove() {
    if (hideTimer) { root.clearTimeout(hideTimer); hideTimer = null; }
    var old = doc && doc.getElementById(ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  /**
   * Show or take down the notice for this account. Safe to call on every
   * account refresh: it rebuilds only when the address changed.
   * `force` shows it even after the member hid it this session (a page that
   * has just refused something because of it).
   */
  function sync(me, opts) {
    if (!doc || !doc.body) return null;
    if (!needs(me)) { remove(); return null; }
    var email = String(me.email || "");
    var have = doc.getElementById(ID);
    if (have && have.getAttribute("data-for") === email && !have.classList.contains("done")) {
      if (opts && opts.force) have.hidden = false;
      return have;
    }
    remove();
    if (hiddenFor(email) && !(opts && opts.force)) return null;
    var box = build(email);
    box.setAttribute("data-for", email);
    return box;
  }

  /** Say something on the notice (the confirm link's own outcome). */
  function say(text, tone) {
    var box = doc && doc.getElementById(ID);
    var line = box && box.querySelector(".cfn-say");
    if (!line) return false;
    box.hidden = false;
    line.className = "cfn-say" + (tone === "bad" ? " bad" : "");
    line.textContent = String(text || "");
    return true;
  }

  /** The address was just confirmed: say so for a few seconds, then go. */
  function confirmed() {
    if (!doc || !doc.body) return;
    remove();
    if (!doc.getElementById(ID + "Css")) {
      var st = doc.createElement("style");
      st.id = ID + "Css";
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    var box = el("div", "done no-print no-capture");
    box.id = ID;
    box.setAttribute("role", "status");
    box.appendChild(el("p", "cfn-t", copy().done));
    box.appendChild(el("p", "cfn-b", "Anything sent to this address is open to you now."));
    place(box);
    hideTimer = root.setTimeout(remove, 6000);
  }

  var api = { needs: needs, copy: copy, sendResult: sendResult, nextFor: nextFor, sync: sync, say: say, confirmed: confirmed, remove: remove, ID: ID };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CONFIRMNOTICE = api;
})(typeof window !== "undefined" ? window : globalThis);
