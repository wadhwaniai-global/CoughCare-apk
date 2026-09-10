# Frontend Data Dictionary

Everything the CoughCare app can send to the backend, with types and value
domains, generated from the app source (authoritative files:
`src/services/SyncService.ts` payload, section components for value domains).
Current as of bundle seq **#75** (2026-09-02). For dashboards, see
**Version notes** at the bottom — records from older bundles differ.

A synced screening becomes one `forms` row: server-side `form_id`, `user_id`
(from the auth token), `created_at`, `file_references`, plus the client-built
`form_data` below. Audio lands in S3 via `/files/upload` (one file per
recording, WAV).

## form_data — identity & demographics

| Field | Type | Values / format |
|---|---|---|
| `participant_id` | string | `GHA-{region 2}{facility 3}{collector 4}{YYYYMMDD}{seq 4}` (25 chars) — pseudonymous study ID, the only participant linkage. The collector code (backend-assigned per account; data collectors `0001` upward, internal accounts `9999` downward) makes it unique across devices and flags internal records; records minted before codes existed use the legacy 17-digit form `GHA-{region}{facility}{YYYYMMDD}{seq}` and CAN collide across collectors at one facility on one day (key on `form_id` for those). |
| `previous_participant_id` | string (absent otherwise) | Present only when the app re-issued the ID after the server rejected the original as a duplicate (409). Same 25-char format; lets a re-issued record be traced to the ID that may already be on paper. |
| `age` | integer | years |
| `gender` | string | `Male` \| `Female` \| `Transgender` |
| `date_of_screening` | string | `DD/MM/YYYY` |
| `region`, `district`, `facility` | string | from the collector's profile (`TEST` for internal accounts) |
| `community` | string \| null | optional free text |
| `data_collector_name` | string | collector's profile name (staff, not participant) |
| `consent_obtained` | boolean | always true on synced records (required to submit) |

## form_data — health history

| Field | Type | Values |
|---|---|---|
| `diabetes_status` | string | `Diabetic` \| `Non-Diabetic` \| `Unknown` |
| `hiv_status` | string | `Positive` \| `Negative` \| `Unknown` \| `Prefer not to say` |
| `covid_status` | string | `Current infection` \| `Previously infected` \| `No` \| `Unknown` |
| `tobacco_use` | boolean | |
| `tobacco_duration` | string \| null | `< 6 months` \| `6 months - 1 year` \| `1 - 3 years` \| `3 - 5 years` \| `> 5 years` |
| `alcohol_use` | boolean | true when frequency is Yes or Occasional |
| `alcohol_use_frequency` | string \| null | `Yes` \| `Occasional` \| `No` |
| `alcohol_duration` | string \| null | same buckets as tobacco_duration |
| `previous_tb` | boolean | |
| `last_tb_year` | string \| null | 4-digit year |
| `tb_treatment_completed` | string \| null | `Yes` \| `No` \| `Don't remember` |
| `recurring_tb` | boolean \| null | |

## form_data — symptoms

`symptoms` is an object with these 8 fixed keys; each value is
`{ present: boolean | null, duration: string }` where duration is days as
free-numeric text (empty when not present):

`fever`, `cough`, `weightLoss`, `bloodInSputum`, `chestPain`,
`lossOfAppetite`, `shortnessOfBreath`, `nightSweats`

## form_data — TB diagnosis

Synced records always have a complete diagnosis (the app blocks sync
otherwise): either `test_done = "No"`, or `test_done = "Yes"` with a type and
a non-Pending result.

| Field | Type | Values |
|---|---|---|
| `test_done` | string | `Yes` \| `No` \| `Not yet` (Not yet never appears on synced records) |
| `test_type` | string \| null | `GeneXpert` \| `Smear Microscopy` \| `Culture` \| `Chest X-ray` (main form) \| `Chest X-Ray (CXR)` \| `Other` (record editor) — two editors, two spellings of X-ray; normalize |
| `test_result` | string \| null | `Positive` \| `Negative` \| `Indeterminate` (main form) \| `Inconclusive` \| `Not done` (record editor) \| `Pending` (never on synced records) |
| `test_date_collection`, `test_date_result` | string \| null | `DD/MM/YYYY` (main form) **or** `YYYY-MM-DD` (record editor) — mixed formats, normalize when displaying |
| `test_site` | string \| null | free text |
| `test_notes` | string \| null | free text |

## form_data — ML analysis

`analysis_result` (object | null): the highest-confidence cough analysis among
the kept recordings.

| Field | Type | Notes |
|---|---|---|
| `coughDetected` | boolean | `confidence > threshold_used` |
| `tbDetected` | boolean | always false (Phase 1: threshold deliberately unreachable) |
| `confidence` / `file_probability` | number 0–1 | whole-recording cough probability |
| `threshold_used` | number | **0.4758** with the CED single-graph detector (test channel #92+); 0.45 with the earlier two-model pipeline |
| `segment_probabilities` | number[] | **two-model pipeline only** (per-2s-segment scores); absent, not null, once the CED detector ships |
| `num_segments` | integer | **two-model pipeline only**; absent once the CED detector ships |
| `message` | string | display text |
| `mode` | string | `CLIENT_SIDE_ONNX` |

Detector history: up to the 2.0.0 handover build the app ran a two-graph
pipeline (mel preprocessing + detector, 2 s windows pooled to a bag score,
threshold 0.45). The CED detector (CED-tiny + LoRA, int8, single graph over a
60 s buffer with a real-length mask, val-selected threshold 0.4758) is under
test on the `test` channel from #92; its release seq on `main` is TBD and will
be added to the version notes below.

## form_data — per-recording metadata

`recordings` (array): one entry per uploaded file, kept **and rejected**.
`file_id` joins against top-level `file_ids` / `file_references`.

| Field | Type | Values |
|---|---|---|
| `file_id` | string | server file id |
| `type` | string | `cough_1` \| `cough_2` \| `cough_3` \| `background` |
| `rejected` | boolean | true = discarded take (re-record), uploaded for model research |
| `confidence` | number 0–1 \| null | that take's own score; null for `background` (never scored) |
| `duration` | number \| null | seconds |
| `audio_source` | string \| null | `MIC` \| `VOICE_RECOGNITION`: the Android microphone path used for this take. Fleet policy since 2026-09-10 is `MIC` on every device (uniform training data; VOICE_RECOGNITION was found to mangle cough audio on the Galaxy A07). Null on takes recorded before this field existed; `VOICE_RECOGNITION` only on pre-policy takes. |
| `quality` | object \| null | On-device signal metrics for this take, computed once from the PCM right after recording (schema below). Null when the app could not compute them (never blocks the take). Absent on records from seq < 99. |

### `recordings[].quality` object

Purpose: catch a device model whose microphone path misbehaves (gain control,
clipping, an unusually quiet path, or the record-start dead time seen on the
Galaxy A07) from the metadata alone, grouped by `device_model` / `device_build`.
All levels are dBFS (0 = full scale, more negative = quieter), rounded to 0.1 dB.

| Field | Type | Meaning |
|---|---|---|
| `v` | 1 | schema version of this object |
| `sample_rate` | number | Hz, from the WAV header (48000 on current builds) |
| `file_seconds` | number | audio length implied by the file |
| `wall_seconds` | number \| null | how long the recorder actually ran. `file_seconds` noticeably above `wall_seconds` means the platform padded zeros while the input started (A07: 6 s take gave 9 to 31 s files) |
| `leading_zero_seconds` | number | exact-zero samples at the start of the file. This is the record-start dead time: any cough made during it was NOT captured. A07 MIC: 0 to 1.3 s; A07 VOICE_RECOGNITION: up to 5 s |
| `interior_zero_seconds` | number | total length of exact-zero runs of 20 ms or more after the leading block (dropouts / buffer underruns; 0 on a healthy device) |
| `peak_dbfs` | number \| null | loudest sample. Around -6 for a close cough on the A07; 0 means saturation |
| `rms_dbfs` | number \| null | average level over the real audio (leading zeros excluded) |
| `clipped_ratio` | number | fraction of real-audio samples at full scale. 0 on a healthy path; sustained values above about 0.001 mean the path is too hot |
| `noise_floor_dbfs` | number \| null | 10th percentile of 20 ms frame levels over the real audio (exact-zero dropout frames excluded), i.e. the quiet-frame level. A07 MIC: -70 to -75 in a quiet room; A07 VOICE_RECOGNITION: -43 (its gain control lifts the floor). A floor far above the fleet median with a normal peak suggests gain control or noise pumping; a peak AND floor both far below suggest an unamplified path |
| `floor_pre_dbfs` | number \| null | noise floor of the first quarter of the real audio |
| `floor_post_dbfs` | number \| null | noise floor of the last quarter. A floor that moves by many dB within one take is the signature of automatic gain control / compression (the processing that made VOICE_RECOGNITION unusable) |

Null floors: the take had under 0.5 s of real audio. Values are per take;
`background` takes give the cleanest floor read (no cough energy), cough takes
give the peak / clipping read.

Suggested dashboard checks (per `device_model`, then per `device_build`):
median and spread of `leading_zero_seconds`, `noise_floor_dbfs`,
`peak_dbfs`, share of takes with `clipped_ratio > 0.001`, share with
`interior_zero_seconds > 0`, and `|floor_post_dbfs - floor_pre_dbfs|`. A model
that stands out on any of these is the one to inspect before trusting its
recordings as training data.

## form_data — build provenance

| Field | Type | Notes |
|---|---|---|
| `device_model` | string | Android model string, e.g. `SM-A075F` (not PII). Use with `recordings[].audio_source` for per-model score distributions and fleet composition. |
| `device_build` | string | Android build fingerprint, e.g. `samsung/a07insxx/a07:16/BP2A.250705.008/A075FXXS3BYH2:user/release-keys`. Pins the firmware, and so the audio HAL tuning: two phones with the same `device_model` can differ here. Contains no device serial. Absent on records from seq < 99. |
| `app_channel` | string | `production` (field) \| `test` (tester sandbox) \| `preview` (retired pre-cutover) \| `development` |
| `app_bundle_seq` | string | monotonic build number (git commit count) — the key for the version notes below |
| `app_update_id` | string | 8-char OTA update id or `embedded` |

## Audio files (S3)

WAV, mono, 16-bit. **48 kHz** since seq #67 (16 kHz before; 48 kHz on Galaxy
A07 between #18bc227 and #67). 5–60 s (60 s hard cap since #51-era). Rejected
takes are full-fidelity uploads. Object keys contain no participant data;
linkage is only via the database.

## Deliberately NEVER sent (on-device only)

- Participant **full name** (never truly collected — duplicates the ID)
- Participant **address** (free text)
- Participant **mobile number**
- **GPS coordinates** of the screening

These live only on the enrolling collector's device and survive the
post-sync purge there. Server-side records are pseudonymous.

## Version notes for dashboards (filter by `app_bundle_seq`)

| Records from | Differences |
|---|---|
| seq < ~52 or missing | no `app_channel`/`app_bundle_seq`/`app_update_id` (all such records are field-era test data on the old backend) |
| seq < 55 | no `recordings[]` array; only kept files uploaded; no per-file confidence |
| seq < 65 | payload includes `full_name` and `address` |
| seq < 68 | payload includes `mobile_number`, `gps_latitude`, `gps_longitude` |
| seq < 67 | audio is 16 kHz |
| seq < 99 | no `recordings[].quality` object and no `device_build` |
| CED detector builds (test channel #92+; main seq TBD) | `analysis_result` has no `segment_probabilities`/`num_segments`; `threshold_used` = 0.4758; per-recording `confidence` values come from a different model and are not comparable with earlier scores |

**Exclude internal data** (backend guidance, 2026-08): drop forms where
`form_data.app_channel == "test"` OR the submitting user's profile
`user_type` ∈ (Tester, Admin). On the new split backends, the production
database should only ever contain `app_channel == "production"` rows anyway.
