# OTA updates (EAS Update) — runbook

How to ship a JavaScript-only change to installed apps without redistributing a
374 MB APK, and how to prove it landed.

Everything here was verified end-to-end on 2026-08-15 against the
`feature/ghana-release` branch.

---

## 0. Quickstart — first OTA in five minutes

For a new dev who has just cloned the repo.

```bash
git clone https://github.com/wadhwaniai-global/CoughCare-apk.git
cd CoughCare-apk
git checkout feature/ghana-release
npm install

npx eas-cli login          # once per machine, see §3
npm run ota:status         # what is currently live

# ...make your JS change, then:
git commit -am "Fix the thing"
npm run ota:preview
```

`npm run ota:preview` runs every preflight check for you — logged in, tree clean,
typecheck not regressed, runtimeVersion read from `app.config.js` — then
publishes and prints how to verify. It refuses to publish rather than doing
something you'd have to roll back.

| Command | Does |
|---|---|
| `npm run ota:status` | Shows what is live on each channel |
| `npm run ota:preview` | Publishes to the testing team |
| `npm run ota:production` | Publishes to Play Store users |
| `npm run ota:preview -- "custom message"` | Same, with your own message (defaults to the last commit subject) |

### Test APK

The build the OTA setup targets, already verified receiving updates:

```
build-1786525949167.apk        # runtimeVersion 1.1.0, channel preview
```

Install it with `adb install -r build-1786525949167.apk`. Its embedded JS is from
`d47e6e6`; anything published to `preview` since then arrives over the air, so
after two launches it is current with the branch.

There is **no** production-channel APK yet — the `production` profile emits an
AAB, which cannot be sideloaded. To make one for testing:

```bash
eas build --platform android --profile production-apk --local
```

---

## 1. What OTA can and cannot ship

| Change | OTA? |
|---|---|
| JS/TS: screens, validation, business logic, styles | ✅ Yes |
| Bundled assets: images, fonts, the `.onnx` models | ✅ Yes |
| New native module (`expo-location`, `react-native-audio-record`, …) | ❌ New binary |
| Anything in `app.config.js` `plugins`, `permissions`, `package` | ❌ New binary |
| App version / icon / splash / Android permissions | ❌ New binary |

**The rule:** if `npx expo prebuild` would produce different native code, you need
a new build. Nothing else does.

All three bug fixes shipped in `d47e6e6` were pure JS — those are exactly the
kind of change OTA exists for.

---

## 2. How this project is wired

| Setting | Value | Where |
|---|---|---|
| EAS project | `cough-against-tb`, account `aakashwaig` | `app.config.js` → `extra.eas.projectId` |
| Update URL | `https://u.expo.dev/94b301ec-6dca-4343-801e-a657ea5024eb` | `app.config.js` → `updates.url` |
| `runtimeVersion` | `1.1.0` | `app.config.js` |
| Channels | `preview`, `production` | `eas.json` → per build profile |
| Check policy | `CHECK_ON_LAUNCH=ALWAYS`, `LAUNCH_WAIT_MS=0` | expo-updates default, baked into the APK |

Dashboard: <https://expo.dev/accounts/aakashwaig/projects/cough-against-tb/updates>

### Build profiles

| Profile | Channel | Output | Use |
|---|---|---|---|
| `preview` | `preview` | APK | What the testing team installs |
| `production` | `production` | AAB | Play Store submission |
| `production-apk` | `production` | APK | Sideload-testing the production channel |

`production-apk` exists only because an AAB cannot be installed directly — you
cannot otherwise verify the production channel without a Play Store release.

### Two things that surprise people

**The channel is fixed at build time.** It is compiled into `AndroidManifest.xml`
as `expo-channel-name`. An APK built with the `preview` profile will *only ever*
read the `preview` channel. Publishing to `production` will never reach it. Check
what an APK is bound to with:

```bash
$ANDROID_HOME/build-tools/36.1.0/aapt2 dump xmltree --file AndroidManifest.xml <apk> | grep -A2 REQUEST_HEADERS
```

**An update applies on the *second* launch.** Because `LAUNCH_WAIT_MS=0`, the app
never blocks startup waiting for a download. Launch 1 runs the current bundle and
downloads the new one in the background; launch 2 runs the new one. A tester who
opens the app once and reports "nothing changed" is not wrong — tell them to
fully close and reopen it.

---

## 3. First-time setup (authentication)

**No credential needed to publish an OTA is stored in this repository, by
design.** Cloning the repo is not enough — you must authenticate to EAS yourself.

1. Ask an owner of the `aakashwaig` Expo account to invite you to the
   `cough-against-tb` project.
2. Log in locally:

   ```bash
   npx eas-cli login
   npx eas-cli whoami        # should print your username
   ```

   This writes a session secret to `~/.expo/state.json`. That file is personal —
   never commit it, paste it, or copy it between machines.

3. For CI, do **not** use a personal login. Create a robot access token in the
   Expo dashboard (Project → Settings → Access tokens) and expose it as the
   `EXPO_TOKEN` environment variable in the CI secret store. `eas update` picks
   it up automatically.

Building an APK additionally needs the Android signing keystore, which is a
separate concern from OTA — see `credentials.json` (gitignored; ask a
maintainer). Publishing an OTA does not touch it.

---

## 4. Publish an update

Normally just:

```bash
npm run ota:preview
npm run ota:production
```

`scripts/ota-publish.mjs` runs these preflight checks and stops on any of them:

| Check | Why it blocks |
|---|---|
| Logged in to EAS | Otherwise the publish fails halfway with an opaque error |
| Working tree clean | EAS records the commit hash; publishing dirty means the deployed bundle matches no commit anyone can check out. An earlier update on this project was published dirty and is untraceable. |
| Typecheck not regressed | Compares against a recorded baseline (the repo has ~50 pre-existing errors), so you are blocked only by errors *you* added |
| `runtimeVersion` readable | Echoed so you can confirm which installed apps will receive it |

The commit subject becomes the update message unless you pass one:

```bash
npm run ota:preview -- "Fix specimen date validation"
```

### Doing it by hand

```bash
git status --porcelain                        # must be empty
npx tsc --noEmit -p tsconfig.app.json         # NOT plain `tsc --noEmit`
eas update --branch preview --message "Short description of what changed"
```

> Plain `tsc --noEmit` checks **nothing** — the root `tsconfig.json` has
> `"files": []`. `npm run typecheck` passes the right project.

Either way, the output gives you the **Android update ID** — keep it, it is what
you verify against. The `runtimeVersion` in the output must match the installed
app's, or no device will ever receive it.

---

## 5. Verify it landed

The app prints its own bundle identity at the bottom of the **login screen** and
the **dashboard**:

```
v1.0.0 · rtv 1.1.0 · preview · 01a004a4
 │        │           │         └─ first 8 chars of the update ID, or "embedded"
 │        │           └─ channel this binary is bound to
 │        └─ runtimeVersion (OTA compatibility key)
 └─ app version
```

`embedded` means the app is running the JS baked into the APK — no OTA applied.
Anything else is an update ID you can match against the publish output.

This is also the fastest way to triage a field bug report: ask for that line.

### On an emulator or a connected device

```bash
adb shell am force-stop com.coughcare.app
adb logcat -c
adb shell monkey -p com.coughcare.app -c android.intent.category.LAUNCHER 1
# wait ~20s, then:
adb logcat -d | grep onBackgroundUpdateFinished
```

- `Update available` → downloaded, will apply next launch
- `No update available` → already running the newest update for this channel

Force-stop and relaunch, then read the line on the login screen. It should now
show the first 8 characters of the update ID you published.

If it still says `embedded`, work through §7.

---

## 6. Roll back

Fastest and safest: republish a known-good earlier update. It becomes the newest
update on the branch, so devices pick it up by the normal mechanism.

```bash
eas update:list --branch preview          # find the good update's group ID
eas update:republish --group <group-id> --message "Roll back to <id>"
```

To abandon OTA entirely and send everyone back to the JS inside their APK:

```bash
eas update:roll-back-to-embedded --branch preview
```

There is no way to "unpublish" an update — rolling forward to a good bundle is
the only mechanism. Publish carefully; `preview` reaches the testing team's
phones on their next launch.

---

## 7. When an update does not arrive

Work down this list:

1. **`runtimeVersion` mismatch.** The single most common cause. The installed app
   and the update must match exactly. `runtimeVersion` is `1.1.0` today; it was
   bumped from `1.0.0` when `expo-location` was added. An app on `1.0.0` will
   never see `1.1.0` updates — that is the safety mechanism working, because that
   bundle would call native code the old binary doesn't contain.
2. **Wrong channel.** Check what the APK is actually bound to (§2). A `preview`
   APK ignores `production` entirely.
3. **Only one launch.** See §2 — it applies on the second.
4. **The update is older than the installed bundle.** expo-updates launches the
   newest bundle by commit time, comparing against the APK's embedded one. A
   freshly built APK is *newer* than a stale published update, so it correctly
   refuses to go backwards. Publish something new rather than expecting an old
   update to apply.
5. **No network on first launch**, or the device is offline. The check is
   best-effort and silent.

---

## 8. Rules of thumb

- **Bump `runtimeVersion` in `app.config.js` whenever you add or change native
  code**, in the same commit. Forgetting it is the one mistake that can actually
  break installed apps: a JS bundle expecting a native module the binary lacks
  will crash on launch, and the user cannot recover it without reinstalling.
- Ship to `preview` first, confirm with one tester, then `production`.
- Keep the publish `--message` specific. It is what you read at 2am deciding
  what to roll back to.
- Updates apply silently. Nothing in the app currently prompts the user or calls
  `Updates.reloadAsync()`, so there is a one-session lag between publishing and a
  tester seeing the change. If that lag ever matters, that is the thing to add —
  `src/utils/buildInfo.ts` is where the expo-updates access already lives.

---

## 9. Worked example (the verification run of 2026-08-15)

```
$ git status --porcelain                            # clean
$ eas update --branch preview --message "Show build/OTA bundle id on login screen"

  Branch             preview
  Runtime version    1.1.0
  Android update ID  01a004a4-763b-7652-becb-6f8a58c222ae
  Commit             e4f3ef873c0627ce9e9a592d77be202e69109f21

$ adb shell am force-stop com.coughcare.app && adb shell monkey -p com.coughcare.app -c android.intent.category.LAUNCHER 1
  → logcat: "onBackgroundUpdateFinished: Update available"

$ adb shell am force-stop com.coughcare.app && adb shell monkey -p com.coughcare.app -c android.intent.category.LAUNCHER 1
  → login screen shows: v1.0.0 · rtv 1.1.0 · preview · 01a004a4
```

The APK under test was built on 2026-08-12 from `d47e6e6` and had never contained
that line. `01a004a4` matches the published update ID — proof the running JS came
over the air.
