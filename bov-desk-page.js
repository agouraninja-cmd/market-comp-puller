// ---------------------------------------------------------------------------
// The BOV desk's two pages (rules in bov-desk.js; routes in server.js):
//
//   renderBovDeskHTML   GET /admin/bov, the owner's page. For each Broker
//                       Opinion of Value request: who asked, the brokers
//                       found for it, the email drafted to each, and one
//                       button per thing a person has to decide.
//   acceptView          what a broker sees behind the link in that email.
//
// Pure: chrome in, HTML out, the pattern of market-hero-review.js. The page
// is a public shell that shows nothing until /api/admin/bov answers, which
// needs the admin key or the cn_admin cookie.
//
// THE BROWSER SCRIPT IS A REAL FUNCTION (deskClient), emitted with
// Function.prototype.toString(), not text inside the template literal. So it
// is parsed by `node --check` with the rest of this file, a stray "${" or a
// single backslash cannot emit broken JavaScript (the trap vault-page.js and
// the admin page each carry a test for), and test/bov-desk-page.test.js can
// run it against a stand-in document. The price: it must read nothing from
// this module's scope. It is ES5 on purpose, like the other admin pages.
//
// Three rules the page holds (tested):
//  - OPENING IT SENDS NOTHING AND SEARCHES NOTHING. Loading is one GET. Every
//    POST is inside a click handler.
//  - A DRAFT'S SEND BUTTON SITS UNDER ITS FULL TEXT. The text is on screen,
//    in a box the owner can edit, before the button that sends it; nothing is
//    behind a fold. "Send all" asks first and says how many.
//  - EVERYTHING A STRANGER TYPED OR A SEARCH RETURNED IS SET AS TEXT, never
//    as markup: createElement and textContent throughout, and a link's href
//    is used only when it starts with http.
// ---------------------------------------------------------------------------

"use strict";

const SCALE_CSS = require("./theme.js").scaleCss();

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// The browser half. Self-contained: see the header.
// ---------------------------------------------------------------------------
function deskClient() {
  var KEYK = "cn_admin_key";
  var KEY = "";
  var DATA = null;
  // Edits not yet sent or saved, by match id: a redraw (after any action)
  // must not throw away what was typed into another broker's draft.
  var EDITS = {};
  // The line under each request, by lead id, so a redraw keeps the message.
  var MSGS = {};
  var BUSY = false;

  function byId(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    var k;
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (attrs[k] == null || attrs[k] === false) continue;
        if (k === "text") el.textContent = attrs[k];
        else if (k === "cls") el.className = attrs[k];
        else if (k === "on") el.addEventListener(attrs[k][0], attrs[k][1]);
        else el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function safeHref(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function link(text, href, cls) {
    var u = safeHref(href);
    if (!u) return h("span", { text: text, cls: cls });
    return h("a", { text: text, href: u, target: "_blank", rel: "noopener noreferrer", cls: cls });
  }
  function ago(ts) {
    var t = Date.parse(ts);
    if (!isFinite(t)) return "";
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " minutes ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs === 1 ? "an hour ago" : hrs + " hours ago";
    var days = Math.round(hrs / 24);
    return days === 1 ? "yesterday" : days + " days ago";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  function api(payload) {
    return fetch("/api/admin/bov", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": KEY || "" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || ("Error " + r.status));
          e.code = j.code; e.data = j;
          throw e;
        }
        return j;
      });
    });
  }
  // The ONE read. Nothing else runs when the page opens.
  function load(key) {
    return fetch("/api/admin/bov", { headers: { "x-admin-key": key || "" } }).then(function (r) {
      if (r.status === 401) throw new Error(key ? "Incorrect key." : "");
      if (r.status === 404) throw new Error("The BOV desk is disabled: set ADMIN_KEY on the server.");
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ("Error " + r.status));
        return j;
      });
    }).then(function (d) {
      if (key && !DATA) {
        // First open with a key: remember it for this tab and trade it for
        // the 30-day cn_admin cookie, as /admin does. Once, not per redraw.
        KEY = key;
        try { sessionStorage.setItem(KEYK, key); } catch (e) { /* private window */ }
        try {
          fetch("/api/admin-access", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: key }) }).catch(function () {});
        } catch (e2) { /* the cookie is a convenience */ }
      }
      DATA = d;
      byId("gate").style.display = "none";
      byId("app").style.display = "block";
      draw();
    }).catch(function (e) {
      if (DATA) { say(null, e.message, true); return; }
      byId("err").textContent = e.message;
      byId("gate").style.display = "block";
      byId("app").style.display = "none";
    });
  }
  function reload() { return load(KEY); }

  function say(leadId, text, bad) {
    if (leadId == null) {
      var top = byId("topmsg");
      top.textContent = text || "";
      top.className = "msg" + (bad ? " bad" : "");
      return;
    }
    MSGS[leadId] = { text: text || "", bad: Boolean(bad) };
    var el = byId("msg-" + leadId);
    if (el) { el.textContent = text || ""; el.className = "msg" + (bad ? " bad" : ""); }
  }
  // One action at a time: a second press while a send is in flight would be
  // a second email.
  function run(leadId, working, payload, done) {
    if (BUSY) return;
    BUSY = true;
    document.body.className = "working";
    say(leadId, working, false);
    return api(payload).then(function (j) {
      BUSY = false; document.body.className = "";
      var text = typeof done === "function" ? done(j) : done;
      MSGS[leadId] = { text: text || "", bad: false };
      return reload();
    }).catch(function (e) {
      BUSY = false; document.body.className = "";
      if (e.code === "no_mail" && e.data && e.data.gmail_url) {
        try { window.open(e.data.gmail_url, "_blank", "noopener"); } catch (x) { /* blocked */ }
      }
      say(leadId, e.message, true);
    });
  }

  // ---- the strip at the top: what this deployment will and will not do ----
  function drawStatus() {
    var d = DATA, box = byId("status");
    box.textContent = "";
    var lines = [];
    lines.push(d.autopilot
      ? "Autopilot is ON: a draft to an address proven by the firm's own site is sent without you. Everything else waits here."
      : "Nothing is sent to a broker until you press Send under its full text.");
    lines.push(d.mail.ready
      ? "Sends as " + d.mail.from + ". Replies go to " + d.mail.replyTo + "."
      : "Outbound mail is not set up on this server, so Send is off. Use Open in Gmail, then Mark as sent.");
    lines.push(!d.search.ready ? "This server has no search key, so brokers cannot be searched for."
      : d.search.left + " of " + d.search.perDay + " broker searches left today.");
    if (!d.automation) lines.push("Automatic start is off (BOV_AUTOMATION): press Find brokers on a request to start it.");
    lines.forEach(function (t) { box.appendChild(h("div", { text: t })); });
    var warn = byId("warn");
    warn.textContent = "";
    warn.style.display = d.ready ? "none" : "block";
    if (!d.ready) {
      warn.appendChild(h("b", { text: "Migration 065 has not been run. " }));
      warn.appendChild(document.createTextNode(
        "Requests are listed, but brokers cannot be stored for them yet. Run migrations/065-bov-desk.sql in the Supabase SQL editor, then refresh."));
    }
  }

  var STATUS_WORDS = {
    draft: "Draft", sent: "Sent", accepted: "Accepted", introduced: "Introduced",
    declined: "Passed", skipped: "Skipped"
  };
  var ORIGIN_WORDS = {
    search: "Found by search", bench: "From an earlier request here",
    manual: "Added by you", platform: "Asked for this from their pipeline"
  };
  var CHECK_WORDS = {
    match: ["Address is on this page, on the firm's own site", "good"],
    free: ["Free-mail address on this page: check it before sending", "care"],
    differs: ["Address is on this page, but on another site's domain: check it", "care"],
    unseen: ["Not on the page it came from: probably guessed. Check before sending", "bad"],
    unchecked: ["Couldn't open the page it came from: check the address before sending", "bad"],
    manual: ["Address typed by you", ""],
    none: ["No email address was stated", "care"]
  };
  // A member broker's address is the one on their own CompNinja account.
  var PLATFORM_CHECK = ["Their CompNinja account's address", ""];

  function editOf(m) {
    var e = EDITS[m.id] || {};
    return {
      email: e.email != null ? e.email : (m.email || ""),
      subject: e.subject != null ? e.subject : (m.subject || ""),
      body: e.body != null ? e.body : (m.body || "")
    };
  }
  function noteEdit(m, field, value) {
    var orig = field === "email" ? (m.email || "") : field === "subject" ? (m.subject || "") : (m.body || "");
    EDITS[m.id] = EDITS[m.id] || {};
    if (value === orig) delete EDITS[m.id][field]; else EDITS[m.id][field] = value;
  }
  // Only what was changed rides the request, so an untouched address keeps
  // the check it earned.
  function changed(m) {
    var e = EDITS[m.id] || {}, out = {};
    if (e.email != null) out.email = e.email;
    if (e.subject != null) out.subject = e.subject;
    if (e.body != null) out.body = e.body;
    return out;
  }
  function withEdits(payload, m) {
    var c = changed(m), k;
    for (k in c) if (Object.prototype.hasOwnProperty.call(c, k)) payload[k] = c[k];
    return payload;
  }
  // A draft's box is as tall as its text, so the whole email is on screen
  // above its Send button with nothing left behind an inner scrollbar.
  function fit(area) {
    if (!area || !area.style || !(area.scrollHeight > 0)) return;
    area.style.height = "auto";
    area.style.height = (area.scrollHeight + 2) + "px";
  }
  function fitAll() {
    var areas = document.getElementsByTagName ? document.getElementsByTagName("textarea") : [];
    for (var i = 0; i < areas.length; i++) fit(areas[i]);
  }
  function btn(text, cls, fn) {
    return h("button", { type: "button", cls: "btn" + (cls ? " " + cls : ""), text: text, on: ["click", fn] });
  }

  function drawMatch(req, m) {
    var lead = req.lead;
    var first = String(m.name || "").split(" ")[0] || "them";
    var box = h("div", { cls: "match st-" + m.status });
    var when = m.status === "sent" && m.sent_at ? " " + ago(m.sent_at)
      : (m.status === "accepted" || m.status === "introduced" || m.status === "declined") && m.answered_at ? " " + ago(m.answered_at) : "";
    box.appendChild(h("div", { cls: "mhead" }, [
      h("span", { cls: "mname", text: m.name + (m.firm ? " · " + m.firm : "") }),
      h("span", { cls: "chip c-" + m.status, text: (STATUS_WORDS[m.status] || m.status) + when })
    ]));
    var check = m.origin === "platform" ? PLATFORM_CHECK : (CHECK_WORDS[m.email_check] || CHECK_WORDS.none);
    var facts = h("div", { cls: "mfacts" });
    if (m.email) facts.appendChild(h("span", { text: m.email }));
    if (m.phone) facts.appendChild(h("span", { text: m.phone }));
    facts.appendChild(h("span", { cls: "check " + check[1], text: check[0] }));
    if (m.license) facts.appendChild(h("span", { text: "License " + m.license }));
    facts.appendChild(h("span", { text: ORIGIN_WORDS[m.origin] || "" }));
    if (safeHref(m.source_url)) facts.appendChild(link("Where this came from", m.source_url));
    box.appendChild(facts);

    var acts = h("div", { cls: "acts" });
    var e = editOf(m);

    if (m.status === "draft" && !m.email) {
      // Found with a phone number only: nothing to send until an address is typed.
      var addr = h("input", { type: "email", cls: "in", placeholder: "Their email address", value: e.email,
        "aria-label": "Email address for " + m.name });
      addr.addEventListener("input", function () { noteEdit(m, "email", addr.value.trim()); });
      box.appendChild(h("p", { cls: "muted", text: "No email address was stated for " + first + ". Call them, or type an address to draft the email." }));
      box.appendChild(addr);
      acts.appendChild(btn("Draft the email", "", function () {
        run(lead.id, "Drafting…", withEdits({ action: "save", match_id: m.id }, m), function () {
          delete EDITS[m.id]; return "Drafted. Read it, then send.";
        });
      }));
      acts.appendChild(btn("Skip", "quiet", function () {
        run(lead.id, "Saving…", { action: "mark", match_id: m.id, status: "skipped" }, "");
      }));
    } else if (m.status === "draft") {
      // The full text, on screen, above the button that sends it.
      var to = h("input", { type: "email", cls: "in", value: e.email, "aria-label": "To" });
      var subj = h("input", { type: "text", cls: "in", value: e.subject, "aria-label": "Subject" });
      var body = h("textarea", { cls: "in body", rows: "16", "aria-label": "Email to " + m.name });
      body.value = e.body;
      to.addEventListener("input", function () { noteEdit(m, "email", to.value.trim()); });
      subj.addEventListener("input", function () { noteEdit(m, "subject", subj.value); });
      body.addEventListener("input", function () { noteEdit(m, "body", body.value); fit(body); });
      box.appendChild(h("div", { cls: "draft" }, [
        h("label", { cls: "lab", text: "To" }), to,
        h("label", { cls: "lab", text: "Subject" }), subj,
        h("label", { cls: "lab", text: "Email" }), body
      ]));
      if (DATA.mail.ready) {
        acts.appendChild(btn("Send to " + first, "", function () {
          run(lead.id, "Sending to " + m.name + "…", withEdits({ action: "send", match_id: m.id }, m), function (j) {
            delete EDITS[m.id];
            return j.sent ? "Sent to " + m.name + ". If they accept, they are introduced to " + lead.name + " automatically." : "Saved.";
          });
        }));
      }
      if (safeHref(m.gmail_url)) {
        acts.appendChild(h("a", { cls: "btn quiet", href: m.gmail_url, target: "_blank", rel: "noopener noreferrer",
          text: "Open in Gmail", title: "Opens this email in Gmail as stored. Save your edits first if you changed it." }));
        acts.appendChild(btn("Mark as sent", "quiet", function () {
          run(lead.id, "Saving…", { action: "mark", match_id: m.id, status: "sent" }, "Marked as sent.");
        }));
      }
      acts.appendChild(btn("Save edits", "quiet", function () {
        run(lead.id, "Saving…", withEdits({ action: "save", match_id: m.id }, m), function () {
          delete EDITS[m.id]; return "Saved.";
        });
      }));
      acts.appendChild(btn("Skip", "quiet", function () {
        run(lead.id, "Saving…", { action: "mark", match_id: m.id, status: "skipped" }, "");
      }));
    } else {
      if (m.body) {
        box.appendChild(h("details", { cls: "sent" }, [
          h("summary", { text: m.status === "sent" ? "What was sent" : "The email" }),
          h("pre", { text: (m.subject ? "Subject: " + m.subject + "\n\n" : "") + m.body })
        ]));
      }
      if (m.status === "sent" || m.status === "accepted") {
        if (m.status === "sent") {
          box.appendChild(h("p", { cls: "muted", text:
            "Waiting on " + first + ". If they accept with the link, the introduction is sent for you. If they said yes by replying instead, introduce them here." }));
        } else {
          box.appendChild(h("p", { cls: "muted", text: first + " said yes and has not been introduced yet." }));
        }
        acts.appendChild(btn("Introduce " + first + " to " + String(lead.name || "the owner").split(" ")[0],
          m.status === "accepted" ? "" : "quiet", function () {
            if (!confirm("Introduce " + m.name + " to " + lead.name + " now? One email goes to both of them with each other's contact details.")) return;
            run(lead.id, "Introducing…", { action: "introduce", match_id: m.id },
              "Introduced. One email went to both of them, copied to you.");
          }));
        acts.appendChild(btn("Mark introduced", "quiet", function () {
          run(lead.id, "Saving…", { action: "introduced", match_id: m.id }, "Marked as introduced.");
        }));
        acts.appendChild(btn(first + " passed", "quiet", function () {
          run(lead.id, "Saving…", { action: "mark", match_id: m.id, status: "declined" }, "");
        }));
      } else if (m.status === "declined" || m.status === "skipped") {
        acts.appendChild(btn("Put back", "quiet", function () {
          run(lead.id, "Saving…", { action: "mark", match_id: m.id, status: m.sent_at ? "sent" : "draft" }, "");
        }));
      }
    }
    if (acts.childNodes.length) box.appendChild(acts);
    return box;
  }

  function drawAddForm(req) {
    var lead = req.lead;
    var name = h("input", { type: "text", cls: "in", placeholder: "First and last name", "aria-label": "Broker's name" });
    var firm = h("input", { type: "text", cls: "in", placeholder: "Firm", "aria-label": "Firm" });
    var email = h("input", { type: "email", cls: "in", placeholder: "Email", "aria-label": "Email" });
    var phone = h("input", { type: "tel", cls: "in", placeholder: "Phone", "aria-label": "Phone" });
    return h("details", { cls: "add" }, [
      h("summary", { text: "Add a broker you know" }),
      h("div", { cls: "addrow" }, [name, firm, email, phone,
        btn("Add", "quiet", function () {
          run(lead.id, "Adding…", { action: "add", lead_id: lead.id, name: name.value, firm: firm.value,
            email: email.value.trim(), phone: phone.value }, "Added. Read the draft, then send.");
        })])
    ]);
  }

  var STATE_WORDS = {
    "new": "Not started", searching: "Searching", ready: "Brokers found", none_found: "Nobody found",
    failed: "Search failed", introduced: "Introduced", closed: "Closed"
  };

  function drawRequest(req) {
    var lead = req.lead;
    var card = h("section", { cls: "req s-" + req.state });
    var facts = [lead.type, lead.size_sqft ? Math.round(Number(lead.size_sqft)).toLocaleString("en-US") + " SF" : "", req.market]
      .filter(Boolean).join(" · ");
    card.appendChild(h("div", { cls: "rhead" }, [
      h("h2", { text: lead.address || "(no address)" }),
      h("span", { cls: "chip r-" + req.state, text: STATE_WORDS[req.state] || req.state })
    ]));
    card.appendChild(h("div", { cls: "rfacts", text: facts + (lead.is_1031 ? " · 1031 exchange" : "") + " · asked " + ago(lead.ts) }));
    var who = h("div", { cls: "who" });
    who.appendChild(h("b", { text: lead.name || "" }));
    if (lead.company) who.appendChild(h("span", { text: lead.company }));
    if (lead.email) who.appendChild(h("a", { href: "mailto:" + encodeURIComponent(lead.email).replace(/%40/g, "@"), text: lead.email }));
    if (lead.phone) who.appendChild(h("span", { text: lead.phone }));
    if (safeHref(req.report_url)) who.appendChild(link("Their automated estimate", req.report_url));
    card.appendChild(who);

    // An address no page was seen to state is sent one at a time, after a
    // person has looked at it, never swept up by "Send all".
    var drafts = req.matches.filter(function (m) {
      return m.status === "draft" && m.email && m.email_check !== "unseen" && m.email_check !== "unchecked";
    });
    var open = req.state !== "closed";
    var acts = h("div", { cls: "acts top" });

    if (!req.matches.length && open) {
      var rep = h("input", { type: "url", cls: "in", placeholder: "Their report link (optional): …/r/…",
        "aria-label": "Report link", value: req.report_url || "" });
      if (!req.report_url) card.appendChild(rep);
      acts.appendChild(btn(req.busy ? "Searching…" : "Find brokers", "", function () {
        run(lead.id, "Searching the web for local brokers. This takes up to a minute…",
          { action: "find", lead_id: lead.id, report_url: (rep.value || "").trim() || undefined },
          function (j) { return j.added ? "Found " + plural(j.added, "broker") + ". Read each draft, then send." : (j.note || "Nobody found."); });
      }));
    } else if (open) {
      if (drafts.length > 1 && DATA.mail.ready) {
        acts.appendChild(btn("Send all " + drafts.length + " drafts", "", function () {
          if (!confirm("Send " + drafts.length + " emails now, one to each broker shown, exactly as written below?")) return;
          sendAll(lead, drafts);
        }));
      }
      acts.appendChild(btn("Find more brokers", "quiet", function () {
        run(lead.id, "Searching the web for more local brokers. This takes up to a minute…",
          { action: "find", lead_id: lead.id, more: true },
          function (j) { return j.added ? "Found " + plural(j.added, "more broker") + "." : (j.note || "Nobody new was found."); });
      }));
    }
    acts.appendChild(btn(open ? "Close this request" : "Reopen", "quiet", function () {
      run(lead.id, "Saving…", { action: open ? "close" : "reopen", lead_id: lead.id }, "");
    }));
    card.appendChild(acts);

    var msg = MSGS[lead.id] || { text: req.note || "", bad: false };
    card.appendChild(h("div", { id: "msg-" + lead.id, cls: "msg" + (msg.bad ? " bad" : ""), text: msg.text || req.note || "" }));

    req.matches.forEach(function (m) { card.appendChild(drawMatch(req, m)); });
    if (open) card.appendChild(drawAddForm(req));
    return card;
  }

  // One at a time, in order, each with its own edits, stopping at the first
  // refusal so nothing is sent past an error nobody has read.
  function sendAll(lead, drafts) {
    if (BUSY) return;
    BUSY = true;
    document.body.className = "working";
    var sent = 0;
    function next(i) {
      if (i >= drafts.length) return finish(null);
      var m = drafts[i];
      say(lead.id, "Sending " + (i + 1) + " of " + drafts.length + ": " + m.name + "…", false);
      api(withEdits({ action: "send", match_id: m.id }, m)).then(function (j) {
        if (j.sent) { sent++; delete EDITS[m.id]; }
        next(i + 1);
      }).catch(function (e) { finish(e); });
    }
    function finish(err) {
      BUSY = false; document.body.className = "";
      MSGS[lead.id] = err
        ? { text: "Sent " + sent + " of " + drafts.length + ", then stopped: " + err.message, bad: true }
        : { text: "Sent " + plural(sent, "email") + ". A broker who accepts is introduced to " + lead.name + " automatically.", bad: false };
      reload();
    }
    next(0);
  }

  function draw() {
    drawStatus();
    var list = byId("list");
    list.textContent = "";
    var a = DATA.attention || { toSend: 0, toIntroduce: 0 };
    byId("tally").textContent = !DATA.requests.length ? ""
      : (a.toSend || a.toIntroduce)
        ? plural(a.toSend, "draft") + " to send · " + plural(a.toIntroduce, "broker") + " to introduce"
        : "Nothing is waiting on you.";
    if (!DATA.requests.length) {
      list.appendChild(h("p", { cls: "empty", text:
        "No BOV requests in the last 60 days. When one comes in, the local brokers are found and the emails drafted here, and you get an email saying so." }));
      return;
    }
    DATA.requests.forEach(function (r) { list.appendChild(drawRequest(r)); });
    fitAll();
  }

  byId("go").addEventListener("click", function () { load(byId("k").value.trim()); });
  byId("k").addEventListener("keydown", function (e) { if (e.key === "Enter") load(e.target.value.trim()); });
  byId("refresh").addEventListener("click", function () { if (!BUSY) { MSGS = {}; reload(); } });
  // No key in this tab? The 30-day cn_admin cookie may still open it.
  try { KEY = sessionStorage.getItem(KEYK) || ""; } catch (e) { KEY = ""; }
  load(KEY);
}

function renderBovDeskHTML(chrome) {
  chrome = chrome || {};
  const CN_LOGO = chrome.CN_LOGO || "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompNinja BOV desk</title><meta name="robots" content="noindex, nofollow"/>
<meta name="theme-color" content="#FBFBF9"/>
<link rel="icon" href="/favicon.ico" sizes="48x48"/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<style>
*{box-sizing:border-box}
${SCALE_CSS}
:root{
  --ink:#1A2433;--ink-2:#4C5665;--ink-3:#68707E;--ink-4:#C7CBD2;
  --red:#B91C1C;--red-deep:#991B1B;--red-wash:#FCF3F2;
  --ok:#166534;--ok-wash:#EEF7F0;--warn:#92400E;--warn-wash:#FDF6E7;
  --paper:#FBFBF9;--line:#E4E2DA;--hair:#F0EFE9;--wash:#F5F4EF;--edge:#D8D4C9;
  --foot-ink:#B8C0CC;--foot-link:#D5DAE2;
}
body{margin:0;background:var(--paper);color:var(--ink);line-height:1.6;min-height:100vh;
  display:flex;flex-direction:column;font-size:var(--text-compact);font-family:var(--sans);
  -webkit-font-smoothing:antialiased}
body.working button,body.working a.btn{opacity:.55;pointer-events:none}
a{color:var(--red);text-decoration:none}a:hover{color:var(--red-deep)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--text-small);background:var(--wash);border-radius:var(--r-sm);padding:1px 5px}
.wrap{max-width:860px;margin:0 auto;padding:0 var(--s6)}
.hdr{border-bottom:1px solid var(--line);background:var(--paper)}
.hdr .wrap{max-width:1024px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:var(--s4);padding-top:var(--s5);padding-bottom:var(--s5)}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}
.brand svg{height:28px;width:28px;flex-shrink:0}
.wordmark{font-size:var(--text-lead);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.wordmark b{color:var(--red);font-weight:600}
.hdr nav{display:flex;align-items:center;flex-wrap:wrap;gap:var(--s4) var(--s5);font-size:var(--text-small)}
.hdr nav a{color:var(--ink-2);white-space:nowrap}.hdr nav a:hover{color:var(--ink)}
main{flex:1;padding:var(--s8) 0 var(--s9)}
.kicker{font-size:var(--text-tiny);letter-spacing:.16em;text-transform:uppercase;color:var(--red);font-weight:600}
h1.h{font-weight:600;letter-spacing:-.005em;color:var(--ink);margin:var(--s4) 0 0;font-size:var(--text-hero);line-height:1.15}
.sub{color:var(--ink-2);max-width:66ch;margin:var(--s4) 0 0}
.gate{background:#fff;border:1px solid var(--edge);border-radius:var(--r-sm);padding:var(--s6);max-width:400px;margin:var(--s8) auto;text-align:center}
.gate .lab{display:block;font-size:var(--text-small);color:var(--ink-3)}
.gate input{width:100%;padding:var(--s4);border:1px solid var(--edge);border-radius:var(--r-sm);margin:var(--s4) 0;
  font-size:var(--text-compact);font-family:inherit;color:var(--ink);background:var(--paper)}
.gate input:focus,.in:focus{outline:none;border-color:var(--red)}
.btn{display:inline-block;background:var(--red);color:#fff;border:1px solid var(--red);border-radius:var(--r-sm);
  padding:var(--s3) var(--s5);font-weight:600;font-size:var(--text-small);font-family:inherit;cursor:pointer;line-height:1.4}
.btn:hover{background:var(--red-deep);border-color:var(--red-deep);color:#fff}
.btn.quiet{background:#fff;color:var(--ink-2);border-color:var(--edge)}
.btn.quiet:hover{background:#fff;color:var(--ink);border-color:var(--ink-3)}
.err,.msg.bad{color:var(--red)}
.err{font-size:var(--text-small);margin-top:var(--s3)}
.bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--s4);margin:var(--s6) 0 var(--s4)}
.tally{font-weight:600;margin:0}
.status{border:1px solid var(--line);background:#fff;border-radius:var(--r-sm);padding:var(--s4) var(--s5);
  font-size:var(--text-small);color:var(--ink-2)}
.status div+div{margin-top:2px}
.warn{display:none;border:1px solid var(--red);background:var(--red-wash);border-radius:var(--r-sm);
  padding:var(--s4) var(--s5);margin-top:var(--s4);font-size:var(--text-small)}
.msg{min-height:1.4em;font-size:var(--text-small);color:var(--ink-2);margin:var(--s3) 0}
.empty{color:var(--ink-2);border:1px dashed var(--edge);border-radius:var(--r-sm);padding:var(--s6);background:#fff}
.req{background:#fff;border:1px solid var(--line);border-radius:var(--r-sm);padding:var(--s6);margin-top:var(--s6)}
.req.s-closed{opacity:.7}
.rhead{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:var(--s3) var(--s5)}
.rhead h2{font-size:var(--text-title);font-weight:600;letter-spacing:-.005em;margin:0;overflow-wrap:anywhere}
.rfacts{color:var(--ink-3);font-size:var(--text-small);margin-top:2px}
.who{display:flex;flex-wrap:wrap;gap:2px var(--s5);margin-top:var(--s4);font-size:var(--text-small);color:var(--ink-2)}
.who b{color:var(--ink)}
.chip{font-size:var(--text-tiny);font-weight:600;border-radius:999px;padding:2px 10px;white-space:nowrap;
  background:var(--wash);color:var(--ink-2);border:1px solid var(--line)}
.chip.c-accepted,.chip.c-introduced,.chip.r-introduced{background:var(--ok-wash);color:var(--ok);border-color:transparent}
.chip.c-draft,.chip.r-ready{background:var(--warn-wash);color:var(--warn);border-color:transparent}
.chip.r-failed,.chip.r-none_found{background:var(--red-wash);color:var(--red);border-color:transparent}
.acts{display:flex;flex-wrap:wrap;gap:var(--s3);margin-top:var(--s4)}
.match{border-top:1px solid var(--line);margin-top:var(--s5);padding-top:var(--s5)}
.match.st-skipped,.match.st-declined{opacity:.6}
.mhead{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:var(--s3) var(--s5)}
.mname{font-weight:600;overflow-wrap:anywhere}
.mfacts{display:flex;flex-wrap:wrap;gap:2px var(--s5);font-size:var(--text-small);color:var(--ink-2);margin-top:2px}
.mfacts span,.mfacts a{overflow-wrap:anywhere}
/* Not "ok"/"warn": .warn is the migration notice's box, which is display:none
   until it is needed, and a span sharing the name vanished with it. */
.check.good{color:var(--ok)}.check.care{color:var(--warn)}.check.bad{color:var(--red);font-weight:600}
.muted{color:var(--ink-3);font-size:var(--text-small);margin:var(--s3) 0 0}
.lab{display:block;font-size:var(--text-tiny);color:var(--ink-3);font-weight:600;margin:var(--s4) 0 2px}
.in{width:100%;padding:var(--s3) var(--s4);border:1px solid var(--edge);border-radius:var(--r-sm);
  font-size:16px;font-family:inherit;color:var(--ink);background:var(--paper)}
.in.body{line-height:1.5;resize:vertical;font-size:15px;overflow-wrap:anywhere}
.req>.in{margin-top:var(--s4)}
details.sent,details.add{margin-top:var(--s4);font-size:var(--text-small)}
details summary{cursor:pointer;color:var(--ink-2);font-weight:600}
details.sent pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--wash);border:1px solid var(--line);
  border-radius:var(--r-sm);padding:var(--s4);margin:var(--s3) 0 0;font-family:inherit;font-size:var(--text-small)}
.addrow{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);margin-top:var(--s3)}
.addrow .btn{justify-self:start}
footer{background:var(--ink);color:var(--foot-ink);font-size:var(--text-small)}
footer .wrap{max-width:1024px;padding:var(--s7) var(--s6);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--s4)}
footer .wordmark{color:#fff}
footer a{color:var(--foot-link)}footer a:hover{color:#fff}
@media(max-width:560px){
  .wrap{padding:0 16px}.req{padding:var(--s5)}.addrow{grid-template-columns:1fr}
  .acts .btn{flex:1 1 auto;text-align:center}
}
</style></head><body>
<header class="hdr">
  <div class="wrap">
    <a class="brand" href="/" aria-label="CompNinja home">${CN_LOGO}<span class="wordmark">Comp<b>Ninja</b></span></a>
    <nav>
      <a href="/hq">HQ</a>
      <a href="/admin">Analytics</a>
      <a href="/dev">Dev hub</a>
      <a href="/contacts">Contacts</a>
    </nav>
  </div>
</header>
<main>
<div class="wrap">
<div class="kicker">Internal</div>
<h1 class="h">BOV desk</h1>
<p class="sub">When someone asks for a Broker Opinion of Value, the local brokers are found and an email to each is drafted here. Read a draft and send it; a broker who accepts is introduced to the person who asked, by email, without you.</p>
<div id="gate" class="gate"><span class="lab">Enter admin key</span>
<input id="k" type="password" placeholder="ADMIN_KEY" autocomplete="off"/>
<button id="go" class="btn">Open the desk</button><div id="err" class="err"></div></div>
<div id="app" style="display:none">
  <div class="bar">
    <p class="tally" id="tally"></p>
    <button class="btn quiet" id="refresh" type="button">Refresh</button>
  </div>
  <div id="status" class="status"></div>
  <div id="warn" class="warn"></div>
  <div id="topmsg" class="msg"></div>
  <div id="list"></div>
</div>
</div>
</main>
<footer><div class="wrap">
  <span class="wordmark">Comp<b style="color:#EF4444">Ninja</b></span>
  <span>Internal page &middot; <a href="/admin">Analytics</a> &middot; <a href="/">Back to the app</a></span>
</div></footer>
<script>(${deskClient.toString()})();</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// What a broker sees behind the link. Returns { title, body } for server.js
// to put inside marketShell. `view.kind`:
//   open          the offer, with Yes and No
//   done          accepted, and the introduction has been sent
//   accepted      accepted, and the introduction is coming (it could not be
//                 sent on the spot)
//   introduced    this broker already has the introduction
//   taken         another broker has it, or the request is closed
//   declined_now  they just said no
//   invalid/gone/busy
// Nothing about who asked is ever on this page.
// ---------------------------------------------------------------------------
const ACCEPT_CSS =
  "background:#1A2433;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:600;cursor:pointer;font-size:16px";
const DECLINE_CSS =
  "background:transparent;color:#4C5665;border:1px solid #D8D4C9;border-radius:8px;padding:12px 18px;font-weight:600;cursor:pointer;font-size:16px";

function acceptView(view) {
  const v = view || {};
  const pro = v.residential ? "agent" : "broker";
  const wrap = (title, inner) => ({ title, body: `<div class="wrap"><h1>${escHtml(title)}</h1>${inner}</div>` });
  const facts = () => {
    const size = Number(v.size_sqft) > 0 ? `${Math.round(Number(v.size_sqft)).toLocaleString("en-US")} SF` : "";
    const line = [v.type, size].filter(Boolean).map(escHtml).join(" &middot; ");
    const est = /^https?:\/\//i.test(String(v.reportUrl || ""))
      ? `<p><a href="${escHtml(v.reportUrl)}" target="_blank" rel="noopener">See the automated estimate</a> (an automated estimate, not an appraisal).</p>`
      : "";
    return `<p style="font-size:18px"><b>${escHtml(v.address || "")}</b>${line ? `<br>${line}` : ""}</p>${est}`;
  };
  switch (v.kind) {
    case "open":
      return wrap(v.residential ? "Take on this home value request?" : "Take on this Broker Opinion of Value?",
        facts() +
        `<p>The owner asked CompNinja to connect them with a local ${pro}, and was told it is free with no obligation. ` +
        `Say yes and one email introduces the two of you, with each other's contact details. ` +
        `The first ${pro} to accept gets the introduction.</p>` +
        (v.declined ? `<p>You passed on this one earlier. It is still open if you have changed your mind.</p>` : "") +
        `<form method="POST" action="${escHtml(v.action)}" style="display:inline-block;margin:8px 8px 0 0">` +
        `<button type="submit" style="${ACCEPT_CSS}">Yes, introduce me to the owner</button></form>` +
        `<form method="POST" action="${escHtml(v.action)}&amp;no=1" style="display:inline-block;margin:8px 0 0">` +
        `<button type="submit" style="${DECLINE_CSS}">No thanks</button></form>` +
        `<p style="margin-top:24px;color:#68707E;font-size:14px">CompNinja is a valuation tool, not a brokerage. We connect owners with a local ${pro} and take no part in what follows.</p>`);
    case "done":
      return wrap("You're introduced",
        facts() + `<p>An email introducing you and the owner is on its way to both of you now, with their contact details in it. Thank you.</p>`);
    case "accepted":
      return wrap("Thank you",
        facts() + `<p>This one is yours. You will get an email introducing you to the owner shortly.</p>`);
    case "introduced":
      return wrap("You've already been introduced",
        facts() + `<p>The introduction went to your inbox. If you cannot find it, reply to the email this link came in and we will send it again.</p>`);
    case "taken":
      return wrap("This one has been taken",
        `<p>Another ${pro} has already taken this request. Thank you for looking at it. We will keep you in mind for the next one in your market.</p>`);
    case "declined_now":
      return wrap("Thanks for letting us know",
        `<p>We will not introduce you for this one. If you change your mind, the link in the email still works while the request is open.</p>`);
    case "busy":
      return wrap("One moment", `<p>Too many requests from this connection. Please try the link again in a few minutes.</p>`);
    case "gone":
      return wrap("This request is no longer open", `<p>The request this link was for has been withdrawn. Thank you for looking at it.</p>`);
    default:
      return wrap("This link is not recognized",
        `<p>It may have been cut short by an email program. Reply to the email it came in and we will take it from there.</p>`);
  }
}

module.exports = { renderBovDeskHTML, acceptView, deskClient, escHtml };
