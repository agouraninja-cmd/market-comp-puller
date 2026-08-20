import Foundation
import Testing
@testable import CompNinjaKit

@Suite("Money display")
struct ReportFormatTests {

    /// The three shapes three real reports actually returned.
    @Test(arguments: [("81", "$81"), ("122", "$122"), ("$453", "$453")])
    func normalizesWhatTheServerActuallySends(raw: String, expected: String) {
        #expect(ReportFormat.money(LooseString(raw)) == expected)
    }

    @Test func neverDoublePrefixes() {
        #expect(ReportFormat.money(LooseString("$113 (sale comps)")) == "$113 (sale comps)")
        #expect(ReportFormat.money(LooseString("$7.25/SF/yr NNN")) == "$7.25/SF/yr NNN")
    }

    @Test func keepsQualifiersAndSeparators() {
        #expect(ReportFormat.money(LooseString("1,250,000")) == "$1,250,000")
        #expect(ReportFormat.money(LooseString("81 (sale comps)")) == "$81 (sale comps)")
    }

    /// A non-USD report quotes every figure in its own currency. Writing "$"
    /// on a CAD figure would state something the report does not.
    @Test func nonUSDGetsItsCodeNotADollarSign() {
        #expect(ReportFormat.money(LooseString("81"), currency: LooseString("CAD")) == "CAD 81")
        #expect(ReportFormat.money(LooseString("81"), currency: LooseString("mxn")) == "MXN 81")
    }

    @Test func aFigureThatAlreadyCarriesAMarkerIsUntouched() {
        #expect(ReportFormat.money(LooseString("CAD 81"), currency: LooseString("CAD")) == "CAD 81")
        #expect(ReportFormat.money(LooseString("€81")) == "€81")
    }

    @Test func absentStaysAbsent() {
        #expect(ReportFormat.money(LooseString(nil)) == nil)
        #expect(ReportFormat.money(LooseString("")) == nil)
        #expect(ReportFormat.money(nil) == nil)
    }

    /// An empty currency means USD, matching the server: usd_rate is "" and
    /// currency is "USD" for a US property, and older cached reports may carry
    /// neither.
    @Test func missingCurrencyMeansDollars() {
        #expect(ReportFormat.money(LooseString("81"), currency: LooseString(nil)) == "$81")
    }
}
