# Security backlog

Agreed 2026-08-18. Two batches, matched to how each fix can be delivered
(see docs/OTA.md for what OTA can and cannot ship).

## Batch 1 — next OTA round (pure JS, after the current fixes are verified on `preview`)

- [ ] **Purge synced records from the device.** The local SQLite database holds
      HIV status, TB history, GPS, and phone numbers indefinitely. Once a
      record is `synced`, it no longer needs to live on the phone; deleting (or
      redacting) synced records shrinks the exposure window of a lost or
      compromised device to days instead of the study's lifetime. Decide the
      retention window with the study team (e.g. keep 7 days for reference,
      then purge).
- [x] **Fail closed when SecureStore is unavailable** (done 2026-08-19).
      Native token storage no longer falls back to plaintext AsyncStorage;
      deletes also clear any plaintext copies left by older builds.
- [ ] **Session-expiry policy.** `refreshToken()` is an unimplemented TODO, so
      an expired session forces an online re-login — a field worker offline
      with an expired token cannot collect data. Needs a deliberate decision
      with the backend team (longer sessions, refresh endpoint, or offline
      grace period).

## Batch 2 — DONE 2026-08-19 (shipped in the v1.0.2 uninstall/reinstall event, pre-launch)

- [x] **Sign with a real, secret keystore.** Releases are now signed by
      `~/coughcare-release-keys/coughcare-release.jks` (random password in
      `keystore.properties` alongside it; folder must be backed up to the org
      password manager — losing it means every future APK forces
      uninstall/reinstall). The build fails loudly if the keystore folder is
      missing. Debug builds still use the debug keystore.
- [x] **`android:allowBackup="false"`** — in the manifest and in
      app.config.js expo-build-properties so prebuilds regenerate it.
- [x] **Cleartext traffic disabled in release** — debug keeps it (Metro over
      HTTP) via android/app/src/debug/AndroidManifest.xml `tools:replace`.
- [ ] **expo-updates code signing** — deliberately deferred: it adds a second
      never-lose key, and this project just lost one keystore to personnel
      churn. Expo-account 2FA (enabled) covers the primary vector. Revisit
      when key custody has an org-level home.

## Done / standing

- [x] Expo project re-homed; publishes require a clean committed tree; the
      field channel (`preview`) requires interactive confirmation.
- [x] Per-user record scoping on shared devices (2026-08-16).
- [x] Orphaned `coughcare.jks` and `login_expo.bat` (which contained a
      plaintext Expo password) removed from the repo head (2026-08-18).
      **Both remain in git history** — the `jainrishi601` Expo password must be
      rotated; purging history needs a coordinated force-push if ever desired.
- [ ] **Enable 2FA on the `rishi-waig13` Expo account** — the account can push
      code to every field device; do this in the Expo dashboard today.
