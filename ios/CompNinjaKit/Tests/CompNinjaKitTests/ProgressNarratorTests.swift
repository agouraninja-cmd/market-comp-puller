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
    @Test func barIsMonotonic() {
        var n = ProgressNarrator()
        n.apply(event(["phase": "drafting", "chars": 11_000]))
        let high = n.fraction
        #expect(high > 0.9)
        n.apply(event(["phase": "writing"]))
        #expect(n.fraction == high)
    }

    @Test func barNeverReachesFullBeforeTheResult() {
        var n = ProgressNarrator()
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
