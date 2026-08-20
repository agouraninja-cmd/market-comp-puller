import Foundation

/// One comparable property.
///
/// The server sends LONG keys — the model writes short ones (`a`, `psf`,
/// `st`) and `report-parse.js` re-expands them before the response is
/// serialized, so the client never sees the compact encoding.
public struct Comp: Codable, Hashable, Identifiable, Sendable {
    public var id: String { (address.value ?? "") + "|" + (date.value ?? "") }

    public var address: LooseString = LooseString(nil)
    public var date: LooseString = LooseString(nil)
    public var transaction: LooseString = LooseString(nil)
    public var sizeSqft: LooseString = LooseString(nil)
    public var priceOrRate: LooseString = LooseString(nil)
    public var pricePerSqft: LooseString = LooseString(nil)
    public var capRate: LooseString = LooseString(nil)
    public var tenancy: LooseString = LooseString(nil)
    public var yearBuilt: LooseString = LooseString(nil)
    public var notes: LooseString = LooseString(nil)
    public var sourceURL: LooseString = LooseString(nil)
    public var sourceType: LooseString = LooseString(nil)
    public var lat: LooseString = LooseString(nil)
    public var lng: LooseString = LooseString(nil)

    /// The green badge. Only the server may award it — it means a named broker
    /// vouched for this deal — so the client renders it and never infers it.
    public var verified: Bool = false
    public var verifiedBy: LooseString = LooseString(nil)

    // Type-specific columns. Which ones arrive depends on the property type;
    // any of them may be absent on any comp.
    public var clearHeight: LooseString = LooseString(nil)
    public var dockDoors: LooseString = LooseString(nil)
    public var buildingClass: LooseString = LooseString(nil)
    public var floorPlate: LooseString = LooseString(nil)
    public var centerType: LooseString = LooseString(nil)
    public var anchorTenant: LooseString = LooseString(nil)
    public var units: LooseString = LooseString(nil)
    public var pricePerUnit: LooseString = LooseString(nil)
    public var lotAcres: LooseString = LooseString(nil)
    public var pricePerAcre: LooseString = LooseString(nil)
    public var zoning: LooseString = LooseString(nil)
    public var bedsBaths: LooseString = LooseString(nil)
    public var condition: LooseString = LooseString(nil)

    public init() {}

    enum CodingKeys: String, CodingKey {
        case address, date, transaction, notes, tenancy, verified, zoning, condition, units
        case sizeSqft = "size_sqft"
        case priceOrRate = "price_or_rate"
        case pricePerSqft = "price_per_sqft"
        case capRate = "cap_rate"
        case yearBuilt = "year_built"
        case sourceURL = "source_url"
        case sourceType = "source_type"
        case lat, lng
        case verifiedBy = "verified_by"
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
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let s = c.loose
        address = s(.address); date = s(.date); transaction = s(.transaction)
        sizeSqft = s(.sizeSqft); priceOrRate = s(.priceOrRate); pricePerSqft = s(.pricePerSqft)
        capRate = s(.capRate); tenancy = s(.tenancy); yearBuilt = s(.yearBuilt)
        notes = s(.notes); sourceURL = s(.sourceURL); sourceType = s(.sourceType)
        lat = s(.lat); lng = s(.lng); verifiedBy = s(.verifiedBy)
        clearHeight = s(.clearHeight); dockDoors = s(.dockDoors); buildingClass = s(.buildingClass)
        floorPlate = s(.floorPlate); centerType = s(.centerType); anchorTenant = s(.anchorTenant)
        units = s(.units); pricePerUnit = s(.pricePerUnit); lotAcres = s(.lotAcres)
        pricePerAcre = s(.pricePerAcre); zoning = s(.zoning); bedsBaths = s(.bedsBaths)
        condition = s(.condition)
        verified = c.flag(.verified) ?? false
    }
}

/// The confidence badge under each comp. An unrecognized value is an
/// `estimate` — the weakest badge — never a stronger one, matching the
/// server's own rule that an unknown state never grants more than it should.
public enum SourceConfidence: String, Sendable {
    case verified, publicRecord, listing, news, estimate

    public init(comp: Comp) {
        if comp.verified { self = .verified; return }
        switch comp.sourceType.value {
        case "public_record": self = .publicRecord
        case "listing": self = .listing
        case "news": self = .news
        default: self = .estimate
        }
    }

    public var label: String {
        switch self {
        case .verified: return "Verified"
        case .publicRecord: return "Public record"
        case .listing: return "Listing"
        case .news: return "News"
        case .estimate: return "Estimate"
        }
    }
}

public struct Range2: Codable, Hashable, Sendable {
    public var low: LooseString = LooseString(nil)
    public var high: LooseString = LooseString(nil)
    public var note: LooseString = LooseString(nil)

    public init() {}

    enum CodingKeys: String, CodingKey { case low, high, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        low = c.loose(.low); high = c.loose(.high); note = c.loose(.note)
    }
}

public struct PriceDiscovery: Codable, Hashable, Sendable {
    public var direction: LooseString = LooseString(nil)
    public var note: LooseString = LooseString(nil)

    public init() {}

    enum CodingKeys: String, CodingKey { case direction, note }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        direction = c.loose(.direction); note = c.loose(.note)
    }
}

/// One withheld comp, reduced to what may safely leave the server: the sale
/// price is deliberately absent, and `price_per_sqft` is precomputed so the
/// basis row never needs it.
public struct LockedBasis: Codable, Hashable, Sendable {
    public var date: LooseString = LooseString(nil)
    public var transaction: LooseString = LooseString(nil)
    public var sizeSqft: LooseString = LooseString(nil)
    public var sourceType: LooseString = LooseString(nil)
    public var pricePerSqft: LooseString = LooseString(nil)
    public var pricePerUnit: LooseString = LooseString(nil)
    public var verified: Bool?

    public init() {}

    enum CodingKeys: String, CodingKey {
        case date, transaction, verified
        case sizeSqft = "size_sqft"
        case sourceType = "source_type"
        case pricePerSqft = "price_per_sqft"
        case pricePerUnit = "price_per_unit"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.loose(.date); transaction = c.loose(.transaction); sizeSqft = c.loose(.sizeSqft)
        sourceType = c.loose(.sourceType); pricePerSqft = c.loose(.pricePerSqft)
        pricePerUnit = c.loose(.pricePerUnit); verified = c.flag(.verified)
    }
}

public struct Report: Codable, Hashable, Sendable {
    public var summary: LooseString = LooseString(nil)
    public var avgPricePerSqft: LooseString = LooseString(nil)
    public var currency: LooseString = LooseString(nil)
    public var usdRate: LooseString = LooseString(nil)
    public var subjectLat: LooseString = LooseString(nil)
    public var subjectLng: LooseString = LooseString(nil)
    public var marketCapRateRange: Range2?
    public var marketOpexRange: Range2?
    public var valueDrivers: [String] = []
    public var marketTrend: LooseString = LooseString(nil)
    public var annualPriceTrendPct: LooseString = LooseString(nil)
    public var searchRadius: LooseString = LooseString(nil)
    public var transactionsReviewed: LooseString = LooseString(nil)
    public var priceDiscovery: PriceDiscovery?
    public var subjectSizeSqft: LooseString = LooseString(nil)
    public var subjectSizeSource: LooseString = LooseString(nil)
    public var subjectYearBuilt: LooseString = LooseString(nil)
    public var comps: [Comp] = []

    /// How many comparables this account is not being shown. The number is the
    /// whole story on free — and on iOS it is the WHOLE story, because App
    /// Store guideline 3.1.3(b) forbids the app from selling or even linking
    /// to the upgrade that would unlock them. See ios/README.md.
    public var lockedCount: Int = 0
    public var lockedBasis: [LockedBasis] = []

    public init() {}

    enum CodingKeys: String, CodingKey {
        case summary, currency, comps
        case avgPricePerSqft = "avg_price_per_sqft"
        case usdRate = "usd_rate"
        case subjectLat = "subject_lat"
        case subjectLng = "subject_lng"
        case marketCapRateRange = "market_cap_rate_range"
        case marketOpexRange = "market_opex_range"
        case valueDrivers = "value_drivers"
        case marketTrend = "market_trend"
        case annualPriceTrendPct = "annual_price_trend_pct"
        case searchRadius = "search_radius"
        case transactionsReviewed = "transactions_reviewed"
        case priceDiscovery = "price_discovery"
        case subjectSizeSqft = "subject_size_sqft"
        case subjectSizeSource = "subject_size_source"
        case subjectYearBuilt = "subject_year_built"
        case lockedCount = "locked_count"
        case lockedBasis = "locked_basis"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let s = c.loose
        summary = s(.summary); currency = s(.currency); avgPricePerSqft = s(.avgPricePerSqft)
        usdRate = s(.usdRate); subjectLat = s(.subjectLat); subjectLng = s(.subjectLng)
        marketTrend = s(.marketTrend); annualPriceTrendPct = s(.annualPriceTrendPct)
        searchRadius = s(.searchRadius); transactionsReviewed = s(.transactionsReviewed)
        subjectSizeSqft = s(.subjectSizeSqft); subjectSizeSource = s(.subjectSizeSource)
        subjectYearBuilt = s(.subjectYearBuilt)
        marketCapRateRange = try? c.decodeIfPresent(Range2.self, forKey: .marketCapRateRange)
        marketOpexRange = try? c.decodeIfPresent(Range2.self, forKey: .marketOpexRange)
        priceDiscovery = try? c.decodeIfPresent(PriceDiscovery.self, forKey: .priceDiscovery)
        valueDrivers = (try? c.decodeIfPresent([LooseString].self, forKey: .valueDrivers))
            .flatMap { $0 }?.compactMap { $0.value } ?? []
        comps = (try? c.decodeIfPresent([Comp].self, forKey: .comps)).flatMap { $0 } ?? []
        lockedBasis = (try? c.decodeIfPresent([LockedBasis].self, forKey: .lockedBasis)).flatMap { $0 } ?? []
        lockedCount = Int(s(.lockedCount).value ?? "") ?? 0
    }
}
