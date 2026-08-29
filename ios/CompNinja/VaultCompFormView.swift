import SwiftUI
import CompNinjaKit

/// Add a comp, or correct one.
///
/// The web edits a comp cell by cell, like a spreadsheet. That does not port —
/// a phone has no Tab key and no room for seventeen columns — so this is a
/// form. What does port is the rule underneath: the SERVER validates, rejects
/// rather than guesses, and its refusal is written to be read by the broker.
/// Nothing here re-implements those rules; the only thing checked locally is
/// what would make the request pointless to send.
struct VaultCompFormView: View {
    enum Mode: Equatable {
        case add
        case edit(id: String)
    }

    let mode: Mode
    let onSaved: () -> Void

    @State private var draft: VaultDraft
    @State private var saving = false
    /// The SERVER's sentence, verbatim. It names the field and the value it
    /// refused ("price: \"1.2M\" is not a number"), which is more use than
    /// anything this screen could write about it.
    @State private var serverError: String?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    init(mode: Mode, draft: VaultDraft = VaultDraft(), onSaved: @escaping () -> Void) {
        self.mode = mode
        self.onSaved = onSaved
        _draft = State(initialValue: draft)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let serverError {
                    Section {
                        Label(serverError, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("The property") {
                    TextField("Address", text: $draft.address, axis: .vertical)
                        .textInputAutocapitalization(.words)
                    Picker("Type", selection: $draft.propertyType) {
                        Text("Choose").tag("")
                        ForEach(VaultDraft.propertyTypes, id: \.self) { Text($0).tag($0) }
                    }
                }

                Section("The deal") {
                    Picker("Deal", selection: $draft.deal) {
                        ForEach(VaultDraft.DealKind.allCases, id: \.self) {
                            Text($0.label).tag($0)
                        }
                    }
                    .pickerStyle(.segmented)

                    dateRow("Date", $draft.dealDate, unsetLabel: "Set the deal date")

                    numberField("Size (SF)", $draft.sizeSqft)

                    switch draft.deal {
                    case .sale:
                        numberField("Price", $draft.price)
                        TextField("Cap rate", text: $draft.capRate)
                    case .lease:
                        leaseFields
                    }
                }

                let specs = VaultDraft.specFields(for: draft.propertyType)
                if !specs.isEmpty {
                    Section("\(draft.propertyType) details") {
                        ForEach(specs) { field in
                            TextField(field.label, text: Binding(
                                get: { draft.spec(field.key) },
                                set: { draft.setSpec(field.key, $0) }))
                        }
                    }
                }

                Section("Anything else") {
                    TextField("Tenancy", text: $draft.tenancy)
                    numberField("Year built", $draft.yearBuilt)
                    TextField("Notes", text: $draft.notes, axis: .vertical)
                        .lineLimit(2...6)
                }

                if let problem = draft.blockingProblem {
                    Section {
                        Text(problem).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(mode == .add ? "Add a comp" : "Edit comp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!draft.canSave)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var leaseFields: some View {
        numberField("Rent per SF", $draft.rentPsf)

        // No default, and that is the whole point. $1.35/SF is an ordinary
        // monthly industrial rent in California and an impossible annual one,
        // so a pre-selected basis would store a figure twelve times wrong in a
        // broker's own records. The broker chooses or the save is refused.
        Picker("That rent is", selection: $draft.rentBasis) {
            Text("Choose").tag(nil as VaultDraft.RentBasis?)
            ForEach(VaultDraft.RentBasis.allCases, id: \.self) {
                Text($0.label).tag(Optional($0))
            }
        }

        Picker("Structure", selection: $draft.leaseType) {
            Text("Not stated").tag(nil as VaultDraft.LeaseType?)
            ForEach(VaultDraft.LeaseType.allCases, id: \.self) {
                Text($0.label).tag(Optional($0))
            }
        }

        dateRow("Lease expires", $draft.leaseExpiry, unsetLabel: "Add an expiry date")
        dateRow("Option notice by", $draft.optionNoticeDate, unsetLabel: "Add an option notice date")
    }

    /// A date that is not set shows NO date.
    ///
    /// A DatePicker bound to `value ?? Date()` renders today's date while the
    /// field is still empty, which reads as set — so a deal that closed in
    /// March gets saved as today, and a lease with no expiry claims one. The
    /// picker only appears once there is a real value to show.
    @ViewBuilder
    private func dateRow(_ label: String, _ value: Binding<Date?>,
                         unsetLabel: String) -> some View {
        if let date = value.wrappedValue {
            DatePicker(label,
                       selection: Binding(get: { date }, set: { value.wrappedValue = $0 }),
                       displayedComponents: .date)
        } else {
            Button(unsetLabel) { value.wrappedValue = Date() }
        }
    }

    private func numberField(_ label: String, _ text: Binding<String>) -> some View {
        TextField(label, text: text)
            .keyboardType(.decimalPad)
    }

    private func save() async {
        serverError = nil
        saving = true
        defer { saving = false }
        do {
            switch mode {
            case .add:
                try await model.api.addVaultComp(draft.body())
            case .edit(let id):
                try await model.api.updateVaultComp(id: id, fields: draft.body())
            }
            onSaved()
            dismiss()
        } catch let e as APIError {
            serverError = e.message
        } catch {
            serverError = "Couldn't save that. Please try again."
        }
    }
}
