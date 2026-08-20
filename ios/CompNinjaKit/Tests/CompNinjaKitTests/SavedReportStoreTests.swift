import Foundation
import Testing
@testable import CompNinjaKit

@Suite("Saved reports")
struct SavedReportStoreTests {
    let dir: URL

    init() throws {
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("cn-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func saved(_ address: String, type: String = "Industrial", at: Date = Date()) -> SavedReport {
        SavedReport(address: address, propertyType: type, savedAt: at, report: Report())
    }

    @Test func savesAndReloadsFromDisk() {
        SavedReportStore(directory: dir).save(saved("1200 W Industrial Blvd, Dallas, TX"))

        // A second store over the same directory is the app relaunching.
        let reopened = SavedReportStore(directory: dir)
        #expect(reopened.all().count == 1)
        #expect(reopened.all().first?.address == "1200 W Industrial Blvd, Dallas, TX")
    }

    /// Re-running an address replaces its saved copy rather than stacking a
    /// second entry, and keeps the id the UI is already holding.
    @Test func rerunningAPropertyReplacesItAndKeepsTheID() {
        let store = SavedReportStore(directory: dir)
        let first = saved("1200 W Industrial Blvd, Dallas, TX", at: Date(timeIntervalSince1970: 1))
        store.save(first)
        store.save(saved("  1200 w industrial blvd, DALLAS, tx ", at: Date(timeIntervalSince1970: 2)))

        #expect(store.all().count == 1)
        #expect(store.all().first?.id == first.id)
        #expect(store.all().first?.savedAt == Date(timeIntervalSince1970: 2))
    }

    /// Same address, different property type, is a different report.
    @Test func propertyTypeIsPartOfIdentity() {
        let store = SavedReportStore(directory: dir)
        store.save(saved("500 Main St", type: "Industrial"))
        store.save(saved("500 Main St", type: "Retail"))
        #expect(store.all().count == 2)
    }

    @Test func newestFirst() {
        let store = SavedReportStore(directory: dir)
        store.save(saved("A", at: Date(timeIntervalSince1970: 100)))
        store.save(saved("B", at: Date(timeIntervalSince1970: 300)))
        store.save(saved("C", at: Date(timeIntervalSince1970: 200)))
        #expect(store.all().map(\.address) == ["B", "C", "A"])
    }

    @Test func deleteRemovesOneEntry() {
        let store = SavedReportStore(directory: dir)
        let a = saved("A")
        store.save(a)
        store.save(saved("B"))
        store.delete(id: a.id)
        #expect(store.all().map(\.address) == ["B"])
    }

    /// A store written by a newer build, or torn by a crash mid-write, must
    /// not take the app down with it.
    @Test func unreadableStoreIsAnEmptyStoreNotACrash() throws {
        try Data("{ this is not json".utf8)
            .write(to: dir.appendingPathComponent("saved-reports.json"))
        let store = SavedReportStore(directory: dir)
        #expect(store.all().count == 0)

        // And it recovers: saving over the junk works.
        store.save(saved("A"))
        #expect(SavedReportStore(directory: dir).all().count == 1)
    }

    @Test func savedReportSurvivesARoundTripWithItsComps() throws {
        let report = try JSONDecoder().decode(Report.self, from: sampleReportData())
        SavedReportStore(directory: dir).save(
            SavedReport(address: "1200 W Industrial Blvd, Dallas, TX",
                        propertyType: "Industrial", report: report))

        let reloaded = try #require(SavedReportStore(directory: dir).all().first)
        #expect(reloaded.report.comps.count == 5)
        #expect(reloaded.report.comps[0].verifiedBy.value == "Lonestar Industrial Advisors")
        #expect(reloaded.report.valueDrivers.count == 3)
        #expect(reloaded.report.summary.value == report.summary.value)
    }
}
