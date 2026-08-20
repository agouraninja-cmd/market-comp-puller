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

@Suite("Count display")
struct ReportCountTests {

    /// The shapes real reports actually sent.
    @Test(arguments: [("12194", "12,194"), ("22888", "22,888"), ("825000", "825,000"), ("2568", "2,568")])
    func groupsBareSizes(raw: String, expected: String) {
        #expect(ReportFormat.count(LooseString(raw)) == expected)
    }

    @Test func leavesAlreadyGroupedValuesAlone() {
        #expect(ReportFormat.count(LooseString("86,400")) == "86,400")
    }

    /// Anything carrying a unit or a range is not re-parsed.
    @Test func leavesAnythingWithNonDigitsAlone() {
        #expect(ReportFormat.count(LooseString("12,194 SF")) == "12,194 SF")
        #expect(ReportFormat.count(LooseString("40,000-60,000")) == "40,000-60,000")
        #expect(ReportFormat.count(LooseString("approx 12000")) == "approx 12000")
    }

    @Test func shortNumbersAreUntouched() {
        #expect(ReportFormat.count(LooseString("999")) == "999")
        #expect(ReportFormat.count(LooseString("48")) == "48")
    }

    /// A year is also a bare four-digit number, and "1,900" would be wrong.
    /// The rule is that call sites never pass a year — this pins the reason.
    @Test func aYearWouldBeGroupedWhichIsWhyItIsNeverPassed() {
        #expect(ReportFormat.count(LooseString("1900")) == "1,900")
    }

    @Test func absentStaysAbsent() {
        #expect(ReportFormat.count(LooseString(nil)) == nil)
    }
}
