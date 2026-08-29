import Foundation

/// A comp being added or corrected.
///
/// This is NOT a validator. `broker-vault.js` is the validator, it rejects
/// rather than guesses ("1.2M", an Excel serial date, a day-first date), and
/// its refusal text is written to be read by the broker. Duplicating those
/// rules here would create a second copy that drifts, and the drift would show
/// up as the app accepting something the server then refuses, or worse,
/// refusing something the server would have taken.
///
/// What this DOES do is narrower and worth having:
///
///  * name the four fields the server requires, so the Save button can be
///    disabled rather than firing a request that can only fail;
///  * carry the vocabularies as closed sets, so a picker cannot offer a value
///    the server would reject;
///  * build the request body, omitting empty fields so a partial edit stays
///    partial.
public struct VaultDraft: Sendable, Equatable {

    // MARK: Vocabularies
    //
    // Closed sets, matching the server's parsers. It is generous about wording
    // on the way in ("sold", "purchase") because an imported spreadsheet says
    // anything; a picker only ever needs the canonical value.

    public static let propertyTypes = [
        "Industrial", "Office", "Retail", "Multifamily", "Land", "Residential",
    ]

    /// Named `DealKind` and stored as `deal`, NOT `transaction`.
    ///
    /// SwiftUI's `Binding` has its own `transaction` property (its animation
    /// Transaction), which shadows dynamic-member lookup — so `$draft.transaction`
    /// silently resolves to SwiftUI's rather than to this field, and the error
    /// it produces names neither. The wire key is still "transaction"; only the
    /// Swift name moved.
    public enum DealKind: String, CaseIterable, Sendable {
        case sale, lease
        public var label: String { self == .sale ? "Sale" : "Lease" }
    }

    /// Required whenever a rent is given, and deliberately NOT defaulted.
    ///
    /// The quoting convention is regional, not national: $1.35/SF is an
    /// ordinary monthly industrial rent in California and an impossible annual
    /// one. Defaulting either way stores a figure twelve times wrong in a
    /// broker's own records, which is the class of error this whole module
    /// refuses "1.2M" to avoid. `nil` is a real state and the UI must make the
    /// broker choose.
    public enum RentBasis: String, CaseIterable, Sendable {
        case annual, monthly
        public var label: String { self == .annual ? "per year" : "per month" }
    }

    /// Optional and disclosed, the deliberate asymmetry against rent basis:
    /// mixing bases makes a median WRONG, mixing structures makes it WEAKER,
    /// and those get different answers.
    public enum LeaseType: String, CaseIterable, Sendable {
        case NNN, FS, MG
        public var label: String {
            switch self {
            case .NNN: return "NNN"
            case .FS: return "Full service"
            case .MG: return "Modified gross"
            }
        }
    }

    // MARK: Fields

    public var address = ""
    public var propertyType = ""
    public var deal: DealKind = .sale
    /// Stored as the date itself; serialised as YYYY-MM-DD, which is the one
    /// shape the server's parser cannot misread. It refuses a bare number as
    /// an Excel serial and refuses day-first dates outright.
    public var dealDate: Date?

    public var price = ""
    public var sizeSqft = ""
    public var capRate = ""

    public var rentPsf = ""
    public var rentBasis: RentBasis?
    public var leaseType: LeaseType?
    public var leaseExpiry: Date?
    public var optionNoticeDate: Date?

    public var tenancy = ""
    public var yearBuilt = ""
    public var notes = ""

    // Per-type specs. Which of these a form shows is decided by
    // `specFields(for:)` below, mirroring TYPE_COMP_FIELDS on the server.
    public var clearHeight = ""
    public var dockDoors = ""
    public var buildingClass = ""
    public var floorPlate = ""
    public var centerType = ""
    public var anchorTenant = ""
    public var units = ""
    public var pricePerUnit = ""
    public var lotAcres = ""
    public var pricePerAcre = ""
    public var zoning = ""
    public var bedsBaths = ""

    public init() {}

    /// Pre-fill from a stored comp, for an edit.
    public init(_ comp: VaultComp) {
        address = comp.address
        propertyType = comp.propertyType
        deal = comp.isLease ? .lease : .sale
        dealDate = Self.date(from: comp.dealDate)
        price = comp.price.value ?? ""
        sizeSqft = comp.sizeSqft.value ?? ""
        capRate = comp.capRate.value ?? ""
        rentPsf = comp.rentPsf.value ?? ""
        rentBasis = RentBasis(rawValue: comp.rentBasis)
        leaseType = LeaseType(rawValue: comp.leaseType)
        leaseExpiry = Self.date(from: comp.leaseExpiry)
        optionNoticeDate = Self.date(from: comp.optionNoticeDate)
        tenancy = comp.tenancy
        yearBuilt = comp.yearBuilt.value ?? ""
        notes = comp.notes
        clearHeight = comp.clearHeight.value ?? ""
        dockDoors = comp.dockDoors.value ?? ""
        buildingClass = comp.buildingClass
        floorPlate = comp.floorPlate.value ?? ""
        centerType = comp.centerType
        anchorTenant = comp.anchorTenant
        units = comp.units.value ?? ""
        pricePerUnit = comp.pricePerUnit.value ?? ""
        lotAcres = comp.lotAcres.value ?? ""
        pricePerAcre = comp.pricePerAcre.value ?? ""
        zoning = comp.zoning
        bedsBaths = comp.bedsBaths
    }

    // MARK: Which specs this type carries

    public struct SpecField: Sendable, Identifiable, Equatable {
        public let key: String
        public let label: String
        public var id: String { key }
    }

    /// Mirrors `TYPE_COMP_FIELDS` on the server. A type that offered a field
    /// the server does not declare for it would be silently dropped, so an
    /// input nobody can save is worse than no input.
    public static func specFields(for propertyType: String) -> [SpecField] {
        switch propertyType {
        case "Industrial":
            return [.init(key: "clear_height", label: "Clear height"),
                    .init(key: "dock_doors", label: "Dock doors")]
        case "Office":
            return [.init(key: "building_class", label: "Class"),
                    .init(key: "floor_plate", label: "Floor plate")]
        case "Retail":
            return [.init(key: "center_type", label: "Center type"),
                    .init(key: "anchor_tenant", label: "Anchor tenant")]
        case "Multifamily":
            return [.init(key: "units", label: "Units"),
                    .init(key: "price_per_unit", label: "$/unit")]
        case "Land":
            return [.init(key: "lot_acres", label: "Lot acres"),
                    .init(key: "price_per_acre", label: "$/acre"),
                    .init(key: "zoning", label: "Zoning")]
        case "Residential":
            return [.init(key: "beds_baths", label: "Beds / baths")]
        default:
            return []
        }
    }

    public func spec(_ key: String) -> String {
        switch key {
        case "clear_height": return clearHeight
        case "dock_doors": return dockDoors
        case "building_class": return buildingClass
        case "floor_plate": return floorPlate
        case "center_type": return centerType
        case "anchor_tenant": return anchorTenant
        case "units": return units
        case "price_per_unit": return pricePerUnit
        case "lot_acres": return lotAcres
        case "price_per_acre": return pricePerAcre
        case "zoning": return zoning
        case "beds_baths": return bedsBaths
        default: return ""
        }
    }

    public mutating func setSpec(_ key: String, _ value: String) {
        switch key {
        case "clear_height": clearHeight = value
        case "dock_doors": dockDoors = value
        case "building_class": buildingClass = value
        case "floor_plate": floorPlate = value
        case "center_type": centerType = value
        case "anchor_tenant": anchorTenant = value
        case "units": units = value
        case "price_per_unit": pricePerUnit = value
        case "lot_acres": lotAcres = value
        case "price_per_acre": pricePerAcre = value
        case "zoning": zoning = value
        case "beds_baths": bedsBaths = value
        default: break
        }
    }

    // MARK: What the server will refuse before it is asked

    /// The four the server requires, plus the one conditional pairing.
    ///
    /// This exists to disable a Save button, not to replace validation. Every
    /// other rule — what a price may look like, what a date may look like —
    /// stays on the server, where it is written once.
    public var blockingProblem: String? {
        if address.trimmingCharacters(in: .whitespaces).isEmpty {
            return "An address is required."
        }
        if propertyType.isEmpty { return "Pick a property type." }
        if dealDate == nil { return "Pick the deal date." }
        // The one conditional rule worth catching locally, because getting it
        // wrong is silent: a rent with no basis is ambiguous by a factor of
        // twelve, and the server refuses it for exactly that reason.
        if !rentPsf.trimmingCharacters(in: .whitespaces).isEmpty && rentBasis == nil {
            return "Say whether that rent is per year or per month."
        }
        return nil
    }

    public var canSave: Bool { blockingProblem == nil }

    // MARK: Serialisation

    /// The request body. Empty fields are omitted rather than sent as "", so a
    /// PATCH stays a partial edit and never clears a column the form did not
    /// show.
    public func body() -> [String: Any] {
        var b: [String: Any] = [:]
        func put(_ key: String, _ value: String) {
            let v = value.trimmingCharacters(in: .whitespaces)
            if !v.isEmpty { b[key] = v }
        }
        put("address", address)
        put("property_type", propertyType)
        b["transaction"] = deal.rawValue
        if let dealDate { b["deal_date"] = Self.string(from: dealDate) }

        // A sale's figures and a lease's are never both sent: a stored comp
        // carrying both would let one view read it as either.
        switch deal {
        case .sale:
            put("price", price)
            put("cap_rate", capRate)
        case .lease:
            put("rent_psf", rentPsf)
            if let rentBasis { b["rent_basis"] = rentBasis.rawValue }
            if let leaseType { b["lease_type"] = leaseType.rawValue }
            if let leaseExpiry { b["lease_expiry"] = Self.string(from: leaseExpiry) }
            if let optionNoticeDate {
                b["option_notice_date"] = Self.string(from: optionNoticeDate)
            }
        }

        put("size_sqft", sizeSqft)
        put("tenancy", tenancy)
        put("year_built", yearBuilt)
        put("notes", notes)
        for field in Self.specFields(for: propertyType) {
            put(field.key, spec(field.key))
        }
        return b
    }

    // MARK: Dates

    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    public static func string(from date: Date) -> String { iso.string(from: date) }

    public static func date(from string: String) -> Date? {
        guard !string.isEmpty else { return nil }
        return iso.date(from: String(string.prefix(10)))
    }
}
