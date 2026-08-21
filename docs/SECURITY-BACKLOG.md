# Security backlog

Agreed 2026-08-18. Two batches, matched to how each fix can be delivered
(see docs/OTA.md for what OTA can and cannot ship).

## Batch 1 — next OTA round (pure JS, after the current fixes are verified on `preview`)

- [x] **Purge synced records from the device** (done 2026-08-21, stronger
      than originally planned: immediate, not a retention window). After a
      confirmed sync the device keeps only dashboard-display fields (id,
      mobile, region, date, status, confidence) and deletes all form answers
      and every audio file, rejected takes included. A catch-up purge at
      startup handles records synced before this existed. Exposure window of
      a lost device is now only the unsynced backlog.
- [x] **Fail closed when SecureStore is unavailable** (done 2026-08-19).
      Native token storage no longer falls back to plaintext AsyncStorage;
      deletes also clear any plaintext copies left by older builds.
- [x] **Session-expiry policy — decided 2026-08-21: keep current behavior.**
      24h tokens, no refresh; the app only logs out on a server 401 (i.e. at
      sync time), offline collection is unaffected by expiry. Rishi confirmed
      this is the data collectors' preferred state. Known accepted edge: a
      401-forced logout while subsequently offline blocks app access (not
      data) until the collector finds signal to re-login. Revisit only if the
      field reports friction.

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
- [x] **2FA on the `rishi-waig13` Expo account** — enabled 2026-08-19.
