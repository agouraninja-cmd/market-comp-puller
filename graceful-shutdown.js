// Stopping without dropping the request somebody is waiting on (2026-11-14).
//
// server.js had no signal handler and no crash handler. Three things followed:
//
//  - Render ends the old instance of every deploy with SIGTERM, and Node's
//    default for SIGTERM is to die on the spot. A comp search runs for tens of
//    seconds to a few minutes and is billed when it starts, so every deploy
//    cut off whatever searches were in flight after they had been paid for.
//  - One unhandled promise rejection anywhere ends a Node process the same
//    way, taking every other visitor's request with it.
//  - Nothing told the owner that either had happened.
//
// This module is the drain: stop taking new connections, let the requests in
// flight finish, then exit, with a deadline so a stuck request cannot hold a
// deploy open for ever. server.js owns the process handlers and the mail; this
// owns the counting, so it can be tested against a plain http.Server with no
// signals sent to anything.
//
// Requiring it starts nothing.
//
// Rules:
//
//  - **In flight is counted here, not asked of Node.** server.close()'s own
//    callback waits for every connection, idle keep-alive ones included, and
//    the proxy in front of this app holds those open. A request is in flight
//    from track() until its response emits "close", which fires once whether
//    the response finished or the visitor went away.
//  - **A request is counted once.** routeWarm hands a request back through
//    server.emit("request"), so the handler, and track(), run twice for it.
//  - **Nothing in flight means exit now.** A deploy on a quiet box, Ctrl+C on
//    a developer's machine and the test suite's stop() all end immediately.
//  - **A second signal ends it at once.** Ctrl+C twice always works.
//  - **The exit code says why.** 0 for a requested stop; the caller passes 1
//    for a crash, so the host restarts it and a test's boot helper reports it.
//  - **exit is called exactly once**, whatever order the events arrive in.

const DEFAULT_GRACE_SECONDS = 280;

// SHUTDOWN_GRACE_SECONDS -> milliseconds. The default is long on purpose: the
// host's own limit is the real one (Render kills the old instance 30 seconds
// after SIGTERM unless its shutdown delay is raised, to at most 300), and a
// drain that gives up BEFORE the host would have is a search thrown away for
// nothing. 280 leaves the host's maximum a margin. A blank, zero, negative or
// unreadable value is the default, never "no wait".
function graceMsFrom(raw) {
  const n = Number(String(raw == null ? "" : raw).trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GRACE_SECONDS * 1000;
  return Math.min(n, 3600) * 1000;
}

function createShutdown({ server, graceMs, log, exit, setTimer, clearTimer } = {}) {
  const say = typeof log === "function" ? log : () => {};
  const startTimer = setTimer || setTimeout;
  const stopTimer = clearTimer || clearTimeout;
  const grace = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : DEFAULT_GRACE_SECONDS * 1000;
  const seen = new WeakSet();
  let inFlight = 0;
  let draining = false;
  let finished = false;
  let exitCode = 0;
  let timer = null;

  function finish(why) {
    if (finished) return;
    finished = true;
    if (timer) stopTimer(timer);
    say(`Shutdown: ${why}. Exiting with code ${exitCode}.`);
    exit(exitCode);
  }

  // Count one request. Call it first in the request handler.
  function track(req, res) {
    if (!res || typeof res.once !== "function" || seen.has(res)) return;
    seen.add(res);
    inFlight += 1;
    let counted = true;
    res.once("close", () => {
      if (!counted) return;
      counted = false;
      inFlight -= 1;
      if (draining && inFlight === 0) finish("the last request in flight finished");
      else if (draining) closeIdle();
    });
    // A request that arrives while draining (the proxy reusing a connection
    // it already had) is still answered, and told not to reuse the socket.
    if (draining) {
      try { if (!res.headersSent) res.setHeader("connection", "close"); } catch (_) { /* answered anyway */ }
    }
  }

  function closeIdle() {
    try { if (typeof server.closeIdleConnections === "function") server.closeIdleConnections(); } catch (_) { /* best effort */ }
  }

  // Start draining. `code` is the exit code once it is over. Calling it again
  // while a drain is under way ends the process at once.
  function begin(reason, code) {
    if (finished) return;
    if (draining) {
      if (code) exitCode = code;
      return finish(`${reason} again, not waiting any longer (${inFlight} request(s) cut off)`);
    }
    draining = true;
    exitCode = code || 0;
    // Stop listening. Throws ERR_SERVER_NOT_RUNNING when the port was never
    // bound (a crash during boot), which is fine: there is nothing to close.
    try { server.close(); } catch (_) { /* not listening */ }
    closeIdle();
    if (inFlight === 0) return finish(`${reason}, nothing in flight`);
    say(`Shutdown: ${reason}. Waiting up to ${Math.round(grace / 1000)}s for ${inFlight} request(s) in flight.`);
    timer = startTimer(() => {
      const left = inFlight;
      try { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); } catch (_) { /* exiting anyway */ }
      finish(`gave up after ${Math.round(grace / 1000)}s with ${left} request(s) still in flight`);
    }, grace);
  }

  return {
    track, begin,
    state: () => ({ inFlight, draining, finished }),
  };
}

// "At most one of these per window, per kind." For the crash mail: a bug that
// rejects on every request must be one message, not one per visitor.
function createLimiter(windowMs, now) {
  const clock = typeof now === "function" ? now : Date.now;
  const last = new Map();
  return function allow(kind) {
    const t = clock();
    const prev = last.get(kind);
    if (prev != null && t - prev < windowMs) return false;
    last.set(kind, t);
    return true;
  };
}

// An error, or whatever was thrown or rejected with, as text that is safe to
// log and to mail: the stack when there is one, capped.
function describeError(err, max) {
  const cap = Number.isFinite(max) && max > 0 ? max : 4000;
  let text;
  if (err && typeof err === "object" && typeof err.stack === "string" && err.stack) text = err.stack;
  else if (err instanceof Error) text = String(err.message || err);
  else {
    try { text = typeof err === "string" ? err : JSON.stringify(err); } catch (_) { text = String(err); }
    if (text === undefined) text = String(err);
  }
  return text.length > cap ? text.slice(0, cap) + "\n… (cut)" : text;
}

module.exports = { createShutdown, createLimiter, describeError, graceMsFrom, DEFAULT_GRACE_SECONDS };
