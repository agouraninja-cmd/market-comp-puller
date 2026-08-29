import SwiftUI
import MapKit
import CompNinjaKit

/// A real MapKit map, not the website's map in a web view. Tapping a pin opens
/// the comp; the subject property is marked separately so the reader can see
/// how far the comps actually are.
struct CompMapView: View {
    let report: Report
    let comps: [Comp]

    @State private var selection: String?

    var body: some View {
        Map(initialPosition: .region(region), selection: $selection) {
            if let subject = subjectCoordinate {
                Marker("Subject property", systemImage: "house.fill", coordinate: subject)
                    .tint(.red)
            }
            ForEach(comps) { comp in
                if let coordinate = coordinate(comp) {
                    Marker(comp.pricePerSqft.value ?? comp.priceOrRate.value ?? "Comp",
                           coordinate: coordinate)
                        .tint(pinColor(comp))
                        .tag(comp.id)
                }
            }
        }
        .mapControls { MapUserLocationButton(); MapCompass() }
    }

    private var subjectCoordinate: CLLocationCoordinate2D? {
        guard let lat = report.subjectLat.number, let lng = report.subjectLng.number else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    private func coordinate(_ comp: Comp) -> CLLocationCoordinate2D? {
        guard let lat = comp.lat.number, let lng = comp.lng.number else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    /// Framed around everything that is actually plotted, with a floor on the
    /// span so a single comp does not open zoomed into a rooftop.
    private var region: MKCoordinateRegion {
        var points = comps.compactMap(coordinate)
        if let subject = subjectCoordinate { points.append(subject) }
        guard !points.isEmpty else {
            return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 39.8, longitude: -98.6),
                                      span: MKCoordinateSpan(latitudeDelta: 40, longitudeDelta: 40))
        }
        let lats = points.map(\.latitude), lngs = points.map(\.longitude)
        let center = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2,
                                            longitude: (lngs.min()! + lngs.max()!) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max(0.02, (lats.max()! - lats.min()!) * 1.4),
            longitudeDelta: max(0.02, (lngs.max()! - lngs.min()!) * 1.4))
        return MKCoordinateRegion(center: center, span: span)
    }

    /// Pin colour mirrors the confidence badge, so the map and the list agree
    /// about what a comp is. A vault comp is purple like its badge, never the
    /// green that means a broker vouched for it in the public records.
    private func pinColor(_ comp: Comp) -> Color {
        switch SourceConfidence(comp: comp) {
        case .verified: return .green
        case .brokerVault: return .purple
        default: return .blue
        }
    }
}
