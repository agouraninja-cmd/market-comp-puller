import Testing
import Foundation
@testable import CompNinjaKit

@Suite("Vault draft")
struct VaultDraftTests {

    private func minimalSale() -> VaultDraft {
        var d = VaultDraft()
        d.address = "455 W Gowen Rd, Boise, ID"
        d.propertyType = "Industrial"
        d.deal = .sale
        d.dealDate = VaultDraft.date(from: "2026-02-11")
        return d
    }

    @Test func theFourRequiredFieldsGateSaving() {
        var d = VaultDraft()
        #expect(!d.canSave)
        d.address = "455 W Gowen Rd"
        #expect(d.blockingProblem == "Pick a property type.")
        d.propertyType = "Industrial"
        #expect(d.blockingProblem == "Pick the deal date.")
        d.dealDate = Date(timeIntervalSince1970: 0)
        #expect(d.canSave)
    }

    @Test func awhitespaceAddressIsNotAnAddress() {
        var d = minimalSale()
        d.address = "   "
        #expect(!d.canSave)
    }

    @Test func aRentWithNoBasisIsRefusedBeforeTheServerIsAsked() {
        // The one conditional rule worth catching locally, because getting it
        // wrong is SILENT: $1.35/SF is an ordinary monthly rent and an
        // impossible annual one, so an unstated basis stores a figure that
        // could be twelve times wrong.
        var d = minimalSale()
        d.deal = .lease
        d.rentPsf = "1.35"
        #expect(!d.canSave)
        #expect(d.blockingProblem?.contains("per year or per month") == true)
        d.rentBasis = .monthly
        #expect(d.canSave)
    }

    @Test func aLeaseWithNoRentAtAllIsFine() {
        // Brokers track deals whose terms were never disclosed. The basis is
        // required WITH a rent, not on every lease.
        var d = minimalSale()
        d.deal = .lease
        #expect(d.canSave)
    }

    @Test func datesSerialiseAsIsoWhichIsTheOneShapeTheParserCannotMisread() {
        let d = minimalSale()
        #expect(d.body()["deal_date"] as? String == "2026-02-11")
    }

    @Test func emptyFieldsAreOmittedSoAPatchStaysPartial() {
        // Sending "" would clear a stored column the form never showed.
        let body = minimalSale().body()
        #expect(body["price"] == nil)
        #expect(body["notes"] == nil)
        #expect(body["cap_rate"] == nil)
        #expect(body["address"] as? String == "455 W Gowen Rd, Boise, ID")
    }

    @Test func aSaleNeverCarriesLeaseFieldsAndViceVersa() {
        // A stored comp carrying both would let one view read it as either.
        var sale = minimalSale()
        sale.rentPsf = "1.35"
        sale.rentBasis = .monthly
        let saleBody = sale.body()
        #expect(saleBody["rent_psf"] == nil)
        #expect(saleBody["rent_basis"] == nil)

        var lease = minimalSale()
        lease.deal = .lease
        lease.price = "3720000"
        lease.capRate = "6.1%"
        let leaseBody = lease.body()
        #expect(leaseBody["price"] == nil)
        #expect(leaseBody["cap_rate"] == nil)
    }

    @Test func onlyTheSpecsThisTypeDeclaresAreSent() {
        // A field the server does not declare for this type is dropped by
        // sanitisation, so an input nobody can save is worse than none.
        var d = minimalSale()
        d.propertyType = "Industrial"
        d.clearHeight = "28"
        d.units = "24"          // multifamily's, not industrial's
        let body = d.body()
        #expect(body["clear_height"] as? String == "28")
        #expect(body["units"] == nil)
    }

    @Test func specFieldsMatchTheServersPerTypeMap() {
        #expect(VaultDraft.specFields(for: "Industrial").map(\.key) == ["clear_height", "dock_doors"])
        #expect(VaultDraft.specFields(for: "Land").map(\.key) == ["lot_acres", "price_per_acre", "zoning"])
        #expect(VaultDraft.specFields(for: "Residential").map(\.key) == ["beds_baths"])
        // A type the server does not know carries no specs rather than all of
        // them.
        #expect(VaultDraft.specFields(for: "Marina").isEmpty)
    }

    @Test func everyPropertyTypeTheServerAcceptsIsOffered() {
        // A picker that offered a seventh type would produce a save the server
        // refuses with "not a known property type".
        #expect(VaultDraft.propertyTypes ==
                ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"])
    }

    @Test func editingPrefillsFromTheStoredComp() throws {
        let json = """
        {"id":"c1","address":"3300 E Franklin Rd","property_type":"Industrial",
         "transaction":"Lease","deal_date":"2025-11-20","size_sqft":12000,
         "rent_psf":"0.85","rent_basis":"monthly","lease_type":"NNN",
         "lease_expiry":"2030-11-30","notes":"Renewal option"}
        """
        let comp = try JSONDecoder().decode(VaultComp.self, from: Data(json.utf8))
        let d = VaultDraft(comp)
        #expect(d.deal == .lease)
        #expect(d.rentBasis == .monthly)
        #expect(d.leaseType == .NNN)
        #expect(d.leaseExpiry != nil)
        #expect(d.notes == "Renewal option")
        // and it round-trips back to the same wire values
        let body = d.body()
        #expect(body["rent_basis"] as? String == "monthly")
        #expect(body["lease_expiry"] as? String == "2030-11-30")
    }

    @Test func anUnrecognisedStoredBasisPrefillsAsUnsetRatherThanGuessed() {
        // If a stored row ever carried something outside the vocabulary, the
        // form must ASK rather than pick one — the whole point of the rule.
        var comp = VaultComp()
        comp.transaction = "Lease"
        comp.rentPsf = LooseString("1.35")
        comp.rentBasis = "per annum in advance"
        let d = VaultDraft(comp)
        #expect(d.rentBasis == nil)
        #expect(!d.canSave)
    }
}
