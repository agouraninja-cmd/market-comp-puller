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
