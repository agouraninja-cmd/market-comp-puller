import Foundation

/// A report as it sits on the phone.
public struct SavedReport: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var address: String
    public var propertyType: String
    public var savedAt: Date
    public var report: Report

    public init(id: String = UUID().uuidString, address: String, propertyType: String,
                savedAt: Date = Date(), report: Report) {
        self.id = id
        self.address = address
        self.propertyType = propertyType
        self.savedAt = savedAt
        self.report = report
    }

    /// Same identity rule the server uses for a report id: address + type,
    /// case- and whitespace-insensitive. Re-running a property REPLACES its
    /// saved copy rather than stacking a second entry, which is what a person
    /// re-running an address a week later actually wants.
    public var key: String {
        let a = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let t = propertyType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return "\(a)|\(t)"
    }
}

/// On-device report storage.
///
/// This is the app's answer to guideline 4.2 as much as it is a feature: a
/// saved report opens on a plane with no signal, which the website cannot do
/// at all. It is a plain JSON file rather than Core Data because a report is
/// already a JSON document and the whole store is a few hundred KB.
public final class SavedReportStore: @unchecked Sendable {
    private let url: URL
    private let queue = DispatchQueue(label: "co.compninja.savedreports")
    private var cache: [SavedReport]?

    public init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default.urls(for: .applicationSupportDirectory,
                                                        in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.url = dir.appendingPathComponent("saved-reports.json")
    }

    /// Newest first.
    public func all() -> [SavedReport] {
        queue.sync {
            if let cache { return cache }
            let loaded = load()
            cache = loaded
            return loaded
        }
    }

    @discardableResult
    public func save(_ report: SavedReport) -> [SavedReport] {
        queue.sync {
            var list = cache ?? load()
            // Replace by key, keeping the ORIGINAL id: a saved report that is
            // re-run keeps whatever the UI is already holding on to.
            if let existing = list.firstIndex(where: { $0.key == report.key }) {
                var replacement = report
                replacement.id = list[existing].id
                list[existing] = replacement
            } else {
                list.append(report)
            }
            list.sort { $0.savedAt > $1.savedAt }
            persist(list)
            cache = list
            return list
        }
    }

    @discardableResult
    public func delete(id: String) -> [SavedReport] {
        queue.sync {
            var list = cache ?? load()
            list.removeAll { $0.id == id }
            persist(list)
            cache = list
            return list
        }
    }

    public func report(forKey key: String) -> SavedReport? {
        all().first { $0.key == key }
    }

    private func load() -> [SavedReport] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        // A store written by a newer build, or a half-written file after a
        // crash, must not take the app down with it — an unreadable store is
        // an empty one.
        guard let list = try? JSONDecoder.iso.decode([SavedReport].self, from: data) else { return [] }
        return list.sorted { $0.savedAt > $1.savedAt }
    }

    private func persist(_ list: [SavedReport]) {
        guard let data = try? JSONEncoder.iso.encode(list) else { return }
        // Atomic: a report is saved right after a minute-long search, and a
        // torn file would lose every other saved report too.
        try? data.write(to: url, options: .atomic)
    }
}

extension JSONDecoder {
    static var iso: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }
}

extension JSONEncoder {
    static var iso: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }
}
