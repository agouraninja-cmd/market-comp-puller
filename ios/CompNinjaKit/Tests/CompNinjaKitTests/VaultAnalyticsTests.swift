import Testing
import Foundation
@testable import CompNinjaKit

@Suite("Vault analytics")
struct VaultAnalyticsTests {

    private func comp(market: String = "Boise, ID", type: String = "Industrial",
                      tx: String = "Sale", psf: Double? = nil, rentYr: Double? = nil,
                      date: String = "2026-02-11", address: String = "1 Main St") -> VaultComp {
        var c = VaultComp()
        c.market = market; c.propertyType = type; c.transaction = tx
        c.dealDate = date; c.address = address
        if let psf { c.pricePerSqft = LooseString(String(psf)) }
        if let rentYr { c.rentPsfYr = LooseString(String(rentYr)) }
        return c
    }

    // MARK: Rollup

    @Test func oneBucketPerMarketAndType() {
        let buckets = VaultAnalytics.rollup([
            comp(market: "Boise, ID", type: "Industrial", psf: 100),
            comp(market: "Boise, ID", type: "Industrial", psf: 120),
            comp(market: "Boise, ID", type: "Retail", psf: 150),
            comp(market: "Nampa, ID", type: "Industrial", psf: 90),
        ])
        #expect(buckets.count == 3)
        let boiseIndustrial = buckets.first { $0.id == "Boise, ID|Industrial" }
        #expect(boiseIndustrial?.count == 2)
        #expect(boiseIndustrial?.median == 110)
        #expect(boiseIndustrial?.unit == "$/SF")
    }

    @Test func aBucketMixingSalesAndLeasesReportsItsCountAndNoMedian() {
        // The two are priced in different units, so a median over both is a
        // number that is wrong rather than weak. The count is still true.
        let buckets = VaultAnalytics.rollup([
            comp(tx: "Sale", psf: 100),
            comp(tx: "Lease", rentYr: 9),
        ])
        #expect(buckets.count == 1)
        #expect(buckets[0].count == 2)
        #expect(buckets[0].median == nil)
        #expect(buckets[0].unit == nil)
    }

    @Test func aBucketWithNoPricedCompStillCounts() {
        // Brokers legitimately track undisclosed deals. They belong in the
        // count and cannot enter a median.
        let buckets = VaultAnalytics.rollup([comp(tx: "Sale"), comp(tx: "Sale")])
        #expect(buckets[0].count == 2)
        #expect(buckets[0].median == nil)
    }

    @Test func bucketsAreOrderedBiggestFirstAndStably() {
        // Dictionary iteration order is not stable between runs; a list that
        // reshuffles on every render is unusable.
        let buckets = VaultAnalytics.rollup([
            comp(market: "Nampa, ID", psf: 90),
            comp(market: "Boise, ID", psf: 100),
            comp(market: "Boise, ID", psf: 120),
        ])
        #expect(buckets.first?.market == "Boise, ID")
        #expect(buckets.first?.count == 2)
    }

    // MARK: By year

    @Test func medianPerYearOldestFirst() {
        let points = VaultAnalytics.byYear([
            comp(psf: 100, date: "2025-03-01"),
            comp(psf: 140, date: "2025-09-01"),
            comp(psf: 200, date: "2026-01-01"),
        ])
        #expect(points.map(\.year) == [2025, 2026])
        #expect(points[0].median == 120)
        #expect(points[1].median == 200)
    }

    @Test func aYearMixingSalesAndLeasesDrawsNoPointButKeepsItsCount() {
        let points = VaultAnalytics.byYear([
            comp(tx: "Sale", psf: 100, date: "2025-03-01"),
            comp(tx: "Lease", rentYr: 9, date: "2025-09-01"),
        ])
        #expect(points.count == 1)
        #expect(points[0].count == 2)
        #expect(points[0].median == nil)
    }

    @Test func aCompWithNoUsableDateIsLeftOutRatherThanBucketedAsYearZero() {
        let points = VaultAnalytics.byYear([
            comp(psf: 100, date: ""),
            comp(psf: 120, date: "not a date"),
            comp(psf: 140, date: "2026-02-11"),
        ])
        #expect(points.map(\.year) == [2026])
        #expect(points[0].count == 1)
    }

    @Test func absurdYearsAreRefused() {
        #expect(VaultAnalytics.year(of: "0001-01-01") == nil)
        #expect(VaultAnalytics.year(of: "9999-01-01") == nil)
        #expect(VaultAnalytics.year(of: "2026-02-11") == 2026)
    }

    // MARK: Repeat properties

    @Test func onlyBuildingsWithMoreThanOneDeal() {
        let props = VaultAnalytics.repeatProperties([
            comp(date: "2026-02-11", address: "455 W Gowen Rd"),
            comp(date: "2023-05-02", address: "455 W Gowen Rd"),
            comp(date: "2025-01-01", address: "12 Fairview Ave"),
        ])
        #expect(props.count == 1)
        #expect(props[0].count == 2)
        #expect(props[0].address == "455 W Gowen Rd")
    }

    @Test func groupingIsOnMarketAndAddressNeverAddressAlone() {
        // Street names repeat across a metro. On the web's first test book
        // this merged a Boise building and a Meridian building at the same
        // house number into one property with three deals.
        let props = VaultAnalytics.repeatProperties([
            comp(market: "Boise, ID", address: "100 Main St"),
            comp(market: "Meridian, ID", address: "100 Main St"),
        ])
        #expect(props.isEmpty)
    }

    @Test func theSameAddressWrittenTwoWaysStillGroups() {
        let props = VaultAnalytics.repeatProperties([
            comp(date: "2026-02-11", address: "455 W. Gowen Rd,  Boise"),
            comp(date: "2023-05-02", address: "455 W Gowen Rd Boise"),
        ])
        #expect(props.count == 1)
        // and it reads as the most recent deal wrote it, which is the one the
        // broker recognises
        #expect(props[0].address == "455 W. Gowen Rd,  Boise")
    }

    @Test func compsWithinAPropertyAreNewestFirst() {
        let props = VaultAnalytics.repeatProperties([
            comp(date: "2023-05-02", address: "1 Main St"),
            comp(date: "2026-02-11", address: "1 Main St"),
        ])
        #expect(props[0].comps.map(\.dealDate) == ["2026-02-11", "2023-05-02"])
    }

    @Test func aCompWithNoAddressIsNotAProperty() {
        // Two unaddressed comps are not one building.
        let props = VaultAnalytics.repeatProperties([comp(address: ""), comp(address: "")])
        #expect(props.isEmpty)
    }
}
