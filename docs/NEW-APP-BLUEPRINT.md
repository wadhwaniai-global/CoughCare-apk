# Blueprint: Offline-First Field Data App with Audio Capture (Android / Tablet)

A product-agnostic template for building a React Native field app that works
fully offline, captures audio, and syncs records and files to a backend when
connectivity allows. Distilled from a shipped production app; every rule here
was paid for at least once. Replace the placeholder nouns (**record**,
**operator**, **organisation unit**) with the new product's vocabulary.

---

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Expo (managed workflow), React Native, TypeScript, Hermes | OTA updates via EAS Update: JS fixes reach devices in minutes without redistributing APKs |
| Local store | SQLite (`expo-sqlite`) | Real queries, migrations, transactions; the source of truth on device |
| Secrets | `expo-secure-store` (hardware-backed) | Tokens never touch plaintext storage |
| Files | `expo-file-system` | Audio lives as files on disk; the DB holds paths and metadata |
| Audio capture | A native PCM/WAV recorder module | Uncompressed, deterministic, no codec surprises |
| Layout | `react-native-safe-area-context` from day one | Tablets and notched devices break hardcoded paddings |

Tablet notes: design for landscape and a master/detail two-pane layout; a
single phone-style column wastes the screen. Assume WiFi-only devices, so
offline is the normal state, not the exception.

## 2. Code layering (enforce the boundaries)

```
screens/     UI only. No fetch, no SQL, no business rules.
hooks/       Form state, recording state.
services/    ApiService (HTTP), AuthService, DatabaseService (ALL SQL), SyncService.
utils/       Pure logic: validation, ID minting, completeness gate, build info,
             environment resolution. Unit-testable without a device.
```

Rule: **every record status transition goes through one pure function.** If
several screens can each set a status, they will disagree within a month.

## 3. Record life cycle

```
draft → complete → pending sync → synced
```

- **Completeness gate:** one predicate decides when a record may be uploaded.
  Records that fail it are visible in their own bucket ("needs X") and are
  structurally invisible to sync; sync never re-checks anything.
- **Manual sync** behind a confirmation ("records cannot be edited after
  sync"). Automatic sync-on-connectivity silently bypasses corrections.
- **Purge after sync:** once the server confirms, delete every sensitive field
  and every audio file from the device, keeping only what the local dashboard
  displays. A lost device then exposes only the unsynced backlog.
- Dashboard: counters per bucket in life-cycle order, one list page per
  bucket, a read-only "already synced" view for purged records.

## 4. Sync contract (agree with the backend before coding)

1. `POST /files/upload` per file → `{ file_id, checksum }`. **Persist the
   `file_id` on the local file row immediately.**
2. `POST /records { data, file_ids[] }`. The backend validates every
   `file_id`. Retries resend the stored `file_id`s, so a lost response never
   re-uploads or drops files from the payload.
3. Backend enforces a **unique index on the record ID** and answers `409` on
   a duplicate. Same-account resubmission with identical files returns the
   stored record (idempotent retry).
4. The client treats `409` as a hard per-record failure: the record stays
   pending, flagged visibly, with a "re-issue ID" action that re-mints the
   next free ID and keeps the previous one in the payload for traceability.
5. `data` is schemaless JSON. Tag every record with **build channel, build
   sequence, and update id** so analytics can reason about app versions.
6. Per-file metadata array inside `data` (type, duration, any on-device
   score, discarded flag), joined to the top-level file list by `file_id`.
7. Any endpoint that returns records to the device must return **only
   identifiers**, never content. Data flows one way.

## 5. Audio

- Capture at the **hardware-native sample rate** (48 kHz on modern Android),
  mono, 16-bit PCM WAV, from the `VOICE_RECOGNITION` source (spec-mandated:
  no automatic gain, no noise suppression). Downsample server-side if a model
  needs less; never let the device HAL downsample.
- Enforce minimum durations at submit and a **hard auto-stop cap** so a
  forgotten recorder cannot fill storage.
- Inline playback (play/pause, seek, elapsed time) for operator verification.
- If discarded takes have value, keep and upload them flagged; otherwise
  delete them on re-record so orphaned files never accumulate.
- Emulators cannot validate audio quality (clipped host-mic passthrough,
  flaky playback). Budget physical-device time early and repeatedly.

## 6. Identity and authentication

- **Record IDs must be unique offline across devices.** Pattern:
  `{org-unit codes}{operator code}{YYYYMMDD}{sequence}` where the operator
  code is **assigned by the backend per account** (unique, immutable, never
  reused) and the local sequence is **seeded from the server at login**
  (`GET /records?since=yesterday`, identifiers only). Refuse to mint an ID if
  the account has no code. A device-local counter alone will collide.
- JWT in secure storage, **fail closed**: if secure storage is unavailable,
  refuse to log in rather than fall back to plaintext.
- `401` → hard logout with all local data preserved; login requires
  connectivity. Decide session length with the field team.
- Scope local records per logged-in account (shared devices happen).

## 7. Environments and release

- **Two apps from one codebase**: a test app (own package id, a permanent
  TEST banner rendered in layout flow, not as an overlay) and the field app.
  Each is bound at build time to an OTA channel (`test`, `production`).
- **The app derives its backend URL from the channel at runtime.** One bundle
  is correct on every channel; there is no environment variable to forget at
  publish time. Keep an explicit override only for localhost development.
- Separate backend instances per environment with separate credentials and
  separate signing secrets; internal/test accounts never exist on production.
- Publish script with preflight checks (clean committed tree, typecheck) and a
  typed confirmation for the field channel. Build identity on screen:
  `version · #sequence · channel · update id`, where sequence = git commit
  count. Tag every synced record with the same values.
- Release signing with a real keystore held by one owner plus a password
  manager; `allowBackup=false`; cleartext traffic off; standard system
  certificate trust, **no pinning** (auto-renewing certificates).
- Developers need **no** publish rights for local work; publishing stays
  with one owner who verifies on their own device before shipping. The
  Expo org has no per-channel permissions, so this is the only real control.

## 8. Privacy defaults

- Decide on day one which fields **never leave the device** and show them in
  a "kept on this device" panel after sync. Pseudonymous server records are
  far easier to defend than a retroactive scrub.
- Write a **data dictionary** (every field, type, value domain, and a version
  table keyed on build sequence) before the dashboard team starts.
- Log the build sequence with every record so schema changes are traceable.

## 9. Testing discipline

- Verify every **screen a change touches**, not just the home screen; a
  one-line import mistake shipped once because only the dashboard was
  checked.
- Validate end to end on the real production-channel build before handover:
  login, a full record, sync, and a server-side read-back of identifiers.
- Seed the test backend with realistic fake data early so dashboards can be
  built against real shapes.

## 10. Platform gotchas (Expo / Metro / Hermes)

- Do **no work at module-initialization time** in configuration modules.
  Resolve lazily on first use and validate types: a `null` in app config
  round-tripped through the update manifest as `{}` and crashed URL
  resolution three publishes in a row.
- The updates channel manifest key must be exact
  (`expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`); a wrong
  key means OTAs silently never arrive. The tell is a blank channel in the
  build-info line.
- `EXPO_PUBLIC_*` variables are inlined by Metro and cached; always publish
  with `--clear-cache`.
- `expo prebuild` regenerates native files and will drop a hand-added signing
  configuration; document the re-apply steps and keep `android/` out of git
  or fully owned by config plugins, never half and half.
- OTA updates apply on the **second** launch after publish; devices always
  fetch the newest update, never a sequence of them. Keep the test channel
  head equal to the embedded bundle of any new test APK, or the app will
  "update" backward on first launch.
- Absolute-positioned overlays (banners) collide with headers on devices
  with tall status bars; put persistent chrome in layout flow.
- Hermes surfaces a missing import as `undefined is not a function` only at
  runtime; TypeScript may pass via a UMD global. Lint for unimported hooks.

## 11. Backend checklist to hand over

- Login returns a profile including the operator code.
- File upload returns `file_id` + `checksum`; record submit validates all
  `file_id`s; unique index + `409` on record ID; idempotent resubmission.
- Identifier-only listing endpoint with `?since=` for sequence seeding.
- Per-environment instances, credentials, and JWT secrets.
- Rate limiting on login, private object storage with no public URLs, TLS
  everywhere with auto-renewing certificates.
- A stated policy that operator codes are never reused.
