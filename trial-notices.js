// ---------------------------------------------------------------------------
// The Pro trial's two emails (2026-09-25): one when the trial starts, one a
// few days before it ends.
//
// Pure, like watchlist-digest.js: no I/O, no clock reads (the caller passes
// `now`), no requires. server.js owns who is on a trial (getEntitlements), the
// ledger of what was sent (trial_notices, migration 053) and the send itself;
// this file owns WHICH email an account is due and WHAT it says.
//
// The bar is the digest's: these go out on the product's own initiative, so
// when in doubt, send nothing. Two emails per trial, never more:
//
//   - Each kind is sent at most once per account, which the ledger enforces
//     by primary key (user_id, kind). noticeDue() reads that ledger.
//   - If both are due at once — an account whose trial began before the start
//     email could reach it and now ends within the window — only the ENDING
//     one goes. It is the one that carries a date the reader must act on, and
//     "you have Pro" followed a minute later by "your Pro is ending" is noise.
//   - Nothing is due once the trial has ended. An ending notice that arrives
//     after the end is an apology, not a notice.
//
// Every figure a reader is told (the price, the free allowance, the end date)
// is PASSED IN, never typed here, so a price change cannot leave these emails
// quoting the old one — the PRICING rule, applied to mail.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// How long before the end the ending notice goes out. Three days: long enough
// to decide and put a card in, short enough that the date is still news.
const ENDING_WINDOW_DAYS = 3;

/**
 * Which trial email is this account due, if any?
 *
 * @param {object} o
 * @param {number|string} o.trialEndsAt  when the trial ends (ms or ISO)
 * @param {number} o.now                 epoch ms
 * @param {string[]} o.sent              kinds already sent ("start", "ending")
 * @returns {"start"|"ending"|null}
 */
function noticeDue({ trialEndsAt, now, sent = [] } = {}) {
  const ends = typeof trialEndsAt === "number" ? trialEndsAt : Date.parse(String(trialEndsAt || ""));
  if (!Number.isFinite(ends) || !Number.isFinite(now) || ends <= now) return null;
  const had = new Set((sent || []).map(String));
  if (ends - now <= ENDING_WINDOW_DAYS * DAY_MS) return had.has("ending") ? null : "ending";
  return had.has("start") ? null : "start";
}

// "October 7" in the reader's calendar is unknowable from a server, so the
// date is written in UTC and named as a date, never a time of day.
function dateWords(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * The email itself. Returns { subject, text }, or null when there is nothing
 * honest to send (an unknown kind, or no end date to state).
 *
 * @param {"start"|"ending"} kind
 * @param {object} o
 * @param {string}  o.name            the account holder's name, may be blank
 * @param {number|string} o.trialEndsAt
 * @param {number}  o.monthly         Pro's monthly price (PRICING.monthly)
 * @param {number}  o.annual          Pro's yearly price, 0 when not sold
 * @param {number?} o.freeReports     the free monthly allowance, null = no cap
 * @param {string}  o.deskUrl         where the workspace is
 * @param {string}  o.pricingUrl      where the plans are
 */
function buildNotice(kind, { name = "", trialEndsAt, monthly, annual = 0, freeReports = null, deskUrl, pricingUrl } = {}) {
  const ends = typeof trialEndsAt === "number" ? trialEndsAt : Date.parse(String(trialEndsAt || ""));
  if (!Number.isFinite(ends) || !(monthly > 0)) return null;
  const hello = String(name || "").trim() ? `Hi ${String(name).trim().split(/\s+/)[0]},` : "Hi,";
  const endDate = dateWords(ends);
  const price = annual > 0 ? `$${monthly} a month or $${annual} a year` : `$${monthly} a month`;
  const freePlan = Number.isInteger(freeReports) && freeReports > 0
    ? `the free plan: ${freeReports} report${freeReports === 1 ? "" : "s"} a month, a three-year sales window and 5 downloads a month`
    : "the free plan: a three-year sales window and 5 downloads a month";
  const footer = "\n\n— CompNinja\n\n" +
    "You're getting this because your CompNinja account is on a Pro trial. It's one of two emails about the trial. " +
    "To stop CompNinja emails, reply and say so.";

  if (kind === "start") {
    return {
      subject: `You have CompNinja Pro until ${endDate}`,
      text: `${hello}\n\n` +
        `Your account has CompNinja Pro until ${endDate}. There's nothing to pay and no card on file.\n\n` +
        "While it lasts you can:\n" +
        "- run as many comp reports as you like, looking back up to ten years\n" +
        "- keep your own closed deals in a private vault that feeds your reports\n" +
        "- value a whole list of addresses at once\n" +
        "- put your firm's name on every report you download\n\n" +
        `Open your workspace: ${deskUrl}\n\n` +
        `When the trial ends your account moves to ${freePlan}. Everything you saved stays in your account. ` +
        `To keep Pro, it's ${price}: ${pricingUrl}` +
        footer,
    };
  }
  if (kind === "ending") {
    return {
      subject: `Your CompNinja Pro trial ends on ${endDate}`,
      text: `${hello}\n\n` +
        `Your Pro trial ends on ${endDate}. After that your account moves to ${freePlan}. ` +
        "Anything you saved or uploaded stays in your account, and the vault reopens whenever Pro does.\n\n" +
        `To keep Pro, it's ${price}: ${pricingUrl}` +
        footer,
    };
  }
  return null;
}

module.exports = { noticeDue, buildNotice, ENDING_WINDOW_DAYS };
