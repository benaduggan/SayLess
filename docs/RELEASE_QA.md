# SayLess Release QA

Use this checklist before publishing or sharing a release artifact. It is intentionally local-first and free: every item should pass without a SayLess account, paid tier, paid plan, paid account, account tier, named starter/team/business/enterprise plan or tier gate, enterprise-only mode, member-only mode, paid membership, free trial, paywall, entitlement check, license-required prompt, license key, activation prompt, contact-sales gate, account-required copy, sign-in-required copy, locked-behind-plan copy, pay-to-unlock copy, upgrade-required copy, hidden account-level gate, hosted dashboard, or background upload.

## Automated Gates

Run these from the repo root:

```sh
npm run qa:release:auto
npm run qa:release:status
```

Expected results:

- The automated runner executes `test:unit`, `test:e2e:offline-whisper-assets`, `test:e2e:offline-transcription-smoke`, `test:e2e:local-recordings`, `build:release`, `test:e2e:built-extension-surface`, and `verify:release` in order.
- On macOS, the automated runner also executes `test:e2e:offline-transcription-speech` with local `say`/`afconvert` clean, deterministic noisy, and longer paused speech fixtures; on other platforms, the evidence file records that harness as skipped because those tools are unavailable.
- After `build:release`, the automated runner executes `test:e2e:built-extension-surface` against the packaged extension pages, packaged bundled-Whisper model assets, and the content-script popup mounted on a local page.
- Unit tests, the offline Whisper asset-readiness browser harness, the offline Whisper startup/inference browser smoke, the macOS generated-speech offline transcription harness when available, the local-recordings browser harness, and the packaged-extension surface smoke pass.
- Release build completes. Production builds fail on unexpected webpack warnings; the only allowed warning is the pinned `@huggingface/transformers` standalone `import.meta` warning.
- `verify:release` reports no OAuth, no extra persistent host permissions beyond the recorder UI injection permission, no external website handshake, no paid/account/cloud recorder surface, no paid-plan/trial/entitlement/license-required gates, no account-tier, account-required, sign-in-required, paid-account, paid-membership, enterprise-only, contact-sales, sales-gated, license-key, or activation-prompt gates, no removed `src/pages/CloudRecorder` hosted recorder source path, no stale Screenity build/test/debug/keepalive names in guarded paths, no stale cloud/account protocol strings, no forbidden paid/account/cloud/upgrade locale copy in source or packaged assets, no missing dynamic local URL guards, no forbidden network service endpoint literals in active source, SVG source assets, or built JS bundles, no secret leaks, no duplicate large build assets, no stale promo media, and byte/hash-verified bundled Whisper files.
- The runner writes `release-artifacts/release-qa-automated.json` with `status: "passed"`, release version, manifest versions, passed command records, build size, deterministic build fingerprints, and a release manifest surface summary showing no OAuth block, no external website handshake, no identity or Google Drive permission, and no remote `connect-src`; attach or reference that evidence in release notes.
- If the runner is started or fails, `release-artifacts/release-qa-automated.json` is overwritten with non-passing running/failed evidence so a stale successful automated run cannot be reused by manual QA.
- `npm run qa:release:status` summarizes the automated, manual, release package, and CWS evidence state and prints the next release action without creating or blessing artifacts. It validates automated QA evidence command inventory, run timing, git branch/commit/dirty-state plus worktree fingerprint, current package versions, build fingerprint, bundled Whisper fingerprint, and release manifest surface before allowing the workflow to proceed to manual QA. Blocked JSON output includes ordered `nextActions`, and blocked human output prints `Next steps`. When manual evidence is missing or still has `status: "template"`, status prints `npm run qa:release:manual:profile` before the evidence completion step and includes a `Manual QA todo` group for the clean-profile pass; that todo is guidance only, and `npm run qa:release:manual` remains the gate. `npm run qa:release:status -- --require-ready` exits nonzero unless the complete automated/manual/package/CWS evidence set is ready.
- `verify:release` requires `package.json`, packaged extension metadata, and `docs/STORE_LISTING.md` to state the free-to-use, offline, local-first, on-device, no-signup product positioning, and scans the canonical Chrome Web Store copy draft for paid-tier, account-gate, cloud-upload, hosted-dashboard, Google Drive, and remote-transcription publication copy before release QA can proceed.
- Record the reported build size and bundled Whisper size in the release notes if they materially change.

## Manual Evidence Gate

After the automated gate passes and the manual sections below are complete, record release-specific evidence:

```sh
npm run qa:release:manual:template
npm run qa:release:manual:profile
npm run qa:release:manual
```

If `release-artifacts/release-qa-automated.json` exists and still matches the current worktree, build fingerprint, bundled Whisper fingerprint, command inventory, versions, and release manifest surface, the template writer pre-fills the matching `automatedEvidenceGeneratedAt` and automated build path. If that evidence is stale or incomplete, the template stays unseeded so manual QA starts by rerunning automated QA instead of blessing drifted artifacts. Leave pre-filled values intact unless you rerun automated QA, then regenerate or update the manual evidence before verifying. The generated template starts with `status: "template"`; change it to `status: "passed"` only after the real manual checklist is complete. Required confirmation booleans start as `false`, and checklist entries start as `status: "template"` so the completed evidence must explicitly record each observed pass. The writer refuses to overwrite an existing manual evidence file unless you intentionally run `npm run qa:release:manual:template:force`.

`npm run qa:release:manual:profile` fails closed unless `release-artifacts/release-qa-automated.json` exists, has `status: "passed"`, and fingerprints the current canonical `build/` plus the current git worktree state. When that preflight passes, it prints a Chrome command that loads the current `build/` from a new temporary user-data directory and opens `chrome://extensions/` so the unpacked extension id can be copied into manual evidence. Its `--json` output includes an `evidencePrefill` object for the automated evidence path, automated evidence timestamp, `environment.extensionSource`, and `environment.cleanChromeProfile`. Use `npm run qa:release:manual:profile -- --launch` when you want the helper to start Chrome directly. If you pass `-- --profile-dir=...`, the directory must be new or empty. If Chrome is not in a standard location, set `SAYLESS_CHROME` to the executable path. Keep `environment.cleanChromeProfile` true and `environment.extensionSource` set to `build` in `release-artifacts/manual-qa-evidence.json`.

Expected result: the verifier accepts `release-artifacts/manual-qa-evidence.json` only when it matches the current package and manifest versions, references the current automated QA evidence with canonical relative paths, confirms each required automated command has a passed command record, confirms the current `build/` manifest version and fingerprint still match that automated evidence, confirms manual QA used that same canonical relative `build` path in a clean Chrome profile and records the unpacked extension id, records at least two real recordings with unique ids, covers MP4 and WebM inputs, includes tab/browser/region and desktop/screen/window capture or recording sources, includes at least one 180-second or longer recording, covers at least two speaker profiles, and records notes that describe observed/confirmed/verified local or offline recording behavior for each listed recording. It also records inspected exports for MP4, WebM, GIF, WAV, M4A, WebVTT, transcript JSON, and `.sayless-project.json` with unique filenames matching the recorded export formats plus notes that describe how each artifact was opened, played, imported, decoded, previewed, viewed, loaded, listened to, or inspected, confirms caption burn-in, export cancel/retry tied to a listed recording and video format, reveal evidence that mentions a completed export/download and the Chrome download id, reveal, open, or show-in-folder observation, Save to file evidence that describes the user-chosen file/folder flow or explains why File System Access was unavailable, save-dialog cancellation evidence, and includes structured real-recording evidence for offline transcription with bundled-model-ready UI status, concrete disabled/blocked/offline network isolation method, a failed external HTTP(S) probe URL/error from the same Chrome profile, a probe result that says the bundled/local Whisper model stayed ready or loaded, transcript quality notes that mention real-speaker/voice/recording quality with word timing, timestamps, accuracy, or usability, transcript cache/regenerate/delete, silence suggestions across real codecs/noise with concrete suggested quiet ranges and ignored noisy ranges, zoom click metadata, zoom keep/remove, zoom preview/export, persisted zoom keyframes after reopen, local library recovery operation observations, fresh install, recording recovery, timeline persistence, and final release-notes/screenshot/store-text no-paid/no-cloud surface checks. Publication-surface searches must include paid/subscription, premium/trial/entitlement/license/upgrade, plan/membership/locked-feature, locked-behind/pay-to-unlock/upgrade-required gates, account-tier/license-key/activation/contact-sales gates, account/sign-in, and cloud/remote terms. Publication notes must describe reviewing paid/account/cloud/remote/local-only claims, the `store-text` reviewed artifact name must include `docs/STORE_LISTING.md`, and residual-risk fields must explicitly say no residual risk/no remaining risk or describe the residual risk. Multi-recording checks must reference distinct listed recording ids; repeating one recording id cannot satisfy two-recording coverage. Every top-level checklist entry must also include structured evidence objects with an artifact, observation, and listed recording ids for checks that depend on real recordings; checklist notes and observations must describe observed, confirmed, verified, recorded, inspected, tested, opened, or reviewed local/offline release behavior, and checklist artifacts must identify concrete screenshots, reports, logs, recordings, exports, transcripts, videos, images, JSON/VTT/MP4/WebM/GIF/WAV/M4A files, or notes. See `docs/MANUAL_QA_EVIDENCE.md`.

Release artifact commands enforce this gate. `npm run release -- patch|minor|major` only bumps the release version and prints the QA sequence. After `npm run qa:release:auto` and the manual checklist are complete, `npm run package:release` verifies `release-artifacts/manual-qa-evidence.json` against the existing automated QA evidence, runs the no-secrets scan, creates a fresh `extension.zip`, writes `release-artifacts/package-release.json` with the canonical relative zip path, zip size, SHA-256, build size, build fingerprint, automated QA pass status, automated git/worktree provenance, and SHA-256 hashes of the exact automated and manual evidence files used for packaging, then runs the release-package verifier before printing success. Run `npm run verify:release-package` again before attaching or sharing `extension.zip`; it reruns the manual QA evidence verifier and verifies the current relative zip path, hash, uncompressed zip contents, package evidence, current `build/` size and fingerprint, automated QA evidence hash and pass status, automated git/worktree provenance, and manual QA evidence hash still match. Artifact and evidence writes use temporary files and atomic renames so failed writes do not leave partially written release files. Package and CWS packaging also overwrite stale package evidence with `running` or `failed` status before doing release work, so a failed or interrupted package attempt cannot leave old passing evidence looking current. CWS packaging reuses that verified artifact path through `npm run build:cws`, copies the verified zip to `build-cws.zip`, writes `release-artifacts/cws-package.json` tying the canonical relative CWS zip path back to the canonical relative source zip, `package-release.json`, automated git/worktree provenance, and the automated/manual QA evidence summaries used for the package, then runs the CWS package verifier before printing success. CWS upload and publish commands run `npm run preflight:cws`, which requires `npm run qa:release:status -- --require-ready`, so store actions cannot proceed unless automated QA, manual QA, release package evidence, and CWS package evidence all verify together. Absolute machine-local artifact paths are rejected so release evidence remains portable and reviewable.

Standalone slow offline transcription smoke:

```sh
npm run test:e2e:offline-transcription-smoke
```

Expected result: Chrome loads the bundled Whisper model plus local ORT files and completes inference on generated audio without downloading model assets. This checks startup/inference plumbing, not real-speech transcript quality.

Standalone generated-speech offline transcription smoke:

```sh
npm run test:e2e:offline-transcription-speech
```

Expected result: on macOS, the harness generates temporary clean, deterministic noisy, and longer paused WAV files with `say`/`afconvert`, Chrome transcribes them with bundled Whisper plus local ORT files, and transcripts contain expected words such as "hello", "offline", "recording", "export", "transcript", and "timeline" with monotonic word timestamps without downloading model assets. This checks recognizable local speech transcription and basic timing under ideal, longer paused, and synthetic noisy conditions, not broad real-recording quality across accents, microphones, or noisy rooms.

Standalone built-extension surface smoke:

```sh
npm run test:e2e:built-extension-surface
```

Expected result: Chrome loads `build/` as an unpacked extension, verifies the packaged extension can fetch the bundled Whisper model manifest and seven required model files from extension URLs, verifies it can create and observe a completed local Chrome download id, opens packaged extension pages with no page-level JavaScript or console errors, mounts the packaged content script on a local page, opens the popup with no page-level JavaScript or console errors, switches to the Videos tab, verifies the local recordings library text, and finds no paid-tier, paid-plan, paid-account, account-tier, enterprise-only, member-only, free-trial, entitlement, license-required, license-key, activation-prompt, contact-sales, sales-gated, subscription, sign-in, account-gated, hosted-dashboard, cloud-recorder, cloud-upload, or Google Drive calls to action in rendered page text or common accessible labels.

## Fresh Install

1. Run `npm run qa:release:manual:profile`, then load `build/` as an unpacked extension in the printed clean Chrome profile.
2. Confirm the manifest prompts do not mention identity, Google Drive, account login, hosted upload, or cloud recorder permissions.
3. Open the popup and confirm the Videos tab is local by default.
4. Confirm there is no paid, premium, trial, entitlement, license-required, subscription, billing, sign-in, or account-gated call to action in the popup or editor.

## Recording And Recovery

1. Record a short tab or desktop video with microphone off.
2. Record a short video with microphone on.
3. Stop each recording and confirm it opens in the editor.
4. Close and reopen the editor from the Videos tab.
5. Confirm the local library shows duration, size, created date, storage backend, edited status, and transcript status.
6. Search and filter the Videos tab by today, edited, transcript, large, and missing-media states.

## Offline Transcription

1. Disable network for the browser profile or machine.
2. Open a saved local recording.
3. Confirm the transcript panel reports the bundled local model as ready.
4. Confirm an external HTTP(S) network probe fails in the same browser profile while the bundled model remains ready; record the URL, failure status, and browser error in `offlineTranscription.externalNetworkProbe`.
5. Generate a transcript.
6. Confirm the transcript is plausible for the real speaker and timing is usable for word-range editing.
7. Close and reopen the editor; confirm the cached transcript is still present.
8. Regenerate and delete the transcript; confirm both actions stay local.

## Timeline Editing

1. Generate or load a transcript.
2. Delete a word range and mute a different word range.
3. Split a clip and reorder clips on the timeline.
4. Use undo and redo from both buttons and keyboard shortcuts.
5. Confirm the transcript panel shows local chapter markers after long pauses or audio silence and that each marker seeks correctly. Record at least two suggested quiet ranges and one noisy range that was not suggested as silence.
6. For a tab or region recording with page clicks, confirm local zoom suggestions appear, can be kept/removed, seek to the click timing, preview as zoomed video, persist after editor reopen, and render into MP4 export.
7. Close and reopen the editor; confirm transcript, clips, mutes, selected clip, chapter markers, saved zoom keyframes, and export settings persist.

## Export

1. Export MP4 with project sidecar enabled.
2. Export WebM; if WebM conversion falls back, confirm the exported MP4 still reflects timeline edits.
3. Export GIF with a short bounded range.
4. Export WAV and M4A audio-only files.
5. Export WebVTT and transcript JSON sidecars.
6. Enable caption burn-in and verify captions appear in the exported video.
7. Start a long export, then cancel it; retry and complete it.
8. Record the recording id and export format used for cancel/retry, then use the completed export job reveal action when Chrome exposes a download id.
9. If `showSaveFilePicker` is available, enable Save to file and repeat MP4 plus sidecar export to a user-chosen folder.
10. Cancel the save dialog and confirm the project remains intact and the UI does not report a hard failure.

## Local Library Recovery

1. Duplicate a recording and confirm the copy reopens.
2. Import a media file and a `.sayless-project.json` sidecar.
3. Bulk export and bulk delete selected recordings.
4. Trigger storage cleanup when orphaned local media is present.
5. Confirm missing media shows a repairable state rather than a generic editor failure.
6. Record operation-level observations for duplicate reopen, sidecar import, bulk export/delete, orphan cleanup, and missing-media repair in the manual evidence file.

## Final Surface Check

Before publishing, start from `docs/STORE_LISTING.md`, then scan release notes, screenshots, and store text for claims that no longer apply:

- No paid tiers, paid plans, paid accounts, account tiers, account-level gates, named plan/tier gates, enterprise-only modes, member-only modes, or paid memberships.
- No paywalls, premium-only controls, starter/team/business/enterprise gates, free trials, entitlement checks, license-required prompts, license keys, activation prompts, subscription prompts, contact-sales gates, locked-feature copy, locked-behind-plan copy, pay-to-unlock copy, upgrade-required copy, subscription-only copy, or hidden feature access levels.
- No hosted dashboard or automatic cloud upload.
- No Google Drive export path.
- No default remote transcription provider.
- No claim that multi-scene recording, auto-zoom, or local suggestions are complete unless separately verified.

For each reviewed publication artifact, record the searched paid/subscription, premium/trial/entitlement/license/upgrade, plan/membership/locked-feature, locked-behind/pay-to-unlock/upgrade-required gates, account-tier/license-key/activation/contact-sales gates, account/sign-in, and cloud/remote terms plus any residual risk in the manual evidence file.
