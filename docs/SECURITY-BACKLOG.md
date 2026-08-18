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
- [ ] **Fail closed when SecureStore is unavailable.** AuthService currently
      falls back to plaintext AsyncStorage for tokens if SecureStore errors.
      Prefer refusing to persist the session over storing it in plaintext.
- [ ] **Session-expiry policy.** `refreshToken()` is an unimplemented TODO, so
      an expired session forces an online re-login — a field worker offline
      with an expired token cannot collect data. Needs a deliberate decision
      with the backend team (longer sessions, refresh endpoint, or offline
      grace period).

## Batch 2 — next APK distribution (native/manifest; one reinstall event, bundle everything)

- [ ] **Sign with a real, secret keystore.** Release builds currently use the
      standard RN debug keystore (publicly known password), so anyone can craft
      an APK that installs over the field app. Generate a proper keystore,
      store it outside git (see `.gitignore`: `*.jks` / `*.keystore`), document
      recovery. NOTE: this changes the app signature — every device must
      uninstall/reinstall once. That is why it waits for an APK event.
- [ ] **`android:allowBackup="false"`** — patient data should not be
      extractable via device backup.
- [ ] **Remove `usesCleartextTraffic="true"`** — all endpoints are HTTPS; the
      flag only preserves a downgrade path.
- [ ] Consider **expo-updates code signing** so OTA bundles are verifiable
      against a key we hold, not just the Expo account.

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
