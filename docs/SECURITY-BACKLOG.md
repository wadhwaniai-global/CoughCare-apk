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
- [x] **Silent re-auth / 429 backoff — considered and REJECTED 2026-08-28.**
      The client stays maximally conservative: 401 → hard logout with all
      unsynced data preserved, no automatic retries anywhere, sync is
      manual-only. Token revocation server-side works against this as-is
      (costs the collector a manual re-login). Decision is final unless the
      field reports friction.
- [x] **Session-expiry policy — decided 2026-08-21; app behaviour fixed and lifetime changed 2026-10-01.**
      No refresh tokens; the app is logged out only by a server 401, so
      offline collection is unaffected by expiry. Rishi confirmed this is the
      data collectors' preferred state, and reconfirmed it on 2026-10-01.
      **Lifetime:** app logins last 48 h from the backend release of
      2026-10 (24 h before); dashboard logins stay at 24 h. Set in
      cough_backend as `APP_TOKEN_HOURS` / `DASHBOARD_TOKEN_HOURS`, told
      apart by the dashboard's hostname, and applied to new logins only.
      **Field friction, reported 2026-10 (Nana Ama):** the app stayed on its
      main screens while every sync failed ("Not logged in") until the
      collector logged out and back in. The policy was never fully built: a
      401 cleared the stored login but nothing told the screens (no listener
      since login was added, 2026-01), and from d217eed (2026-09-04) the
      launch-time participant-ID seed made the first online launch more than
      24 h after login drop the session silently.
      **Behaviour from seq 115:** a 401 on any request (launch-time seed,
      sync, ID re-issue) ends the session in the app: the Login screen opens
      with an expiry notice and the username filled in. On New Participant,
      and while test results are being edited, it waits until the collector
      leaves that screen, so nothing typed is lost. Sync stops at the first
      401, a sync run never continues under another account (shared phones),
      and no request is sent without a token. The server learns of an expiry
      only at launch with internet and at sync; a check on every return to
      the app was considered and declined by Rishi on 2026-10-01 (it would
      interrupt interviews whenever the screen wakes).
      **Offline notice (seq 115):** once the login has run out by the phone's
      clock, the Dashboard says "Session expired: relogin before next sync".
      The phone reads the expiry from the token itself and, at login, shifts
      it by the gap between the server's clock (the response's Date header)
      and its own, so the notice comes on time even on a phone whose clock is
      off, unless the clock is changed after login. It never logs anyone out
      and collection carries on.
      Known accepted edge, now somewhat more likely because the launch-time
      check also logs out: a 401-forced logout while subsequently offline
      blocks app access (not data) until the collector finds signal to
      re-login.

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
