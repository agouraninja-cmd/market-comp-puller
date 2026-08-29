import Foundation

/// A field the server may send as a string, a number, or null.
///
/// This is not defensive decoration. `/api/comps` is a model-written JSON
/// document that the server normalizes but does not re-type: the prompt asks
/// for `"transactions_reviewed": ""` (a string) and the shipped sample report
/// carries `34` (a number). Both are real. A plain `String?` here means the
/// whole report fails to decode on the difference, so every human-readable
/// scalar in the report crosses the wire through this type.
public struct LooseString: Codable, Hashable, Sendable {
    public let value: String?

    public init(_ value: String?) {
        // Empty string means "unknown" everywhere in this API (the prompt says
        // so explicitly), so it is folded into nil once, here, rather than at
        // each of the several dozen call sites that would otherwise check.
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.value = (trimmed?.isEmpty ?? true) ? nil : trimmed
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self.init(nil)
        } else if let s = try? c.decode(String.self) {
            self.init(s)
        } else if let i = try? c.decode(Int.self) {
            self.init(String(i))
        } else if let d = try? c.decode(Double.self) {
            // 5.0 -> "5", 5.8 -> "5.8". A trailing ".0" on a count reads wrong
            // in a table cell.
            self.init(d == d.rounded() ? String(Int(d)) : String(d))
        } else if let b = try? c.decode(Bool.self) {
            self.init(b ? "true" : "false")
        } else {
            self.init(nil)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let value { try c.encode(value) } else { try c.encodeNil() }
    }
}

extension LooseString: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self.init(value) }
}

extension LooseString {
    public var isPresent: Bool { value != nil }

    /// The numeric reading of a display string: "$9,940,000" -> 9940000,
    /// "5.8%" -> 5.8, "86,400" -> 86400. Returns nil when there is no number
    /// in there at all, which is the honest answer for "Price not disclosed."
    public var number: Double? {
        guard let value else { return nil }
        var digits = ""
        var seenSeparator = false
        for ch in value {
            if ch.isNumber {
                digits.append(ch)
            } else if ch == "." && !seenSeparator && !digits.isEmpty {
                digits.append(ch)
                seenSeparator = true
            } else if ch == "-" && digits.isEmpty {
                digits.append(ch)
            } else if ch == "," {
                continue   // thousands separator
            } else if !digits.isEmpty {
                break      // "$7.25/SF/yr NNN" stops at the slash
            }
        }
        return Double(digits)
    }
}

extension KeyedDecodingContainer {
    /// Read one report field, tolerating every way it can be absent.
    ///
    /// Every object in a report is partial by design — the prompt tells the
    /// model to omit what it has no value for — so a `try container.decode`
    /// anywhere in this file would throw on a missing key and, worse, take the
    /// whole ENCLOSING object down with it wherever the caller wrapped it in
    /// `try?`. That is exactly how `market_cap_rate_range` went missing: its
    /// sibling `note` is absent on a cap-rate range, and one absent optional
    /// field silently deleted the range from the report.
    func loose(_ key: Key) -> LooseString {
        (try? decodeIfPresent(LooseString.self, forKey: key)).flatMap { $0 } ?? LooseString(nil)
    }

    func flag(_ key: Key) -> Bool? {
        (try? decodeIfPresent(Bool.self, forKey: key)).flatMap { $0 }
    }
}
