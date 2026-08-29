import Foundation
import MapKit

/// Formats a placemark the way the server needs to see an address.
///
/// The comp prompt is explicit about this: an address must end in its city and
/// two-letter state, because a bare street geocodes to the wrong state. That
/// is not theoretical — "1200 W Industrial Blvd" typed without a city resolved
/// to Cumberland, Maryland and spent a real search doing it, when the address
/// on the site's own example is in Dallas, Texas.
enum AddressFormat {
    static func street(from placemark: CLPlacemark) -> String? {
        let street = [placemark.subThoroughfare, placemark.thoroughfare]
            .compactMap { $0 }.joined(separator: " ")
        let tail = [placemark.locality, placemark.administrativeArea]
            .compactMap { $0 }.joined(separator: ", ")
        let parts = [street, tail].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

/// Address suggestions as you type, from the same engine Apple Maps uses.
///
/// This is the app's answer to ambiguity, and it is a better one than the
/// website's: the web catches a bad address AFTER you have typed it, with a
/// confirm dialog. Here a real, fully qualified address is picked before the
/// search is ever run, so there is nothing to confirm and less to type.
@MainActor
final class AddressCompleter: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published private(set) var suggestions: [MKLocalSearchCompletion] = []

    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        // Addresses only. Without this the list fills with businesses and
        // landmarks, which are not what the comp search takes.
        completer.resultTypes = .address
    }

    func update(query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // Two characters is where suggestions start being about the thing you
        // are typing rather than the whole country.
        guard trimmed.count >= 3 else {
            suggestions = []
            completer.cancel()
            return
        }
        completer.queryFragment = trimmed
    }

    func clear() {
        suggestions = []
        completer.cancel()
    }

    /// Turn a chosen suggestion into the full address string to search on.
    ///
    /// The completion itself is only a display title and subtitle, so it is
    /// resolved to a real placemark first. If that lookup fails the title and
    /// subtitle are joined instead, which still carries the city and state —
    /// a worse address is better than dropping the person's choice.
    func resolve(_ completion: MKLocalSearchCompletion) async -> String {
        let fallback = [completion.title, completion.subtitle]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        let response = try? await MKLocalSearch(request: .init(completion: completion)).start()
        guard let placemark = response?.mapItems.first?.placemark,
              let formatted = AddressFormat.street(from: placemark) else { return fallback }
        return formatted
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        let results = completer.results
        Task { @MainActor in
            // Four is as many as fits under the field without the form
            // jumping around while someone types.
            suggestions = Array(results.prefix(4))
        }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in suggestions = [] }
    }
}
