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

    /// Group a plain count so it can be read at a glance.
    ///
    /// Same inconsistency as `money`, in a different field: real reports send
    /// `size_sqft` as "12194" and "825000", while the shipped sample sends
    /// "86,400". Both are real. "825000 SF" in a table cell is a number you
    /// have to count digits on.
    ///
    /// Only a string that is ENTIRELY digits is touched. Anything already
    /// grouped, or carrying a unit or a range, is returned untouched rather
    /// than re-parsed.
    ///
    /// Deliberately NOT applied to `year_built`, which is also a bare number:
    /// 1900 is a year, and "1,900" would be wrong. That is a call site rule,
    /// not something this function can see, which is why it is written down
    /// here and pinned by a test.
    public static func count(_ value: LooseString) -> String? {
        guard let raw = value.value else { return nil }
        guard raw.allSatisfy(\.isNumber), raw.count > 3 else { return raw }

        // Commas, not the device locale. Reports mix grouped and ungrouped
        // values in one table, and a German phone rendering our "86,400" next
        // to its own "12.194" would be worse than either alone.
        var grouped = ""
        for (offset, character) in raw.reversed().enumerated() {
            if offset > 0, offset % 3 == 0 { grouped.append(",") }
            grouped.append(character)
        }
        return String(grouped.reversed())
    }

    /// The same, for a figure that may legitimately be absent.
    public static func money(_ value: LooseString?, currency: LooseString = LooseString(nil)) -> String? {
        guard let value else { return nil }
        return money(value, currency: currency)
    }
}
