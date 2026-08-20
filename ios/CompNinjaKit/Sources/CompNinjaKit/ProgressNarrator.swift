import Foundation

/// Turns the raw progress stream into what the waiting screen says.
///
/// A report takes roughly a minute, and the writing phase alone is 40-70s of
/// it, so the wait is the app's longest-held screen — worth its own tested
/// type rather than a switch buried in a View. The phase-to-copy mapping and
/// the bar targets mirror `applyProgress` in index.html on purpose: two
/// clients telling a different story about the same search is a bug report
/// waiting to happen.
public struct ProgressNarrator: Sendable {
    /// A 12-comp report runs about this many characters of JSON; the drafting
    /// phase reports its character count, which is the only real signal we get
    /// during the longest stretch of the wait.
    static let draftCharsFull = 11_000.0

    public private(set) var headline = "Starting your search…"
    public private(set) var detail = ""
    /// 0...1, monotonic. The bar never walks backwards: a later phase that
    /// aims lower than where we already are is ignored, because a bar going
    /// backwards reads as a failure even when the search is fine.
    public private(set) var fraction = 0.02
    public private(set) var lastPhase: String?

    /// Comps seen streaming in, for the assembling table underneath.
    public private(set) var identifiedComps = 0
    public private(set) var lockedComps = 0

    public init() {}

    public mutating func apply(_ e: ProgressEvent) {
        defer { lastPhase = e.phase.isEmpty ? lastPhase : e.phase }
        switch e.phase {
        case "corpus":
            let n = e.coverage ?? 0
            let market = e.market ?? "this market"
            headline = "Using \(n) comps CompNinja already has for \(market)…"
            detail = "This one should be quick."
            aim(0.18)
        case "search":
            if lastPhase != "search" { headline = "Searching the web…" }
            let q = (e.query ?? "").replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            detail = q.isEmpty ? "search \(e.n ?? 1)" : String(q.prefix(70))
            aim(min(0.45, 0.20 + Double(e.n ?? 0) * 0.05))
        case "results":
            if let count = e.count, count > 0 { detail = "\(count) results to review" }
            aim(0.48)
        case "writing":
            headline = "Writing your report…"
            detail = "Comparing size, age, and location"
            aim(0.55)
        case "drafting":
            if e.writing == true, lastPhase != "writing", lastPhase != "drafting" {
                headline = "Writing your report…"
                detail = "Comparing size, age, and location"
            }
            aim(0.50 + min(0.45, (Double(e.chars ?? 0) / Self.draftCharsFull) * 0.45))
        case "comp":
            if e.locked == true { lockedComps += 1 } else { identifiedComps += 1 }
        case "field":
            if e.key == "summary", let v = e.value, !v.isEmpty { detail = String(v.prefix(120)) }
        case "retry":
            headline = "The results came back oddly, rechecking…"
            detail = ""
            // Attempt 2 finds its own comps; anything assembled so far is not
            // in the report the server will actually return.
            identifiedComps = 0
            lockedComps = 0
        default:
            break
        }
    }

    private mutating func aim(_ target: Double) {
        fraction = max(fraction, min(0.97, target))
    }
}
