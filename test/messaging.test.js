// The firm messaging rules.
//
// Run: npm test
//
// Cost: zero. messaging.js is pure, so every rule below is exercised with no
// database, no server and no browser. The route wiring is proven separately
// (test/messages-routes.test.js and test/messages-run.test.js) — correct in
// isolation is not the same as WIRED, which is what routes.test.js exists for.

const test = require("node:test");
const assert = require("node:assert");
const MSG = require("../messaging");

// ---------------------------------------------------------------------------
// The DM identity
// ---------------------------------------------------------------------------

test("a participant key does not depend on who started it, or on order", () => {
  // The whole reason this function exists: two colleagues who both press
  // "message" at the same moment must land in ONE thread. Without a sorted key
  // the unique index sees two different strings and lets both through, and
  // then each of them is typing into a room the other cannot see.
  assert.equal(MSG.participantKey(["b", "a"]), MSG.participantKey(["a", "b"]));
  assert.equal(MSG.participantKey(["a", "b"]), "a|b");
  // And the same for a GROUP, which is the point of widening it past pairs:
  // picking the same three people twice reopens one room.
  assert.equal(MSG.participantKey(["c", "a", "b"]), "a|b|c");
  assert.equal(MSG.participantKey(["b", "c", "a"]), MSG.participantKey(["a", "b", "c"]));
});

test("an unkeyable set returns \"\", never a value to store", () => {
  // "" must be treated as a refusal by the caller. Stored, it would collide
  // with every other unkeyable set under msg_threads_dm_uidx — so two
  // unrelated broken threads would be "the same conversation".
  assert.equal(MSG.participantKey(["a", "a"]), "", "there is no conversation with yourself");
  assert.equal(MSG.participantKey(["a"]), "");
  assert.equal(MSG.participantKey([]), "");
  assert.equal(MSG.participantKey(["", "b"]), "");
  assert.equal(MSG.participantKey(null), "");
});

// ---------------------------------------------------------------------------
// Access — the two walls
// ---------------------------------------------------------------------------

const THREAD = { id: "t1", org_id: "org-1", kind: "dm" };
const MINE = { user_id: "u1", left_at: null };

test("reading a thread needs BOTH the firm and a live member row", () => {
  assert.deepEqual(
    MSG.canReadThread({ thread: THREAD, orgId: "org-1", memberRow: MINE }),
    { ok: true, reason: "member" });

  // Right firm, no member row: a colleague at the same firm is not thereby in
  // every conversation in it.
  assert.equal(
    MSG.canReadThread({ thread: THREAD, orgId: "org-1", memberRow: null }).reason,
    "not_a_member");

  // A member row for a thread belonging to ANOTHER firm. This is the wall that
  // matters: the thread id came from the browser and proves nothing, so a
  // membership row alone must never be enough.
  assert.equal(
    MSG.canReadThread({ thread: THREAD, orgId: "org-2", memberRow: MINE }).reason,
    "wrong_firm");
});

test("an empty or missing firm matches nothing", () => {
  // The failure worth naming: "" == "" is true in JavaScript, so a caller who
  // could not resolve a firm and a thread whose org_id came back blank would
  // otherwise authorize each other.
  assert.equal(
    MSG.canReadThread({ thread: { org_id: "" }, orgId: "", memberRow: MINE }).reason,
    "wrong_firm");
  assert.equal(
    MSG.canReadThread({ thread: THREAD, orgId: null, memberRow: MINE }).reason,
    "wrong_firm");
  assert.equal(MSG.canReadThread({ thread: null, orgId: "org-1" }).reason, "not_found");
});

test("leaving is reported separately from never having been in it", () => {
  // Two different sentences on screen: one person walked out of a room, the
  // other was never in it. canReadHub keeps `removed` and `not_invited` apart
  // for the same reason.
  const left = { user_id: "u1", left_at: "2026-09-01T00:00:00Z" };
  assert.equal(
    MSG.canReadThread({ thread: THREAD, orgId: "org-1", memberRow: left }).reason,
    "left");
});

test("posting asks the same question as reading, through its own door", () => {
  // It is an alias today. It is a separate function so an archived thread has
  // an obvious home and every call site already asks the right question.
  assert.equal(
    MSG.canPostToThread({ thread: THREAD, orgId: "org-1", memberRow: MINE }).ok, true);
  assert.equal(
    MSG.canPostToThread({ thread: THREAD, orgId: "org-2", memberRow: MINE }).ok, false);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a message must say something", () => {
  // A stray Enter keypress must not put an empty bubble in a colleague's
  // thread forever.
  assert.equal(MSG.validateMessage({ body: "   " }).ok, false);
  assert.equal(MSG.validateMessage({}).ok, false);
  // Comps alone ARE a message — "here, look at these" is a real thing to send.
  assert.equal(MSG.validateMessage({ compIds: ["c1"] }).ok, true);
  assert.equal(MSG.validateMessage({ body: "hi" }).ok, true);
});

test("validateMessage returns the cleaned body, and the caller must store it", () => {
  const r = MSG.validateMessage({ body: "  hello\u0000 there  " });
  assert.equal(r.ok, true);
  assert.equal(r.body, "hello there", "the control strip and the trim are not advisory");
});

test("newlines survive the control-character strip", () => {
  // A message with paragraphs in it is an ordinary message. Stripping \n here
  // would quietly reflow everything anybody sends.
  assert.equal(MSG.cleanText("a\nb"), "a\nb");
  assert.equal(MSG.cleanText("a\tb"), "a\tb", "tab is not a control character worth eating");
});

test("comp ids are deduped before they are counted against the cap", () => {
  // The browser sends a selection, and a selection can repeat if the picker
  // re-renders mid-click. Ten of the same comp is one comp.
  const r = MSG.validateMessage({ body: "x", compIds: ["a", "a", "b", "", null] });
  assert.deepEqual(r.compIds, ["a", "b"]);
});

test("the caps refuse rather than truncate", () => {
  assert.equal(MSG.validateMessage({ body: "x".repeat(MSG.MAX_BODY + 1) }).ok, false);
  const many = Array.from({ length: MSG.MAX_COMPS_PER_MESSAGE + 1 }, (_, i) => "c" + i);
  assert.equal(MSG.validateMessage({ body: "x", compIds: many }).ok, false);
});

test("the shape follows from the count, and NOTHING gets a name", () => {
  // THE BUG THIS FIXES. The owner typed "Test" as a label for a conversation
  // with one colleague and got a CHANNEL called Test, because the shape used
  // to be inferred from whether a name had been typed. Names are gone
  // entirely now (owner's, 2026-09-01), so there is no input anywhere that
  // can produce that outcome.
  const dm = MSG.validateThread({ memberIds: ["u2"] });
  assert.equal(dm.ok, true);
  assert.equal(dm.kind, "dm");
  assert.equal(dm.title, "");

  const group = MSG.validateThread({ memberIds: ["u2", "u3"] });
  assert.equal(group.ok, true);
  assert.equal(group.kind, "channel");
  assert.equal(group.title, "", "a group is called after its people, never a stored string");
});

test("a title sent anyway is discarded, not refused", () => {
  // An old browser still posting one should get a conversation rather than an
  // error, and it must not be able to name anything by doing so.
  const one = MSG.validateThread({ title: "Test", memberIds: ["u2"] });
  assert.equal(one.ok, true);
  assert.equal(one.title, "");
  const many = MSG.validateThread({ title: "Boise industrial", memberIds: ["u2", "u3"] });
  assert.equal(many.ok, true);
  assert.equal(many.title, "");
});

test("a conversation needs somebody in it, and the cap refuses", () => {
  assert.equal(MSG.validateThread({ memberIds: [] }).ok, false);
  assert.equal(MSG.validateThread({}).ok, false);
  const many = Array.from({ length: MSG.MAX_THREAD_MEMBERS + 1 }, (_, i) => "u" + i);
  assert.equal(MSG.validateThread({ memberIds: many }).ok, false);
});

// ---------------------------------------------------------------------------
// The comp on its way into a message
// ---------------------------------------------------------------------------

test("a comp with no address is refused", () => {
  // The address is the comp's identity everywhere downstream — the tab, the
  // card, the save. A row without one renders as a blank line nobody can act
  // on or explain.
  assert.equal(MSG.compRowFrom({ price: 1000000 }), null);
  assert.equal(MSG.compRowFrom({ address: "   " }), null);
  assert.equal(MSG.compRowFrom(null), null);
  assert.equal(MSG.compRowFrom("1 Main St"), null, "a string is not a comp");
});

test("compRowFrom lifts only what the tab lists on, and keeps the rest in the snapshot", () => {
  const snap = { address: "5142 Kanan Rd", property_type: "Retail", deal_date: "2026-03-04", price: 2500000 };
  const row = MSG.compRowFrom(snap, { addressKey: "5142 kanan rd" });
  assert.equal(row.address, "5142 Kanan Rd");
  assert.equal(row.property_type, "Retail");
  assert.equal(row.deal_date, "2026-03-04");
  assert.equal(row.address_key, "5142 kanan rd");
  assert.equal(row.snapshot, snap, "the snapshot is the comp itself, not a rebuild of it");
});

test("an undated vault comp is normal here, not an error", () => {
  // 042's `undated` sentinel is stored as SQL null, so a real vault row can
  // arrive with no date and must still be sendable.
  const row = MSG.compRowFrom({ address: "1 Main St" });
  assert.equal(row.deal_date, null);
  assert.equal(row.address_key, null);
  assert.equal(row.property_type, null);
});

// ---------------------------------------------------------------------------
// What the list shows
// ---------------------------------------------------------------------------

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-01T11:00:00.000Z";
const T2 = "2026-09-01T12:00:00.000Z";

test("your own messages are never unread", () => {
  // shouldNotifyByEmail's rule one surface over: the author is excluded.
  // Without this every message you send lights up your own badge.
  const msgs = [
    { user_id: "u1", created_at: T1 },
    { user_id: "u2", created_at: T2 },
  ];
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: T0, userId: "u1" }), 1);
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: T0, userId: "u2" }), 1);
});

test("never opened means everything is unread", () => {
  // The honest answer for somebody just added to a channel with history, and
  // what makes the badge appear at all on a thread they have never seen.
  const msgs = [{ user_id: "u2", created_at: T1 }, { user_id: "u2", created_at: T2 }];
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: null, userId: "u1" }), 2);
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: "not a date", userId: "u1" }), 2);
});

test("a message exactly at the read mark is already read", () => {
  // Strictly after, or stamping last_read_at from the newest message's own
  // timestamp would leave that message permanently unread.
  const msgs = [{ user_id: "u2", created_at: T1 }];
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: T1, userId: "u1" }), 0);
});

test("a deleted message is not unread", () => {
  const msgs = [{ user_id: "u2", created_at: T2, deleted_at: T2 }];
  assert.equal(MSG.unreadCount(msgs, { lastReadAt: T0, userId: "u1" }), 0);
});

test("a comps-only message previews as what it is", () => {
  // Not as an empty line, which reads as a bug in the list rather than as a
  // message somebody sent.
  assert.equal(MSG.previewOf({ body: "", comp_count: 1 }), "Sent a comp");
  assert.equal(MSG.previewOf({ body: null, comp_count: 3 }), "Sent 3 comps");
  assert.equal(MSG.previewOf({ body: "look at this", comp_count: 1 }), "look at this");
  assert.equal(MSG.previewOf(null), "");
});

test("a preview is one line and is capped", () => {
  assert.equal(MSG.previewOf({ body: "a\nb\n\nc" }), "a b c");
  const long = MSG.previewOf({ body: "x".repeat(300) });
  assert.ok(long.length <= 120, "a preview that wraps breaks the list's row height");
  assert.ok(long.endsWith("…"));
});

test("a thread is named for its reader", () => {
  // The same row is one name on one desk and another on the other, which is
  // why this takes the reader and why no title is stored for a DM.
  const members = [
    { user_id: "u1", email: "owen@compninja.co", name: "Owen" },
    { user_id: "u2", email: "dana@compninja.co", name: "Dana" },
  ];
  assert.equal(MSG.threadLabel({ kind: "dm" }, members, "u1"), "Dana");
  assert.equal(MSG.threadLabel({ kind: "dm" }, members, "u2"), "Owen");
  assert.equal(MSG.threadLabel({ kind: "channel", title: "Boise industrial" }, members, "u1"),
    "Boise industrial");
});

test("a thread whose other members are gone still has a name", () => {
  // The correspondence outlives the employment. A thread that suddenly had no
  // name would read as data loss.
  const members = [{ user_id: "u1", email: "owen@compninja.co" }];
  assert.equal(MSG.threadLabel({ kind: "dm" }, members, "u1"), "A colleague");
  assert.equal(MSG.threadLabel({ kind: "channel", title: "  " }, members, "u1"), "Group");
});

test("an unnamed group is named by the people in it, per reader", () => {
  // Two names in full, then a count: the list row is one line, and four names
  // in it would be an ellipsis rather than an answer.
  const three = [
    { user_id: "u1", email: "owen@x.co", name: "Owen" },
    { user_id: "u2", email: "dana@x.co", name: "Dana" },
    { user_id: "u3", email: "mike@x.co", name: "Mike" },
  ];
  assert.equal(MSG.threadLabel({ kind: "channel" }, three, "u1"), "Dana, Mike");
  assert.equal(MSG.threadLabel({ kind: "channel" }, three, "u2"), "Owen, Mike");

  const five = three.concat([
    { user_id: "u4", email: "pat@x.co", name: "Pat" },
    { user_id: "u5", email: "sam@x.co", name: "Sam" },
  ]);
  assert.equal(MSG.threadLabel({ kind: "channel" }, five, "u1"), "Dana, Mike and 2 others");

  const four = three.concat([{ user_id: "u4", email: "pat@x.co", name: "Pat" }]);
  assert.equal(MSG.threadLabel({ kind: "channel" }, four, "u1"), "Dana, Mike and 1 other",
    "the count is singular at one");

  // A STORED title still renders, because rows created before names were
  // dropped have one. Nothing writes another.
  assert.equal(MSG.threadLabel({ kind: "channel", title: "Boise" }, three, "u1"), "Boise");
  assert.equal(MSG.threadLabel({ kind: "channel", title: "Boise" }, three, "u2"), "Boise");
});

test("a name falls back through the email, because the roster carries no names", () => {
  // GET /api/org/members returns emails and no display name, so this fallback
  // is the common path rather than the exceptional one.
  assert.equal(MSG.displayName({ email: "dana@compninja.co" }), "dana");
  assert.equal(MSG.displayName({ name: "Dana Reed", email: "d@x.co" }), "Dana Reed");
  assert.equal(MSG.displayName(null), "A colleague");
  assert.equal(MSG.displayName({}), "A colleague");
});

test("kind is presentation, so an unrecognized one costs a label and no access", () => {
  assert.equal(MSG.kindOf({ kind: "channel" }), "channel");
  assert.equal(MSG.kindOf({ kind: "broadcast" }), "dm");
  assert.equal(MSG.kindOf(null), "dm");
});
