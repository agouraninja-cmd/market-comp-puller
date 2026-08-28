# Apple signing & notarization — the once-Apple-approves checklist

**Status (2026-08-28, evening):** APPROVED. The Apple Developer Program
enrollment for COMPNINJA LLC is live (enrolled as Organization, renewal
2027-08-28). **Team ID: `ZRFN5C3645`** (Membership page; not a secret).
Owner steps 1–2 below are DONE: the App Store Connect invite went to
**owenkbarnes@icloud.com** the same day (role Admin, plus Access to Cloud
Managed Developer ID Certificate) — it shows as pending until Owen accepts
it from his inbox. (An invite first went to okb336@gmail.com by mistake
and was cancelled minutes later; if that address ever shows up again in
Users and Access, it is stale.) What remains is the dev side (steps 3–7). Until a signed
release actually ships, installers stay unsigned and `/download`'s
first-launch warning copy stays true — do not soften that copy early.

The repo side is **already wired and dormant** (this doc's commit):
`desktop-app/package.json` declares `hardenedRuntime` + `notarize: true`,
and `.github/workflows/desktop-release.yml`'s Build step reads five repo
secrets that don't exist yet. With no secrets, builds are byte-for-byte the
unsigned ones — nothing changes until the secrets are added.

## Owner steps, the day the approval email arrives

1. **App Store Connect → Users and Access → invite `owenkbarnes@icloud.com`
   as Admin.** Admin rather than App Manager, so certificates can be managed
   without a round trip each year (they expire annually). This is Owen
   Barnes's Apple ID; his Google account (okb336@gmail.com) is the one on
   Search Console and `PRO_AUDIENCE`, but Apple invites go to an Apple ID.
2. **Send the Team ID.** It's on the Membership page of the developer
   account. Not a secret — it goes in a repo secret only for tidiness.

## Dev steps, once invited

3. In the developer account, create a **Developer ID Application**
   certificate (that exact kind — it's the one for apps distributed
   *outside* the Mac App Store, which is what the DMG is). Export it from
   Keychain as a password-protected `.p12`, then base64 the file.
4. Generate an **app-specific password** for the Apple ID at
   account.apple.com → Sign-In and Security → App-Specific Passwords
   (notarization refuses regular passwords).
5. Add five GitHub repo secrets (repo → Settings → Secrets and variables →
   Actions):

   | Secret | Value |
   |---|---|
   | `MAC_CSC_LINK` | base64 of the `.p12` |
   | `MAC_CSC_KEY_PASSWORD` | the `.p12` export password |
   | `APPLE_ID` | the Apple ID email that was invited (owenkbarnes@icloud.com) |
   | `APPLE_APP_SPECIFIC_PASSWORD` | from step 4 |
   | `APPLE_TEAM_ID` | from step 2 |

6. Cut a release: `git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`.
   Verify before believing: download the released `CompNinja.dmg` on a Mac
   and run `spctl -a -vv /Applications/CompNinja.app` — it must say
   `accepted` / `source=Notarized Developer ID`. A green Actions run alone
   proves the build finished, not that Gatekeeper is satisfied.
7. **Only after step 6 passes**, update `/download`'s first-launch note in
   `server.js` (`renderDownloadPageHTML`): the Mac half of the warning
   ("Mac may say the developer is unverified") becomes untrue and should
   go; the **Windows SmartScreen half stays** — Windows code signing is a
   separate certificate purchase the Apple enrollment does not cover.
   `test/download-page.test.js` covers that page; run `npm test` after.

## Traps

- **Empty secrets are safe; wrong ones are not.** The workflow treats an
  absent secret as "stay unsigned". A *present but wrong* `MAC_CSC_LINK`
  fails only the mac job (fail-fast is off), so Windows/Linux assets still
  attach — the release is partial, not broken.
- `CSC_LINK` is deliberately scoped to the mac matrix job in the workflow:
  electron-builder reads the same variable for Windows signing, and a mac
  `.p12` in the Windows job would fail that build.
- Certificates expire annually; when the mac job starts failing on signing
  a year from now, the fix is a fresh certificate + updated `MAC_CSC_LINK`,
  not a workflow change.
