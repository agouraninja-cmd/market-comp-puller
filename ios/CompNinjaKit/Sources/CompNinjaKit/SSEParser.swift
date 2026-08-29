import Foundation

/// A `progress` frame off `/api/comps`.
///
/// Only `phase` is always present; every other field belongs to one phase and
/// is absent on the rest, which is why they are all optional rather than a
/// per-phase enum with associated values — a new phase from the server must
/// decode into "something I don't render", never into a decoding failure that
/// kills the stream.
public struct ProgressEvent: Sendable, Equatable {
    public var phase: String
    public var coverage: Int?      // corpus: comps we already had
    public var market: String?     // corpus
    public var query: String?      // search: the live web query
    public var n: Int?             // search: query number; comp: comp number
    public var count: Int?         // results
    public var chars: Int?         // drafting: characters written so far
    public var writing: Bool?      // drafting
    public var key: String?        // field
    public var value: String?      // field
    public var locked: Bool?       // comp: gated, arrives with no identity
    public var attempt: Int?       // comp: which parse attempt

    init(_ obj: [String: Any]) {
        phase = obj["phase"] as? String ?? ""
        coverage = (obj["coverage"] as? NSNumber)?.intValue
        market = obj["market"] as? String
        query = obj["query"] as? String
        n = (obj["n"] as? NSNumber)?.intValue
        count = (obj["count"] as? NSNumber)?.intValue
        chars = (obj["chars"] as? NSNumber)?.intValue
        writing = obj["writing"] as? Bool
        key = obj["key"] as? String
        value = obj["value"] as? String
        locked = obj["locked"] as? Bool
        attempt = (obj["attempt"] as? NSNumber)?.intValue
    }
}

/// One frame off `/api/comps` when the body asked for `stream: true`.
public enum SSEEvent: Sendable, Equatable {
    case progress(ProgressEvent)
    case result(Data)          // the report body, handed on undecoded
    case failure(String)
}

/// Incremental reader for the server's event stream.
///
/// Deliberately a pure value type with no URLSession in it, because the
/// framing is the part that breaks: bytes arrive split anywhere, including
/// mid-frame and mid-UTF8-character. Feed it `Data` as it lands and it
/// returns whole events only.
///
/// The wire format matches `readProgressStream` in index.html: frames are
/// separated by a blank line, `event:` names the frame, and `data:` lines are
/// concatenated (each one trimmed) before being parsed as JSON.
public struct SSEParser {
    private var buffer = Data()
    private static let separator = Data("\n\n".utf8)

    public init() {}

    public mutating func consume(_ chunk: Data) -> [SSEEvent] {
        buffer.append(chunk)
        var events: [SSEEvent] = []
        while let range = buffer.range(of: Self.separator) {
            let frame = buffer[buffer.startIndex..<range.lowerBound]
            buffer = buffer[range.upperBound...]
            if let event = Self.parse(frame: frame) { events.append(event) }
        }
        return events
    }

    /// The stream ended. A stream that ends with neither a result nor an error
    /// is a dropped connection, not a finished report — the browser treats it
    /// that way and so must the app, or the progress view sits there forever.
    public func finish(sawResult: Bool) -> SSEEvent? {
        sawResult ? nil : .failure("The connection dropped before the report finished. Please try again.")
    }

    private static func parse(frame: Data) -> SSEEvent? {
        guard let text = String(data: frame, encoding: .utf8) else { return nil }
        var name = "message"
        var payload = ""
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("event:") {
                name = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                payload += line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            }
        }
        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { return nil }
        switch name {
        case "progress":
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return .progress(ProgressEvent(obj))
        case "result":
            return .result(data)
        case "error":
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return .failure(obj["error"] as? String ?? "The search failed.")
        default:
            // An unknown event name is ignored rather than surfaced. The server
            // may add frames; an older app must not show them as errors.
            return nil
        }
    }
}
