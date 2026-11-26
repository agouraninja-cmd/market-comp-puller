// ---------------------------------------------------------------------------
// /admin/removals: the owner lookup's removal list (owner-lookup.js rule 8,
// migration 067; routes in server.js, /api/admin/owner-suppressions).
//
// A person who asks to stop being shown in owner lookups (the Privacy
// Policy's section 7 tells them to email us) is added here by the owner:
// an address, a name, a phone or an email. From then on the lookup refuses
// that address before any search and scrubs that name, phone or email out of
// every answer, including answers members looked up before.
//
// Pure: chrome in, HTML out, bov-desk-page.js's pattern. The page is a public
// shell that shows nothing until the API answers, which needs the admin key
// or the cn_admin cookie. THE BROWSER SCRIPT IS A REAL FUNCTION
// (removalsClient), emitted with toString(), so `node --check` parses it; it
// must read nothing from this module's scope. ES5, like the other admin
// pages. What anybody typed is set as text (textContent), never as markup.
// Opening the page only reads: the one GET. Adding and removing are clicks.
// ---------------------------------------------------------------------------

"use strict";

const SCALE_CSS = require("./theme.js").scaleCss();

function removalsClient() {
  var KEYK = "cn_admin_key";
  var KEY = "";
  function byId(id) { return document.getElementById(id); }
  function h(tag, text, cls) {
    var el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function say(text, bad) {
    var m = byId("msg");
    m.textContent = text || "";
    m.className = bad ? "msg bad" : "msg";
  }
  function call(method, url, body) {
    var init = { method: method, headers: { "x-admin-key": KEY || "" } };
    if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  var KIND_NAMES = { address: "Property address", name: "Name", phone: "Phone", email: "Email" };
  function draw(rows) {
    var list = byId("list");
    list.textContent = "";
    if (!rows.length) { list.appendChild(h("p", "Nobody has asked to be removed yet.", "muted")); return; }
    rows.forEach(function (r) {
      var row = h("div", null, "row");
      var main = h("div", null, "rmain");
      main.appendChild(h("div", (KIND_NAMES[r.kind] || r.kind) + ": " + (r.label || r.value_key), "rlabel"));
      var meta = (r.created_at ? String(r.created_at).slice(0, 10) : "") + (r.note ? " · " + r.note : "");
      if (meta) main.appendChild(h("div", meta, "muted"));
      row.appendChild(main);
      var del = h("button", "Take off the list", "btn ghost");
      del.addEventListener("click", function () {
        if (!window.confirm("Take this off the removal list? Owner lookups will show it again.")) return;
        call("DELETE", "/api/admin/owner-suppressions?id=" + encodeURIComponent(r.id)).then(function (j) {
          if (j.status !== 200) return say(j.error || "Couldn't remove it.", true);
          say("Taken off the list.");
          load(KEY);
        });
      });
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  function load(key) {
    KEY = key || "";
    return call("GET", "/api/admin/owner-suppressions").then(function (j) {
      if (j.status === 401) {
        byId("gate").style.display = "";
        byId("app").style.display = "none";
        if (key) say("Incorrect key.", true);
        return;
      }
      if (j.status === 404) return say("Disabled: set ADMIN_KEY on the server.", true);
      byId("gate").style.display = "none";
      byId("app").style.display = "";
      if (key) { try { sessionStorage.setItem(KEYK, key); } catch (e) { /* private window */ } }
      if (j.status !== 200) return say(j.error || "Couldn't load the list.", true);
      draw(j.rows || []);
    });
  }
  byId("gate").addEventListener("submit", function (e) {
    e.preventDefault();
    load(byId("key").value.trim());
  });
  byId("add").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = { kind: byId("kind").value, value: byId("value").value, note: byId("note").value };
    call("POST", "/api/admin/owner-suppressions", body).then(function (j) {
      if (j.status !== 200) return say(j.error || "Couldn't add it.", true);
      say(j.already ? "That was already on the list." : "Added. Owner lookups stop showing it within a minute.");
      byId("value").value = "";
      byId("note").value = "";
      load(KEY);
    });
  });
  try { KEY = sessionStorage.getItem(KEYK) || ""; } catch (e) { KEY = ""; }
  load(KEY);
}

const CSS = `${SCALE_CSS}
*{box-sizing:border-box}
body{margin:0;background:var(--bg,#f6f7f9);color:var(--ink,#1c2430);font:15px/1.5 Inter,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:26px;margin:0 0 6px}
.muted{color:var(--ink-3,#6b7686);font-size:13px}
.card{background:var(--card,#fff);border:1px solid var(--line,#e3e7ed);border-radius:10px;padding:18px;margin:16px 0}
label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
input,select{width:100%;padding:9px 10px;border:1px solid var(--line,#cfd6df);border-radius:8px;font:inherit;background:var(--card,#fff);color:inherit}
.btn{margin-top:12px;padding:9px 14px;border-radius:8px;border:0;background:var(--accent,#c8102e);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.btn.ghost{background:none;border:1px solid var(--line,#cfd6df);color:inherit;margin:0;white-space:nowrap}
.row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line,#e3e7ed)}
.row:first-child{border-top:0}
.rlabel{font-weight:600;word-break:break-word}
.msg{min-height:20px;font-size:14px;margin-top:8px}
.msg.bad{color:#b42318}
ol{padding-left:20px;margin:6px 0 0}
`;

function renderOwnerRemovalsHTML() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Owner lookup removals | CompNinja</title>
<style>${CSS}</style></head><body><main>
<h1>Owner lookup removals</h1>
<p class="muted">People who asked CompNinja to stop showing their details in owner lookups. Anything on this list is
taken out of every owner lookup answer, old and new, and a listed address is not looked up at all.</p>
<form id="gate" class="card" style="display:none"><label for="key">Admin key</label>
<input id="key" type="password" autocomplete="off"><button class="btn" type="submit">Open</button></form>
<div id="msg" class="msg" role="status"></div>
<div id="app" style="display:none">
<form id="add" class="card">
<label for="kind">What to remove</label>
<select id="kind"><option value="name">A person's or company's name</option><option value="phone">A phone number</option>
<option value="email">An email address</option><option value="address">A property address</option></select>
<label for="value">Exactly as they gave it</label>
<input id="value" maxlength="200" required placeholder="A full name, a phone number, an email address, or a street address">
<label for="note">Who asked and when (for the record)</label>
<input id="note" maxlength="300" placeholder="Asked by email on Nov 26, confirmed by reply">
<button class="btn" type="submit">Add to the removal list</button>
</form>
<div class="card"><b>When a removal request comes in</b><ol class="muted">
<li>Add each thing they named: their name, and their phone and email if they gave them. A name needs a first and last name.</li>
<li>Reply to say it is done. Aim for within 10 business days; the Privacy Policy says so.</li>
<li>Contacts members already saved are their own records and are not changed here. If the person asks, delete those rows
by hand in Supabase (<code>user_contacts</code> and <code>org_contacts</code> where <code>source = 'lookup'</code>).</li>
</ol></div>
<div class="card"><b>On the list</b><div id="list"></div></div>
</div>
</main>
<script>(${removalsClient.toString()})();</script>
</body></html>`;
}

module.exports = { renderOwnerRemovalsHTML, removalsClient };
