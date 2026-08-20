import Foundation

public enum ReportFormat {

    /// Give a money figure its currency marker, if it does not already have one.
    ///
    /// The server does not normalize this. Three real reports came back with
    /// `avg_price_per_sqft` as "81", "122" and "$453" — the model writes what
    /// it writes. On the website that is survivable, because the figure sits
    /// in a labelled row ("Market Avg $/SF: 81") and the label carries the
    /// unit. In the app it is the value hero, a single large number, where a
    /// bare "81" reads as something broken.
    ///
    /// Anything that already starts with a symbol or a currency code is left
    /// exactly as it is, so "$113 (sale comps)" keeps its qualifier and
    /// nothing is ever double-prefixed.
    public static func money(_ value: LooseString, currency: LooseString = LooseString(nil)) -> String? {
        guard let raw = value.value else { return nil }
        guard let first = raw.first else { return nil }
        // A leading digit (or a sign, or a bare decimal) means no marker yet.
        guard first.isNumber || first == "-" || first == "." else { return raw }

        let code = (currency.value ?? "USD").uppercased()
        // A non-USD report quotes every figure in its own currency, and the
        // code is the honest marker — writing "$" on a CAD figure would state
        // something the report does not.
        return code == "USD" ? "$" + raw : "\(code) \(raw)"
    }

    /// The same, for a figure that may legitimately be absent.
    public static func money(_ value: LooseString?, currency: LooseString = LooseString(nil)) -> String? {
        guard let value else { return nil }
        return money(value, currency: currency)
    }
}
