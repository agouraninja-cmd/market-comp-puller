import Testing
import Foundation
@testable import CompNinjaKit

@Suite("Vault payload")
struct VaultPayloadTests {

    @Test func decodesTheShapeTheServerActuallySends() throws {
        let json = """
        {"comps":[
          {"id":"c1","market":"Boise, ID","property_type":"Industrial",
           "address":"455 W Gowen Rd","deal_date":"2026-02-11","transaction":"Sale",
           "price":3720000,"size_sqft":31000,"price_per_sqft":120,
           "published":true,"cited_count":4,"lat":43.55,"lng":-116.25,
           "geo_source":"broker","upload_id":"u1"}],
         "counts":{"returned":1,"published":1},
         "markets":["Boise, ID"],
         "types":["Industrial"],
         "identity":{"display_name":"Owen Barnes","company":"CompNinja LLC",
                     "license_number":"","creditedTo":"CompNinja LLC","canPublish":true},
         "firm":{"id":7,"name":"Colliers Boise"},
         "sharedWithFirm":["c1"]}
        """
        let p = try JSONDecoder().decode(VaultPayload.self, from: Data(json.utf8))
        #expect(p.comps.count == 1)
        #expect(p.comps[0].pricePerSqft.number == 120)
        #expect(p.comps[0].citedCount == 4)
        #expect(p.counts.published == 1)
        #expect(p.identity.creditedTo == "CompNinja LLC")
        #expect(p.identity.canPublish)
        // firm.id arrives as a number and is carried as text
        #expect(p.firm?.name == "Colliers Boise")
        #expect(p.sharedWithFirm.contains("c1"))
    }

    @Test func aBrokerInNoFirmDecodesWithNoFirm() throws {
        // `firm: null` is the ordinary case and must not throw.
        let p = try JSONDecoder().decode(
            VaultPayload.self, from: Data(#"{"comps":[],"firm":null}"#.utf8))
        #expect(p.firm == nil)
        #expect(p.sharedWithFirm.isEmpty)
    }

    @Test func anUnstatedIdentityCannotPublish() throws {
        // A vault-first broker has no profile. The credit name is deliberately
        // NOT inherited from the account name, so it comes back empty and the
        // publish route refuses with needs_credit_name.
        let p = try JSONDecoder().decode(
            VaultPayload.self, from: Data(#"{"identity":{"creditedTo":"","canPublish":false}}"#.utf8))
        #expect(!p.identity.isStated)
        #expect(!p.identity.canPublish)
    }
}

@Suite("Vault filtering")
struct VaultFilterTests {

    private func comp(_ id: String, market: String = "Boise, ID",
                      type: String = "Industrial", tx: String = "Sale",
                      psf: Double? = nil, rentYr: Double? = nil,
                      address: String = "", notes: String = "") -> VaultComp {
        var c = VaultComp()
        c.id = id; c.market = market; c.propertyType = type; c.transaction = tx
        c.address = address; c.notes = notes
        if let psf { c.pricePerSqft = LooseString(String(psf)) }
        if let rentYr { c.rentPsfYr = LooseString(String(rentYr)) }
        return c
    }

    @Test func theFourFiltersCompose() {
        let comps = [
            comp("1", market: "Boise, ID", type: "Industrial", tx: "Sale"),
            comp("2", market: "Boise, ID", type: "Retail", tx: "Sale"),
            comp("3", market: "Nampa, ID", type: "Industrial", tx: "Lease"),
        ]
        var f = VaultFilter()
        f.market = "Boise, ID"
        #expect(Vault.apply(f, to: comps).map(\.id) == ["1", "2"])
        f.propertyType = "Industrial"
        #expect(Vault.apply(f, to: comps).map(\.id) == ["1"])
    }

    @Test func searchTermsAreAndedNotTreatedAsAPhrase() {
        // Two words mean both, so "gowen boise" finds a Gowen Rd comp in Boise
        // without the two having to be adjacent.
        let comps = [
            comp("1", address: "455 W Gowen Rd, Boise, ID"),
            comp("2", address: "12 Fairview Ave, Boise, ID"),
        ]
        var f = VaultFilter()
        f.search = "gowen boise"
        #expect(Vault.apply(f, to: comps).map(\.id) == ["1"])
        f.search = "boise"
        #expect(Vault.apply(f, to: comps).count == 2)
    }

    @Test func searchReachesNotesAndTenancyNotJustTheAddress() {
        let comps = [comp("1", notes: "Closed off market, owner-user buyer")]
        var f = VaultFilter()
        f.search = "owner-user"
        #expect(Vault.apply(f, to: comps).count == 1)
    }

    @Test func theDealFilterSeparatesSalesFromLeases() {
        let comps = [comp("1", tx: "Sale"), comp("2", tx: "Lease")]
        var f = VaultFilter()
        f.deal = .sale
        #expect(Vault.apply(f, to: comps).map(\.id) == ["1"])
        f.deal = .lease
        #expect(Vault.apply(f, to: comps).map(\.id) == ["2"])
    }

    @Test func anUntouchedFilterIsNotActive() {
        // Drives which of the two empty states a screen shows, so it has to be
        // exact: "no comps match this filter" versus a genuinely empty book.
        var f = VaultFilter()
        #expect(!f.isActive)
        f.search = "   "
        #expect(!f.isActive)   // whitespace is not a search
        f.search = "boise"
        #expect(f.isActive)
    }
}

@Suite("Vault medians")
struct VaultMedianTests {

    private func sale(_ psf: Double) -> VaultComp {
        var c = VaultComp(); c.transaction = "Sale"
        c.pricePerSqft = LooseString(String(psf)); return c
    }
    private func lease(_ rentYr: Double) -> VaultComp {
        var c = VaultComp(); c.transaction = "Lease"
        c.rentPsfYr = LooseString(String(rentYr)); return c
    }

    @Test func amedianOfSalesIsQuotedInDollarsPerSqft() {
        let r = Vault.medianRate([sale(100), sale(120), sale(140)])
        #expect(r?.value == 120)
        #expect(r?.unit == "$/SF")
    }

    @Test func aMedianOfLeasesIsQuotedPerYear() {
        let r = Vault.medianRate([lease(7), lease(9)])
        #expect(r?.value == 8)
        #expect(r?.unit == "$/SF/yr")
    }

    @Test func aViewHoldingBothStatesNoMedianAtAll() {
        // The two are priced in different units. Averaging them produces a
        // number that is WRONG rather than merely weak, which is exactly why
        // the Deal filter had to exist before this could be shown.
        #expect(Vault.medianRate([sale(100), lease(8)]) == nil)
    }

    @Test func aLeaseWithNoAnnualRentContributesNothing() {
        // rent_psf_yr is the server's derived column. A lease without one has
        // no rate, and nothing here recomputes it from rent_psf and the basis:
        // California quotes monthly and most of the country annually, so a
        // local guess would be 12x wrong.
        var c = VaultComp(); c.transaction = "Lease"
        c.rentPsf = LooseString("1.35")   // no basis, no derived annual
        #expect(c.rate == nil)
        #expect(Vault.medianRate([c]) == nil)
    }

    @Test func aSaleWithNoPricePerSqftContributesNothing() {
        // Brokers legitimately track undisclosed deals. An unpriced comp is a
        // real row that simply cannot enter a median.
        var c = VaultComp(); c.transaction = "Sale"
        #expect(c.rate == nil)
    }

    @Test func anEmptySetHasNoMedianRatherThanZero() {
        #expect(Vault.medianRate([]) == nil)
    }
}
