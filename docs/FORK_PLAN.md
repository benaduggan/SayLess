# SayLess Roadmap

This roadmap is based on the current worktree. The direction is an offline, local-only recorder and editor: local capture, local storage, local transcription, local editing, and explicit user-controlled export.

## Current Baseline

Already working or substantially implemented:

- Local recording engine inherited from Screenity with WebCodecs MP4, MediaRecorder WebM fallback, OPFS/IDB storage, offscreen recording, and recovery/watchdog flows.
- In-page recording controls, annotation tools, blur, cursor effects, countdown, camera bubble, and camera background effects.
- In-browser editor with mediabunny operations for trim, cut, mute, crop, audio replacement, MP4/WebM/GIF export, and large-file OPFS handling.
- Local recording library index with reopen and edited-blob checkpointing.
- Local Whisper transcription provider with privacy mode enabled by default.
- EDL/timeline primitives for delete, mute, split, reorder, source/output time mapping, and transcript grouping.
- Transcript panel for generating transcripts and deleting or muting selected word spans.
- Unit tests for EDL/timeline/render planning and an e2e harness for local recordings.

Main unfinished migration work:

- Transcription now refuses remote model download by default and resolves the bundled Whisper model path under `assets/whisper/models/`; the release build includes and verifies the required model files.
- Phase 4 is mostly complete; remaining work is broader manual QA across real recordings.
- Timeline edits now persist as local project state, MP4/WebM/GIF downloads render pending timeline edits before format export, and project/transcript/caption sidecars can be exported/imported; richer export settings are normalized and migrated with project schema v2.
- Local project state now persists timeline/transcript/export metadata for saved local recordings. The editor has a first-pass integrated video/timeline/transcript layout and a visible local project summary for autosave state, clips, transcript words, chapters, zooms, export preset, and sidecar choices.
- Remote support/help links have been converted to local extension pages and diagnostic ZIP flow.

## Principles

1. Local by default means no account, no paid tiers, no paid plans, no starter/team/business/enterprise plan gates, no member-only modes, no free trials, no entitlement checks, no license-required prompts, no account-level gates, no hosted dashboard, no remote telemetry, and no background upload.
2. SayLess is not freemium. Everything developed for the extension stays free, with no hidden capability differences by account level, plan name, or membership state.
3. Network use must be explicit, removable, and off by default.
4. A recording is user data. Store it locally, make location and quota visible, and provide export/delete controls.
5. Editing should become non-destructive. Blob mutation can remain as an export/apply step, not the source of truth.
6. Reliability work stays conservative. The recorder recovery engine is valuable and should not be casually rewritten.

## Phase 1: Finish The Local-Only Cutover

Goal: make the extension's install surface and UI match the local-only product.

- Completed: removed inherited cloud recorder entries from the build.
- Completed: removed `externally_connectable` entries.
- Completed: removed Google Drive OAuth, identity permission, Drive UI, and Drive background handlers.
- Completed: pinned release host permissions to the single `<all_urls>` grant needed for recorder UI injection; release audit fails if additional persistent host permissions are added.
- Completed: removed Pro/account/subscription/pricing/waitlist copy from active popup/editor/menu flows.
- Completed: replaced dashboard/library paths with the local Videos tab.
- Completed: removed cloud video fetch/cache handlers from active product paths.
- Completed: remote support/error/report handlers now stay local and keep diagnostic ZIP export as the support artifact.
- Completed: removed the leftover editor token/Drive-derived state and renamed diagnostic ZIP keys/events to local recording/export terms; release audit now blocks those inherited account/cloud diagnostic names from returning.
- Completed: renamed active cloud/account-era runtime protocol strings and user-visible finalization copy to local SayLess terms; remaining Screenity references are DOM/storage/message compatibility names, WebCodecs test hooks, or fork acknowledgements.
- Completed: moved active recorder chunk storage helpers out of the inherited CloudRecorder path, renamed OPFS chunk storage/diagnostics to local recorder terms, and removed stale cloud recovery protocol strings from the download recovery page.
- Completed: removed the inherited `src/pages/CloudRecorder` source tree; release audit now fails if that hosted recorder path reappears.
- Completed: renamed release/build/test environment flags from `SCREENITY_*` to `SAYLESS_*` and added an audit check for stale Screenity build/test flag names in package/config/test paths.
- Completed: release audit fails if active source, SVG source assets, or built JS bundles contain forbidden network endpoint literals; bundled JS is also checked for stale cloud/account protocol strings and remote transcription/provider endpoints.

Validation:

- `npm run build:release` produces an extension that has no cloud recorder page, no account UI, no external app host, and no OAuth section.
- `npm run test:e2e:built-extension-surface` loads the packaged extension pages in Chrome/Chromium, mounts the packaged content script on a local page, opens the popup Videos tab, verifies the local-library surface, and scans rendered text and accessible labels for paid, account-gated, hosted dashboard, cloud recorder/upload, sign-in, subscription, and Google Drive calls to action.
- Searching active source for `app.screenity.io`, `SCREENITY_ENABLE_CLOUD_FEATURES`, `handle-login`, `pricing`, `isSubscribed`, `drive.file`, `clipboardWrite`, `cloud-local-playback`, `cloud-telemetry`, and account-token cleanup keys finds no active product paths.
- A fresh unpacked install can record, reopen locally, edit, and export without signing in.
- Any feature developed for SayLess is free to use in the extension; release checks should keep blocking paid tiers, paid plans, named account plans, member-only modes, locked-feature copy, free trials, entitlement checks, license-required prompts, paywalls, subscription prompts, and hidden account-level gates.
- The required all-sites page access is for local recorder UI injection and annotation controls, not for account, paid-tier, cloud upload, telemetry, or remote transcription behavior; release checks should keep blocking added persistent host permissions beyond that known recorder requirement.

## Phase 2: Make Offline Transcription Complete

Goal: transcript editing works on a clean offline install after assets are bundled.

- Bundle a small default Whisper model as an extension asset.
- Completed: bundled `onnx-community/whisper-base_timestamped` model assets under `src/assets/whisper/models/` for offline release packaging.
- Completed: `local-whisper` release defaults set `allowRemoteModels: false`.
- Completed: release defaults wire `localModelPath` to `chrome.runtime.getURL("assets/whisper/models/")`.
- Completed: added a checked-in Whisper asset manifest and `npm run verify:whisper-assets` preflight with byte-size and SHA-256 integrity checks for release packaging.
- Completed: add a clear model status UI for bundled model readiness, missing files, refresh, and approximate storage used.
- Completed: add language selection and persist it in local transcription settings.
- Completed: cache transcript results per local recording id, model id, language, and source checksum.
- Completed: add transcript regeneration and delete-transcript controls.
- Completed: classify local transcription failures for unsupported browser/audio decode, missing model assets, storage quota exhaustion, privacy-mode blocks, and very large recordings with actionable recovery messages.

Validation:

- Disable network, install the release build with bundled model assets, and generate a transcript.
- `privacyMode: true` blocks remote providers in tests.
- Local transcript cache survives closing and reopening the editor.

## Phase 3: Turn Timeline Into Durable Project State

Goal: edits are saved as data, not only as new blobs.

- Define a local project schema for each recording:
  - source recording reference,
  - transcript metadata,
  - timeline clips,
  - mute/delete operations,
  - future overlay tracks,
  - export settings.
- Completed: save timeline/project state alongside the local recording entry.
- Completed: reopen a local recording with the same transcript, timeline, and selected clip.
- Completed: MP4 download renders pending timeline edits directly, so export matches the non-destructive timeline preview without requiring a manual "Apply edits" bake step.
- Completed: WebM and GIF exports use the same timeline-rendered source; WebM falls back to the timeline-correct MP4 if WebM conversion fails.
- Completed: project sidecar JSON export/import for transcript, timeline, thumbnail metadata, and export settings.
- Completed: old media-only local library entries get a default full-span project sidecar on export.
- Completed: project schema v2 normalizes richer export settings for format, quality preset, sidecar inclusion, audio-only export, GIF snippet bounds, and caption style, with migration tests.
- Completed: editor Save panel now shows local project autosave state and a summary of persisted project contents plus selected export/sidecar settings.
- Completed: local browser e2e covers generated recording -> local library -> transcript-driven timeline edit -> reopen -> timeline-rendered export.
- Keep blob checkpointing as a compatibility/autosave fallback, not the main edit model.

Validation:

- Delete/mute/reorder timeline edits persist after editor reload without baking a new blob.
- Export from a reopened project matches the preview.
- Unit tests cover project schema migrations, export settings normalization, and source/output time mapping; local browser e2e covers reopen and timeline-rendered export after transcript-driven edits.

## Phase 4: Local Library UX

Goal: the Videos tab becomes a real local recording manager.

- Completed: generate/store local thumbnails after import and edited exports when the browser can decode the media.
- Completed: tuned local thumbnails to avoid likely blank first frames, preserve source aspect ratio, and store a higher-quality 480x270-bounded JPEG.
- Completed: add rename, delete, duplicate, export/download file, and copy local metadata actions.
- Completed: add import recording action.
- Completed: add optional save-to-user-chosen-file actions for local library and editor exports where the File System Access API allows them.
- Completed: show duration, file size, created date, edited status, storage backend, and transcript status on local library items.
- Completed: add local library search and filters for recorded today, has transcript, edited, large files, and failed/missing media.
- Completed: add storage/quota panel using the OPFS and IndexedDB estimates exposed by the local library.
- Completed: flag missing media and remove stale index entries from the Videos tab.
- Completed: detect unreferenced local media and clean up orphaned IndexedDB blobs.
- Completed: add real-browser coverage for orphaned OPFS file cleanup.
- Completed: add bulk delete/export actions.
- Completed: add storage pressure warnings for near-limit and critical browser quota usage.

Validation:

- Local recordings e2e covers create/list/open/rename/delete/sort, project persistence, transcript-driven timeline edit/export after reopen, duplicate, import, export packaging, bulk delete/export, storage pressure levels, missing-media repair, orphaned IndexedDB blob cleanup, and orphaned OPFS file cleanup. Unit tests cover local library search/filter semantics.
- Missing OPFS or IndexedDB media produces a repairable state, not a generic editor load error.

## Phase 5: Editor UX And Automation

Goal: make editing faster, more understandable, and less manual.

- Completed: replace the transcript-only floating drawer in edit mode with a first-pass integrated layout where video, timeline, and transcript are visible together; the floating drawer remains available as a fallback component mode.
- Completed: add timeline-scoped undo/redo history, visible Undo/Redo controls, and keyboard shortcuts for delete/backspace clip removal, M mute toggle, S split at playhead, J/L and arrow-key review seeking, and Cmd/Ctrl-Z/Y redo/undo.
- Completed: add silence detection and suggested cuts, computed locally from decoded audio waveforms.
- Completed: add local transcript-derived cut suggestions for filler words, repeated words, filler phrases, and long transcript pauses.
- Completed: add automatic chapter/section markers from transcript pauses, decoded audio silence, and an extensible local activity-event input.
- Completed: use captured click events to suggest zoom moments and persist editable local zoom keyframes in project sidecars.
- Completed: add WebVTT export from the saved transcript/timeline.
- Completed: add local caption style presets and optional burned-in caption export using the persisted project schema v2 caption settings.
- Completed: add local export preset controls for MP4/WebM/GIF, original/compressed quality metadata, GIF snippet bounds, and checked project/transcript/caption sidecar downloads using persisted project schema v2 settings.
- Completed: add audio-only WAV/M4A export backed by the local timeline renderer so clip order, cuts, and mutes match the project state.
- Completed: move local exports to a visible job panel with progress, cancel where supported, retry after failures/cancel, completion notification, and reveal action when Chrome exposes a download id.

Validation:

- Common editing tasks can be completed without modal-heavy flows.
- Preview remains responsive on long recordings.
- Export jobs can be canceled and retried without corrupting the local project.

## Phase 6: Export And Interop Without Cloud Lock-In

Goal: sharing remains user-controlled and local-first.

- Keep direct file download as the primary export.
- Completed: add optional export to a user-chosen local file through the File System Access API where the browser exposes it, with Chrome downloads retained as the fallback.
- Completed: add project backup/import as portable `.sayless-project.json` sidecars containing transcript, timeline, thumbnail metadata, and export settings.
- Completed: add sidecar exports for `.vtt` captions and standalone transcript JSON.
- If any network destination is added later, implement it as an explicit opt-in connector with clear docs and no default background upload.

## Near-Term Task List

Highest leverage next changes:

1. Run broader manual QA on long local recordings, especially actual MP4/WebM/GIF cancellation timing, retry after partially completed real exports, reveal action behavior with Chrome downloads, and real-recording offline transcription timing/quality across varied speakers and microphones, using `docs/RELEASE_QA.md`; browser harness coverage now proves timeline video/audio render aborts at the renderer layer and that the packaged extension can create and observe a completed local Chrome download id.
2. Broaden manual QA coverage for local audio silence suggestions on varied real browser codecs and noisy microphone environments; generated WebM audio, timeline-rendered M4A export/decode, and deterministic noisy-room fixtures are now covered in the browser harness.
3. Broaden manual visual QA coverage for saved local zoom keyframe preview and MP4 export rendering on varied real recordings; synthetic wide/square/portrait export framing is now covered in the browser harness.

Completed package-size hardening:

- Removed the stale promo video from the release assets.
- Prevented webpack from emitting a duplicate ONNX Runtime WASM fallback; the release build now keeps the copied `build/ort/` runtime as the single ORT source.
- Added release-audit checks for stale promo media and duplicate large build assets. Current audited release build size is 118.6 MB, including 76.0 MB of bundled Whisper assets.
- Tightened release-audit bundle checks so paid tiers, paid plans, free trials, entitlement checks, license-required prompts, subscriptions, billing, pricing, paywalls, account-level gates, and subscription-state code cannot re-enter release JavaScript.
- Tightened release-audit source, built-surface, and bundle checks so account tiers, paid accounts, paid memberships, named plan/tier gates, enterprise-only copy, plan/tier/subscription-required gates, locked-by-plan wording, contact-sales gates, sales-gated copy, license keys, and activation prompts cannot re-enter the free extension surface.
- Added `docs/STORE_LISTING.md` as the canonical Chrome Web Store copy draft and made release audit require and scan it for paid-tier, account-gate, cloud-upload, hosted-dashboard, Google Drive, and remote-transcription publication copy.
- Tightened manual publication-surface evidence so the `store-text` artifact must explicitly name `docs/STORE_LISTING.md`, preventing release QA from reviewing an alternate or vague store copy draft.
- Tightened release status and release-prep handoffs so `docs/STORE_LISTING.md` is explicitly listed with the release evidence and ZIP artifacts, and manual QA todo text points store-text review at that canonical draft.
- Tightened release metadata checks so `package.json`, `docs/STORE_LISTING.md`, and the packaged extension description must state free-to-use, offline, local-first, on-device transcription, word-based editing, and no-signup positioning while rejecting paid/account/cloud/remote publication-surface copy.
- Tightened release-audit locale checks so source and packaged extension strings cannot reintroduce paid-tier, account, sign-up, hosted dashboard, cloud upload, upgrade, or inherited storage-quota copy.
- Tightened release-audit source and bundle checks so stale cloud recovery protocol strings, inherited CloudRecorder recorder-storage imports, cloud OPFS chunk names, and Screenity recovery filenames cannot re-enter active release paths.
- Tightened release-audit source-path checks so the removed `src/pages/CloudRecorder` hosted recorder tree cannot re-enter the release worktree unnoticed.
- Tightened release-audit package/config/test/source checks so stale `SCREENITY_*` build, browser-harness, debug, and keepalive names cannot re-enter the release workflow.
- Renamed active non-compatibility editor/content UI names for scrollbars, gradient backgrounds, player loading states, sandbox toast animations, and editor debug globals to SayLess terms; release audit blocks those stale active Screenity UI/debug names from returning.
- Tightened release audit so inherited Screenity product/account/cloud identifiers cannot re-enter active extension source; remaining Screenity references are constrained to compatibility DOM/message hooks, docs, acknowledgements, or explicit test compatibility selectors.
- Tightened release-audit source checks so dynamic local URL sinks must validate blob export/download URLs and extension-page/catalog URLs before `fetch`, `XMLHttpRequest`, `window.open`, Chrome downloads, or object URL revocation.
- Added offline Whisper asset-readiness browser coverage so a clean local server can load the bundled model manifest, probe all required model files, and report a ready status without downloading model assets.
- Added an optional slow offline transcription smoke harness that loads bundled Whisper plus local ORT in Chrome and runs inference on generated audio without remote model downloads.
- Added an optional generated-speech offline transcription harness that creates temporary macOS `say` clean, deterministic noisy, and longer paused WAVs and verifies bundled Whisper recognizes expected words with monotonic word timestamps in all fixtures without remote model downloads.
- Converted the legacy developer transcription harness from a remote Hugging Face JFK fixture and remote-model opt-in path to bundled Whisper assets, local ORT files, and a generated local WAV fixture; release audit blocks the old remote harness URL/env/model-download path from returning.
- Added an optional built-extension surface smoke that opens packaged extension pages, exercises the packaged content-script popup Videos tab on a local page, and verifies rendered text/labels contain no paid/account/cloud calls to action.
- Hardened the built-extension surface smoke so page-level JavaScript errors and console errors on packaged extension pages or the mounted popup fail release automation instead of only appearing in summaries.
- Changed packaged extension page asset URLs to default to relative paths, preventing root-relative extension assets from resolving through `chrome-extension://invalid/` and surfacing as console errors.
- Extended the built-extension surface smoke to fetch the bundled Whisper manifest and all seven required model files from packaged extension URLs, so release automation proves the built extension can read its offline transcription assets at runtime.
- Extended the packaged-extension smoke with a local Chrome download-id probe so reveal-action state has real `chrome.downloads` completion evidence in the built extension.
- Fixed packaged content-script popup regressions caught by that smoke: popup drag positioning no longer assumes a `react-rnd` imperative position getter, Radix popover autofocus receives a function instead of a boolean, toast calls accept duration-only shorthand, and content messaging imports the shared timer setter used by popup toggles.
- Added long-waveform unit coverage for local audio silence suggestions, including multiple separated pauses in a ten-minute recording and multi-channel false-positive prevention.
- Added browser coverage for local audio silence suggestions on deterministic noisy-room audio so low-level background noise still yields one quiet-room pause without cutting louder regions.
- Added browser coverage that exports generated local audio to M4A through the timeline renderer, decodes the exported M4A through the local transcription audio path, and verifies the expected silence suggestion survives.
- Added zoom preview/export transform parity coverage across square, portrait, and wide aspect ratios, plus tall/wide edge-click framing checks.
- Added real-browser zoom-rendered export pixel coverage across wide, square, and portrait synthetic recordings.
- Added real-browser thumbnail pixel coverage so generated local recording thumbnails are JPEGs with the expected dimensions and a nonblank center pixel from the captured video frame.
- Added timeline-preview coverage for long 1,000-clip timelines, reordered clip seeks, deleted-gap snaps, muted clips, and near-clip-end resync so preview does not jump back toward the beginning after a scrub.
- Added export-job state coverage so user-cancelled save dialogs finish as retryable cancelled jobs instead of misleading completed exports.
- Added export-job lifecycle coverage so completed exports can reveal the correct Chrome download id, then a later retry clears stale reveal ids before becoming a retryable cancelled job.
- Hardened export retry snapshots so cancelled or failed retries preserve the selected format, quality preset, sidecar choices, audio format, caption burn-in/style, audio-only state, and GIF bounds instead of falling back to partial defaults.
- Added browser harness coverage for export-job progress, cancellation, retry snapshot preservation, completed reveal eligibility, save-result completion mapping, and dismiss state alongside the local recording/export workflow.
- Added abort-signal support to the local timeline video/audio renderers and browser harness coverage that aborts both render paths mid-progress.
- Added `npm run qa:release:auto` to run unit tests, the offline Whisper asset-readiness harness, the bundled-Whisper startup/inference smoke, the macOS generated-speech offline transcription harness when available, the local-recordings browser harness, release build, packaged-extension paid/account/cloud surface smoke, and release audit in one pass, with evidence written to `release-artifacts/release-qa-automated.json`.
- Hardened automated release QA so starting or failing `npm run qa:release:auto` overwrites stale passing automated evidence with non-passing running/failed evidence before manual QA can reference it.
- Hardened automated release QA evidence so successful runs explicitly record `status: "passed"`, and manual/package/CWS verifiers reject automated evidence without that pass status.
- Hardened automated release QA evidence so successful runs record the release build manifest surface for OAuth, external connectivity, identity, Google Drive, and remote `connect-src`, and manual QA verification rejects forbidden or drifted manifest-surface evidence before packaging.
- Tightened release audit so `package.json`, `package-lock.json`, the package-lock root package version, source manifest, and build manifest must agree before release QA can pass.
- Added `npm run qa:release:manual` plus `docs/MANUAL_QA_EVIDENCE.md` so release-specific real-recording manual QA evidence is structured and machine-checked before publishing.
- Hardened manual QA evidence so the top-level manual evidence file must carry `status: "passed"`, and package/CWS verifiers reject non-passing or drifted manual QA status before artifact reuse.
- Hardened the manual QA evidence verifier with a fixtureable release root override, and added release-audit coverage so manual evidence checks stay testable like the automated, package, and CWS verifiers.
- Routed generic, release, CWS packaging, and CWS publish commands through the manual evidence verifier so `extension.zip`, `build-cws.zip`, and Chrome Web Store publish actions cannot proceed without release-specific manual QA evidence that matches the automated build fingerprint.
- Tightened the manual offline-transcription evidence gate so release QA must record the bundled-model-ready UI status and a failed external network probe while real recordings still transcribe locally.
- Tightened the manual offline-transcription evidence gate so the failed external network probe must include a structured external HTTP(S) URL, failure status, observed browser error, and same-profile confirmation.
- Tightened the manual export evidence gate so cancel/retry/reveal QA must name the real recording, video export format, and completed Chrome download/reveal observation instead of relying on generic pass notes.
- Tightened the manual export evidence gate so each required export must have a unique filename that matches its declared format and notes that describe how the artifact was opened, played, imported, decoded, previewed, viewed, loaded, listened to, or inspected.
- Tightened the manual reveal-action evidence gate so a vague reveal note is not enough; evidence must mention a completed export/download and the Chrome download id, reveal, open, or show-in-folder observation.
- Tightened the manual Save to file evidence gate so workflow notes must describe the user-chosen file/folder flow when verified, explain File System Access unavailability when unavailable, and separately record save-dialog cancellation behavior.
- Tightened the manual offline-transcription evidence gate so network-isolation notes must name the disabled/blocked/offline method, failed-probe summaries must mention the bundled/local Whisper model staying ready or loaded, and transcript quality notes must tie real speaker/voice/recording quality to word timing, timestamps, accuracy, or usability.
- Tightened the final publication-surface evidence gate so reviewed-artifact notes must describe reviewing paid/account/cloud/remote/local-only claims and residual-risk fields must explicitly state no residual risk/no remaining risk or name the residual risk.
- Tightened the top-level manual checklist evidence gate so checklist notes and observations must describe observed/confirmed/verified local or offline release behavior, and checklist artifacts must identify concrete screenshots, reports, logs, recordings, exports, transcripts, videos, images, JSON/VTT/media files, or notes.
- Tightened the manual real-recording evidence gate so each listed recording source must describe a tab/browser/region/desktop/screen/window capture or recording, each container must identify MP4 or WebM, and recording notes must describe observed/confirmed/verified local or offline recording behavior.
- Tightened the manual silence-suggestion evidence gate so release QA must record concrete suggested quiet ranges and ignored noisy ranges tied to listed real recordings.
- Tightened the manual zoom evidence gate so release QA must prove click metadata, keep/remove, preview, persisted keyframes after reopen, and inspected MP4 export framing on a real tab/region recording.
- Tightened the manual local-library recovery evidence gate so release QA must record duplicate-reopen, sidecar-import, bulk-export-delete, orphan-cleanup, and missing-media-repair observations instead of a generic recovery note.
- Tightened the final publication-surface evidence gate so release QA must record searched no-paid/no-account/no-cloud terms and residual-risk notes for release notes, screenshots, and store text.
- Tightened the final publication-surface evidence gate so release QA must also search premium, trial, entitlement, license-required, upgrade, and feature/account gate wording before release notes, screenshots, or store text can pass.
- Tightened the top-level manual checklist evidence gate so each checklist pass must include structured artifact and observation evidence, with listed recording ids for real-recording checks.
- Tightened the manual real-recording evidence gate so listed recording ids must be unique before exports, offline transcription, silence suggestions, zoom, recovery, or checklist evidence can reference them.
- Tightened multi-recording manual evidence so offline transcription, silence-suggestion, bulk recovery, and checklist coverage must reference distinct listed recording ids rather than repeating one recording.
- Replaced shell-based release zipping with a Node packaging gate that verifies manual QA evidence, reruns the no-secrets scan, creates `extension.zip`, writes `release-artifacts/package-release.json` with zip size, SHA-256, git state, and build fingerprint, then self-verifies the written package before reporting success.
- Hardened package evidence so `package-release.json` records and verifies build byte count and formatted build size alongside the build file count and fingerprint.
- Hardened the package-release gate so it runs the checked-in manual QA evidence verifier with the release root override, preventing alternate-root packaging from substituting a weaker verifier.
- Hardened the package-release gate so it runs the checked-in no-secrets scanner against the release build directory, preventing alternate-root packaging from substituting a weaker secret scan.
- Hardened the release audit so alternate-root verification runs checked-in Whisper asset and no-secrets helpers against the selected release root instead of trusting helper scripts from that root.
- Hardened the no-secrets scanner so text SVG assets in the release build are scanned instead of skipped as binary media.
- Hardened the release audit source scanner so SVG source assets are treated as text for paid/account/cloud and network endpoint checks.
- Hardened the manual QA evidence gate so it must reference the canonical `release-artifacts/release-qa-automated.json` file and exact automated release harness commands before packaging can proceed.
- Hardened the manual QA evidence gate so automated evidence, build, bundled Whisper, and `environment.extensionSource` paths must stay canonical relative paths rather than machine-local absolute paths.
- Hardened the manual QA evidence gate so automated release QA evidence must include a valid run window (`startedAt`, `generatedAt`, and positive `durationMs`) before manual evidence can bless it.
- Hardened the manual QA evidence gate so automated release QA evidence must have internally consistent timing and an exact command inventory with no duplicate, unexpected, or overlong command records.
- Hardened the manual QA evidence gate so automated build and bundled-Whisper byte counts, formatted sizes, file counts, and fingerprints must match the current release build before manual evidence can bless it.
- Hardened the manual QA evidence gate so automated release QA evidence must include git branch, commit SHA, and dirty-state provenance before packaging can proceed.
- Hardened automated release QA provenance so manual/status gates compare the recorded worktree fingerprint against the current dirty source state, preventing source edits after automated QA from being published under stale evidence.
- Hardened manual QA template generation so stale or incomplete automated evidence does not pre-fill release-specific manual evidence timestamps or build paths.
- Hardened the manual QA clean-profile helper so it refuses to print or launch the Chrome manual-test command unless automated QA evidence matches the current build and current git worktree fingerprint.
- Hardened release package verification so `package-release.json` git provenance must be present and match the automated QA evidence that produced the build.
- Hardened release and CWS package provenance so package evidence carries the automated QA worktree fingerprint and verifiers reject package/CWS evidence whose worktree fingerprint drifts from the automated source state.
- Hardened release and CWS package evidence so `package-release.json` records the automated QA pass status and verifiers reject missing, non-passing, or drifted status before artifacts can be reused.
- Hardened release and CWS package evidence so `package-release.json` and `cws-package.json` both carry top-level `status: "passed"` and verifiers reject non-passing artifact evidence before reuse.
- Hardened release and CWS package verification so package evidence timestamps must be valid and ordered after the automated/manual evidence they package, and CWS evidence must be ordered after package evidence.
- Hardened release and CWS package evidence so both artifacts carry an explicit `releaseVersion` that must match their referenced automated, manual, and package evidence.
- Hardened CWS package evidence so `cws-package.json` records and verifies the same git provenance as the package evidence used to create `build-cws.zip`.
- Hardened CWS package evidence so `cws-package.json` records and verifies source `extension.zip` byte counts and formatted size alongside the SHA-256 before store upload can proceed.
- Hardened CWS package verification so `cws-package.json` source zip SHA-256, byte count, and formatted size must also match the referenced `package-release.json` zip evidence, not only the zip file on disk.
- Hardened CWS package evidence so the nested `packageEvidence` record carries and verifies the referenced package release version and generation timestamp alongside the package evidence hash.
- Hardened release and CWS package evidence so formatted zip sizes must match the verified artifact byte counts instead of remaining stale release-note copy.
- Tightened automated QA evidence so every required release command must carry a passed status, executed command string, and non-negative duration before manual evidence can approve the build.
- Tightened package evidence traceability so `release-artifacts/package-release.json` records SHA-256 hashes for the exact automated and manual evidence files used to create `extension.zip`.
- Tightened package evidence traceability so the automated and manual evidence references in `package-release.json` carry and verify the release version from the exact evidence files they hash.
- Tightened package evidence traceability so `package-release.json` must name the canonical `extension.zip` path before a release package can verify.
- Tightened CWS evidence traceability so `cws-package.json` must name the canonical `release-artifacts/package-release.json`, `extension.zip`, and `build-cws.zip` paths before a CWS package can verify.
- Tightened CWS evidence traceability so `cws-package.json` carries automated and manual QA evidence summaries copied from `package-release.json`, and the CWS verifier rejects drift before store upload or publish actions.
- Tightened release artifact evidence so package and CWS verifiers reject absolute machine-local artifact paths and require canonical relative paths for portable review.
- Added `npm run verify:release-package` so `extension.zip` can be independently checked against package evidence, uncompressed zip contents, the current build fingerprint, and the automated/manual QA evidence hashes before any manual release attachment.
- Hardened `npm run verify:release-package` so standalone package verification reruns the manual QA evidence verifier instead of trusting matching hashes and marker fields alone.
- Replaced shell-copy CWS packaging with a Node gate that runs the verified release package step, copies `extension.zip` to `build-cws.zip`, verifies both hashes match, writes `release-artifacts/cws-package.json`, and self-verifies the CWS package before reporting success.
- Hardened CWS packaging so it runs the checked-in release package gate with the CWS root override, preventing alternate-root CWS packaging from substituting a weaker release packager.
- Hardened release audit so the `release:cws:force` alias must delegate to the verified `release:cws` flow instead of becoming a store-upload evidence bypass.
- Hardened CWS preflight so upload and publish commands require `qa:release:status -- --require-ready`, proving automated QA, manual QA, release package evidence, and CWS package evidence are all ready immediately before store actions.
- Hardened release audit so any npm script that invokes `chrome-webstore-upload` directly must also run `preflight:cws` and `verify:cws-package` before the store action, preventing new upload/publish aliases from bypassing release evidence gates.
- Hardened release artifact writes so `extension.zip`, `build-cws.zip`, and their evidence JSON files are written through temporary files and atomic renames rather than unlinking or direct-copying final artifact paths.
- Hardened release and CWS packaging so both packagers overwrite stale package evidence with non-passing running/failed evidence before and after failed runs, preventing interrupted packaging attempts from leaving old passing artifact evidence reusable.
- Hardened release and CWS package verifiers so failed/incomplete package evidence reports the recorded remaining release work and failed step, making failed artifact evidence auditable instead of only reporting generic status drift.
- Added a CWS package verifier and wired CWS upload/publish scripts through it so store actions require the current `build-cws.zip`, `extension.zip`, package evidence, automated evidence hash, and manual evidence hash to match.
- Hardened release audit pattern coverage so account-required, sign-in-required, locked-behind-plan, pay-to-unlock, upgrade-required, and subscription-only wording cannot re-enter active source, packaged locale text, rendered release surfaces, or built bundles.

## Deferred Or Rejected For Now

- Hosted dashboard and automatic cloud upload.
- Screenity account auth and subscription gating.
- Bunny/TUS upload path.
- Remote telemetry as a default behavior.
- Multi-scene cloud projects before local timeline/project persistence is solid.
- Backend transcription as a default provider.

Remote providers can stay as development hooks only if privacy mode blocks them in release builds and the UI makes network use explicit.
