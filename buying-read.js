// ---------------------------------------------------------------------------
// The buying read on The Board (the markets a member follows, /vault#board):
// how conditions look for BUYING in one market, and why (2026-10-07).
//
// It was half of deal-wall.js, the wall of deal cards that sat under the
// market tiles until 2026-10-09, when deals became a development firm's
// alone and moved to Home's Properties tab (home-sites.js; the owner: "the
// board is meant to be kind of like a stock portfolio watch list for
// properties and markets"). The market tiles kept this read, so it stayed.
//
// THE READ IS COMPUTED, NEVER TYPED, from the two market signals we have for
// real: the six-month median $/SF trend on The Board's feed and the market
// page's direction while it is fresh (buildWatchlistFeed in server.js puts
// both on each feed item). With neither there is no read, and the tile says
// nothing rather than guessing. It is a read of public numbers, never advice:
// the copy says "conditions", and the page carries the not-advice line.
//
// PURE and dual-exported: Node gets the module (test/buying-read.test.js),
// the browser gets the global BUYINGREAD, read by vault-page.js's
// renderMarkets. Served at /buying-read.js with maxAge 0.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BUYINGREAD = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // A price move smaller than this either way is "flat": six-month medians
  // drift by a point or two on mix alone.
  var FLAT_PCT = 2;
  var LEANS = { good: "Favorable", mid: "Mixed", bad: "Tough" };

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

  return { FLAT_PCT: FLAT_PCT, LEANS: LEANS, priceMove: priceMove, buyingRead: buyingRead };
});
