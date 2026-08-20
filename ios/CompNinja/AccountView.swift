import SwiftUI
import CompNinjaKit

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// The server's own sentence when the guest search cap sent us here.
    var prompt: String?

    @State private var mode: Mode = .logIn
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmingDelete = false
    @State private var deleting = false

    enum Mode { case logIn, signUp }

    var body: some View {
        Group {
            if let account = model.account {
                signedIn(account)
            } else {
                signedOut
            }
        }
        .navigationTitle("Account")
    }

    private func signedIn(_ account: Account) -> some View {
        List {
            Section {
                LabeledContent("Signed in as", value: account.email ?? "—")
                if let name = account.name, !name.isEmpty {
                    LabeledContent("Name", value: name)
                }
                LabeledContent("Plan", value: account.isPro ? "Pro" : "Free")
            } footer: {
                // No purchase UI and no link out to one. App Store guideline
                // 3.1.3(b) lets an app serve a subscription bought elsewhere
                // only if it neither sells nor advertises the purchase — see
                // ios/README.md. Do not add a button here.
                if !account.isPro {
                    Text("Pro is managed on your CompNinja account.")
                }
            }

            Section {
                Button("Sign out", role: .destructive) {
                    Task { await model.signOut() }
                }
            }

            // Required by App Store guideline 5.1.1(v): an app that creates
            // accounts must let a person delete theirs from inside the app —
            // not via a link out to the website, not by emailing support. It
            // also has to be findable, which is why it sits here on the
            // account screen rather than behind a submenu.
            Section {
                Button("Delete account", role: .destructive) {
                    confirmingDelete = true
                }
                .disabled(deleting)
            } footer: {
                Text("Permanently deletes your account, your saved properties and your watchlist, and removes every report saved on this iPhone. This cannot be undone.")
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
        }
        .alert("Delete your account?", isPresented: $confirmingDelete) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { runDelete() }
        } message: {
            Text("Your account, saved properties and watchlist are deleted from CompNinja, and the reports saved on this iPhone are removed. This cannot be undone.")
        }
    }

    private func runDelete() {
        deleting = true
        errorMessage = nil
        Task {
            defer { deleting = false }
            do {
                try await model.deleteAccount()
            } catch {
                // The account still exists and nothing local was touched —
                // deleteAccount wipes this device only after the server
                // confirms, so a failed call is safe to simply report.
                errorMessage = error.localizedDescription
            }
        }
    }

    private var signedOut: some View {
        Form {
            if let prompt {
                Section { Text(prompt) }
            }

            Section {
                Picker("", selection: $mode) {
                    Text("Log in").tag(Mode.logIn)
                    Text("Create account").tag(Mode.signUp)
                }
                .pickerStyle(.segmented)

                if mode == .signUp {
                    TextField("Name", text: $name).textContentType(.name)
                }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(mode == .signUp ? .newPassword : .password)
            } footer: {
                if mode == .signUp { Text("Free account. No card needed.") }
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }

            Section {
                Button {
                    submit()
                } label: {
                    Text(mode == .logIn ? "Log in" : "Create account")
                        .frame(maxWidth: .infinity)
                }
                .disabled(busy || email.isEmpty || password.isEmpty)
            }
        }
    }

    private func submit() {
        busy = true
        errorMessage = nil
        Task {
            defer { busy = false }
            do {
                let account = mode == .logIn
                    ? try await model.api.logIn(email: email, password: password)
                    : try await model.api.signUp(email: email, password: password, name: name)
                model.account = account
                model.signInPrompt = nil
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
