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
| `participant_id` | string | `GHA-{region}{facility}{YYYYMMDD}{seq}` — pseudonymous study ID, unique, the only participant linkage |
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
| `test_type` | string \| null | `GeneXpert` \| `Smear Microscopy` \| `Culture` \| `Chest X-ray` |
| `test_result` | string \| null | `Positive` \| `Negative` \| `Indeterminate` \| `Inconclusive` \| `Pending` (Inconclusive comes from one editor's mapping; Pending never appears on synced records) |
| `test_date_collection`, `test_date_result` | string \| null | `DD/MM/YYYY` (main form) **or** `YYYY-MM-DD` (record editor) — mixed formats, normalize when displaying |
| `test_site` | string \| null | free text |
| `test_notes` | string \| null | free text |

## form_data — ML analysis

`analysis_result` (object | null): the highest-confidence cough analysis among
the kept recordings.

| Field | Type | Notes |
|---|---|---|
| `coughDetected` | boolean | `confidence > 0.45` |
| `tbDetected` | boolean | always false (Phase 1: threshold deliberately unreachable) |
| `confidence` / `file_probability` | number 0–1 | whole-recording bag probability |
| `segment_probabilities` | number[] | per-2s-segment scores |
| `num_segments` | integer | up to 32 |
| `threshold_used` | number | 0.45 |
| `message` | string | display text |
| `mode` | string | `CLIENT_SIDE_ONNX` |

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

## form_data — build provenance

| Field | Type | Notes |
|---|---|---|
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

**Exclude internal data** (backend guidance, 2026-08): drop forms where
`form_data.app_channel == "test"` OR the submitting user's profile
`user_type` ∈ (Tester, Admin). On the new split backends, the production
database should only ever contain `app_channel == "production"` rows anyway.
