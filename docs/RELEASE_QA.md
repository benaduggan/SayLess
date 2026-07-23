# SayLess Release QA

Use this checklist before publishing or sharing a release artifact. It is intentionally local-first and free: every item should pass without a SayLess account, paid tier, paid plan, paid account, account tier, named starter/team/business/enterprise plan or tier gate, enterprise-only mode, member-only mode, paid membership, free trial, paywall, entitlement check, license-required prompt, license key, activation prompt, contact-sales gate, account-required copy, sign-in-required copy, locked-behind-plan copy, pay-to-unlock copy, upgrade-required copy, hidden account-level gate, hosted dashboard, or background upload.

## Automated Gates

Run these from the repo root:

```sh
npm run qa:release:auto
npm run qa:release:status
```

Expected results:

- The automated runner executes `typecheck`, `test:unit`, `test:e2e:offline-whisper-assets`, `test:e2e:offline-transcription-smoke`, `test:e2e:local-recordings`, `test:e2e:editor-layout`, `build:release`, `test:e2e:editor-editing-proof`, `test:e2e:built-extension-surface`, and `verify:release` in order. `typecheck` uses the official TypeScript 7.0.2 native compiler installed under the pinned `@typescript/native` npm alias.
- GitHub Actions installs the locked npm dependencies, runs the TypeScript 7 gate explicitly on Node 24, and then runs the same automated release QA sequence so the typecheck is both a CI gate and part of release evidence. TypeScript 5 remains installed separately for build tools that still require its JavaScript API.
- On macOS, the automated runner also executes `test:e2e:offline-transcription-speech` with local `say`/`afconvert` clean, deterministic noisy, and longer paused speech fixtures; on other platforms, the evidence file records that harness as skipped because those tools are unavailable.
- After `build:release`, the automated runner executes `test:e2e:editor-editing-proof` through the packaged editor, including File System Access picker cancellation, retry, successful MP4 write/close, the absence of a reveal action when no Chrome download id exists, and a second MP4 export whose non-empty completed Chrome download record makes the reveal action visible. It then executes `test:e2e:built-extension-surface` against the packaged extension pages, packaged bundled-Whisper model assets, and the content-script popup mounted on a local page.
- Unit tests, the offline Whisper asset-readiness browser harness, the offline Whisper startup/inference browser smoke, the macOS generated-speech offline transcription harness when available, the local-recordings and editor-layout browser harnesses, the packaged editor editing proof, and the packaged-extension surface smoke pass. The local-recordings harness also feeds its product-generated VTT, transcript JSON, and project JSON through the manual sidecar probe as one matched set.
- Release build completes. Production builds fail on unexpected webpack warnings; the only allowed warning is the pinned `@huggingface/transformers` standalone `import.meta` warning.
- `verify:release` reports no OAuth, no extra persistent host permissions beyond the recorder UI injection permission, no external website handshake, no paid/account/cloud recorder surface, no paid-plan/trial/entitlement/license-required gates, no account-tier, account-required, sign-in-required, paid-account, paid-membership, enterprise-only, contact-sales, sales-gated, license-key, or activation-prompt gates, no removed `src/pages/CloudRecorder` hosted recorder source path, no stale Screenity build/test/debug/keepalive names in guarded paths, no stale cloud/account protocol strings, no forbidden paid/account/cloud/upgrade locale copy in source or packaged assets, no missing dynamic local URL guards, no forbidden network service endpoint literals in active source, SVG source assets, or built JS bundles, no secret leaks, no duplicate large build assets, no stale promo media, and byte/hash-verified bundled Whisper files.
- The runner writes `release-artifacts/release-qa-automated.json` with `status: "passed"`, release version, manifest versions, passed command records, build size, deterministic build fingerprints, and a release manifest surface summary showing no OAuth block, no external website handshake, no identity or Google Drive permission, and no remote `connect-src`; attach or reference that evidence in release notes.
- If the runner is started or fails, `release-artifacts/release-qa-automated.json` is overwritten with non-passing running/failed evidence so a stale successful automated run cannot be reused by manual QA.
- `npm run qa:release:status` summarizes the automated, manual, release package, and CWS evidence state and prints the next release action without creating or blessing artifacts. It validates automated QA evidence command inventory, run timing, git branch/commit/dirty-state plus worktree fingerprint, current package versions, build fingerprint, bundled Whisper fingerprint, and release manifest surface before allowing the workflow to proceed to manual QA. Blocked JSON output includes ordered `nextActions`, and blocked human output prints `Next steps`. When a manual template is missing canonical fields, still contains recognized untouched retired placeholders, or carries stale release/build provenance, status prints `npm run qa:release:manual:profile -- --sync-template --launch`; when that template is already canonical and current, status advances to `npm run qa:release:manual:profile -- --launch` without the redundant synchronization flag. Both actions start the clean Chrome profile directly. Synchronization removes only known obsolete placeholder values and preserves user-entered legacy evidence. Both paths retain a `Manual QA todo` group covering real-recording metadata, exports, offline transcription, silence, zoom, crop, project audio, recovery, checklist, and publication evidence; that todo is guidance only, and `npm run qa:release:manual` remains the gate. JSON status exposes `manualQa.templateSyncRequired` and its reasons. `npm run qa:release:status -- --require-ready` exits nonzero unless the complete automated/manual/package/CWS evidence set is ready.
- `verify:release` requires `package.json`, packaged extension metadata, and `docs/STORE_LISTING.md` to state the free-to-use, offline, local-first, on-device, no-signup product positioning, and scans the canonical Chrome Web Store copy draft for paid-tier, account-gate, cloud-upload, hosted-dashboard, Google Drive, and remote-transcription publication copy before release QA can proceed.
- Record the reported build size and bundled Whisper size in the release notes if they materially change.

## Manual Evidence Gate

After the automated gate passes, run the real session in this order. The strict
probes come after the session has produced their source, export, project-audio,
and sidecar inputs:

```sh
npm run qa:release:manual:template
npm run qa:release:manual:profile -- --sync-template --launch
# Complete the manual sections below and keep every generated file.
npm run qa:release:manual:progress
npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json /path/to/recording.mp4
npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json /path/to/recording.vtt
npm run qa:release:manual:measurements -- --json --write
# Set status/testedAt only after both strict reports pass.
npm run qa:release:manual:progress
npm run qa:release:manual
```

If `release-artifacts/release-qa-automated.json` exists and still matches the current worktree, build fingerprint, bundled Whisper fingerprint, command inventory, versions, and release manifest surface, the template writer pre-fills the matching `automatedEvidenceGeneratedAt` and automated build path. If that evidence is stale or incomplete, the template stays unseeded so manual QA starts by rerunning automated QA instead of blessing drifted artifacts. Leave pre-filled values intact unless you rerun automated QA, then regenerate or update the manual evidence before verifying. The generated template requires a tester name for attribution but no email or other contact data. It starts with `status: "template"`; change it to `status: "passed"` only after the real manual checklist is complete. Required confirmation booleans start as `false`, and checklist entries start as `status: "template"` so the completed evidence must explicitly record each observed pass. The writer refuses to overwrite an existing manual evidence file unless you intentionally run `npm run qa:release:manual:template:force`.

The template names the canonical media and sidecar probe reports and includes source/export/project-audio filenames, byte sizes, and SHA-256 identities. Final verification requires both reports to be strict, complete, generated after automated QA and before `testedAt`, and consistent with every measurable worksheet field.

`npm run qa:release:manual:profile -- --sync-template` fails closed unless `release-artifacts/release-qa-automated.json` exists, has `status: "passed"`, fingerprints the current canonical `build/` plus current git worktree, and carries a valid extension ID observed by the clean-profile packaged-extension smoke. It safely adds missing canonical fields and refreshes release/build provenance on an existing `status: "template"` evidence file. It detects the host OS and selected Chrome version and carries forward that browser-observed extension ID, replacing only untouched canonical placeholders and preserving tester-entered values; unavailable Chrome-version detection stays manual, and all values should be confirmed in the launched browser. It is byte-stable when repeated against unchanged inputs and refuses non-template evidence. When that preflight passes, it prints a Chrome command that loads the current `build/` from a new temporary user-data directory and opens `chrome://extensions/` so the prefilled ID can be visually confirmed. Its `--json` output includes `templateSynchronized`, `browserObservedExtensionId`, `detectedEnvironment`, and `evidencePrefill`. Use `npm run qa:release:manual:profile -- --sync-template --launch` when you want the helper to start Chrome directly. If you pass `--profile-dir=...` after the npm `--` separator, the directory must be new or empty. If Chrome is not in a standard location, set `SAYLESS_CHROME` to the executable path.

Starting a new session writes `.sayless-manual-qa-profile.json` inside the new profile and prints a resume command. If Chrome closes during this multi-part checklist, resume the same recordings and browser state with `npm run qa:release:manual:profile -- --profile-dir=/the/printed/path --resume-profile --launch`. The marker binds the session to the release version, automated-evidence timestamp, build identity, extension ID, detected OS, and selected browser executable/version. The helper rejects arbitrary non-empty Chrome profiles and refuses a marked session after the build, worktree-derived automated evidence, extension provenance, OS, or selected browser changes.

When `--launch` succeeds, the helper waits for the operating system to acknowledge the Chrome process spawn, then atomically stamps portable `manualSession` provenance into `release-artifacts/manual-qa-evidence.json` and writes the ignored, machine-local `release-artifacts/manual-qa-session.json` pointer. A missing, non-executable, or permission-denied browser command therefore cannot stamp evidence or replace a previously valid pointer with a session that never launched. The evidence stamp binds profile creation time, release/build/automated-evidence identity, extension ID, OS, and browser version, but contains no profile directory or browser executable path and does not fill any human observation. Repeated synchronization for the same automated run preserves it; newer automated evidence resets it and requires a new launch. `npm run qa:release:status` never trusts the local pointer by itself: it runs the profile helper’s strict resume validation against the current build, worktree, browser, OS, extension identity, and profile marker before recommending the exact `--resume-profile --launch` command. Missing, malformed, moved, stale, tampered, or environment-mismatched sessions fall back to a new clean-profile launch. The pointer is local operator state and is not a release attachment; the path-free stamp is part of the portable manual evidence.

The packaged-extension smoke atomically writes running, failed, or passed browser evidence and records the extension ID actually observed in its clean temporary Chrome profile. Automated QA validates and carries that identity forward. The profile helper prefills it only over the untouched template placeholder, while manual and status gates reject malformed browser provenance or a mismatched manual ID.

Use `npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json <files...>` on downloaded source recordings, media exports, and WAV/M4A/MP3 project-audio inputs. The helper streams files read-only and reports exact byte counts, SHA-256 identities, duration, dimensions, container/MIME/codec data, and audio channel/sample-rate metadata. Its JSON provides schema-exact recording and project-audio field groups, per-file long-and-large threshold results, and a `releaseCoverage` summary of the measurable MP4/WebM, 180-second/25-MiB, varied-geometry, and WAV/M4A/MP3 requirements, but never writes the evidence worksheet. Strict mode exits nonzero until every measurable check passes; omit `--require-complete` for an incremental advisory report. The optional output is an atomic copy of the JSON report, is retained even when strict coverage is incomplete, and cannot overwrite an inspected input. Confirm which videos are original sources rather than exports. Opening/playback, visual quality, audibility, synchronization, picker, reveal, and file-manager results remain human observations.

Use `npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json <files...>` on the exported WebVTT, transcript JSON, and `.sayless-project.json` files. It validates cue timing/text, exact SayLess kinds and sidecar schema, positive timed transcript words, current project schema v4, matching project/recording identity, bounded unique clips, matching timeline/source duration, supported export format, filenames, and hashes. Coverage is structurally complete only when one common filename stem has all three formats and the JSON recording IDs agree; unrelated exports cannot satisfy the set, and strict mode exits nonzero until a matched set is complete. Omit `--require-complete` for an incremental advisory report. Its atomic output report survives an incomplete strict run and cannot overwrite an inspected input. Its `exportFields` omit the recording id and inspection notes that must still come from the real session. Open the VTT/transcript and import the project through the tested extension before recording those observations.

For the final run, give the media probe every worksheet source, media export, and project-audio input. The verifier cross-checks source duration/dimensions/container, project-audio decode metadata, all measurable file sizes and SHA-256 identities, and sidecar formats against the two canonical reports. Playback, perception, reveal, open, and import observations remain manual.

After both strict reports pass and after you have assigned each exact filename to its real source, export, or project-audio role in the worksheet, preview the measurement import with `npm run qa:release:manual:measurements -- --json`. Add `--write` to atomically copy only the matched hashes, byte sizes, durations, dimensions, containers, channel counts, and sample rates. The importer requires a `status: "template"` worksheet, current strict canonical reports, exact filename and format matches, and complete coverage of every listed recording, export, and project-audio input. It refuses stale, incomplete, ambiguous, mismatched, or already-passed evidence. It never chooses a file role, changes filenames, marks checks passed, sets `testedAt`, or writes playback, audibility, synchronization, visual-quality, reveal, open, or import observations. Repeating `--write` after a successful import is byte-stable.

The mutating profile helper and read-only release status use the same pure rules from `scripts/manual-qa-template-sync.mjs`; release audit rejects local copies in either caller. Direct unit tests cover merge, migration, preservation, reason reporting, and idempotence so status cannot silently disagree with the synchronization it recommends.

Use `npm run qa:release:manual:progress` while recording observations. It applies the same validation rules as the strict verifier, reports complete/incomplete sections with bounded error samples, and prints the first incomplete section plus its focused follow-up command. Run that command, such as `npm run qa:release:manual:progress -- --section=recordings`, to see every remaining issue for one section without losing the overall counts. Missing or invalid canonical reports are separated into `mediaProbe` and `sidecarProbe` sections whose next commands run the corresponding strict probe; only actual automated-build or provenance failures recommend rerunning `npm run qa:release:auto`. After both reports pass, report-backed hashes, sizes, durations, dimensions, containers, channels, and sample rates are routed to a dedicated `measurementImport` section and its guarded write command, while filenames, formats, roles, and observations remain in their human-owned sections. Network isolation is reported under offline transcription instead of session metadata. The top-level passing status and final `testedAt` timestamp remain in a last `finalization` section until the observation, probe, and measurement-import stages are complete. Add `--json` after the npm separator for structured `nextSection` and `selectedSection` output. Unknown section ids fail closed. Progress exits successfully for an incomplete, valid JSON worksheet and remains read-only guidance, not a release pass; `npm run qa:release:manual` must still succeed before packaging.

Focused and next-section output names the exact `workTargets` to edit or generate, and JSON includes the same targets for all sections. This keeps the tester on the relevant worksheet object or canonical report without auto-populating human observations.

The strict verifier requires the machine-stamped `manualSession` created after an acknowledged launch. Its profile creation time must fall between automated QA and `testedAt`, and its release, automated timestamp, build hash/count/size, extension ID, OS, and browser version must exactly match the portable automated and environment evidence.

Expected result: the verifier accepts `release-artifacts/manual-qa-evidence.json` only when it matches the current package and manifest versions, references the current automated QA evidence with canonical relative paths, confirms each required automated command has a passed command record, confirms the current `build/` manifest version and fingerprint still match that automated evidence, confirms manual QA used that same canonical relative `build` path in a clean Chrome profile and records the unpacked extension id, records at least two real recordings with unique ids, exact positive-integer source-file `byteSize`, `width`, and `height` values, covers MP4 and WebM inputs, includes tab/browser/region and desktop/screen/window capture or recording sources, includes at least one recording that is both 180 seconds or longer and at least 25 MiB, requires microphone and noise-profile descriptions, covers at least two speaker profiles, and records notes that describe observed/confirmed/verified local or offline recording behavior for each listed recording. It also records inspected exports for MP4, WebM, GIF, WAV, M4A, WebVTT, transcript JSON, and `.sayless-project.json` with unique filenames matching the recorded export formats plus notes that describe how each artifact was opened, played, imported, decoded, previewed, viewed, loaded, listened to, or inspected, confirms caption burn-in, ties export cancel/retry to that same long-and-large listed recording and a video format, records reveal evidence that mentions a completed export/download and the Chrome download id, reveal, open, or show-in-folder observation, Save to file evidence that describes the user-chosen file/folder flow or explains why File System Access was unavailable, save-dialog cancellation evidence, and includes structured real-recording evidence for offline transcription with bundled-model-ready UI status, concrete disabled/blocked/offline network isolation method, a failed external HTTP(S) probe URL/error from the same Chrome profile, a probe result that says the bundled/local Whisper model stayed ready or loaded, transcript quality notes that mention real-speaker/voice/recording quality with word timing, timestamps, accuracy, or usability, transcript cache/regenerate/delete, silence suggestions linked to distinct listed MP4 and WebM recordings with at least two noise profiles, an observed quiet range for each referenced recording, and an observed noisy range that was not suggested, per-recording zoom evidence for at least two tab/browser/region sources with distinct dimension pairs and aspect ratios covering click metadata, keep/remove, preview, reopen persistence, and inspected MP4 export framing, per-recording crop evidence across at least two distinct source dimension pairs/aspect ratios covering normalized edge bounds, native controls, non-destructive preview, reopen persistence, and inspected MP4 dimensions whose aspect ratio matches the crop, real WAV/M4A/MP3 project-audio inputs with decoded metadata and audible previews plus long-recording seek/play/pause/rate/reorder synchronization, perceptual mix/replace/loop checks, cancellation/retry, reopen, duplicate/delete isolation, sidecar missing-asset/relink, and Apply-edits cleanup evidence, local library recovery operation observations, fresh install, recording recovery, timeline persistence, and final release-notes/screenshot/store-text no-paid/no-cloud surface checks. Publication-surface searches must include paid/subscription, premium/trial/entitlement/license/upgrade, plan/membership/locked-feature, locked-behind/pay-to-unlock/upgrade-required gates, account-tier/license-key/activation/contact-sales gates, account/sign-in, and cloud/remote terms. Publication notes must describe reviewing paid/account/cloud/remote/local-only claims, the `store-text` reviewed artifact name must include `docs/STORE_LISTING.md`, and residual-risk fields must explicitly say no residual risk/no remaining risk or describe the residual risk. Multi-recording checks must reference distinct listed recording ids; repeating one recording id cannot satisfy two-recording coverage. Every top-level checklist entry must also include structured evidence objects with an artifact, observation, and listed recording ids for checks that depend on real recordings; checklist notes and observations must describe observed, confirmed, verified, recorded, inspected, tested, opened, or reviewed local/offline release behavior, and checklist artifacts must identify concrete screenshots, reports, logs, recordings, exports, transcripts, videos, images, JSON/VTT/MP4/WebM/GIF/WAV/M4A files, or notes. See `docs/MANUAL_QA_EVIDENCE.md`.

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

Standalone packaged editor editing proof:

```sh
npm run test:e2e:editor-editing-proof
```

Expected result: the packaged editor saves and reopens non-destructive timeline, zoom, crop, and MP3 project-audio edits; Apply edits produces a durable reset project; a simulated File System Access picker cancellation yields a retryable cancelled export without a reveal action; and the retry writes and closes a non-empty MP4 through the picker path. It then exports another non-empty MP4 through `chrome.downloads`, verifies the new download id, completed state, byte counts, and file existence, and requires the reveal action to appear. Unit coverage proves that action dispatches the exact validated id. The picker and OS file-manager interaction remain simulated/unopened, so choosing a real folder and observing Show in folder remain part of manual QA.

Standalone built-extension surface smoke:

```sh
npm run test:e2e:built-extension-surface
```

Expected result: Chrome loads `build/` as an unpacked extension, verifies the packaged extension can fetch the bundled Whisper model manifest and seven required model files from extension URLs, verifies it can create and observe a completed local Chrome download id, opens packaged extension pages with no page-level JavaScript or console errors, mounts the packaged content script on a local page, opens the popup with no page-level JavaScript or console errors, switches to the Videos tab, verifies the local recordings library text, and finds no paid-tier, paid-plan, paid-account, account-tier, enterprise-only, member-only, free-trial, entitlement, license-required, license-key, activation-prompt, contact-sales, sales-gated, subscription, sign-in, account-gated, hosted-dashboard, cloud-recorder, cloud-upload, or Google Drive calls to action in rendered page text or common accessible labels.

## Fresh Install

1. Run `npm run qa:release:manual:profile -- --sync-template --launch`; it loads `build/` as an unpacked extension in a new clean Chrome profile.
2. Confirm the manifest prompts do not mention identity, Google Drive, account login, hosted upload, or cloud recorder permissions.
3. Open the popup and confirm the Videos tab is local by default.
4. Confirm there is no paid, premium, trial, entitlement, license-required, subscription, billing, sign-in, or account-gated call to action in the popup or editor.

## Recording And Recovery

1. Record a short tab or desktop video with microphone off.
2. Record a short video with microphone on.
3. Ensure the evidence set includes one real recording that is both at least 180 seconds and at least 25 MiB; record each source file's exact byte count and source-video dimensions as `recordings[].byteSize`, `width`, and `height`.
4. Record the actual microphone and noise environment for every listed recording; the silence-suggestion pair must use distinct noise profiles and include both an MP4 and a WebM source.
5. Stop each recording and confirm it opens in the editor.
6. Close and reopen the editor from the Videos tab.
7. Confirm the local library shows duration, size, created date, storage backend, edited status, and transcript status.
8. Search and filter the Videos tab by today, edited, transcript, large, and missing-media states.

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
5. Confirm the transcript panel shows local chapter markers after long pauses or audio silence and that each marker seeks correctly. On the linked MP4 and WebM recordings with distinct noise profiles, record at least one suggested quiet range per recording and one noisy range that was not suggested as silence.
6. For at least two tab, browser, or region recordings with page clicks and distinct dimension pairs/aspect ratios, confirm on each source that local zoom suggestions appear, can be kept/removed, seek to the click timing, preview as zoomed video, persist after editor reopen, and render into an inspected MP4 export. Record a separate `zoom.observations[]` entry for each source.
7. Close and reopen the editor; confirm transcript, clips, mutes, selected clip, chapter markers, saved zoom keyframes, and export settings persist.
8. Add a real WAV, M4A, or MP3 as project audio. Verify mix and replace modes, enable and disable the loop control, seek/play/pause and playback-rate synchronization across a reordered timeline, persistence after reopen, and that saving the audio does not replace the source recording blob.
9. Duplicate the recording and verify its project audio still previews. Delete the duplicate and confirm the original remains intact. Export/import the project sidecar without the audio media, confirm the missing-asset state is explicit, then relink the original audio file and verify the SHA-256-backed reference recovers.
10. Before applying, confirm timeline/crop/audio-only project changes have not created an edited-media checkpoint. Choose Apply edits, immediately close and reopen after it completes, and verify the baked media opens with one reset clip, stale transcript/crop/audio metadata is cleared, the original source remains available, and no removed project-audio asset is orphaned.

## Crop Preview And Export

1. Use at least two listed recordings with distinct source dimension pairs and aspect ratios.
2. On each recording, save normalized crop bounds that touch at least one source edge; record `xRatio`, `yRatio`, `widthRatio`, and `heightRatio` in `crop.observations[]`.
3. Confirm native playback controls remain usable and the cropped preview shows the intended bounds without replacing the source blob.
4. Close and reopen the editor; confirm the crop persists and the original source dimensions/blob remain unchanged.
5. Export MP4, inspect its visible bounds and exact dimensions, and record `exportWidth`/`exportHeight`; their aspect ratio must match the normalized source crop within 3%.

## Project Audio

1. On the same listed recording that is at least 180 seconds and 25 MiB, select real user-supplied WAV, M4A, and MP3 files in turn. Record each exact filename, byte count, decoded duration, channel count, and sample rate, and confirm an audible preview.
2. Verify seek, play, pause, playback-rate changes, and reordered-timeline synchronization over the long recording. Enable and disable looping.
3. Compare mix and replace modes at intentional source/project gain settings; record perceived volume, audibility, balance, and any clipping or drift in `projectAudio.playback.gainPerceptionNotes`.
4. Include project audio in the long export cancellation/retry performed for `exports.workflow.cancelRetryRecordingId`.
5. Reopen the project and confirm the audio remains synchronized while the source recording blob remains unchanged.
6. Duplicate the recording and verify the duplicate previews its owned audio asset. Delete the duplicate and confirm the original recording/audio remain intact.
7. Export/import the project sidecar without the audio media, confirm the explicit missing-asset state, relink the original file, and verify the SHA-256 identity matches.
8. Apply edits and confirm the baked output is valid, the reset project no longer references the project-audio asset, and the removed asset is not orphaned.

## Export

1. Export MP4 with project sidecar enabled.
2. Export WebM; if WebM conversion falls back, confirm the exported MP4 still reflects timeline edits.
3. Export GIF with a short bounded range.
4. Export WAV and M4A audio-only files.
5. Export WebVTT and transcript JSON sidecars.
6. Enable caption burn-in and verify captions appear in the exported video.
7. Export a project with added/replacement audio as video and audio-only output; confirm timeline cuts/reorders and mix/replace settings match preview.
8. On the same listed recording that is at least 180 seconds and 25 MiB, start an export, cancel it after progress begins, then retry and complete it. Include a project-audio render in the cancellation coverage.
9. Record that long-and-large recording id and the export format used for cancel/retry, then use the completed export job reveal action when Chrome exposes a download id.
10. If `showSaveFilePicker` is available, enable Save to file and repeat MP4 plus sidecar export to a user-chosen folder.
11. Cancel the save dialog and confirm the project remains intact and the UI does not report a hard failure.

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
