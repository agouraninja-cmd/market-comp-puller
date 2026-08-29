import Foundation
import Testing
@testable import CompNinjaKit

/// The shipped sample report, lifted verbatim out of index.html. If the
/// server's report shape moves, this is what notices.
func sampleReportData() throws -> Data {
    let url = try #require(Bundle.module.url(forResource: "sample-report",
                                             withExtension: "json",
                                             subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

@Suite("Report decoding")
struct ReportDecodingTests {

    @Test func decodesTheRealSampleReport() throws {
        let report = try JSONDecoder().decode(Report.self, from: sampleReportData())

        #expect(report.comps.count == 5)
        #expect(report.valueDrivers.count == 3)
        #expect(report.avgPricePerSqft.value == "$113 (sale comps)")
        #expect(report.marketCapRateRange?.low.value == "5.8%")
        #expect(report.subjectLat.number == 32.7715)
        #expect(report.priceDiscovery?.direction.value == "flat")
    }

    /// `transactions_reviewed` is documented as a string and shipped as the
    /// number 34. Both are real, so both must decode — this is the exact
    /// mismatch that would otherwise fail the WHOLE report.
    @Test func numericFieldDocumentedAsStringStillDecodes() throws {
        let report = try JSONDecoder().decode(Report.self, from: sampleReportData())
        #expect(report.transactionsReviewed.value == "34")
    }

    @Test func compCarriesTypeSpecificColumns() throws {
        let first = try JSONDecoder().decode(Report.self, from: sampleReportData()).comps[0]
        #expect(first.address.value == "2801 S Great Southwest Pkwy, Grand Prairie, TX")
        #expect(first.clearHeight.value == "28 ft")
        #expect(first.dockDoors.value == "12 dock-high, 2 grade")
        #expect(first.pricePerSqft.value == "$115")
    }

    /// Empty string means "unknown" everywhere in this API. If it survived as
    /// an empty string the UI would render blank rows that look like a bug.
    @Test func emptyStringsBecomeAbsent() throws {
        let first = try JSONDecoder().decode(Report.self, from: sampleReportData()).comps[0]
        #expect(!first.capRate.isPresent)
        #expect(!first.sourceURL.isPresent)
        #expect(first.capRate.value == nil)
    }

    @Test func badgeFallsBackToTheWeakestValue() throws {
        let comps = try JSONDecoder().decode(Report.self, from: sampleReportData()).comps
        // Comp 0 is broker-verified; the server awards that, never the client.
        #expect(SourceConfidence(comp: comps[0]) == .verified)
        #expect(comps[0].verifiedBy.value == "Lonestar Industrial Advisors")
        #expect(SourceConfidence(comp: comps[1]) == .news)
        #expect(SourceConfidence(comp: comps[3]) == .publicRecord)

        var unknown = Comp()
        #expect(SourceConfidence(comp: unknown) == .estimate)
        unknown.sourceType = LooseString("something_new_from_the_server")
        #expect(SourceConfidence(comp: unknown) == .estimate,
                "an unrecognized source type must never earn a stronger badge")
    }

    @Test func missingFieldsDecodeRatherThanThrow() throws {
        let report = try JSONDecoder().decode(Report.self, from: Data(#"{"comps":[]}"#.utf8))
        #expect(report.comps.isEmpty)
        #expect(report.lockedCount == 0)
        #expect(!report.summary.isPresent)
    }

    @Test func lockedCompsDecodeWithoutAPrice() throws {
        let json = Data("""
        {"comps":[],"locked_count":14,
         "locked_basis":[{"date":"Mar 2025","transaction":"Sale","size_sqft":"40,000",
                          "source_type":"listing","price_per_sqft":"118","verified":true}]}
        """.utf8)
        let report = try JSONDecoder().decode(Report.self, from: json)
        #expect(report.lockedCount == 14)
        #expect(report.lockedBasis.first?.pricePerSqft.value == "118")
        #expect(report.lockedBasis.first?.verified == true)
    }

    @Test(arguments: [
        ("$9,940,000", 9_940_000.0),
        ("86,400", 86_400.0),
        ("5.8%", 5.8),
        ("$7.25/SF/yr NNN", 7.25),
        ("-96.8460", -96.8460),
    ])
    func numberReadsDisplayStrings(text: String, expected: Double) {
        #expect(LooseString(text).number == expected)
    }

    @Test func numberIsNilWhenThereIsNoNumber() {
        #expect(LooseString("Price not disclosed.").number == nil)
        #expect(LooseString(nil).number == nil)
    }
}
