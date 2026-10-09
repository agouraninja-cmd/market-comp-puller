// ---------------------------------------------------------------------------
// The deal wall on The Board (the Data page's Board tab, 2026-10-07).
// Design: the owner's pick "C, Deal wall" of the Board drafts,
//   https://claude.ai/artifact/YXWid51XCmpwwyBxjTmsrY
//
// Every property a member is chasing, as a photo card on a wall: its stage
// stamped on the photo, a progress bar, the asking price, the next date, and
// how conditions for buying look in its market. Stage tabs and market chips
// filter it. A card opens in place to move the deal along, pass on it, edit
// its price, acres, notes and dates, or remove it.
//
// THE DEALS ARE user_sites ROWS, the same ones the Sites tab draws for a
// development firm (sites.js holds the stages and the validation; the routes
// are /api/sites). The wall is for every Pro member; a development firm keeps
// its Sites tab as the list of the same rows. Nothing here adds a table.
//
// THE BUYING READ is computed, never typed: buyingRead() below, from the two
// market signals we have for real, the six-month median $/SF trend on The
// Board's feed and the market page's direction while it is fresh. With
// neither there is no read, and the tile says nothing rather than guessing.
// It is a read of public numbers, never advice: the copy says "conditions",
// and the page carries the not-advice line.
//
// PRIVACY: a deal's address goes to our own POST /api/geocode (Census behind
// it) and nowhere else -- CLAUDE.md never-break rule 7. The photo is then
// fetched by coordinates from the same Esri imagery the comp map's pin
// popups use. Coordinates are cached in this browser only. Since 2026-10-09
// a street photo is laid over it where one can be proven good
// (building-photo.js): OpenStreetMap is asked by coordinates, and our own
// /api/streetview by the building's coordinates, never the address.
//
// PURE where it can be and dual-exported, like sites.js: Node gets the
// helpers (test/deal-wall.test.js), the browser gets the global DEALWALL,
// whose mount() the /vault page calls once /sites.js has defined SITES.
// ---------------------------------------------------------------------------

(function (root, factory) {
  var node = typeof module === "object" && module.exports;
  var api = factory(node ? require("./sites") : root.SITES);
  if (node) module.exports = api;
  else root.DEALWALL = api;
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  // A price move smaller than this either way is "flat": six-month medians
  // drift by a point or two on mix alone.
  var FLAT_PCT = 2;
  var LEANS = { good: "Favorable", mid: "Mixed", bad: "Tough" };
  // Stages that are a deal in progress, and the total "in play" sums them.
  var LIVE = ["prospect", "loi", "contract", "entitle"];
  var GEO_KEY = "cnDealGeo1";
  // The window in a browser; an empty object under Node, where only the pure
  // helpers run.
  var G = typeof window !== "undefined" ? window : {};
  var ZOOM = 18;
  // POST /api/geocode answers a Census outage the way it answers a real miss
  // (an empty object), so a miss is remembered for three days, not for good.
  var MISS_MS = 3 * 864e5;

  // ---- pure -------------------------------------------------------------------

  // The six-month move in a market's median $/SF, as a percentage, or null
  // when the feed has no trend (fewer than three sales on either side).
  function priceMove(item) {
    var t = item && item.median_trend;
    if (!t || t.current == null || t.prior == null) return null;
    var cur = Number(t.current), prior = Number(t.prior);
    if (!isFinite(cur) || !isFinite(prior) || prior <= 0) return null;
    return (cur - prior) / prior * 100;
  }

  // How conditions look for BUYING in one market of The Board, and why.
  // Two signals, each worth one point toward the buyer or against them:
  //   prices falling helps a buyer, rising works against one;
  //   a contracting market helps a buyer, an expanding one works against one.
  // Favorable at +1 or better, Tough at -1 or worse, Mixed in between. No
  // signal at all is null: no read, never a default.
  function buyingRead(item) {
    if (!item) return null;
    var reasons = [], score = 0, seen = 0;
    var pct = priceMove(item);
    if (pct != null) {
      seen++;
      var t = item.median_trend, r = Math.round(Math.abs(pct) * 10) / 10;
      var span = " in six months ($" + Math.round(t.prior) + " to $" + Math.round(t.current) + "/SF)";
      if (pct <= -FLAT_PCT) { score++; reasons.push({ dir: "down", helps: "buyers", text: "Prices down " + r + "%" + span }); }
      else if (pct >= FLAT_PCT) { score--; reasons.push({ dir: "up", helps: "against", text: "Prices up " + r + "%" + span }); }
      else reasons.push({ dir: "flat", helps: "", text: "Prices flat" + span });
    }
    var d = item.direction;
    if (d === "contracting" || d === "expanding" || d === "flat") {
      seen++;
      if (d === "contracting") { score++; reasons.push({ dir: "down", helps: "buyers", text: "The market page reads contracting" }); }
      else if (d === "expanding") { score--; reasons.push({ dir: "up", helps: "against", text: "The market page reads expanding" }); }
      else reasons.push({ dir: "flat", helps: "", text: "The market page reads flat" });
    }
    if (!seen) return null;
    return { lean: score >= 1 ? "good" : score <= -1 ? "bad" : "mid", score: score, reasons: reasons };
  }

  // The Board feed item for a deal's market and type, if it is on The Board.
  function feedFor(site, feed) {
    var type = (site && site.property_type) || "Land";
    var list = Array.isArray(feed) ? feed : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].market === site.market && list[i].property_type === type) return list[i];
    }
    return null;
  }

  // What goes on the wall: deals in progress and closed ones (a deal that
  // closes becomes its property's Owned status and stays on the wall).
  // Tracking describes a building watched, not chased, so it is not a card.
  // Passed deals are their own tab.
  function onWall(site) { return !!site && (LIVE.indexOf(site.stage) >= 0 || site.stage === "owned"); }

  // The stage tabs, in tracker order. Entitlements shows for a development
  // firm, or for anyone with a deal in it; Passed only when there is one.
  function stageTabs(sites, dev) {
    var has = function (st) { return sites.some(function (s) { return s.stage === st; }); };
    var out = ["prospect", "loi", "contract"];
    if (dev || has("entitle")) out.push("entitle");
    out.push("owned");
    if (has("passed")) out.push("passed");
    return out;
  }

  // The tracker steps a card's progress bar shows.
  function stepsFor(site, dev) {
    var steps = (S && S.STEPS) || ["prospect", "loi", "contract", "entitle", "owned"];
    return dev || (site && site.stage === "entitle") ? steps.slice() : steps.filter(function (k) { return k !== "entitle"; });
  }

  // The city a deal is in, for the market chips: the first half of its
  // canonical market, else the address's second part.
  function cityOf(site) {
    var m = String((site && site.market) || "");
    if (m) return m.split(",")[0].trim();
    var parts = String((site && site.address) || "").split(",");
    return parts.length > 1 ? parts[1].trim() : "";
  }

  // The cards one view shows: a stage tab ("all" is every card on the wall,
  // "passed" the passed ones) and a city chip ("all" or a city), furthest-along
  // deals first, then the soonest-updated.
  function filterSites(sites, stage, city) {
    var order = { owned: 0, entitle: 1, contract: 2, loi: 3, prospect: 4, passed: 5 };
    return sites.filter(function (s) {
      if (stage === "passed" ? s.stage !== "passed" : !onWall(s)) return false;
      if (stage && stage !== "all" && stage !== "passed" && s.stage !== stage) return false;
      return !city || city === "all" || cityOf(s) === city;
    }).sort(function (a, b) {
      return (order[a.stage] - order[b.stage]) || String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  }

  function counts(sites) {
    var c = { all: 0 };
    sites.forEach(function (s) {
      c[s.stage] = (c[s.stage] || 0) + 1;
      if (onWall(s)) c.all++;
    });
    return c;
  }

  // The asking prices still in play: deals in progress, not closed or passed.
  function inPlay(sites) {
    return sites.reduce(function (t, s) {
      return t + (LIVE.indexOf(s.stage) >= 0 && Number(s.asking_price) > 0 ? Number(s.asking_price) : 0);
    }, 0);
  }

  // The aerial photo as Esri World Imagery tiles stitched around a point:
  // the crop is w x h pixels at zoom z, centred on the point. Each tile says
  // where its top-left corner sits inside the crop.
  // ⚠ The same math as index.html's aerialTileSpec (the comp map's pin
  // popups). Change both together.
  function aerialTiles(ll, w, h, z) {
    var scale = 256 * Math.pow(2, z);
    var x = ((ll.lng + 180) / 360) * scale;
    var latRad = (ll.lat * Math.PI) / 180;
    var y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
    var ox = x - w / 2, oy = y - h / 2, tiles = [];
    for (var ty = Math.floor(oy / 256); ty <= Math.floor((oy + h - 1) / 256); ty++) {
      for (var tx = Math.floor(ox / 256); tx <= Math.floor((ox + w - 1) / 256); tx++) {
        tiles.push({
          src: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + z + "/" + ty + "/" + tx,
          left: Math.round(tx * 256 - ox), top: Math.round(ty * 256 - oy),
        });
      }
    }
    return tiles;
  }

  function short(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }

  // The next date a card shows, with the words "in N days".
  function nextDate(site, today) {
    var d = S && S.nextDeadline ? S.nextDeadline(site.dates, today) : null;
    if (!d) return null;
    var n = S.daysUntil(d.on, today);
    if (n == null || n < 0) return null;
    return { label: d.label, n: n, hot: n <= 7,
      text: d.label + (n === 0 ? " today" : n === 1 ? " tomorrow" : " in " + n + " days") };
  }

  // ---- drawing ----------------------------------------------------------------

  function cardHtml(site, o) {
    var esc = o.esc, escA = o.escA;
    var parts = String(site.address || "").split(","), street = parts[0].trim();
    var stage = site.stage, label = S.labelOf(stage) || stage;
    var facts = [cityOf(site)];
    if (site.acres) facts.push(String(Math.round(Number(site.acres) * 10) / 10) + " ac");
    var price = Number(site.asking_price) > 0
      ? '<p class="dw-pr"><b>' + short(site.asking_price) + "</b>" +
        (site.acres ? "<span>" + short(site.asking_price / site.acres) + "/ac</span>" : "") + "</p>"
      : '<p class="dw-pr dw-mute">No asking price yet</p>';
    var nx = stage === "owned" || stage === "passed" ? null : nextDate(site, o.today);
    var read = stage === "owned" || stage === "passed" ? null : buyingRead(feedFor(site, o.feed));
    var steps = stepsFor(site, o.dev), at = steps.indexOf(stage);
    return '<article class="dw-card" role="button" tabindex="0" data-open="' + escA(site.id) + '" aria-label="' + escA(street + ", " + label) + '">' +
      '<div class="dw-ph" data-ph="' + escA(site.address || "") + '"><span class="dw-stamp dw-s-' + escA(stage) + '">' + esc(label) + "</span>" +
      '<span class="dw-type">' + esc(site.property_type || "Land") + "</span></div>" +
      '<div class="dw-body"><h3 class="dw-a">' + esc(street) + '</h3><p class="dw-f">' + esc(facts.filter(Boolean).join(" · ")) + "</p>" + price +
      (nx ? '<p class="dw-due' + (nx.hot ? " hot" : "") + '">' + esc(nx.text) + "</p>" : "") +
      (read ? '<p class="dw-read"><i class="dw-dot dw-' + read.lean + '"></i>Buying here: <b class="dw-l-' + read.lean + '">' + LEANS[read.lean] + "</b></p>" : "") +
      (at >= 0 ? '<span class="dw-prog" aria-hidden="true">' + steps.map(function (k, j) { return "<i" + (j <= at ? ' class="on dw-s-' + escA(stage) + '"' : "") + "></i>"; }).join("") + "</span>" : "") +
      "</div></article>";
  }

  // ---- the browser half ---------------------------------------------------------

  function mount(ctx) {
    if (!S || !ctx || !ctx.root) return null;
    var el = ctx.root, esc = ctx.esc, escA = ctx.escA;
    var isDev = typeof ctx.isDev === "function" ? ctx.isDev : function () { return false; };
    var feed = typeof ctx.feed === "function" ? ctx.feed : function () { return []; };
    // ctx.openAdd: the page was opened to add a deal (Home's "Add a property",
    // via /vault?add=buy), so the form is open once the read lands.
    var focusAsked = !!ctx.openAdd;
    var state = { s: 0, sites: [], today: "", stage: "all", city: "all", open: null, addOpen: !!ctx.openAdd,
      msg: "", msgBad: false, paneMsg: "", busy: false };
    var geo = {};
    try { geo = JSON.parse((G.localStorage && G.localStorage.getItem(GEO_KEY)) || "{}") || {}; } catch (e) { geo = {}; }

    function getJson(url) {
      return fetch(url, { credentials: "same-origin" }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j || {} }; });
      }).catch(function () { return { s: 0, j: {} }; });
    }
    function send(method, url, body) {
      return fetch(url, { method: method, credentials: "same-origin", headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j || {} }; });
      }).catch(function () { return { s: 0, j: { error: "That didn't reach the server. Nothing was changed." } }; });
    }
    function load() {
      return getJson("/api/sites").then(function (r) {
        state.s = r.s;
        if (r.s === 200) { state.sites = Array.isArray(r.j.sites) ? r.j.sites : []; state.today = r.j.today || state.today; }
        render();
        if (focusAsked && r.s === 200) { focusAsked = false; focusAdd(); }
      });
    }
    function siteById(id) { for (var i = 0; i < state.sites.length; i++) if (state.sites[i].id === id) return state.sites[i]; return null; }
    function streetOf(s) { return String((s && s.address) || "").split(",")[0].trim(); }

    // ---- the parts ----
    function lockHtml() {
      return '<div class="dw-lock"><p><b>Tracking the properties you’re chasing is part of Pro.</b> Put each one on the wall with its stage, its next date and how conditions look where it is.</p>' +
        '<p><a class="btn" href="/desk">See your plan</a></p></div>';
    }
    function typeOptions(sel) {
      return (ctx.propTypes || ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"]).map(function (t) {
        return "<option" + (t === sel ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("");
    }
    function addHtml() {
      var stages = ["prospect", "loi", "contract"].concat(isDev() ? ["entitle"] : []);
      return '<form class="dw-form" id="dwAddForm" autocomplete="off"><h3>Add a property you’re chasing</h3>' +
        '<label class="dw-wide">Address<input name="address" id="dwAddr" maxlength="300" placeholder="1550 S Federal Way, Boise, ID 83716" required></label>' +
        '<label>Type<select name="property_type" id="dwType">' + typeOptions(isDev() ? "Land" : "Industrial") + "</select></label>" +
        '<label>Stage<select name="stage" id="dwStage">' + stages.map(function (k) { return '<option value="' + k + '">' + esc(S.labelOf(k)) + "</option>"; }).join("") + "</select></label>" +
        '<label>Asking price<input name="asking_price" id="dwAsk" inputmode="decimal" placeholder="3,450,000"></label>' +
        '<label>Acres <span class="dw-opt">optional</span><input name="acres" id="dwAcres" inputmode="decimal" placeholder="18.4"></label>' +
        '<label>Next date <span class="dw-opt">optional</span><input name="on" id="dwOn" type="date"></label>' +
        '<label>What happens then<input name="label" id="dwLabel" maxlength="80" placeholder="Tour"></label>' +
        '<div class="dw-act dw-wide"><button class="btn" type="submit">Add to the wall</button><button class="btn ghost" type="button" data-addclose="1">Cancel</button>' +
        (state.paneMsg && state.addOpen ? '<span class="dw-err">' + esc(state.paneMsg) + "</span>" : "") + "</div></form>";
    }
    function paneHtml(s) {
      var steps = stepsFor(s, isDev()), held = !!s.portfolio_item_id;
      var dates = (s.dates || []).map(function (d, i) {
        return '<li><span>' + esc(d.on) + "</span> " + esc(d.label) + ' <button class="lnk" type="button" data-deldate="' + i + '" aria-label="Remove ' + escA(d.label) + '">Remove</button></li>';
      }).join("");
      var moves = held
        ? '<p class="dw-mute">Closed. It’s with your properties now' + (isDev() ? ", on the Sites tab." : ", on the Properties tab.") + "</p>"
        : '<div class="dw-moves" role="group" aria-label="Stage">' + steps.map(function (k) {
            return '<button type="button" class="dw-mv' + (k === s.stage ? " on" : "") + '" data-stage="' + k + '"' + (k === s.stage ? ' aria-pressed="true"' : "") + ">" + esc(S.labelOf(k)) + "</button>";
          }).join("") + (s.stage === "passed"
            ? '<button type="button" class="dw-mv" data-stage="prospect">Bring it back</button>'
            : '<button type="button" class="dw-mv dw-pass" data-stage="passed">Pass</button>') + "</div>";
      return '<section class="dw-pane" id="dwPane" aria-label="' + escA(streetOf(s)) + '">' +
        '<div class="dw-ph dw-pane-ph" data-ph="' + escA(s.address || "") + '"></div>' +
        '<div class="dw-pane-in"><div class="dw-pane-h"><div><h3>' + esc(streetOf(s)) + '</h3><p class="dw-mute">' + esc(s.address || "") + "</p></div>" +
        '<button class="lnk" type="button" data-close="1">Close</button></div>' + moves +
        (held ? "" : '<form class="dw-form dw-edit" id="dwEditForm" autocomplete="off">' +
          '<label>Asking price<input name="asking_price" value="' + escA(s.asking_price == null ? "" : Number(s.asking_price).toLocaleString("en-US")) + '" inputmode="decimal"></label>' +
          '<label>Acres<input name="acres" value="' + escA(s.acres == null ? "" : String(s.acres)) + '" inputmode="decimal"></label>' +
          '<label class="dw-wide">Notes<textarea name="notes" rows="2" maxlength="1000">' + esc(s.notes || "") + "</textarea></label>" +
          '<div class="dw-wide"><p class="dw-k">Key dates</p>' + (dates ? '<ul class="dw-dates">' + dates + "</ul>" : '<p class="dw-mute">None yet.</p>') +
          '<div class="dw-adddate"><input name="on" type="date" aria-label="Date"><input name="label" maxlength="80" placeholder="What happens then" aria-label="What happens then"></div></div>' +
          '<div class="dw-act dw-wide"><button class="btn" type="submit">Save</button>' +
          '<button class="lnk dw-rm" type="button" data-rm="1">Remove from the wall</button>' +
          (isDev() ? '<a class="lnk" href="#sites">Open in Sites</a>' : "") + "</div></form>") +
        (state.paneMsg && !state.addOpen ? '<p class="dw-err">' + esc(state.paneMsg) + "</p>" : "") + "</div></section>";
    }
    function html() {
      if (state.s === 403) return lockHtml();
      if (state.s === 401) return "";
      if (state.s !== 200) {
        return state.s === 0 && !state.sites.length ? '<p class="dw-mute">Loading your deals…</p>'
          : '<div class="msg bad">Couldn’t load your deals just now. Nothing has been lost. Refresh in a moment.</div>';
      }
      var sites = state.sites, c = counts(sites), dev = isDev();
      var out = state.addOpen ? addHtml() : "";
      if (state.msg) out += '<div class="msg' + (state.msgBad ? " bad" : " ok") + '" role="status">' + esc(state.msg) + "</div>";
      if (!c.all && !c.passed) {
        return out + (state.addOpen ? "" : '<button class="dw-add dw-big" type="button" data-add="1"><span>+</span>Add the first property you’re chasing' +
          "<small>It goes up on the wall with a photo, its stage, its next date and how conditions look for buying there.</small></button>");
      }
      var tabs = ["all"].concat(stageTabs(sites, dev));
      if (tabs.indexOf(state.stage) < 0) state.stage = "all";
      var cities = {};
      sites.forEach(function (s) { if (onWall(s)) { var k = cityOf(s); if (k) cities[k] = 1; } });
      var cityList = Object.keys(cities).sort();
      if (state.city !== "all" && !cities[state.city]) state.city = "all";
      var total = inPlay(sites);
      out += '<div class="dw-bar"><div class="dw-tabs" role="tablist" aria-label="Stage">' + tabs.map(function (k) {
        var n = k === "all" ? c.all : (c[k] || 0);
        return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === state.stage) + '"' + (k === state.stage ? ' class="on"' : "") + ">" +
          (k === "all" ? "" : '<i class="dw-s-' + k + '"></i>') + esc(k === "all" ? "All" : S.labelOf(k)) + " <b>" + n + "</b></button>";
      }).join("") + "</div>" + (total ? '<span class="dw-tot"><b>' + short(total) + "</b> in play</span>" : "") + "</div>";
      if (cityList.length > 1) {
        out += '<div class="dw-chips" role="group" aria-label="Market">' + ["all"].concat(cityList).map(function (k) {
          return '<button type="button" data-city="' + escA(k) + '" aria-pressed="' + (k === state.city) + '"' + (k === state.city ? ' class="on"' : "") + ">" + esc(k === "all" ? "All markets" : k) + "</button>";
        }).join("") + "</div>";
      }
      var open = state.open && siteById(state.open);
      if (open) out += paneHtml(open);
      var list = filterSites(sites, state.stage, state.city);
      var o = { esc: esc, escA: escA, today: state.today, feed: feed(), dev: dev };
      out += '<div class="dw-wall">' + list.map(function (s) { return cardHtml(s, o); }).join("") +
        (state.stage === "passed" ? "" : '<button class="dw-add" type="button" data-add="1"><span>+</span>Add a property</button>') + "</div>";
      if (!list.length) out += '<p class="dw-mute">Nothing ' + (state.stage === "all" ? "here" : "at " + esc(S.labelOf(state.stage))) + (state.city === "all" ? "" : " in " + esc(state.city)) + " yet.</p>";
      return out;
    }
    function render() {
      el.innerHTML = html();
      if (ctx.addToggle) {
        ctx.addToggle.setAttribute("aria-expanded", String(state.addOpen));
        ctx.addToggle.className = state.s === 200 ? "dact" : "dact hide";
      }
      if (typeof ctx.setCount === "function") {
        var live = state.sites.filter(function (s) { return LIVE.indexOf(s.stage) >= 0; }).length;
        ctx.setCount(state.s === 200 ? live : null);
      }
      photos();
    }

    // ---- photos: our own geocoder, then imagery by coordinates ----
    var queue = [], active = 0, asked = {};
    function saveGeo() { try { if (G.localStorage) G.localStorage.setItem(GEO_KEY, JSON.stringify(geo)); } catch (e) {} }
    function paint(box, ll) {
      var big = box.className.indexOf("dw-pane-ph") >= 0, w = big ? 720 : 480, h = big ? 640 : 160;
      box.insertAdjacentHTML("afterbegin", '<span class="dw-tiles" style="width:' + w + "px;height:" + h + "px;margin-left:-" + (w / 2) + "px;margin-top:-" + (h / 2) + 'px" aria-hidden="true">' +
        aerialTiles(ll, w, h, ZOOM).map(function (t) {
          return '<img src="' + t.src + '" alt="" loading="lazy" style="left:' + t.left + "px;top:" + t.top + 'px" onerror="this.style.display=\'none\'">';
        }).join("") + '<i class="dw-pin"></i></span><span class="dw-credit">Esri</span>');
      box.classList.add("dw-has");
      street(box, ll);
    }
    // The building from the street (2026-10-09; building-photo.js, the global
    // BLDGPHOTO): laid over the aerial once OpenStreetMap proves which
    // building the address is and the server finds a good photo of it, the
    // way Home's cards do. Where either answer is no (a Land deal with no
    // building on it, most of all) the aerial stays. The building is looked
    // up by coordinates only; the address is compared in this browser.
    var wanted = [], snapTimer = 0;
    function streetOn() { return !!(ctx.streetview && G.BLDGPHOTO); }
    function street(box, ll) {
      if (!streetOn()) return;
      var addr = box.getAttribute("data-ph") || "";
      var b = G.BLDGPHOTO.building(ll, addr);
      if (b === undefined) {
        box._bp = { ll: ll, address: addr };
        wanted.push(box._bp);
        clearTimeout(snapTimer);
        snapTimer = setTimeout(function () {
          G.BLDGPHOTO.snap(wanted.splice(0)).then(upgrade, function () {});
        }, 200);
        return;
      }
      if (b && G.BLDGPHOTO.photoState(b) !== "fail") lay(box, b);
    }
    function lay(box, b) {
      if (box._svDone) return;
      box._svDone = true;
      G.BLDGPHOTO.overlay(box, b, {
        known: G.BLDGPHOTO.photoState(b) === "ok", lazy: true,
        before: box.querySelector(".dw-credit"),
        onLoad: function () {
          box.classList.add("dw-sv");
          var credit = box.querySelector(".dw-credit");
          if (credit) credit.textContent = "Google";
        },
      });
    }
    // A lookup answers for every card showing that place, including the ones
    // drawn again while it was out (the wall re-renders on every change).
    function upgrade() {
      var boxes = el.querySelectorAll("[data-ph]");
      for (var i = 0; i < boxes.length; i++) {
        var bp = boxes[i]._bp;
        if (!bp || boxes[i]._svDone) continue;
        var b = G.BLDGPHOTO.building(bp.ll, bp.address);
        if (b === undefined) continue;
        if (b && G.BLDGPHOTO.photoState(b) !== "fail") lay(boxes[i], b);
        else boxes[i]._svDone = true;
      }
    }
    function photos() {
      if (!el.querySelectorAll) return;
      var boxes = el.querySelectorAll("[data-ph]");
      for (var i = 0; i < boxes.length; i++) {
        var key = String(boxes[i].getAttribute("data-ph") || "").trim().toLowerCase();
        if (!key) continue;
        var hit = geo[key];
        if (hit && hit.length === 2) paint(boxes[i], { lat: hit[0], lng: hit[1] });
        else if (!(typeof hit === "number" && Date.now() - hit < MISS_MS) && queue.indexOf(key) < 0 && !asked[key]) queue.push(key);
      }
      pump();
    }
    function pump() {
      while (active < 2 && queue.length) {
        (function (key) {
          active++; asked[key] = 1;
          send("POST", "/api/geocode", { address: key }).then(function (r) {
            active--;
            // A hit is kept; a miss is stamped with the time and asked again
            // after MISS_MS; a refusal (rate limit, server down) stops the
            // queue and stamps nothing, so the next visit retries.
            if (r.s === 200 && r.j.lat != null && isFinite(r.j.lat) && isFinite(r.j.lng)) geo[key] = [Number(r.j.lat), Number(r.j.lng)];
            else if (r.s === 200) geo[key] = Date.now();
            else { queue = []; return; }
            saveGeo();
            if (Array.isArray(geo[key])) {
              var boxes = el.querySelectorAll("[data-ph]");
              for (var i = 0; i < boxes.length; i++) {
                if (String(boxes[i].getAttribute("data-ph") || "").trim().toLowerCase() === key && boxes[i].className.indexOf("dw-has") < 0) {
                  paint(boxes[i], { lat: geo[key][0], lng: geo[key][1] });
                }
              }
            }
            pump();
          });
        })(queue.shift());
      }
    }

    // ---- writing ----
    function flash(text, bad) { state.msg = text || ""; state.msgBad = !!bad; }
    function update(id, body) {
      return send("POST", "/api/sites/update", Object.assign({ id: id }, body)).then(function (r) {
        if (r.s !== 200) { state.paneMsg = r.j.error || "That didn't save."; render(); return false; }
        state.paneMsg = "";
        return load().then(function () { return true; });
      });
    }
    // Closing a deal: the property joins the member's properties first, then
    // the deal row becomes its Owned status, keeping its stage history --
    // exactly what the Sites tab does (sites-tab.js makeOwned).
    function makeOwned(s) {
      return send("POST", "/api/portfolio", { address: s.address, propertyType: s.property_type || "Land" }).then(function (r) {
        if (r.s !== 200 || !r.j.id) { state.paneMsg = r.j.error || "Couldn't add it to your properties."; render(); return; }
        var pid = r.j.id;
        var stale = state.sites.filter(function (x) { return x.portfolio_item_id === pid && x.id !== s.id; });
        return Promise.all(stale.map(function (x) { return send("DELETE", "/api/sites?id=" + encodeURIComponent(x.id)); })).then(function () {
          return update(s.id, { stage: "owned", portfolio_item_id: pid }).then(function (ok) {
            if (ok) { state.open = null; flash("Closed on " + streetOf(s) + ". It’s with your properties now."); render(); }
          });
        });
      });
    }
    function fieldsOf(form) {
      var o = {}, els = form.elements || [];
      for (var i = 0; i < els.length; i++) if (els[i].name) o[els[i].name] = els[i].value;
      return o;
    }
    function onSubmit(e) {
      var form = e.target;
      if (!form || (form.id !== "dwAddForm" && form.id !== "dwEditForm")) return;
      e.preventDefault();
      if (state.busy) return;
      var f = fieldsOf(form);
      var date = f.on || f.label ? [{ on: f.on || "", label: f.label || "" }] : [];
      if (form.id === "dwAddForm") {
        var body = { address: f.address, property_type: f.property_type, stage: f.stage, asking_price: f.asking_price, acres: f.acres, dates: date };
        state.busy = true;
        send("POST", "/api/sites", body).then(function (r) {
          state.busy = false;
          if (r.s !== 200) { state.paneMsg = r.j.error || "That didn't save."; render(); return; }
          state.addOpen = false; state.paneMsg = ""; state.stage = "all";
          flash(streetOf({ address: f.address }) + " is on the wall."); load();
        });
        return;
      }
      var s = siteById(state.open); if (!s) return;
      var patch = { asking_price: f.asking_price, acres: f.acres, notes: f.notes };
      if (date.length) patch.dates = (s.dates || []).concat(date);
      state.busy = true;
      update(s.id, patch).then(function (ok) { state.busy = false; if (ok) { flash("Saved " + streetOf(s) + "."); render(); } });
    }
    function onClick(e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b;
      if ((b = t.closest("[data-tab]"))) { state.stage = b.getAttribute("data-tab"); state.open = null; render(); return; }
      if ((b = t.closest("[data-city]"))) { state.city = b.getAttribute("data-city"); state.open = null; render(); return; }
      if ((b = t.closest("[data-add]"))) { state.addOpen = true; state.paneMsg = ""; render(); focusAdd(); return; }
      if ((b = t.closest("[data-addclose]"))) { state.addOpen = false; state.paneMsg = ""; render(); return; }
      if ((b = t.closest("[data-close]"))) { state.open = null; state.paneMsg = ""; render(); return; }
      if ((b = t.closest("[data-stage]"))) {
        var s = siteById(state.open), to = b.getAttribute("data-stage");
        if (!s || to === s.stage) return;
        b.disabled = true;
        if (to === "owned") { makeOwned(s); return; }
        update(s.id, { stage: to }).then(function (ok) {
          if (ok) { flash(to === "passed" ? "Passed on " + streetOf(s) + ". It’s under Passed if you change your mind." : streetOf(s) + " moved to " + S.labelOf(to) + "."); render(); }
        });
        return;
      }
      if ((b = t.closest("[data-deldate]"))) {
        var ds = siteById(state.open); if (!ds) return;
        var i = Number(b.getAttribute("data-deldate"));
        update(ds.id, { dates: (ds.dates || []).filter(function (_, j) { return j !== i; }) });
        return;
      }
      if ((b = t.closest("[data-rm]"))) {
        var rs = siteById(state.open); if (!rs) return;
        if (!G.confirm || !G.confirm("Remove " + streetOf(rs) + " from the wall? Its stages and dates go with it.")) return;
        send("DELETE", "/api/sites?id=" + encodeURIComponent(rs.id)).then(function (r) {
          if (r.s !== 200) { state.paneMsg = r.j.error || "That didn't go through."; render(); return; }
          state.open = null; flash("Removed " + streetOf(rs) + "."); load();
        });
        return;
      }
      if ((b = t.closest("[data-open]"))) {
        state.open = state.open === b.getAttribute("data-open") ? null : b.getAttribute("data-open");
        state.paneMsg = ""; state.msg = ""; render();
        var pane = el.querySelector && el.querySelector("#dwPane");
        if (pane && pane.scrollIntoView) pane.scrollIntoView({ block: "nearest" });
      }
    }
    function focusAdd() { var a = el.querySelector && el.querySelector("#dwAddr"); if (a && a.focus) a.focus(); }
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    el.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target && e.target.getAttribute && e.target.getAttribute("data-open") && e.target.tagName === "ARTICLE") {
        e.preventDefault(); onClick(e);
      }
    });
    if (ctx.addToggle) {
      ctx.addToggle.addEventListener("click", function () {
        state.addOpen = !state.addOpen; state.paneMsg = ""; render(); if (state.addOpen) focusAdd();
      });
    }
    load();
    return { reload: load, refresh: render };
  }

  return {
    FLAT_PCT: FLAT_PCT, LEANS: LEANS, LIVE: LIVE,
    priceMove: priceMove, buyingRead: buyingRead, feedFor: feedFor, onWall: onWall, stageTabs: stageTabs,
    stepsFor: stepsFor, cityOf: cityOf, filterSites: filterSites, counts: counts, inPlay: inPlay,
    aerialTiles: aerialTiles, short: short, nextDate: nextDate, cardHtml: cardHtml, mount: mount,
  };
});
