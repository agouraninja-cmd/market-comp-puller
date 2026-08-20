import SwiftUI
import CoreLocation
import CompNinjaKit

struct SearchView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var locator = NearMeLocator()

    @State private var address = ""
    @State private var type: PropertyType = .industrial
    @State private var months = 12
    @State private var txFocus = "both"
    @State private var sizeSqft = ""
    @State private var note = ""
    @State private var showAdvanced = false

    @State private var running: RunningSearch?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. 1200 W Industrial Blvd, Dallas, TX", text: $address, axis: .vertical)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .font(.body)          // never below 16pt
                        .submitLabel(.search)

                    Button {
                        locator.request()
                    } label: {
                        Label(locator.isWorking ? "Finding you…" : "Use my current location",
                              systemImage: "location")
                    }
                    .disabled(locator.isWorking)

                    Picker("Property type", selection: $type) {
                        ForEach(PropertyType.allCases) { Text($0.rawValue).tag($0) }
                    }
                } header: {
                    Text("Address")
                } footer: {
                    Text("Automated estimate, not an appraisal.")
                }

                // A DisclosureGroup, not Section(isExpanded:): inside a Form
                // the expandable Section draws no chevron and nothing can open
                // it, so every field below was unreachable on device.
                Section {
                  DisclosureGroup("Details", isExpanded: $showAdvanced) {
                    Picker("Look back", selection: $months) {
                        ForEach(lookbackChoices, id: \.self) { Text("\($0) months").tag($0) }
                    }
                    Picker("Transactions", selection: $txFocus) {
                        Text("Sales and leases").tag("both")
                        Text("Sales only").tag("sales")
                        Text("Leases only").tag("leases")
                    }
                    TextField("Building size (SF)", text: $sizeSqft)
                        .keyboardType(.numberPad)
                    TextField("Anything else worth knowing", text: $note, axis: .vertical)
                  }
                } footer: {
                    if !model.isPro {
                        Text("Free accounts look back up to 12 months.")
                    }
                }

                Section {
                    Button {
                        run()
                    } label: {
                        Text("Run a report").frame(maxWidth: .infinity)
                    }
                    .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("CompNinja")
            .onReceive(locator.$resolvedAddress.compactMap { $0 }) { address = $0 }
            .alert("Search failed", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .fullScreenCover(item: $running) { search in
                SearchingView(search: search) { result in
                    running = nil
                    switch result {
                    case .success(let report):
                        model.save(report, address: search.address, propertyType: search.type)
                    case .failure(let error):
                        if let api = error as? APIError, api.signInRequired {
                            // The server's own sentence, never a copy of it.
                            model.signInPrompt = api.message
                        } else {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
                .environmentObject(model)
            }
        }
    }

    private var lookbackChoices: [Int] {
        [6, 12, 24, 36, 60, 120].filter { $0 <= model.maxLookbackMonths }
    }

    private func run() {
        running = RunningSearch(
            address: address.trimmingCharacters(in: .whitespacesAndNewlines),
            type: type.rawValue,
            months: months,
            txFocus: txFocus,
            sizeSqft: Int(sizeSqft.filter(\.isNumber)),
            note: note.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}

extension AppModel {
    var isPro: Bool { account?.isPro ?? false }
}

struct RunningSearch: Identifiable {
    let id = UUID()
    let address: String
    let type: String
    let months: Int
    let txFocus: String
    let sizeSqft: Int?
    let note: String

    var request: SearchRequest {
        SearchRequest(address: address, type: type,
                      note: note.isEmpty ? nil : note,
                      months: months, txFocus: txFocus,
                      subjectSizeSqft: sizeSqft)
    }
}

/// "Run comps where I'm standing" — the reason a broker in a parking lot
/// reaches for the app instead of the website. Location never leaves the
/// device as coordinates: it is reverse-geocoded to a street address here, and
/// only the address is sent.
@MainActor
final class NearMeLocator: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var resolvedAddress: String?
    @Published var isWorking = false

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() {
        isWorking = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            isWorking = false
        default:
            manager.requestLocation()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways:
                if isWorking { manager.requestLocation() }
            case .denied, .restricted:
                isWorking = false
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            defer { isWorking = false }
            guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else { return }
            resolvedAddress = Self.streetAddress(from: placemark)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in isWorking = false }
    }

    /// The server needs a full street address ending in city and two-letter
    /// state — a bare street geocodes to the wrong state.
    static func streetAddress(from placemark: CLPlacemark) -> String? {
        let street = [placemark.subThoroughfare, placemark.thoroughfare]
            .compactMap { $0 }.joined(separator: " ")
        let tail = [placemark.locality, placemark.administrativeArea]
            .compactMap { $0 }.joined(separator: ", ")
        let parts = [street, tail].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}
