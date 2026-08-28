import Testing
import Foundation
@testable import CompNinjaKit

@Suite("Broker payload decoding")
struct BrokerDecodingTests {

    @Test func decodesTheLeadInboxTheServerActuallySends() throws {
        let json = """
        {"leads":[
          {"id":412,"market":"Boise, ID","type":"Industrial","size_sqft":"24,000",
           "ts":"2026-08-20T14:03:00Z","is_1031":true,"intro_requested":false}],
         "coverage":[
          {"id":7,"market":"Boise, ID","property_type":"Industrial","source":"earned","nearby":7}]}
        """
        let inbox = try JSONDecoder().decode(LeadInbox.self, from: Data(json.utf8))
        #expect(inbox.leads.count == 1)
        // Postgres sends the id as a number; it is only ever echoed back to
        // /intro, so it has to survive as text.
        #expect(inbox.leads[0].id == "412")
        #expect(inbox.leads[0].is1031)
        #expect(!inbox.leads[0].introRequested)
        #expect(inbox.coverage[0].nearby == 7)
        #expect(inbox.coverage[0].propertyType == "Industrial")
    }

    @Test func aLeadMissingEveryOptionalFieldStillDecodes() throws {
        let inbox = try JSONDecoder().decode(
            LeadInbox.self, from: Data(#"{"leads":[{"id":"9"}]}"#.utf8))
        #expect(inbox.leads.count == 1)
        #expect(inbox.leads[0].market == "")
        #expect(!inbox.leads[0].is1031)
        // A response with no coverage key at all is an empty list, not a throw.
        #expect(inbox.coverage.isEmpty)
    }

    @Test func decodesTheBovLogAndItsRollup() throws {
        let json = """
        {"bovs":[
          {"id":"a1b2","lead_id":412,"market":"Boise, ID","property_type":"Industrial",
           "size_sqft":24000,"address":"","notes":"Owner wants to close by year end",
           "received_on":"2026-08-21","source":"compninja","status":"delivered",
           "status_changed_at":"2026-08-22T10:00:00Z","created_at":"2026-08-21T09:00:00Z"}],
         "rollup":{"total":9,"thisYear":6,"open":2,"delivered":3,"won":3,"lost":1,
                   "decided":4,"winRate":0.75}}
        """
        let log = try JSONDecoder().decode(BOVLog.self, from: Data(json.utf8))
        #expect(log.bovs[0].status == .delivered)
        #expect(log.bovs[0].leadID == "412")
        // size arrives as a bare number here and as "24,000" on the lead above.
        #expect(log.bovs[0].sizeSqft.value == "24000")
        #expect(log.rollup.winRateLabel == "75%")
    }

    @Test func anUnknownStatusReadsAsOpenRatherThanVanishing() throws {
        let log = try JSONDecoder().decode(
            BOVLog.self, from: Data(#"{"bovs":[{"id":"x","status":"renegotiating"}]}"#.utf8))
        // A row the app cannot classify is still live business. Dropping it or
        // failing the decode would lose work the broker is actually doing.
        #expect(log.bovs.count == 1)
        #expect(log.bovs[0].status == .open)
    }

    @Test func aWithheldWinRateStaysWithheld() throws {
        // The server returns null below three decided BOVs. A rate over one or
        // two deals is noise, and "100%" off a single win is worse than blank.
        let log = try JSONDecoder().decode(
            BOVLog.self, from: Data(#"{"rollup":{"won":1,"decided":1,"winRate":null}}"#.utf8))
        #expect(log.rollup.winRate == nil)
        #expect(log.rollup.winRateLabel == nil)
        #expect(log.rollup.won == 1)
    }

    @Test func entitlementsDefaultClosedWhenTheBlockIsAbsent() throws {
        // /api/config always answers, including to a signed-out visitor. A
        // missing pro block must not read as "broker".
        let cfg = try JSONDecoder().decode(AppConfig.self, from: Data("{}".utf8))
        #expect(!cfg.pro.broker)
        #expect(!cfg.pro.canUseVault)
    }

    @Test func entitlementsReadTheBrokerFlags() throws {
        let cfg = try JSONDecoder().decode(AppConfig.self, from: Data(
            #"{"pro":{"enabled":true,"isPro":true,"broker":true,"canUseVault":true}}"#.utf8))
        #expect(cfg.pro.broker)
        #expect(cfg.pro.canUseVault)
    }
}

@Suite("Pipeline")
struct PipelineTests {

    private func lead(_ id: String, ts: String, market: String = "Boise, ID") -> Lead {
        var l = Lead()
        l.id = id; l.ts = ts; l.market = market; l.type = "Industrial"
        return l
    }

    private func bov(_ id: String, leadID: String? = nil, status: String = "open",
                     received: String = "", created: String = "") -> BOV {
        var b = BOV()
        b.id = id; b.leadID = leadID; b.statusRaw = status
        b.receivedOn = received; b.createdAt = created
        b.market = "Boise, ID"; b.propertyType = "Industrial"
        return b
    }

    @Test func aClaimedLeadAppearsOnceAsItsBovRow() {
        // Asking for an introduction creates a BOV row on the server, so the
        // same engagement is in both payloads. The BOV wins because it is the
        // one carrying the status the broker set.
        let items = Pipeline.merge(
            leads: [lead("412", ts: "2026-08-20T00:00:00Z")],
            bovs: [bov("a1", leadID: "412", status: "delivered", received: "2026-08-21")])
        #expect(items.count == 1)
        #expect(items[0].stage == .delivered)
    }

    @Test func anUnclaimedLeadIsTheNewStage() {
        let items = Pipeline.merge(leads: [lead("9", ts: "2026-08-20T00:00:00Z")], bovs: [])
        #expect(items.count == 1)
        #expect(items[0].stage == .new)
    }

    @Test func bovsWithNoLeadIdDoNotSwallowUnrelatedLeads() {
        // A hand-added BOV has a null lead_id. Treating that as a claim would
        // hide every lead whose id happened to be empty.
        let items = Pipeline.merge(
            leads: [lead("9", ts: "2026-08-20T00:00:00Z")],
            bovs: [bov("a1", leadID: nil, received: "2026-08-19")])
        #expect(items.count == 2)
    }

    @Test func newestFirstAcrossBothShapesOfDate() {
        // Leads carry an ISO timestamp, received_on is a bare YYYY-MM-DD.
        // Both sort correctly as text, which is the only reason one comparison
        // can serve both.
        let items = Pipeline.merge(
            leads: [lead("1", ts: "2026-08-10T00:00:00Z"),
                    lead("2", ts: "2026-08-25T00:00:00Z")],
            bovs: [bov("a", received: "2026-08-20")])
        #expect(items.map(\.id) == ["lead-2", "bov-a", "lead-1"])
    }

    @Test func aBovWithNoReceivedDateFallsBackToWhenItWasCreated() {
        let items = Pipeline.merge(leads: [], bovs: [bov("a", created: "2026-08-22T00:00:00Z")])
        #expect(items[0].sortDate == "2026-08-22T00:00:00Z")
    }

    @Test func aRowWithNoDateAtAllSortsLastRatherThanDisappearing() {
        let items = Pipeline.merge(
            leads: [lead("1", ts: "2026-08-10T00:00:00Z")],
            bovs: [bov("a")])
        #expect(items.count == 2)
        #expect(items.last?.id == "bov-a")
    }

    @Test func countsCoverEveryStageIncludingTheEmptyOnes() {
        // The strip renders all five cells always, so a stage with nothing in
        // it has to answer 0 rather than nil.
        let counts = Pipeline.counts(Pipeline.merge(
            leads: [lead("1", ts: "2026-08-10T00:00:00Z")],
            bovs: [bov("a", status: "won", received: "2026-08-01")]))
        #expect(counts[.new] == 1)
        #expect(counts[.won] == 1)
        #expect(counts[.delivered] == 0)
        #expect(counts[.lost] == 0)
        #expect(counts.count == PipelineStage.allCases.count)
    }
}
