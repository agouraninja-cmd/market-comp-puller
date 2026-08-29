import Foundation
import Testing
@testable import CompNinjaKit

@Suite("Waiting screen")
struct ProgressNarratorTests {

    func event(_ obj: [String: Any]) -> ProgressEvent { ProgressEvent(obj) }

    @Test func corpusPhaseNamesTheMarketAndTheCount() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "corpus", "coverage": 9, "market": "Dallas"]))
        #expect(n.headline == "Using 9 comps CompNinja already has for Dallas…")
        #expect(n.detail == "This one should be quick.")
    }

    @Test func searchShowsTheLiveQueryTruncated() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "search", "n": 1, "query": String(repeating: "x", count: 200)]))
        #expect(n.detail.count == 70)
    }

    /// The bar must never walk backwards: a later phase aiming lower than
    /// where we are reads as a failure even when the search is fine.
    ///
    /// The writing frame first is not incidental — drafting only drives the
    /// bar once the report is genuinely being written. See the real-ordering
    /// suite below for why.
    @Test func barIsMonotonic() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "writing"]))
        n.apply(event(["phase": "drafting", "chars": 11_000]))
        let high = n.fraction
        #expect(high > 0.9)
        n.apply(event(["phase": "writing"]))
        #expect(n.fraction == high)
    }

    @Test func barNeverReachesFullBeforeTheResult() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "writing"]))
        n.apply(event(["phase": "drafting", "chars": 500_000]))
        #expect(n.fraction <= 0.97)
    }

    @Test func lockedCompsAreCountedSeparatelyFromIdentifiedOnes() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "comp", "n": 1]))
        n.apply(event(["phase": "comp", "n": 2]))
        n.apply(event(["phase": "comp", "n": 3, "locked": true]))
        #expect(n.identifiedComps == 2)
        #expect(n.lockedComps == 1)
    }

    /// A retry means attempt 2 finds its own comps. Anything assembled so far
    /// is not in the report the server will actually return.
    @Test func retryClearsTheAssembledComps() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "comp", "n": 1]))
        n.apply(event(["phase": "retry"]))
        #expect(n.identifiedComps == 0)
        #expect(n.lockedComps == 0)
        #expect(n.headline.contains("rechecking"))
    }

    @Test func unknownPhaseChangesNothing() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "writing"]))
        let before = (n.headline, n.detail, n.fraction)
        n.apply(event(["phase": "a_phase_from_a_newer_server"]))
        #expect(n.headline == before.0)
        #expect(n.detail == before.1)
        #expect(n.fraction == before.2)
    }
}

/// Replays the frame ordering a real 70-second search actually produced
/// against the server, rather than the order the phase names imply.
@Suite("Waiting screen, real ordering")
struct ProgressNarratorRealRunTests {

    func event(_ obj: [String: Any]) -> ProgressEvent { ProgressEvent(obj) }

    /// The defect this pins: the server interleaves `drafting` frames from
    /// about 1.8 seconds in, long before the report is being written. Those
    /// drove the bar to 50% immediately, where it then sat for the whole
    /// 40-second search because the bar cannot walk backwards, while the
    /// headline still read "Searching the web".
    @Test func draftingBeforeWritingDoesNotMoveTheBar() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "start"]))
        n.apply(event(["phase": "drafting", "chars": 0]))
        #expect(n.fraction < 0.10, "an early drafting frame must not jump the bar to half")

        n.apply(event(["phase": "search", "n": 1, "query": "casper wy industrial"]))
        n.apply(event(["phase": "results", "count": 10]))
        n.apply(event(["phase": "drafting", "chars": 40]))
        #expect(n.fraction <= 0.48, "the search phases own the bar until writing starts")
        #expect(n.headline == "Searching the web…")
    }

    /// And once writing genuinely starts, drafting takes over as before.
    @Test func draftingDrivesTheBarOnceWritingHasStarted() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "search", "n": 1]))
        n.apply(event(["phase": "writing"]))
        n.apply(event(["phase": "drafting", "chars": 5500]))
        #expect(n.fraction > 0.70)
        #expect(n.headline == "Writing your report…")
    }

    /// The server can also announce writing through a drafting frame carrying
    /// `writing: true`, without a separate writing phase first.
    @Test func aDraftingFrameFlaggedWritingCountsAsTheStart() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "search", "n": 1]))
        n.apply(event(["phase": "drafting", "chars": 5500, "writing": true]))
        #expect(n.headline == "Writing your report…")
        #expect(n.fraction > 0.70)
    }

    /// The bar climbed 2% to 82% across the real run and never went backwards.
    @Test func theRealSequenceOnlyEverClimbs() {
        var n = ProgressNarrator()
        var last = 0.0
        let realRun: [[String: Any]] = [
            ["phase": "start"],
            ["phase": "drafting", "chars": 0],
            ["phase": "search", "n": 1, "query": "230 S Beverly St Casper WY industrial"],
            ["phase": "search", "n": 2, "query": "industrial warehouse sale Casper Wyoming"],
            ["phase": "results", "count": 8],
            ["phase": "results", "count": 10],
            ["phase": "drafting", "chars": 120],
            ["phase": "search", "n": 3, "query": "Natrona County assessor"],
            ["phase": "results", "count": 10],
            ["phase": "drafting", "chars": 300],
            ["phase": "writing"],
            ["phase": "drafting", "chars": 2000],
            ["phase": "field", "key": "summary", "value": "Casper is a thin, small-city industrial market"],
            ["phase": "drafting", "chars": 7800],
        ]
        for frame in realRun {
            n.apply(event(frame))
            #expect(n.fraction >= last, "bar went backwards at phase \(frame["phase"] ?? "?")")
            last = n.fraction
        }
        #expect(n.fraction > 0.70)
        #expect(n.fraction <= 0.97)
    }
}
