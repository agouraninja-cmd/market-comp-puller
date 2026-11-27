// ---------------------------------------------------------------------------
// bov-builder.js — the BOV builder's browser half (/bov; bov-page.js draws
// the form, bov-doc.js knows everything). 2026-11-27.
//
// It binds the form to a draft, redraws the document beside it on every
// keystroke, keeps the draft in this browser, and prints. It DECIDES nothing:
// how a figure is read, which comps are ticked to start, what range they
// support and what the document says are all BOVDOC's (pure, tested).
//
// WHAT LEAVES THE PAGE, in full (CLAUDE.md rule 6; test/bov-page.test.js
// reads this file for any other request):
//   GET  /api/branding          the broker's own letterhead
//   GET  /api/broker/bovs       their own BOV log, to start from one
//   POST /api/building-photo    ONE press, the subject's address in the body
//                               (rule 7's own door), for a street photo
//   POST /api/broker/bovs/update  ONE press, { id, status: "delivered" }
//   GET  /api/broker/bov-docs   the list of BOVs saved to their account
//   GET  /api/broker/bov-docs?id=   ONE press (or a card's link), to open one
//   POST /api/broker/bov-docs   ONE press of Save: { id, draft }
//   DELETE /api/broker/bov-docs?id=   ONE press of Remove
// The draft itself (an owner's name, an NOI, a value, which private comps
// were used) goes to ONE place and only when the broker presses "Save to
// your account" (2026-11-27, the owner: "let brokers save BOVs to their
// account"): their own row, which only they can read. Typing sends nothing.
// Until it is saved, and between saves, the draft is kept in localStorage
// under a key that names the account by a tag the server hashed, so two
// people sharing a browser do not read each other's drafts.
//
// NOTHING IS WRITTEN ON LOAD. A copy of this page built ahead of the click
// (rule 15) reads, draws, and waits.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  var B = window.BOVDOC, BOOT = window.__BOV_BOOT__;
  var $ = function (id) { return document.getElementById(id); };
  if (!B || !BOOT || !$("bbApp")) return;

  var j = BOOT.j || {};
  var comps = j.comps || [];
  var identity = j.identity || null;
  var brand = null, brandKnown = false;
  var bovs = [];
  var today = (function () { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); })();

  // A development firm writes no BOVs: its row here is Sites (vault-page.js's
  // applyShop, the same rule). Never from a page built ahead of being seen.
  var shop = !!(j.firm && j.firm.kind === "development");
  if (window.cnShopNav) window.cnShopNav(shop);
  if (shop && !document.prerendering && window.location && window.location.replace) { window.location.replace("/sites"); return; }

  // ---- the draft, and where it is kept ----------------------------------------
  var STORE_KEY = "cnBov1:" + (BOOT.tag || "me");
  var MAX_DRAFTS = 12;
  var store = { drafts: {}, last: "_" };
  try {
    var raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.drafts && typeof parsed.drafts === "object") store = { drafts: parsed.drafts, last: String(parsed.last || "_") };
  } catch (e) {}
  // Where a draft sits in this browser: a saved copy under its own id, else
  // the pipeline BOV it is for, else the one free-standing draft.
  var keyOf = function (d) { return d.docId ? "d:" + d.docId : (d.from || "_"); };
  var draft = B.blankDraft();
  var saveNote = "";
  // dirty: this draft holds changes the account's copy does not.
  var dirty = false;

  function save() {
    var key = keyOf(draft);
    store.drafts[key] = { at: Date.now(), d: draft, u: dirty ? 1 : 0 };
    store.last = key;
    var keys = Object.keys(store.drafts).sort(function (a, b) { return (store.drafts[b].at || 0) - (store.drafts[a].at || 0); });
    keys.slice(MAX_DRAFTS).forEach(function (k) { delete store.drafts[k]; });
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      saveNote = "";
    } catch (e) {
      // Almost always the cover photos: storage is small. Keep this draft's
      // words and drop the pictures from the copy that is stored.
      try {
        var lean = { drafts: {}, last: store.last };
        Object.keys(store.drafts).forEach(function (k) {
          var d = store.drafts[k].d, c = {};
          Object.keys(d).forEach(function (f) { c[f] = f === "photo" && /^data:/.test(String(d[f])) ? "" : d[f]; });
          lean.drafts[k] = { at: store.drafts[k].at, d: c };
        });
        window.localStorage.setItem(STORE_KEY, JSON.stringify(lean));
        saveNote = "The cover photo is too large to keep in this browser. It stays while this page is open.";
      } catch (e2) { saveNote = "This browser would not keep the draft. It stays while this page is open."; }
    }
  }
  // fresh: nothing was kept for this BOV, so its card on the Pipeline board
  // may fill the form in. A kept draft is never written over by it.
  var fresh = true;
  function loadDraft(from) {
    var held = store.drafts[from || "_"];
    // A BOV for this card that was saved to the account is kept here under
    // its own id: the newest of those is this card's draft.
    if (!held && from) {
      Object.keys(store.drafts).forEach(function (k) {
        var e = store.drafts[k];
        if (k.indexOf("d:") === 0 && e && e.d && e.d.from === from && (!held || (e.at || 0) > (held.at || 0))) held = e;
      });
    }
    fresh = !held;
    draft = B.cleanDraft(held && held.d);
    draft.from = from || "";
    dirty = !!(held && held.u);
  }
  function loadKey(key) {
    var held = store.drafts[key];
    fresh = !held;
    draft = B.cleanDraft(held && held.d);
    dirty = !!(held && held.u);
  }

  // ---- the form ---------------------------------------------------------------
  // [input id, where it lives in the draft]
  var FIELDS = [
    ["bbAddr", "subject", "address"], ["bbType", "subject", "type"], ["bbSize", "subject", "size"], ["bbAcres", "subject", "acres"],
    ["bbYear", "subject", "year"], ["bbOcc", "subject", "occupancy"], ["bbZoning", "subject", "zoning"], ["bbHighlights", "subject", "highlights"],
    ["bbClient", "client", "name"], ["bbClientCo", "client", "company"],
    ["bbLow", "value", "low"], ["bbHigh", "value", "high"], ["bbList", "value", "list"],
    ["bbNoi", "income", "noi"], ["bbCap", "income", "cap"],
    ["bbSummary", "text", "summary"], ["bbMarket", "text", "market"], ["bbStrategy", "text", "strategy"], ["bbAbout", "text", "about"],
  ];
  function fillForm() {
    FIELDS.forEach(function (f) { $(f[0]).value = draft[f[1]][f[2]] || ""; });
    $("bbFrom").value = draft.from || "";
    if (draft.income.noi || draft.income.cap) $("bbIncomeBox").open = true;
  }
  var showAll = false, findText = "";

  function show(el, on) { if (on) el.removeAttribute("hidden"); else el.setAttribute("hidden", ""); }
  function setText(el, text) { el.textContent = text == null ? "" : String(text); }

  // The comps the broker has not chosen for themselves yet are BOVDOC's pick,
  // re-made whenever the address or the type changes what suits.
  function applySuggestion() {
    if (!draft.touchedComps) draft.compIds = B.suggestComps(comps, draft.subject);
  }

  function compLine(c) {
    var land = B.isLandType(c.property_type);
    var rate = c.transaction === "lease" ? B.rentRate(c) : B.saleRate(c);
    var fig = rate == null ? "" : c.transaction === "lease" ? "$" + rate.toFixed(2) + "/SF/yr" : B.fmtRateShort(rate, land ? "acre" : "sf");
    var a = B.splitAddress(c.address);
    var sub = [c.property_type, c.transaction === "lease" ? "Lease" : "Sale", B.shortDate(c.deal_date) || "Undated", a.rest].filter(Boolean).join(" · ");
    return { street: a.street || c.address || "", sub: sub, fig: fig || "no price" , none: !fig };
  }

  function renderComps() {
    var ranked = B.rankComps(comps, draft.subject);
    var on = {};
    draft.compIds.forEach(function (id) { on[id] = true; });
    var terms = findText.toLowerCase().split(/\s+/).filter(Boolean);
    var list = ranked.filter(function (c) {
      if (!terms.length) return true;
      var hay = [c.address, c.market, c.property_type, c.transaction].join(" ").toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    // The ticked ones lead, so a chosen comp is never below the fold.
    list.sort(function (a, b) { return (on[String(b.id)] ? 1 : 0) - (on[String(a.id)] ? 1 : 0); });
    var cap = showAll || terms.length ? list.length : Math.max(8, draft.compIds.length);
    var box = $("bbCompList");
    box.textContent = "";
    list.slice(0, cap).forEach(function (c) {
      var id = String(c.id), line = compLine(c);
      var row = document.createElement("label");
      row.className = on[id] ? "bb-c" : "bb-c off";
      var tick = document.createElement("input");
      tick.type = "checkbox"; tick.checked = !!on[id]; tick.setAttribute("data-comp", id);
      var b = document.createElement("b"); setText(b, line.street);
      var em = document.createElement("em"); setText(em, line.fig); if (line.none) em.className = "none";
      var i = document.createElement("i"); setText(i, line.sub);
      row.appendChild(tick); row.appendChild(b); row.appendChild(em); row.appendChild(i);
      box.appendChild(row);
    });
    show($("bbCompTools"), comps.length > 8);
    show($("bbCompEmpty"), !comps.length);
    show($("bbCompLead"), comps.length > 0);
    var more = $("bbCompMore");
    show(more, !terms.length && list.length > cap || (showAll && list.length > 8 && !terms.length));
    setText(more, showAll ? "Show fewer" : "Show all " + list.length + " of your comps");

    var mbox = $("bbManualList");
    mbox.textContent = "";
    draft.manual.forEach(function (m) {
      var c = B.manualComp(m, draft.subject.type), line = compLine(c);
      var row = document.createElement("div");
      row.className = "bb-c";
      var dot = document.createElement("span"); setText(dot, "✎");
      var b = document.createElement("b"); setText(b, line.street);
      var x = document.createElement("button");
      x.type = "button"; x.className = "bb-link bb-x"; x.setAttribute("data-unmanual", m.id); setText(x, "Remove");
      var i = document.createElement("i"); setText(i, "Typed in · " + (B.shortDate(m.date) || "Undated") + " · " + line.fig);
      row.appendChild(dot); row.appendChild(b); row.appendChild(x); row.appendChild(i);
      mbox.appendChild(row);
    });
    var n = draft.compIds.length + draft.manual.length;
    setText($("bbCompN"), n ? n + " chosen" : "");
  }

  function renderType() {
    var land = B.isLandType(draft.subject.type);
    show($("bbSizeRow"), !land);
    setText($("bbAcresLab"), land ? "Site (acres)" : "Lot (acres)");
    $("bbAcres").placeholder = land ? "4.5" : "optional";
    setText($("bbmSizeLab"), land ? "Size (acres)" : "Size (SF)");
  }

  function renderValue() {
    var chosen = B.chosenComps(draft, comps);
    var basis = B.saleBasis(chosen, draft.subject.type), size = B.subjectSize(draft);
    var sug = B.suggestValue(basis, size);
    var box = $("bbSuggest");
    show(box, !!basis.n);
    if (basis.n) {
      var land = basis.unit === "acre";
      var text = "Your " + basis.n + " comparable " + draft.subject.type.toLowerCase() + " sale" + (basis.n === 1 ? "" : "s") +
        (basis.n === 1 || basis.low === basis.high ? " sold at " + B.fmtRate(basis.median, basis.unit)
          : " sold at " + B.fmtRateShort(basis.low, basis.unit) + " to " + B.fmtRateShort(basis.high, basis.unit) + ", median " + B.fmtRateShort(basis.median, basis.unit)) + ".";
      if (sug) {
        text += " On " + (land ? B.fmtNum(size, 2) + " acres" : B.fmtNum(size) + " SF") + " that is " +
          (sug.single ? B.fmtMoney(sug.likely) : B.fmtMoney(sug.low) + " to " + B.fmtMoney(sug.high) + ", " + B.fmtMoney(sug.likely) + " at the median") + ".";
      } else {
        text += " Enter the property’s " + (land ? "acreage" : "size") + " to see what that comes to.";
      }
      setText($("bbSuggestText"), text);
      show($("bbUse"), !!sug);
    }
    var op = B.opinion(draft), errs = op.errors;
    ["low", "high", "list"].forEach(function (k) {
      $(k === "low" ? "bbLow" : k === "high" ? "bbHigh" : "bbList").className = errs[k] ? "bad" : "";
    });
    var first = errs.low || errs.high || errs.list || "";
    setText($("bbValErr"), first); show($("bbValErr"), !!first);

    var noi = B.money(draft.income.noi), cap = B.percent(draft.income.cap), inc = B.incomeValue(draft);
    $("bbNoi").className = noi.ok ? "" : "bad"; $("bbCap").className = cap.ok ? "" : "bad";
    var ierr = (!noi.ok && noi.error) || (!cap.ok && cap.error) || "";
    setText($("bbIncErr"), ierr); show($("bbIncErr"), !!ierr);
    setText($("bbIncomeOut"), inc ? B.fmtMoney(inc.noi) + " a year at a " + inc.cap + "% cap rate indicates " + B.fmtMoney(inc.value) + ". It prints under the comparables."
      : "Your figures are on this page and the document. They are sent nowhere unless you save the BOV to your account.");

    var s = draft.subject, perr = "";
    var sz = B.number(B.isLandType(s.type) ? s.acres : s.size), yr = B.year(s.year);
    $("bbSize").className = !B.isLandType(s.type) && !sz.ok ? "bad" : "";
    $("bbAcres").className = !B.number(s.acres).ok ? "bad" : "";
    $("bbYear").className = yr.ok ? "" : "bad";
    if (!sz.ok) perr = sz.error; else if (!B.number(s.acres).ok) perr = B.number(s.acres).error; else if (!yr.ok) perr = yr.error;
    setText($("bbPropErr"), perr); show($("bbPropErr"), !!perr);
  }

  function renderBrand() {
    var el = $("bbBrand");
    if (!brandKnown) { setText(el, "Loading your letterhead…"); return; }
    var who = B.preparerOf(brand, identity);
    el.textContent = "";
    if (!who.firm && !who.name && !who.logo) {
      setText(el, "No letterhead yet. The document will carry no firm name until you add one.");
      return;
    }
    el.appendChild(document.createTextNode([who.name, who.firm].filter(Boolean).join(", ") || "Your logo"));
    var sub = document.createElement("span");
    setText(sub, [who.license ? "License " + who.license : "No license number on file", who.phone, who.email].filter(Boolean).join(" · "));
    el.appendChild(sub);
  }

  function renderLook() {
    var sw = $("bbAccents").querySelectorAll("[data-accent]");
    for (var i = 0; i < sw.length; i++) sw[i].setAttribute("aria-pressed", sw[i].getAttribute("data-accent") === draft.accent ? "true" : "false");
    $("bbDocCss").textContent = B.documentCss(draft.accent);
    show($("bbPhotoRemove"), !!draft.photo);
  }

  function renderReady() {
    var r = B.readiness(draft, comps, brand), el = $("bbReady");
    el.textContent = "";
    var b = document.createElement("b");
    if (r.ready) {
      el.className = "bb-ready ok";
      setText(b, "Ready to print.");
      el.appendChild(b);
      if (r.want.length) el.appendChild(document.createTextNode(" Worth adding: " + r.want.map(function (w) { return w[1].charAt(0).toLowerCase() + w[1].slice(1); }).join("; ") + "."));
    } else {
      el.className = "bb-ready";
      setText(b, "Still needed: ");
      el.appendChild(b);
      el.appendChild(document.createTextNode(r.need.map(function (w) { return w[1].charAt(0).toLowerCase() + w[1].slice(1); }).join("; ") + "."));
    }
    if (saveNote) { el.appendChild(document.createElement("br")); el.appendChild(document.createTextNode(saveNote)); }
    $("bbPrint").disabled = !r.ready;
  }

  function docOpts(preview) { return { comps: comps, brand: brand, identity: identity, today: today, preview: preview }; }

  function fitPreview() {
    var prev = $("bbPrev"), zoom = $("bbZoom");
    var w = prev.clientWidth - 40;
    if (!(w > 0)) return;
    zoom.style.zoom = String(Math.min(1, Math.round((w / 816) * 1000) / 1000));
  }

  function renderDoc() {
    // The document is BOVDOC's own string, every typed value escaped there.
    $("bbZoom").innerHTML = B.documentHtml(draft, docOpts(true));
    fitPreview();
  }

  var timer = null;
  function redraw(now) {
    renderType(); renderComps(); renderValue(); renderLook(); renderReady();
    if (timer) clearTimeout(timer);
    if (now) { renderDoc(); return; }
    timer = setTimeout(renderDoc, 120);
  }
  // A change the broker made: kept in this browser, then drawn. Nothing is
  // sent: the account's copy changes only on a press of Save.
  function changed() { dirty = true; save(); renderSaved(); redraw(false); }

  // ---- wiring -----------------------------------------------------------------
  FIELDS.forEach(function (f) {
    var el = $(f[0]);
    var on = function () {
      draft[f[1]][f[2]] = el.value;
      if (f[0] === "bbAddr" || f[0] === "bbType") applySuggestion();
      changed();
    };
    el.addEventListener("input", on);
    el.addEventListener("change", on);
  });

  $("bbCompList").addEventListener("change", function (e) {
    var t = e.target, id = t && t.getAttribute && t.getAttribute("data-comp");
    if (!id) return;
    draft.touchedComps = true;
    var at = draft.compIds.indexOf(id);
    if (t.checked && at < 0) {
      if (draft.compIds.length >= B.COMPS_MAX) { t.checked = false; return; }
      draft.compIds.push(id);
    } else if (!t.checked && at >= 0) draft.compIds.splice(at, 1);
    changed();
  });
  $("bbFind").addEventListener("input", function () { findText = $("bbFind").value; renderComps(); });
  $("bbCompMore").addEventListener("click", function () { showAll = !showAll; renderComps(); });

  $("bbmAdd").addEventListener("click", function () {
    var m = { address: $("bbmAddr").value.trim(), date: $("bbmDate").value, size: $("bbmSize").value, price: $("bbmPrice").value, cap: $("bbmCap").value };
    var err = "";
    var size = B.number(m.size), price = B.money(m.price), cap = B.percent(m.cap);
    if (!m.address) err = "Enter the comparable’s address.";
    else if (!size.ok) err = size.error;
    else if (!price.ok) err = price.error;
    else if (!cap.ok) err = cap.error;
    else if (draft.manual.length >= B.MANUAL_MAX) err = "A BOV holds up to " + B.MANUAL_MAX + " typed comparables.";
    setText($("bbmErr"), err); show($("bbmErr"), !!err);
    if (err) return;
    m.id = "m" + (draft.manual.length + 1);
    draft.manual.push(m);
    draft = B.cleanDraft(draft);
    ["bbmAddr", "bbmDate", "bbmSize", "bbmPrice", "bbmCap"].forEach(function (id) { $(id).value = ""; });
    changed();
  });
  $("bbManualList").addEventListener("click", function (e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute("data-unmanual");
    if (!id) return;
    draft.manual = draft.manual.filter(function (m) { return m.id !== id; });
    draft = B.cleanDraft(draft);
    changed();
  });

  $("bbUse").addEventListener("click", function () {
    var sug = B.suggestValue(B.saleBasis(B.chosenComps(draft, comps), draft.subject.type), B.subjectSize(draft));
    if (!sug) return;
    var plain = function (n) { return Math.round(n).toLocaleString("en-US"); };
    draft.value.low = plain(sug.low); draft.value.high = plain(sug.high);
    if (!draft.value.list.trim()) draft.value.list = plain(sug.likely);
    fillForm(); changed();
  });

  // A first draft is offered into an EMPTY box, or asked about first: it
  // never writes over words the broker typed.
  function starter(boxId, key, make) {
    var text = make();
    if (!text) return;
    if (draft.text[key].trim() && !window.confirm("Replace what you have written with a new first draft?")) return;
    draft.text[key] = text; $(boxId).value = text; changed();
  }
  $("bbSummaryDraft").addEventListener("click", function () { starter("bbSummary", "summary", function () { return B.starterSummary(draft, comps); }); });
  $("bbStrategyDraft").addEventListener("click", function () { starter("bbStrategy", "strategy", function () { return B.starterStrategy(draft); }); });

  $("bbAccents").addEventListener("click", function (e) {
    var t = e.target; while (t && t !== this && !(t.getAttribute && t.getAttribute("data-accent"))) t = t.parentNode;
    var key = t && t.getAttribute && t.getAttribute("data-accent");
    if (!key) return;
    draft.accent = key; changed();
  });

  // ---- the cover photo ----------------------------------------------------------
  function photoMsg(text) { setText($("bbPhotoMsg"), text || ""); }
  $("bbPhotoPick").addEventListener("click", function () { $("bbPhotoFile").click(); });
  $("bbPhotoFile").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { photoMsg("Choose a JPEG, PNG or WebP image."); return; }
    var reader = new FileReader();
    reader.onerror = function () { photoMsg("That image could not be read."); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { photoMsg("That image could not be read."); };
      img.onload = function () {
        // Sized for a printed cover and small enough to keep: the photo is
        // redrawn in this browser and never uploaded.
        var out = "", widths = [1400, 1100, 800];
        for (var i = 0; i < widths.length && !out; i++) {
          var w = Math.min(widths[i], img.naturalWidth || img.width), h = Math.round(w * ((img.naturalHeight || img.height) / (img.naturalWidth || img.width)));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          var url = canvas.toDataURL("image/jpeg", 0.82);
          if (B.okPhoto(url)) out = url;
        }
        if (!out) { photoMsg("That image is too large to use. Try a smaller one."); return; }
        draft.photo = out; photoMsg("Your photo is on the cover."); changed();
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
  $("bbPhotoStreet").addEventListener("click", function () {
    var address = draft.subject.address.trim(), btn = this;
    if (!address) { photoMsg("Enter the property’s address first."); return; }
    btn.disabled = true; photoMsg("Looking for a street photo…");
    // The address travels in the body, to our own server (rule 7).
    fetch("/api/building-photo", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ places: [{ address: address }] }) })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .then(function (o) {
        btn.disabled = false;
        if (o.s === 404) { show(btn, false); photoMsg("Street photos are not available here. Upload your own."); return; }
        var src = o.s === 200 && o.j && o.j.photos && o.j.photos[0];
        if (src && B.okPhoto(src)) { draft.photo = src; photoMsg("A street photo of the address is on the cover."); changed(); }
        else photoMsg(o.s === 200 ? "No good street photo of this address was found. Upload your own." : "The street photo could not be looked up just now.");
      })
      .catch(function () { btn.disabled = false; photoMsg("The street photo could not be looked up just now."); });
  });
  $("bbPhotoRemove").addEventListener("click", function () { draft.photo = ""; photoMsg(""); changed(); });

  // ---- starting from a BOV on the Pipeline board ----------------------------------
  function bovLabel(b) {
    return [b.address ? B.splitAddress(b.address).street : "", b.market, b.property_type].filter(Boolean).join(" · ");
  }
  function prefillFrom(b) {
    if (!b || !fresh) return;
    var s = draft.subject;
    if (b.address) s.address = String(b.address);
    if (B.PROPERTY_TYPES.indexOf(b.property_type) >= 0) s.type = b.property_type;
    if (b.size_sqft && !B.isLandType(s.type)) s.size = Math.round(Number(b.size_sqft)).toLocaleString("en-US");
  }
  function switchTo(from) {
    loadDraft(from);
    var row = bovs.filter(function (b) { return String(b.id) === from; })[0];
    prefillFrom(row);
    applySuggestion();
    showDraft();
    openForCard();
  }
  // The form, the saved line and the document, from the draft as it now is.
  function showDraft() {
    fillForm(); show($("bbDone"), false); photoMsg(""); saveMsg = "";
    renderFrom(); renderSaved(); redraw(true);
  }
  $("bbFrom").addEventListener("change", function () { switchTo(this.value); });
  function renderFrom() {
    var sel = $("bbFrom"), keep = draft.from;
    var open = bovs.filter(function (b) { return b.status === "open" || b.status === "delivered" || String(b.id) === keep; });
    while (sel.options.length > 1) sel.remove(1);
    open.forEach(function (b) {
      var o = document.createElement("option");
      o.value = String(b.id); setText(o, bovLabel(b) || "A BOV in your pipeline");
      sel.appendChild(o);
    });
    sel.value = keep || "";
    show($("bbFromRow"), open.length > 0);
  }

  // ---- printing -----------------------------------------------------------------
  function whenImagesLoad(el, done) {
    var imgs = el.querySelectorAll ? el.querySelectorAll("img") : [], left = 0, fired = false;
    var go = function () { if (!fired) { fired = true; done(); } };
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) continue;
      left++;
      var one = function () { if (--left <= 0) go(); };
      imgs[i].addEventListener("load", one); imgs[i].addEventListener("error", one);
    }
    if (!left) go(); else setTimeout(go, 4000);
  }
  $("bbPrint").addEventListener("click", function () {
    if (!B.readiness(draft, comps, brand).ready || !window.print) return;
    var sheet = $("bovSheet"), body = document.body;
    // The printed copy is drawn without the page's hints, so none can reach a
    // client, and moved under body: the print rule shows that one child.
    sheet.innerHTML = B.documentHtml(draft, docOpts(false));
    if (sheet.parentNode !== body) body.appendChild(sheet);
    var title = document.title;
    var done = function () {
      body.classList.remove("bov-printing"); document.title = title;
      window.removeEventListener("afterprint", done);
      var row = bovs.filter(function (b) { return String(b.id) === draft.from; })[0];
      show($("bbDone"), !!(row && row.status === "open"));
    };
    window.addEventListener("afterprint", done);
    whenImagesLoad(sheet, function () {
      body.classList.add("bov-printing");
      // The browser offers the page's title as the PDF's file name.
      document.title = B.fileName(draft);
      window.print();
    });
  });
  $("bbDelivered").addEventListener("click", function () {
    var btn = this, id = draft.from;
    if (!id) return;
    btn.disabled = true;
    fetch("/api/broker/bovs/update", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: id, status: "delivered" }) })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .then(function (o) {
        btn.disabled = false;
        if (o.s !== 200) { setText($("bbDoneMsg"), (o.j && o.j.error) || "That could not be saved. Please try again."); return; }
        bovs.forEach(function (b) { if (String(b.id) === id) b.status = "delivered"; });
        show(btn, false); setText($("bbDoneMsg"), "Moved to Delivered.");
      })
      .catch(function () { btn.disabled = false; setText($("bbDoneMsg"), "That could not be saved. Please try again."); });
  });

  $("bbReset").addEventListener("click", function () {
    if (!window.confirm("Clear this draft and start over? This cannot be undone.")) return;
    // The browser's draft goes. A copy saved to the account is untouched:
    // it is still in "Open a saved BOV", and Remove is its own press.
    var from = draft.from;
    delete store.drafts[keyOf(draft)];
    draft = B.blankDraft(); draft.from = from; fresh = true; dirty = false;
    prefillFrom(bovs.filter(function (b) { return String(b.id) === from; })[0]);
    applySuggestion();
    save();
    showDraft();
  });

  // ---- saved to the account -------------------------------------------------------
  // The one place a draft is sent, and only on a press (the header's rule).
  // savedReady stays false until the list read answers 200: a free account, an
  // outage or an unrun migration 067 leaves the page as it was, with no Save.
  var docs = [], savedReady = false, saveMsg = "", saveBad = false;
  function docLabel(d) {
    var when = B.shortDate(String(d.updated_at || "").slice(0, 10));
    return [B.splitAddress(d.address).street || "A saved BOV", d.property_type, when].filter(Boolean).join(" \u00b7 ");
  }
  function renderSaved() {
    show($("bbSaveRow"), savedReady);
    var sel = $("bbSaved");
    while (sel.options.length > 1) sel.remove(1);
    docs.forEach(function (d) {
      var o = document.createElement("option");
      o.value = String(d.id); setText(o, docLabel(d));
      sel.appendChild(o);
    });
    sel.value = draft.docId || "";
    show($("bbSavedRow"), savedReady && docs.length > 0);
    setText($("bbSave"), draft.docId ? "Save changes" : "Save to your account");
    show($("bbSavedRemove"), !!draft.docId);
    var msg = $("bbSaveMsg");
    msg.className = saveBad ? "bb-err" : "";
    setText(msg, saveMsg || (draft.docId
      ? (dirty ? "Changes since your last save are only in this browser." : "Saved to your account.")
      : "Only in this browser so far."));
  }
  function loadDocs(then) {
    fetch("/api/broker/bov-docs", { credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .catch(function () { return { s: 0, j: null }; })
      .then(function (o) {
        savedReady = o.s === 200;
        docs = (savedReady && o.j && o.j.docs) || [];
        renderSaved();
        if (then) then();
      });
  }
  function openSaved(id) {
    fetch("/api/broker/bov-docs?id=" + encodeURIComponent(id), { credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .catch(function () { return { s: 0, j: null }; })
      .then(function (o) {
        if (o.s !== 200 || !o.j || !o.j.doc) {
          saveMsg = (o.j && o.j.error) || "That saved BOV could not be opened just now."; saveBad = true;
          renderSaved(); return;
        }
        draft = B.cleanDraft(o.j.doc.draft);
        draft.docId = String(o.j.doc.id);
        fresh = false; dirty = false; saveBad = false;
        save();
        showDraft();
      });
  }
  // A card's link, on a computer that holds no draft for it: the BOV saved
  // for that card opens. A draft kept in this browser is never replaced.
  function openForCard() {
    if (!savedReady || !fresh || !draft.from || draft.docId) return;
    var hit = docs.filter(function (d) { return String(d.bov_id || "") === draft.from; })[0];
    if (hit) openSaved(String(hit.id));
  }
  $("bbSaved").addEventListener("change", function () {
    var id = this.value;
    if (!id || id === draft.docId) return;
    if (dirty && !window.confirm("Open the saved BOV? Changes you have not saved to your account stay in this browser only.")) { this.value = draft.docId || ""; return; }
    openSaved(id);
  });
  $("bbSave").addEventListener("click", function () {
    var btn = this, was = keyOf(draft);
    if (!draft.subject.address.trim()) { saveMsg = "Enter the property\u2019s address before saving."; saveBad = true; renderSaved(); return; }
    btn.disabled = true; saveMsg = "Saving\u2026"; saveBad = false; renderSaved();
    fetch("/api/broker/bov-docs", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: draft.docId || undefined, draft: draft }) })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .catch(function () { return { s: 0, j: null }; })
      .then(function (o) {
        btn.disabled = false;
        if (o.s !== 200 || !o.j || !o.j.id) {
          // Removed on another computer: this draft is a new one again.
          if (o.j && o.j.code === "gone") { delete store.drafts[was]; draft.docId = ""; save(); }
          saveMsg = (o.j && o.j.error) || "That could not be saved just now. Your draft is still in this browser."; saveBad = true;
          renderSaved(); return;
        }
        draft.docId = String(o.j.id);
        dirty = false; saveMsg = ""; saveBad = false;
        // The browser's copy moves under the saved copy's id.
        if (was !== keyOf(draft)) delete store.drafts[was];
        save();
        loadDocs();
      });
  });
  $("bbSavedRemove").addEventListener("click", function () {
    var id = draft.docId, btn = this;
    if (!id || !window.confirm("Remove this BOV from your account? It stays in this browser until you start over.")) return;
    btn.disabled = true;
    fetch("/api/broker/bov-docs?id=" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (o) { return { s: r.status, j: o }; }); })
      .catch(function () { return { s: 0, j: null }; })
      .then(function (o) {
        btn.disabled = false;
        if (o.s !== 200) { saveMsg = (o.j && o.j.error) || "That could not be removed just now."; saveBad = true; renderSaved(); return; }
        delete store.drafts[keyOf(draft)];
        draft.docId = ""; dirty = false; saveMsg = ""; saveBad = false;
        save();
        loadDocs();
      });
  });

  if (window.addEventListener) window.addEventListener("resize", fitPreview);

  // ---- boot ---------------------------------------------------------------------
  // ?from=<id>: the Pipeline board's "Write the BOV" link. Otherwise the
  // draft this browser was last on.
  var asked = "";
  try { asked = new URLSearchParams(window.location.search).get("from") || ""; } catch (e) {}
  if (!/^[0-9a-f-]{36}$/i.test(asked)) asked = "";
  if (asked) loadDraft(asked);
  else if (store.last && store.drafts[store.last]) loadKey(store.last);
  else loadDraft("");
  applySuggestion();
  fillForm();
  renderSaved();
  redraw(true);

  fetch("/api/branding", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (o) {
      // Their own letterhead, else their firm's: the comp sheet's order.
      var own = o && o.branding && (o.branding.firmName || o.branding.logo) ? o.branding : null;
      brand = own || (o && o.firm) || null; brandKnown = true;
      renderBrand(); renderReady(); renderDoc();
    });
  fetch("/api/broker/bovs", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (o) {
      bovs = (o && o.bovs) || [];
      // A link to a BOV that is not this account's starts a plain draft. A
      // draft already kept (its card since removed) is left as it is.
      if (draft.from && fresh && !bovs.some(function (b) { return String(b.id) === draft.from; })) { loadDraft(""); applySuggestion(); fillForm(); }
      else if (draft.from) { prefillFrom(bovs.filter(function (b) { return String(b.id) === draft.from; })[0]); applySuggestion(); fillForm(); }
      renderFrom(); redraw(true);
      openForCard();
    });
  loadDocs(openForCard);
})();
