import Foundation

// The broker's private book.
//
// Everything here is vault-class: the server has no file fallback for it and
// refuses with a 503 rather than answering emptily, because on the web a
// silent empty answer would read as "my book is gone". The same rule applies
// to every screen built on this file — an error is never rendered as an empty
// vault.
//
// The shape below mirrors `vault-api.js`'s PUBLIC_COMP_FIELDS, which is an
// allowlist rather than the table's shape. Fields it strips as plumbing
// (`user_id`, `address_key`, `dedupe_key`, `property_id`,
// `renewal_notified_at`) are deliberately absent here too: modelling one would
// invite a UI for something the API does not send.

// MARK: - A stored comp

public struct VaultComp: Decodable, Identifiable, Sendable, Equatable {
    public var id: String = ""
    /// Which import this came from. Null for a comp added by hand, which is
    /// why such a comp can only ever be removed individually.
    public var uploadID: String?

    public var market: String = ""
    public var propertyType: String = ""
    public var address: String = ""
    public var dealDate: String = ""
    public var transaction: String = ""

    public var price: LooseString = LooseString(nil)
    public var sizeSqft: LooseString = LooseString(nil)
    /// Sales only. The server computes it and leaves it null on a lease,
    /// because an annual rent divided by size is $/SF/yr and would corrupt any
    /// median it entered. Never recompute it here.
    public var pricePerSqft: LooseString = LooseString(nil)
    public var capRate: LooseString = LooseString(nil)

    // The lease side. `rentPsf` and `rentBasis` are what the broker typed;
    // `rentPsfYr` is the canonical annual figure the server derived from them,
    // carried so no screen redoes that multiplication and disagrees with the
    // stored median.
    public var rentPsf: LooseString = LooseString(nil)
    public var rentBasis: String = ""
    public var leaseType: String = ""
    public var rentPsfYr: LooseString = LooseString(nil)

    // The renewal watch's two dates, both the broker's own input.
    public var leaseExpiry: String = ""
    public var optionNoticeDate: String = ""

    // Per-type specs. Which of these carry anything depends on propertyType,
    // exactly as TYPE_COMP_FIELDS decides on the server.
    public var clearHeight: LooseString = LooseString(nil)
    public var dockDoors: LooseString = LooseString(nil)
    public var buildingClass: String = ""
    public var floorPlate: LooseString = LooseString(nil)
    public var centerType: String = ""
    public var anchorTenant: String = ""
    public var units: LooseString = LooseString(nil)
    public var pricePerUnit: LooseString = LooseString(nil)
    public var lotAcres: LooseString = LooseString(nil)
    public var pricePerAcre: LooseString = LooseString(nil)
    public var zoning: String = ""
    public var bedsBaths: String = ""

    public var tenancy: String = ""
    public var yearBuilt: LooseString = LooseString(nil)
    public var notes: String = ""

    public var published: Bool = false
    public var publishedAt: String = ""
    public var publishedSubmissionID: String?
    /// How many generated reports have cited this comp since it was published.
    /// A FLOOR, not an impression count: a cache hit serves a stored report
    /// without re-running attribution, so it does not bump. Omitted at zero
    /// rather than shown as "0" beside every freshly published comp.
    public var citedCount: Int = 0

    public var createdAt: String = ""

    // Inherited from the broker's own property row, not from broker_comps.
    public var lat: LooseString = LooseString(nil)
    public var lng: LooseString = LooseString(nil)
    public var geoSource: String = ""

    /// A lease is priced in a different unit from a sale, so no view may mix
    /// the two into one median.
    public var isLease: Bool { transaction.lowercased().contains("lease") }

    /// The rate figure this comp contributes, and the unit it is quoted in.
    /// Reads STORED columns only. A comp with neither has no rate, which is
    /// why callers show a count instead of a fabricated number.
    public var rate: (value: Double, unit: String)? {
        if isLease {
            if let r = rentPsfYr.number { return (r, "$/SF/yr") }
            return nil
        }
        if let p = pricePerSqft.number { return (p, "$/SF") }
        return nil
    }

    enum CodingKeys: String, CodingKey {
        case id, market, address, transaction, price, tenancy, notes, published, zoning, units
        case uploadID = "upload_id"
        case propertyType = "property_type"
        case dealDate = "deal_date"
        case sizeSqft = "size_sqft"
        case pricePerSqft = "price_per_sqft"
        case capRate = "cap_rate"
        case rentPsf = "rent_psf"
        case rentBasis = "rent_basis"
        case leaseType = "lease_type"
        case rentPsfYr = "rent_psf_yr"
        case leaseExpiry = "lease_expiry"
        case optionNoticeDate = "option_notice_date"
        case clearHeight = "clear_height"
        case dockDoors = "dock_doors"
        case buildingClass = "building_class"
        case floorPlate = "floor_plate"
        case centerType = "center_type"
        case anchorTenant = "anchor_tenant"
        case pricePerUnit = "price_per_unit"
        case lotAcres = "lot_acres"
        case pricePerAcre = "price_per_acre"
        case bedsBaths = "beds_baths"
        case yearBuilt = "year_built"
        case publishedAt = "published_at"
        case publishedSubmissionID = "published_submission_id"
        case citedCount = "cited_count"
        case createdAt = "created_at"
        case lat, lng
        case geoSource = "geo_source"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func str(_ k: CodingKeys) -> String {
            if let s = try? c.decode(String.self, forKey: k) { return s }
            if let n = try? c.decode(Int.self, forKey: k) { return String(n) }
            return ""
        }
        func loose(_ k: CodingKeys) -> LooseString {
            (try? c.decode(LooseString.self, forKey: k)) ?? LooseString(nil)
        }

        id = str(.id)
        uploadID = (try? c.decode(String.self, forKey: .uploadID))
        market = str(.market); propertyType = str(.propertyType); address = str(.address)
        dealDate = str(.dealDate); transaction = str(.transaction)
        price = loose(.price); sizeSqft = loose(.sizeSqft)
        pricePerSqft = loose(.pricePerSqft); capRate = loose(.capRate)
        rentPsf = loose(.rentPsf); rentBasis = str(.rentBasis)
        leaseType = str(.leaseType); rentPsfYr = loose(.rentPsfYr)
        leaseExpiry = str(.leaseExpiry); optionNoticeDate = str(.optionNoticeDate)
        clearHeight = loose(.clearHeight); dockDoors = loose(.dockDoors)
        buildingClass = str(.buildingClass); floorPlate = loose(.floorPlate)
        centerType = str(.centerType); anchorTenant = str(.anchorTenant)
        units = loose(.units); pricePerUnit = loose(.pricePerUnit)
        lotAcres = loose(.lotAcres); pricePerAcre = loose(.pricePerAcre)
        zoning = str(.zoning); bedsBaths = str(.bedsBaths)
        tenancy = str(.tenancy); yearBuilt = loose(.yearBuilt); notes = str(.notes)
        published = (try? c.decode(Bool.self, forKey: .published)) ?? false
        publishedAt = str(.publishedAt)
        publishedSubmissionID = (try? c.decode(String.self, forKey: .publishedSubmissionID))
        citedCount = (try? c.decode(Int.self, forKey: .citedCount)) ?? 0
        createdAt = str(.createdAt)
        lat = loose(.lat); lng = loose(.lng); geoSource = str(.geoSource)
    }
}

// MARK: - Identity

/// Who a publish would credit.
///
/// Read verbatim and never recomputed from `displayName`/`company`. The web
/// learned this the hard way: the page must print exactly what the write would
/// produce, or it promises a name the server will not use.
public struct VaultIdentity: Decodable, Sendable, Equatable {
    public var displayName: String = ""
    public var company: String = ""
    public var licenseNumber: String = ""
    public var creditedTo: String = ""
    /// The SERVER's answer to whether this identity may publish, not a local
    /// re-derivation. A second copy of that rule could promise a publish the
    /// route would refuse.
    public var canPublish: Bool = false

    /// An unstated identity is `""`, and publishing refuses with
    /// `needs_credit_name`. It is deliberately NOT inherited from the account
    /// name: a vault-first broker never chose that string, so it would be
    /// published as their firm without anyone picking it.
    public var isStated: Bool { !creditedTo.trimmingCharacters(in: .whitespaces).isEmpty }

    enum CodingKeys: String, CodingKey {
        case company, creditedTo, canPublish
        case displayName = "display_name"
        case licenseNumber = "license_number"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        displayName = (try? c.decode(String.self, forKey: .displayName)) ?? ""
        company = (try? c.decode(String.self, forKey: .company)) ?? ""
        licenseNumber = (try? c.decode(String.self, forKey: .licenseNumber)) ?? ""
        creditedTo = (try? c.decode(String.self, forKey: .creditedTo)) ?? ""
        canPublish = (try? c.decode(Bool.self, forKey: .canPublish)) ?? false
    }
}

/// The firm, when the broker is in one. `null` is the ordinary case.
public struct VaultFirm: Decodable, Sendable, Equatable {
    public var id: String = ""
    public var name: String = ""

    enum CodingKeys: String, CodingKey { case id, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .id) { id = s }
        else if let n = try? c.decode(Int.self, forKey: .id) { id = String(n) }
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
    }
}

public struct VaultCounts: Decodable, Sendable, Equatable {
    public var returned: Int = 0
    public var published: Int = 0

    enum CodingKeys: String, CodingKey { case returned, published }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        returned = (try? c.decode(Int.self, forKey: .returned)) ?? 0
        published = (try? c.decode(Int.self, forKey: .published)) ?? 0
    }
}

// MARK: - The payload

public struct VaultPayload: Decodable, Sendable {
    public var comps: [VaultComp] = []
    public var identity: VaultIdentity = VaultIdentity()
    public var counts: VaultCounts = VaultCounts()
    /// The markets and types actually present, computed server-side. Used for
    /// the filter's options rather than a second local derivation.
    public var markets: [String] = []
    public var types: [String] = []
    /// nil for a broker in no firm, which is most of them.
    public var firm: VaultFirm?
    /// Ids of this broker's comps already on the firm's shelf. Ids rather than
    /// a flag on each comp, because shelf membership is a property of the
    /// relationship and not of the comp — the comps array is the vault API's
    /// own allowlist.
    public var sharedWithFirm: Set<String> = []

    enum CodingKeys: String, CodingKey {
        case comps, identity, counts, markets, types, firm, sharedWithFirm
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        comps = (try? c.decode([VaultComp].self, forKey: .comps)) ?? []
        identity = (try? c.decode(VaultIdentity.self, forKey: .identity)) ?? VaultIdentity()
        counts = (try? c.decode(VaultCounts.self, forKey: .counts)) ?? VaultCounts()
        markets = (try? c.decode([String].self, forKey: .markets)) ?? []
        types = (try? c.decode([String].self, forKey: .types)) ?? []
        firm = try? c.decodeIfPresent(VaultFirm.self, forKey: .firm)
        if let ids = try? c.decode([String].self, forKey: .sharedWithFirm) {
            sharedWithFirm = Set(ids)
        } else if let ids = try? c.decode([Int].self, forKey: .sharedWithFirm) {
            sharedWithFirm = Set(ids.map(String.init))
        }
    }
}

// MARK: - Filtering

/// The four filters, which compose and clear together.
///
/// Deal is not a nicety: sales and leases are priced in different units, so a
/// view holding both can state no median at all. That is why it is a filter
/// rather than a sort.
public struct VaultFilter: Sendable, Equatable {
    public enum Deal: String, CaseIterable, Sendable {
        case all, sale, lease
        public var label: String {
            switch self {
            case .all: return "All"
            case .sale: return "Sales"
            case .lease: return "Leases"
            }
        }
    }

    public var market: String = ""
    public var propertyType: String = ""
    public var deal: Deal = .all
    public var search: String = ""

    public init() {}

    public var isActive: Bool {
        !market.isEmpty || !propertyType.isEmpty || deal != .all
            || !search.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Terms are ANDed, so two words mean both rather than the phrase.
    func matches(_ c: VaultComp) -> Bool {
        if !market.isEmpty && c.market != market { return false }
        if !propertyType.isEmpty && c.propertyType != propertyType { return false }
        switch deal {
        case .all: break
        case .sale: if c.isLease { return false }
        case .lease: if !c.isLease { return false }
        }
        let terms = search.lowercased().split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return true }
        let hay = [c.address, c.notes, c.market, c.propertyType, c.tenancy]
            .joined(separator: " ").lowercased()
        return terms.allSatisfy { hay.contains($0) }
    }
}

public enum Vault {
    public static func apply(_ filter: VaultFilter, to comps: [VaultComp]) -> [VaultComp] {
        comps.filter { filter.matches($0) }
    }

    /// Every market present in the book, for the filter's own options.
    public static func markets(_ comps: [VaultComp]) -> [String] {
        Array(Set(comps.map(\.market).filter { !$0.isEmpty })).sorted()
    }

    public static func propertyTypes(_ comps: [VaultComp]) -> [String] {
        Array(Set(comps.map(\.propertyType).filter { !$0.isEmpty })).sorted()
    }

    /// The median rate of a set, and the unit it is quoted in.
    ///
    /// Returns nil when the set mixes sales and leases, because those are
    /// priced in different units and averaging them produces a number that is
    /// wrong rather than merely weak. Callers show a comp count instead.
    public static func medianRate(_ comps: [VaultComp]) -> (value: Double, unit: String)? {
        let rated = comps.compactMap(\.rate)
        guard !rated.isEmpty else { return nil }
        let units = Set(rated.map(\.unit))
        guard units.count == 1, let unit = units.first else { return nil }
        let values = rated.map(\.value).sorted()
        let mid = values.count / 2
        let median = values.count % 2 == 0
            ? (values[mid - 1] + values[mid]) / 2
            : values[mid]
        return (median, unit)
    }
}
