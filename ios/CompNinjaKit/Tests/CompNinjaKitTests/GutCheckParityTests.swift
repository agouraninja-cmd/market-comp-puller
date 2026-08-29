import Testing
import Foundation
@testable import CompNinjaKit

/// Parity with `test/gut-check.test.js`.
///
/// `GutCheck.swift` is a second copy of that file's client half, and this suite
/// is what stops the two drifting. Every fixture and every expected value below
/// is lifted from the JS suite deliberately — if a case here is changed without
/// changing the JS, or the JS without changing this, a broker gets one verdict
/// on their phone and a different one on the web, which is the exact failure
/// the duplication was accepted in order to risk.
@Suite("Gut check parity with gut-check.js")
struct GutCheckParityTests {

    // MARK: Fixtures, matching the JS suite's

    private func vaultComp(id: String = "c1", market: String = "Boise, ID",
                           type: String = "Industrial", transaction: String = "sale",
                           pricePerSqft: Double? = 150, capRate: Double? = nil) -> VaultComp {
        var c = VaultComp()
        c.id = id; c.market = market; c.propertyType = type; c.transaction = transaction
        if let pricePerSqft { c.pricePerSqft = LooseString(String(pricePerSqft)) }
        if let capRate { c.capRate = LooseString(String(capRate)) }
        return c
    }

    /// CORPUS_OK in the JS suite.
    private let corpusOK = GutCheck.Corpus(count: 6, q1Ppsf: 120, q3Ppsf: 180,
                                           capRateMedian: nil)
    /// SNAP_OK. Note the cap rates arrive as "5.5%" strings, so the parity
    /// covers the percent-sign parse too.
    private let snapOK = GutCheck.Snapshot(
        ppsf: .init(low: 125, high: 170), capRateLow: 5.5, capRateHigh: 6.5)

    private func bench(corpus: GutCheck.Corpus? = nil,
                       snapshot: GutCheck.Snapshot? = nil,
                       market: String = "Boise, ID",
                       type: String = "Industrial") -> GutCheck.Benchmark {
        GutCheck.Benchmark(market: market, type: type, corpus: corpus, snapshot: snapshot)
    }

    // MARK: Verdicts

    @Test func inLineWhenTheBrokerMedianSitsInsideTheUnionBand() {
        let r = GutCheck.run(comps: [vaultComp(pricePerSqft: 150)],
                             benchmarks: [bench(corpus: corpusOK, snapshot: snapOK)])
        #expect(r.buckets.count == 1)
        #expect(r.buckets[0].verdict == .inLine)
        #expect(r.buckets[0].deltaPct == nil)
        // UNION of corpus 120-180 and snapshot 125-170, never the intersection:
        // two honest sources that disagree widen "in line" rather than narrow it.
        #expect(r.buckets[0].band?.low == 120)
        #expect(r.buckets[0].band?.high == 180)
    }

    @Test func aboveMarketMeasuresFromTheNearestEdge() {
        let r = GutCheck.run(comps: [vaultComp(pricePerSqft: 225)],
                             benchmarks: [bench(corpus: corpusOK)])   // band 120-180
        #expect(r.buckets[0].verdict == .above)
        #expect(r.buckets[0].deltaPct == 25)   // (225-180)/180
    }

    @Test func belowMarketIsANegativeDelta() {
        let r = GutCheck.run(comps: [vaultComp(pricePerSqft: 90)],
                             benchmarks: [bench(corpus: corpusOK)])   // band 120-180
        #expect(r.buckets[0].verdict == .below)
        #expect(r.buckets[0].deltaPct == -25)  // (120-90)/120
    }

    @Test func aDeltaThatRoundsToZeroNeverRendersAsAboveOrBelow() {
        // 100.4 is technically over a band topping out at 100, but (0.4/100)
        // rounds to 0 — the contradiction "above · 0%" must collapse to in_line.
        let tight = GutCheck.Corpus(count: 6, q1Ppsf: 100, q3Ppsf: 100)
        let r = GutCheck.run(comps: [vaultComp(pricePerSqft: 100.4)],
                             benchmarks: [bench(corpus: tight)])
        #expect(r.buckets[0].verdict == .inLine)
        #expect(r.buckets[0].deltaPct == nil)
    }

    @Test func aThinCorpusDoesNotCountTowardTheBandButASnapshotStillDoes() {
        var thin = corpusOK
        thin.count = 3                                  // below MIN_CORPUS_PPSF
        let r = GutCheck.run(comps: [vaultComp()], benchmarks: [bench(corpus: thin)])
        #expect(r.buckets[0].verdict == .noData)
        #expect(r.buckets[0].band == nil)

        let r2 = GutCheck.run(comps: [vaultComp(pricePerSqft: 150)],
                              benchmarks: [bench(corpus: thin, snapshot: snapOK)])
        #expect(r2.buckets[0].verdict == .inLine)
        #expect(r2.buckets[0].band?.low == 125)
        #expect(r2.buckets[0].band?.high == 170)
    }

    @Test func noBenchmarkMeansNoDataAndNoOutlierCanFire() {
        let r = GutCheck.run(comps: [vaultComp()], benchmarks: [bench()])
        #expect(r.buckets[0].verdict == .noData)
        #expect(r.buckets[0].outlierIDs.isEmpty)
        #expect(r.outliers.isEmpty)
    }

    @Test func aBucketWithNoPricedSalesGetsNoCardAtAll() {
        let r = GutCheck.run(
            comps: [vaultComp(transaction: "lease", pricePerSqft: nil)],
            benchmarks: [bench(corpus: corpusOK)])
        #expect(r.buckets.isEmpty)
    }

    @Test func bucketsSortByPricedSaleCountDescending() {
        let r = GutCheck.run(comps: [
            vaultComp(id: "m1", market: "Meridian, ID"),
            vaultComp(id: "b1", market: "Boise, ID"),
            vaultComp(id: "b2", market: "Boise, ID"),
        ], benchmarks: [bench(corpus: corpusOK),
                        bench(corpus: corpusOK, market: "Meridian, ID")])
        #expect(r.buckets[0].market == "Boise, ID")
        #expect(r.buckets[1].market == "Meridian, ID")
    }

    // MARK: Outliers

    @Test func onlyASaleMoreThanTwentyFivePercentOutsideTheBandIsFlagged() {
        let r = GutCheck.run(comps: [
            vaultComp(id: "hot", pricePerSqft: 230),    // 180*1.25 = 225, flagged
            vaultComp(id: "warm", pricePerSqft: 220),   // above band, inside 25%, not
            vaultComp(id: "cold", pricePerSqft: 80),    // 120*0.75 = 90, flagged
        ], benchmarks: [bench(corpus: corpusOK)])
        #expect(r.outliers.keys.sorted() == ["cold", "hot"])
        #expect(r.outliers["hot"]?.direction == "above")
        #expect((r.outliers["hot"]?.pct ?? 0) >= 27 && (r.outliers["hot"]?.pct ?? 0) <= 28)
        #expect(r.outliers["cold"]?.direction == "below")
        #expect(r.buckets[0].outlierIDs.sorted() == ["cold", "hot"])
    }

    // MARK: Cap rates

    @Test func aCapVerdictNeedsTwoBrokerCapCompsAndASnapshotRange() {
        let one = GutCheck.run(comps: [vaultComp(capRate: 6.0)],
                               benchmarks: [bench(corpus: corpusOK, snapshot: snapOK)])
        #expect(one.buckets[0].cap == nil)

        var corpusWithCap = corpusOK
        corpusWithCap.capRateMedian = 6.1
        let two = GutCheck.run(comps: [
            vaultComp(id: "c1", capRate: 5.8),
            vaultComp(id: "c2", capRate: 6.2),
        ], benchmarks: [bench(corpus: corpusWithCap, snapshot: snapOK)])
        #expect(two.buckets[0].cap != nil)
        #expect(two.buckets[0].cap?.verdict == .inLine)   // 6.0 inside 5.5-6.5
        #expect(two.buckets[0].cap?.median == 6)
        #expect(two.buckets[0].cap?.corpusMedian == 6.1)
    }

    @Test func aCorpusMedianAloneIsNotABandSoThereIsNoCapVerdict() {
        var corpusWithCap = corpusOK
        corpusWithCap.capRateMedian = 6.1
        let r = GutCheck.run(comps: [
            vaultComp(id: "c1", capRate: 5.8),
            vaultComp(id: "c2", capRate: 6.2),
        ], benchmarks: [bench(corpus: corpusWithCap)])     // no snapshot
        #expect(r.buckets[0].cap == nil)
    }

    @Test func anUnpricedSalesCapRateStillCounts() {
        // Brokers track undisclosed-price deals, and a sale with no entered
        // price can still carry a real cap rate. Only the $/SF median needs a
        // price; the cap aggregate needs a sale.
        let r = GutCheck.run(comps: [
            vaultComp(id: "c1", capRate: 5.8),
            vaultComp(id: "c2", pricePerSqft: nil, capRate: 6.2),
        ], benchmarks: [bench(corpus: corpusOK, snapshot: snapOK)])
        #expect(r.buckets[0].cap != nil)
        #expect(r.buckets[0].cap?.count == 2)
        #expect(r.buckets[0].cap?.median == 6)
        #expect(r.buckets[0].pricedSales == 1)
    }

    // MARK: The constants and the parsers

    @Test func theFloorsAndThresholdHoldTheirSpeccedValues() {
        #expect(GutCheck.minCorpusPpsf == 4)
        #expect(GutCheck.minCorpusCap == 3)
        #expect(GutCheck.minBrokerCap == 2)
        #expect(GutCheck.outlierPct == 0.25)
    }

    @Test func theNumberParserTakesTheFirstNumberRatherThanRefusingAmbiguity() {
        // A deliberate divergence from the report side's displayMoney, which
        // refuses ambiguity. This feeds aggregates over many rows, where a
        // refusal starves the benchmark and a rare misread is damped by the
        // median.
        #expect(GutCheck.firstNumber(in: "$1,234,567") == 1234567)
        #expect(GutCheck.firstNumber(in: "100-200") == 100)
        #expect(GutCheck.firstNumber(in: "5.5%") == 5.5)
        #expect(GutCheck.firstNumber(in: "-42") == -42)
        #expect(GutCheck.firstNumber(in: "no digits here") == nil)
        #expect(GutCheck.firstNumber(in: "") == nil)
    }

    @Test func aCapRateOutsideZeroToTwentyFiveIsATypoNotASignal() {
        #expect(GutCheck.capOk(6.1))
        #expect(!GutCheck.capOk(0))
        #expect(!GutCheck.capOk(25))
        #expect(!GutCheck.capOk(-3))
        // 0.061 would be a rate written as a fraction, which is a different
        // unit rather than a market signal; it is still inside (0,25) and so
        // is deliberately accepted, matching the JS.
        #expect(GutCheck.capOk(0.061))
    }

    @Test func anythingNotStartingWithLeaseIsASale() {
        // gut-check.js's own predicate, kept literal rather than reusing
        // VaultComp.isLease, which asks whether the word appears anywhere.
        #expect(GutCheck.isSale("sale"))
        #expect(GutCheck.isSale(""))
        #expect(!GutCheck.isSale("lease"))
        #expect(!GutCheck.isSale("Lease"))
    }
}
