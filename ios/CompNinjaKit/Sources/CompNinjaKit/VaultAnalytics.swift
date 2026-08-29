import Foundation

/// What a broker's own book says about their markets.
///
/// All three of these are pure functions over comps the app already holds, so
/// they cost no request and move with whatever filter is applied — which is
/// the web's arrangement too: one filter row scoping the rollup, the chart and
/// the repeat list together.
///
/// One rule runs through every figure here and is worth stating once: a rate
/// comes from a STORED column or it does not exist. `price_per_sqft` is the
/// server's, computed for priced sales only; `rent_psf_yr` is the server's,
/// derived from the broker's rent and the basis they stated. Nothing in this
/// file multiplies or divides to invent one, because a fabricated rate in a
/// broker's own records is the error nobody catches.
public enum VaultAnalytics {

    // MARK: - Rollup

    /// One bucket per market and property type — the same pair lead coverage
    /// is keyed on, so the two vocabularies stay comparable.
    public struct Bucket: Identifiable, Sendable, Equatable {
        public let market: String
        public let propertyType: String
        public let count: Int
        /// Absent when the bucket holds no rated comp, or holds both sales and
        /// leases. A bucket with no median shows its comp count instead of a
        /// fabricated number.
        public let median: Double?
        public let unit: String?

        public var id: String { market + "|" + propertyType }
    }

    public static func rollup(_ comps: [VaultComp]) -> [Bucket] {
        var groups: [String: [VaultComp]] = [:]
        for c in comps {
            groups[c.market + "|" + c.propertyType, default: []].append(c)
        }
        return groups.map { key, members in
            let parts = key.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false)
            let rate = Vault.medianRate(members)
            return Bucket(market: String(parts.first ?? ""),
                          propertyType: parts.count > 1 ? String(parts[1]) : "",
                          count: members.count,
                          median: rate?.value,
                          unit: rate?.unit)
        }
        // Biggest first, then alphabetical, so the order is stable between
        // renders rather than following dictionary iteration.
        .sorted { ($0.count, $1.id) > ($1.count, $0.id) }
    }

    // MARK: - By year

    public struct YearPoint: Identifiable, Sendable, Equatable {
        public let year: Int
        public let count: Int
        /// Same rule as a bucket: nil when the year holds no rated comp or
        /// mixes sales and leases.
        public let median: Double?
        public let unit: String?

        public var id: Int { year }
    }

    /// Median rate per year of the deal date, oldest first.
    ///
    /// A year whose comps mix sales and leases reports its count and no
    /// median, which is why this is read with the Deal filter applied. Drawing
    /// a line through a mixed year would be drawing a number that is wrong
    /// rather than merely thin.
    public static func byYear(_ comps: [VaultComp]) -> [YearPoint] {
        var groups: [Int: [VaultComp]] = [:]
        for c in comps {
            guard let year = year(of: c.dealDate) else { continue }
            groups[year, default: []].append(c)
        }
        return groups.map { year, members in
            let rate = Vault.medianRate(members)
            return YearPoint(year: year, count: members.count,
                             median: rate?.value, unit: rate?.unit)
        }
        .sorted { $0.year < $1.year }
    }

    /// The leading four digits of a stored date. Dates arrive as YYYY-MM-DD
    /// from the server, which is the only shape it stores.
    static func year(of date: String) -> Int? {
        guard date.count >= 4, let y = Int(date.prefix(4)), y > 1800, y < 2200 else {
            return nil
        }
        return y
    }

    // MARK: - Repeat properties

    public struct Property: Identifiable, Sendable, Equatable {
        public let market: String
        /// The address as it reads on the most recent deal, since that is the
        /// one a broker recognises.
        public let address: String
        public let comps: [VaultComp]

        public var id: String { market + "|" + address.lowercased() }
        public var count: Int { comps.count }
    }

    /// Buildings this book holds more than one deal on.
    ///
    /// Grouped on market AND address, never address alone. Street names repeat
    /// across a metro, and on the web's first test book that merged a Boise
    /// building and a Meridian building at the same house number into one
    /// property with three deals.
    public static func repeatProperties(_ comps: [VaultComp]) -> [Property] {
        var groups: [String: [VaultComp]] = [:]
        for c in comps where !c.address.isEmpty {
            groups[c.market.lowercased() + "|" + normalize(c.address), default: []].append(c)
        }
        return groups.compactMap { _, members -> Property? in
            guard members.count > 1 else { return nil }
            let ordered = members.sorted { $0.dealDate > $1.dealDate }
            guard let newest = ordered.first else { return nil }
            return Property(market: newest.market, address: newest.address, comps: ordered)
        }
        .sorted { ($0.count, $1.address) > ($1.count, $0.address) }
    }

    /// Enough to match the same building written two ways in one book. NOT the
    /// server's `address_key` — that is storage plumbing the API deliberately
    /// strips, and reproducing it here would be a second copy of a rule with
    /// nothing keeping the two in step. This is a display grouping, and a
    /// missed match costs one row in a list rather than a wrong figure.
    static func normalize(_ address: String) -> String {
        address
            .lowercased()
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: ".", with: " ")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }
}
