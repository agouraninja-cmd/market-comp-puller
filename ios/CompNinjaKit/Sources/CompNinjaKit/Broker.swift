import Foundation

// The broker's pipeline: enquiries that arrived through CompNinja, and the
// broker's own log of every BOV they are working.
//
// The web merged these two into ONE table on 2026-08-13 rather than keeping a
// lead inbox above a BOV tracker, and this file follows that decision rather
// than re-litigating it. The reason holds even harder on a phone: a lead and a
// BOV are the same engagement at different ages, and two lists meant a broker
// had to know which one a piece of work lived in before they could look at it.
//
// A lead is the `new` stage, and its only action is asking for an
// introduction. Everything past that is a BOV row the broker owns.

// MARK: - Entitlement

/// The `pro` block of `/api/config`.
///
/// The app asks one question of it: may this person see the pipeline at all.
/// `broker` is the identity and `canUseVault` is the capability; the server
/// keeps them separate because the vault is a private-data workspace, so this
/// mirrors both rather than collapsing them into one flag the server does not
/// actually have.
public struct Entitlements: Decodable, Sendable, Equatable {
    public var enabled: Bool = false
    public var isPro: Bool = false
    public var broker: Bool = false
    public var canUseVault: Bool = false

    enum CodingKeys: String, CodingKey {
        case enabled, isPro, broker, canUseVault
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        isPro = (try? c.decode(Bool.self, forKey: .isPro)) ?? false
        broker = (try? c.decode(Bool.self, forKey: .broker)) ?? false
        canUseVault = (try? c.decode(Bool.self, forKey: .canUseVault)) ?? false
    }
}

/// `/api/config`. Only the block the app reads is modelled; every other key
/// the server sends is ignored, which is what keeps this from breaking each
/// time the web adds a flag.
public struct AppConfig: Decodable, Sendable {
    public var pro: Entitlements = Entitlements()

    enum CodingKeys: String, CodingKey { case pro }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pro = (try? c.decode(Entitlements.self, forKey: .pro)) ?? Entitlements()
    }
}

// MARK: - Leads

/// One BOV enquiry, as the server is willing to describe it to a broker.
///
/// This is deliberately thin. The server's `anonymizeLead` is an allowlist and
/// these five facts are the whole of it: no name, no email, no phone, no
/// company, no street address. Do not add a field here speculatively — if it
/// is not in that allowlist the server will never send it, and a property that
/// looks available invites a UI that promises something the API cannot answer.
public struct Lead: Decodable, Identifiable, Sendable, Equatable {
    public var id: String = ""
    public var market: String = ""
    public var type: String = ""
    public var sizeSqft: LooseString = LooseString(nil)
    public var ts: String = ""
    /// The seller is inside a 1031 exchange window, so the clock is real.
    public var is1031: Bool = false
    public var introRequested: Bool = false

    enum CodingKeys: String, CodingKey {
        case id, market, type, ts
        case sizeSqft = "size_sqft"
        case is1031 = "is_1031"
        case introRequested = "intro_requested"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The server sends numeric ids from Postgres; a lead id is only ever
        // echoed back to /intro, so it is carried as text either way.
        if let s = try? c.decode(String.self, forKey: .id) { id = s }
        else if let n = try? c.decode(Int.self, forKey: .id) { id = String(n) }
        market = (try? c.decode(String.self, forKey: .market)) ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        sizeSqft = (try? c.decode(LooseString.self, forKey: .sizeSqft)) ?? LooseString(nil)
        ts = (try? c.decode(String.self, forKey: .ts)) ?? ""
        is1031 = (try? c.decode(Bool.self, forKey: .is1031)) ?? false
        introRequested = (try? c.decode(Bool.self, forKey: .introRequested)) ?? false
    }
}

/// A market + property type the broker wants leads from.
///
/// `nearby` is how many EXTRA markets this row reaches through the server's
/// metro grouping. It must be shown wherever the coverage is shown: a broker
/// whose coverage says "Boise, ID" seeing a Meridian lead has no way to tell
/// that from a bug otherwise.
public struct Coverage: Decodable, Identifiable, Sendable, Equatable {
    public var id: String = ""
    public var market: String = ""
    public var propertyType: String = ""
    public var nearby: Int = 0

    enum CodingKeys: String, CodingKey {
        case id, market, nearby
        case propertyType = "property_type"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .id) { id = s }
        else if let n = try? c.decode(Int.self, forKey: .id) { id = String(n) }
        market = (try? c.decode(String.self, forKey: .market)) ?? ""
        propertyType = (try? c.decode(String.self, forKey: .propertyType)) ?? ""
        nearby = (try? c.decode(Int.self, forKey: .nearby)) ?? 0
    }
}

public struct LeadInbox: Decodable, Sendable {
    public var leads: [Lead] = []
    public var coverage: [Coverage] = []

    enum CodingKeys: String, CodingKey { case leads, coverage }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        leads = (try? c.decode([Lead].self, forKey: .leads)) ?? []
        coverage = (try? c.decode([Coverage].self, forKey: .coverage)) ?? []
    }
}

// MARK: - BOVs

/// The four stages a BOV moves through.
///
/// Deliberately NOT policed as a workflow: the server's `bov-log.js` allows
/// any transition because this is the broker's own record of what happened,
/// not a process the product is entitled to enforce. A won deal that comes
/// back is allowed to go back to open.
public enum BOVStatus: String, Codable, CaseIterable, Sendable {
    case open, delivered, won, lost

    public var label: String {
        switch self {
        case .open: return "Open"
        case .delivered: return "Delivered"
        case .won: return "Won"
        case .lost: return "Lost"
        }
    }
}

public struct BOV: Decodable, Identifiable, Sendable, Equatable {
    public var id: String = ""
    public var leadID: String?
    public var market: String = ""
    public var propertyType: String = ""
    public var sizeSqft: LooseString = LooseString(nil)
    public var address: String = ""
    public var notes: String = ""
    public var receivedOn: String = ""
    public var source: String = ""
    public var statusRaw: String = ""
    public var createdAt: String = ""

    /// An unrecognised status reads as `open` rather than being dropped.
    /// A row the app cannot classify is still a live piece of the broker's
    /// business, and hiding it would be the one failure that loses work.
    public var status: BOVStatus { BOVStatus(rawValue: statusRaw) ?? .open }

    enum CodingKeys: String, CodingKey {
        case id, market, address, notes, source, status
        case leadID = "lead_id"
        case propertyType = "property_type"
        case sizeSqft = "size_sqft"
        case receivedOn = "received_on"
        case createdAt = "created_at"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .id) { id = s }
        else if let n = try? c.decode(Int.self, forKey: .id) { id = String(n) }
        if let s = try? c.decode(String.self, forKey: .leadID) { leadID = s }
        else if let n = try? c.decode(Int.self, forKey: .leadID) { leadID = String(n) }
        market = (try? c.decode(String.self, forKey: .market)) ?? ""
        propertyType = (try? c.decode(String.self, forKey: .propertyType)) ?? ""
        sizeSqft = (try? c.decode(LooseString.self, forKey: .sizeSqft)) ?? LooseString(nil)
        address = (try? c.decode(String.self, forKey: .address)) ?? ""
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        receivedOn = (try? c.decode(String.self, forKey: .receivedOn)) ?? ""
        source = (try? c.decode(String.self, forKey: .source)) ?? ""
        statusRaw = (try? c.decode(String.self, forKey: .status)) ?? ""
        createdAt = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
    }
}

/// The counts under the pipeline. Mirrors `bov-log.js`'s `rollup`.
public struct BOVRollup: Decodable, Sendable, Equatable {
    public var total: Int = 0
    public var thisYear: Int = 0
    public var open: Int = 0
    public var delivered: Int = 0
    public var won: Int = 0
    public var lost: Int = 0
    public var decided: Int = 0
    /// Null below the server's floor of three decided BOVs. A win rate over
    /// one or two deals is noise, and printing it invites a broker to read
    /// "100%" off a single win.
    public var winRate: Double?

    enum CodingKeys: String, CodingKey {
        case total, thisYear, open, delivered, won, lost, decided, winRate
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
        thisYear = (try? c.decode(Int.self, forKey: .thisYear)) ?? 0
        open = (try? c.decode(Int.self, forKey: .open)) ?? 0
        delivered = (try? c.decode(Int.self, forKey: .delivered)) ?? 0
        won = (try? c.decode(Int.self, forKey: .won)) ?? 0
        lost = (try? c.decode(Int.self, forKey: .lost)) ?? 0
        decided = (try? c.decode(Int.self, forKey: .decided)) ?? 0
        winRate = try? c.decode(Double.self, forKey: .winRate)
    }

    /// The win rate as it is written on screen, or nil when the server
    /// withheld it. Never invent a figure from `won` and `decided` here: the
    /// floor is the server's rule and a second copy of it would drift.
    public var winRateLabel: String? {
        guard let winRate else { return nil }
        return "\(Int((winRate * 100).rounded()))%"
    }
}

public struct BOVLog: Decodable, Sendable {
    public var bovs: [BOV] = []
    public var rollup: BOVRollup = BOVRollup()

    enum CodingKeys: String, CodingKey { case bovs, rollup }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        bovs = (try? c.decode([BOV].self, forKey: .bovs)) ?? []
        rollup = (try? c.decode(BOVRollup.self, forKey: .rollup)) ?? BOVRollup()
    }
}

// MARK: - The merged pipeline

/// One row of the pipeline, whichever half of the API it came from.
public struct PipelineItem: Identifiable, Sendable, Equatable {
    public enum Kind: Equatable, Sendable {
        /// An enquiry nobody has claimed yet. The only action is asking for
        /// an introduction.
        case lead(Lead)
        /// The broker's own row, with a status they control.
        case bov(BOV)
    }

    public var kind: Kind

    public init(kind: Kind) { self.kind = kind }

    public var id: String {
        switch kind {
        case .lead(let l): return "lead-" + l.id
        case .bov(let b): return "bov-" + b.id
        }
    }

    /// `new` for an unclaimed lead, otherwise the BOV's own status.
    public var stage: PipelineStage {
        switch kind {
        case .lead: return .new
        case .bov(let b): return PipelineStage(b.status)
        }
    }

    public var market: String {
        switch kind {
        case .lead(let l): return l.market
        case .bov(let b): return b.market
        }
    }

    public var propertyType: String {
        switch kind {
        case .lead(let l): return l.type
        case .bov(let b): return b.propertyType
        }
    }

    public var sizeSqft: LooseString {
        switch kind {
        case .lead(let l): return l.sizeSqft
        case .bov(let b): return b.sizeSqft
        }
    }

    /// The date the row sorts and displays on. A BOV prefers the date the
    /// broker said they received it over the date the row happened to be
    /// created, which is the same preference `rollup` uses for its year count.
    public var sortDate: String {
        switch kind {
        case .lead(let l): return l.ts
        case .bov(let b): return b.receivedOn.isEmpty ? b.createdAt : b.receivedOn
        }
    }

    public var is1031: Bool {
        if case .lead(let l) = kind { return l.is1031 }
        return false
    }
}

/// The five stages the pipeline shows, `new` plus the four a BOV can be in.
public enum PipelineStage: String, CaseIterable, Sendable {
    case new, open, delivered, won, lost

    public init(_ s: BOVStatus) {
        switch s {
        case .open: self = .open
        case .delivered: self = .delivered
        case .won: self = .won
        case .lost: self = .lost
        }
    }

    public var label: String {
        switch self {
        case .new: return "New"
        case .open: return "Open"
        case .delivered: return "Delivered"
        case .won: return "Won"
        case .lost: return "Lost"
        }
    }
}

public enum Pipeline {
    /// Merge the inbox and the log into one list, newest first.
    ///
    /// A lead the broker has already asked for an introduction to becomes a
    /// BOV row on the server, so the same engagement would otherwise appear
    /// twice: once as a claimed lead and once as the row it created. The BOV
    /// wins, because it is the one carrying the status the broker set. This
    /// dedupe is why the two lists can safely be shown as one.
    public static func merge(leads: [Lead], bovs: [BOV]) -> [PipelineItem] {
        let claimed = Set(bovs.compactMap { $0.leadID }.filter { !$0.isEmpty })
        var out: [PipelineItem] = []
        for b in bovs { out.append(PipelineItem(kind: .bov(b))) }
        for l in leads where !claimed.contains(l.id) {
            out.append(PipelineItem(kind: .lead(l)))
        }
        // Newest first. Dates arrive as ISO-8601 or as a bare YYYY-MM-DD from
        // `received_on`, and both sort correctly as text; a row with no date
        // at all sorts last rather than being dropped.
        out.sort { a, b in
            if a.sortDate.isEmpty != b.sortDate.isEmpty { return !a.sortDate.isEmpty }
            if a.sortDate != b.sortDate { return a.sortDate > b.sortDate }
            return a.id < b.id
        }
        return out
    }

    /// How many rows sit in each stage, for the strip above the list.
    public static func counts(_ items: [PipelineItem]) -> [PipelineStage: Int] {
        var out: [PipelineStage: Int] = [:]
        for s in PipelineStage.allCases { out[s] = 0 }
        for i in items { out[i.stage, default: 0] += 1 }
        return out
    }
}
