// The watchlist digest's copy and its "is this worth sending?" rule.
//
// Why this is its own module: everything here is a judgment about what a
// person is worth interrupting for, and those judgments are the part that
// will be argued about and changed. Keeping them pure means `npm test` can
// exercise every one of them with no database, no mail provider, and no
// clock — the same reason gut-check.js and bov-log.js are separate files.
//
// The digest is the only thing CompNinja sends on its own initiative. Every
// other outbound email answers something a person just did (a share, a reset,
// a BOV). That asymmetry sets the bar used throughout this file: when in
// doubt, send nothing. An empty inbox costs nothing; one boring email teaches
// somebody to ignore the next one, and there is no second chance at that.
//
// Pure: no I/O, no requires, no clock (the caller passes what it knows).
// Covered by npm test (test/watchlist-digest.test.js).

"use strict";

// A market with new comps but no median is still worth a line — "3 new comps"
// is the news. A market with NOTHING new is not, however interesting its
// median is, because the reader has already seen that median.
function hasNews(item) {
  return Number(item && item.new_count) > 0;
}

// The send/skip decision, deliberately separate from the copy: a caller has
// to be able to ask "would this send?" without building an email, and the
// dry-run path does exactly that.
function worthSending(items) {
  return Array.isArray(items) && items.some(hasNews);
}

function plural(n, one, many) {
  return Number(n) === 1 ? one : (many || one + "s");
}

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "";
  return "$" + Math.round(x).toLocaleString("en-US");
}

// "$84/SF". Rounded to the dollar on purpose: the cents in a median of a
// dozen comps are noise, and a reader comparing two digests should see a
// figure move only when it really moved.
function psf(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "";
  return "$" + Math.round(x) + "/SF";
}

// Direction, only where the feed already decided it had enough comps to say
// so (it withholds median_trend below 3 comps a side). Reported as a
// direction and a figure, never as a percentage: a 6-month median over a
// handful of comps moves double digits on noise, and a percentage invites
// the reader to treat that as a market move.
function trendPhrase(item) {
  const t = item && item.median_trend;
  if (!t) return "";
  const cur = Number(t.current);
  const pri = Number(t.prior);
  if (!Number.isFinite(cur) || !Number.isFinite(pri) || cur <= 0 || pri <= 0) return "";
  if (Math.round(cur) === Math.round(pri)) return ", flat against the 6 months before";
  return (cur > pri ? ", up from " : ", down from ") + psf(pri) + " the 6 months before";
}

// One comp, as a line. Address included because these are PUBLIC corpus comps
// — the same rows the market pages and any report already show. A broker's
// own vault comps never enter the corpus and so can never reach this file;
// that separation is enforced upstream by separate tables, not here.
function compLine(c) {
  const bits = [];
  const kind = String((c && c.transaction) || "").toLowerCase().startsWith("lease") ? "lease" : "sale";
  bits.push(kind);
  if (c && c.deal_date) bits.push(String(c.deal_date));
  const price = money(c && c.price_or_rate);
  if (price) bits.push(price);
  const rate = psf(c && c.price_per_sqft);
  if (rate) bits.push(rate);
  const addr = String((c && c.address) || "").trim() || "Address not stated";
  return "  - " + addr + " (" + bits.join(", ") + ")";
}

// How many comps to itemize per market. Deliberately smaller than the feed's
// own cap: the feed is a page somebody chose to open and can scroll, and this
// is an interruption that has to earn its length. The count above the list is
// always the TRUE number, so a reader is never told there were fewer than
// there were.
const MAX_COMPS_PER_MARKET = 3;

function marketBlock(item) {
  const head = item.market + " · " + item.property_type;
  const lines = [head];

  const parts = [item.new_count + " new " + plural(item.new_count, "comp")];
  const med = psf(item.median_psf);
  if (med) parts.push("median " + med + " (sales, last 6 months)" + trendPhrase(item));
  lines.push("  " + parts.join(" · "));

  const comps = Array.isArray(item.comps) ? item.comps.slice(0, MAX_COMPS_PER_MARKET) : [];
  comps.forEach((c) => lines.push(compLine(c)));

  // Two different "not shown" numbers, and conflating them would misreport
  // one of them as the other. `locked_count` is what the reader's plan
  // withheld (an upgrade prompt is honest there). The overflow below is
  // simply this email being short, and offering Pro for it would be a lie.
  const locked = Number(item.locked_count) || 0;
  const shown = comps.length;
  const overflow = Math.max(0, (Array.isArray(item.comps) ? item.comps.length : 0) - shown);
  if (overflow) lines.push("  ...and " + overflow + " more in your desk.");
  if (locked) {
    lines.push("  " + locked + " more " + plural(locked, "comp") + " " +
      (locked === 1 ? "was" : "were") + " found and " + (locked === 1 ? "is" : "are") +
      " itemized with Pro.");
  }
  return lines.join("\n");
}

// The subject line. One market gets named, because a named market is the
// difference between a subject somebody reads and one they archive; several
// markets get a count, because a subject line listing four of them is a wall.
function subjectFor(items) {
  const news = items.filter(hasNews);
  const total = news.reduce((n, i) => n + Number(i.new_count), 0);
  if (news.length === 1) {
    return total + " new " + plural(total, "comp") + " in " + news[0].market;
  }
  return total + " new " + plural(total, "comp") + " across " + news.length + " markets you watch";
}

// Builds the whole email, or returns null when there is nothing worth
// sending. Returning null rather than an empty string is deliberate: the
// caller must not be able to send a blank digest by forgetting to check.
//
// `deskUrl` and `unsubscribeUrl` are passed in rather than built here so this
// module never has to know about SITE_URL, tokens, or how an unsubscribe is
// authenticated.
function buildDigest({ items, deskUrl, unsubscribeUrl }) {
  if (!worthSending(items)) return null;
  const news = items.filter(hasNews);

  const body = [
    "New comps landed in " + (news.length === 1 ? "a market" : news.length + " markets") + " you watch.",
    "",
    news.map(marketBlock).join("\n\n"),
    "",
    "See them all in your desk: " + deskUrl,
    "",
    // Two separate facts, and the reader needs both: WHY this arrived (they
    // asked for it, which is not obvious months later) and HOW to stop it.
    // Never one sentence — "you subscribed, unsubscribe here" reads as a
    // marketing footer and gets skimmed past.
    "You are receiving this because you added these markets to your CompNinja watchlist.",
    "Turn these emails off: " + unsubscribeUrl,
    "",
    "Comp figures are automated estimates drawn from public records and listings, never an appraisal.",
  ].join("\n");

  return { subject: subjectFor(news), text: body };
}

module.exports = {
  buildDigest,
  worthSending,
  hasNews,
  subjectFor,
  MAX_COMPS_PER_MARKET,
};
