# SayLess Capabilities Inventory

This document describes the current worktree, not the upstream Screenity product page. It is meant to separate working local features from remaining local-first gaps.

## Product Shape

SayLess is a Manifest V3 Chrome extension for local screen recording, live annotation, local recording management, and in-browser editing. The fork is moving away from Screenity's hosted Pro product toward a device-local tool:

- No account is required for the main recording and editing flow.
- Recordings are stored locally in OPFS or IndexedDB.
- The Videos tab now loads the local recording library by default.
- Transcript editing is implemented through a local Whisper provider and a non-destructive timeline/EDL layer.

SayLess is not a freemium product. Everything developed for SayLess is free to use in the extension, and release work should not introduce paid-only features or account-level feature differences. There are no paid tiers, paid plans, starter/team/business/enterprise plan gates, member-only modes, free trials, paywalls, entitlement checks, license-required prompts, subscription prompts, premium-only controls, or account-level feature gates. The hosted cloud recorder, Screenity auth, subscription gating, Google Drive OAuth export, external website handshake, and hosted upload path have been removed from the active extension surface.

## Build And Extension Surface

- Bundler: Webpack with multiple extension page entries.
- Extension model: Manifest V3 service worker plus content script on `<all_urls>`.
- Main pages: background, content script, recorder, offscreen recorder, remux offscreen page, camera, editor, waveform, region, permissions, setup, playground, and download.
- Required permissions in `src/manifest.json`: `activeTab`, `storage`, `unlimitedStorage`, `downloads`, `tabs`, `tabCapture`, `scripting`, `system.display`.
- Persistent host permission is pinned to `<all_urls>` because the recorder UI and annotation toolbar are injected into existing pages through `chrome.scripting`; release audit fails if any additional host permission is added.
- Optional permissions: `offscreen`, `desktopCapture`, `alarms`.
- Removed from the release surface: `oauth2`, `externally_connectable`, `identity`, `clipboardWrite`, `cloudrecorder.html`, cloud recorder build entry, hosted app/API build flags, Screenity auth handlers, Pro/subscription UI, and Google Drive export handlers.
- Release audit scans source and packaged locale assets so paid-tier, paid-plan, account-plan, member-only, locked-feature, locked-behind-plan, pay-to-unlock, upgrade-required, trial, entitlement, license-required, account, sign-up, hosted dashboard, cloud upload, upgrade, and inherited storage-quota copy cannot quietly re-enter the extension text.
- Release audit scans active source, SVG source assets, and built JavaScript bundles for forbidden network service endpoint literals, while allowing SVG/XML namespace metadata.
- Release audit also fails if the removed `src/pages/CloudRecorder` hosted recorder source path reappears.
- Release, build, browser-harness, debug, and keepalive environment/runtime flags use `SAYLESS_*` names; release audit blocks stale Screenity flag and keepalive names from package/config/test/source paths.
- Active non-compatibility editor/content UI names for scrollbars, gradient backgrounds, player loading states, sandbox toast animations, and editor debug globals use SayLess names; remaining Screenity DOM/message names are compatibility hooks or inherited test hooks.
- Release audit blocks inherited Screenity product/account/cloud identifiers from active extension source; remaining Screenity references should stay limited to compatibility DOM/message hooks, documentation, acknowledgements, or explicit test compatibility selectors.
- Dynamic local URL sinks validate blob export/download URLs and extension-page/catalog URLs before `fetch`, `XMLHttpRequest`, `window.open`, Chrome downloads, or object URL revocation.

## Recording

Supported capture modes:

- Desktop or application window through `chrome.desktopCapture.chooseDesktopMedia`.
- Browser tab/region flow through tab capture and region handling.
- Camera-only recording through `getUserMedia`.

Audio support:

- Microphone capture with device fallback handling.
- System audio when Chrome exposes it for the selected capture source.
- Mixed audio through `AudioContext`.
- Push-to-talk and mic controls in the recording UI.

Encoding and storage:

- WebCodecs MP4 path when device support is available.
- MediaRecorder WebM fallback.
- OPFS chunk storage preferred for large local recordings.
- IndexedDB/localforage fallback when OPFS is unavailable.
- `lastRecordingBackendRef` tells the editor whether to read from OPFS or IDB.

Reliability:

- Offscreen recorder page keeps recording work out of the MV3 service worker.
- Alarm/watchdog flows handle first-chunk failures, stalls, restart recovery, and finalization problems.
- Editor load path retries OPFS reads, falls back to IDB, and surfaces a diagnostic ZIP option when loading fails.
- Local recording entries are registered when a recording becomes ready, and edited blobs are checkpointed after changes.

## In-Page Recording UI And Annotation

The content script injects a React UI isolated from page CSS. Current capabilities include:

- Recording popup with mode selection, mic/camera/settings controls, local Videos tab, and sorting.
- Toolbar controls for stop, pause/resume, restart, discard, timer, visibility, and tool switching.
- Fabric-based annotation canvas: pen, highlighter, eraser, rectangle, circle, triangle, arrows, text, image insert, select/transform, undo/redo, clear, colors, and stroke widths.
- Blur tool for DOM elements.
- Cursor effects: click ring, highlight, hidden cursor mode, and spotlight mode.
- Camera bubble with resize, position, flip, PiP, and effects.
- Countdown, auto-stop timer, warning modals, and keyboard commands.

Known stale UI:

- Some internal state names still reference inherited concepts such as `multiMode`, but active account, pricing, hosted library, and Google Drive UI paths have been removed.
- Help and report actions now stay inside the extension and use local diagnostic ZIP export for troubleshooting.

## Local Recording Library

Implemented in `src/pages/localRecordings/localRecordingLibrary.ts` and wired into `VideosTab.jsx`.

Current behavior:

- Stores a local index in `chrome.storage.local` under `localRecordingLibraryIndex`.
- Stores small/non-OPFS blobs in an IndexedDB-backed localforage store named `local-recordings`.
- Recorder/editor fallback chunk storage uses an explicit IndexedDB-backed localforage store named `chunks`; the default localforage namespace is `sayless`.
- OPFS recorder chunk storage lives under `sayless-recorder-chunks` with local recorder diagnostics; active background/download paths import the shared chunk helpers from recorder storage rather than the inherited CloudRecorder path.
- References OPFS recordings by file name instead of duplicating the full blob.
- Stores local project metadata on the recording entry, including timeline clips, transcript data, selected clip, and normalized export settings.
- Sorts recordings by newest, oldest, A-Z, or Z-A.
- Opens recordings with `editor.html?localRecordingId=...`.
- Saves edited blobs as `edited:<recordingId>` and prefers the edited version when reopening.
- Supports rename, delete, duplicate, import, export/download, and copy-local-metadata actions from the Videos tab.
- When the browser exposes the File System Access API, the Videos tab can save single or selected exports directly to user-chosen files; otherwise it falls back to Chrome downloads.
- Shows duration, file size, created date, edited status, storage backend, and transcript status for each local recording.
- Supports local library search plus filters for recordings made today, recordings with transcripts, edited recordings, large recordings, and missing/broken media.
- Exposes local storage estimates and per-recording health checks for quota/repair UI.
- Shows a local storage summary in the Videos tab.
- Flags entries whose backing media is missing and can remove stale index entries from the Videos tab.
- Detects unreferenced local media and can remove orphaned IndexedDB blobs and OPFS files from the Videos tab.
- Supports multi-select bulk export and delete from the Videos tab.
- Shows storage pressure warnings when browser quota usage is near limit or critical.
- Stores and displays generated local thumbnails when the browser can decode the recording; invalid or unsupported media falls back to the placeholder.
- Thumbnail generation seeks past likely blank first frames by default, preserves the source aspect ratio, uses high-quality canvas scaling, and stores a 480x270-bounded JPEG for the local library and project sidecars.
- Exports and imports `.sayless-project.json` sidecars for local project backup/restore. Sidecars include recording metadata, thumbnail data, transcript, timeline clips, selected clip, and project schema v2 export settings; media remains user-controlled and is exported separately. Older media-only entries get a default full-span project sidecar on export.
- Exports standalone transcript JSON and timeline-aware WebVTT caption sidecars from saved local projects.

Current gaps:

- Thumbnail generation has unit coverage for sizing/timing and browser coverage for a nonblank generated JPEG from a deterministic video; final release still needs visual QA across varied real recording sizes and codecs.

## Editor

The editor is an in-browser React app with mediabunny-based operations.

Current capabilities:

- Opens freshly recorded blobs from OPFS or IDB.
- Reopens saved local recordings by `localRecordingId`.
- Plays recordings through native local `<video>` elements; timeline preview drives the same local source through a player-agnostic adapter.
- Supports trim, cut, mute, volume/gain, add or replace audio, crop, GIF export, WebM export, and MP4 download/remux paths.
- Uses lazy mediabunny imports and OPFS-backed reads to avoid loading large videos into memory where possible.
- Has undo/redo history for destructive editor operations.
- Autosaves local edits when a recording has a local library id.

Known limitations:

- Many classic editor operations still mutate the working blob destructively.
- Some internal state names still refer to ffmpeg even though mediabunny is the active implementation.
- Crop, audio replacement, and export surfaces now run as local editor operations without hosted-product or account assumptions.
- Local project/timeline metadata is durable for saved local recordings; blob checkpoints still exist as the compatibility/autosave fallback.

## Transcript And Timeline Editing

Implemented foundations:

- `src/transcription/` provides a provider registry, config resolver, and engine entry point.
- Default provider is `local-whisper` with `privacyMode: true`.
- Local provider uses `@huggingface/transformers`, ONNX Runtime WASM, and a timestamped Whisper model.
- Release defaults disable remote model downloads and point the local provider at `assets/whisper/models/` inside the extension package.
- The release package includes the required `onnx-community/whisper-base_timestamped` model files; `npm run verify:whisper-assets` passes for both `src` and the built extension. The bundled Whisper assets add about 76 MB to the package.
- `src/assets/whisper/model-manifest.json` defines the required local model payload with byte-size and SHA-256 integrity metadata, and `npm run verify:whisper-assets` checks it before packaging an offline release.
- The transcript drawer checks the bundled Whisper manifest at runtime, shows whether required model files are ready or missing, exposes refresh, and shows approximate bundled bytes when available.
- Local transcription failures are classified into user-facing offline recovery states for unsupported browser/audio decode, missing bundled model assets, storage quota exhaustion, privacy-mode network blocks, unsupported media, and recordings too large for the current in-browser path.
- Transcription language selection is persisted in local extension settings.
- Transcript results are cached locally by recording id, provider, model, language, and source hash.
- The transcript drawer can regenerate or delete the saved transcript.
- `src/edl/model.js` provides v1 delete/mute EDL primitives.
- `src/edl/timeline.js` provides a v2 ordered clip timeline with split, delete, mute, move, source/output time mapping, and transcript grouping.
- `src/edl/render.js` plans and applies delete/mute operations through existing editor operations.
- `TranscriptPanel.jsx` can generate a transcript, seek by word, select spans, delete or mute words, reset edits, and apply edits.
- `EdlContext.jsx` loads and saves local project state for recordings opened by `localRecordingId`.
- Edit mode uses a first-pass integrated layout with video and timeline in the main column and transcript editing in a right-side panel; the transcript component still supports its older floating drawer mode for fallback use.
- Timeline editing has a timeline-scoped undo/redo stack with visible toolbar controls and keyboard shortcuts for clip deletion, mute toggle, split at playhead, review seeking, and timeline undo/redo.
- The transcript panel computes local cut suggestions from transcript text and timings for filler words, repeated words, and filler phrases. It also decodes local audio in the browser to suggest waveform-based silence cuts; applying any suggestion creates a non-destructive timeline edit.
- The editor computes local chapter/section markers from transcript pauses and decoded audio silence, persists them in the local project sidecar, and displays them as seekable chapter shortcuts in the transcript panel. The marker builder also accepts local activity events for future cursor/click-derived sections.
- During tab and region recordings, local click events are captured as bounded recording metadata. The editor turns those clicks into local zoom-moment suggestions, lets the user keep/remove them as project zoom keyframes, persists those keyframes in `.sayless-project.json` sidecars, previews them locally, and renders them into timeline-aware MP4 exports. Preview and export share the same clamped zoom viewport math so edge-click framing is consistent.
- Project schema v2 normalizes export settings for format, quality preset, sidecar inclusion, audio-only export, GIF snippet bounds, and caption style. The editor export panel exposes MP4/WebM/GIF/audio preset controls, WAV/M4A audio format selection, caption style selection, burned-in caption toggle, and checked project/transcript/WebVTT sidecar downloads while persisting normalized settings on the local project.
- The editor export panel shows a local export job panel with progress, abort-backed cancellation for timeline video/audio renders, retry after failures or cancellation, a dismissible completion state, and a reveal action when Chrome exposes the completed download id.
- Retrying a failed or cancelled export preserves the selected local export settings, including format, quality preset, sidecar choices, audio format, caption style/burn-in, audio-only state, and GIF bounds.
- The editor export panel exposes the same optional "Save to file" path when the File System Access API is available; direct Chrome download remains the fallback. User-cancelled save dialogs return to the project without reporting a hard failure, audio export save cancellations finish as retryable cancelled jobs, and non-cancel picker failures fall back to Chrome download.
- MP4 download renders pending timeline edits directly before finalization, matching the non-destructive timeline preview without requiring a manual "Apply edits" bake step.
- WebM and GIF exports use the same timeline-rendered source as MP4; if WebM conversion fails after rendering timeline edits, the fallback is the timeline-correct MP4 rather than the unedited source. When caption burn-in is enabled, the renderer composites timeline-aware caption cues into the exported video using the selected local style preset. Audio-only WAV/M4A export uses the same resolved timeline so cuts, reorders, and muted clips match the project state.
- Unit tests cover EDL math, timeline behavior, timeline preview behavior on long 1,000-clip projects, timeline history, caption cue normalization, zoom viewport framing, render planning, project schema migrations, export settings normalization, export-job cancel/retry/reveal state transitions, save-dialog cancellation/fallback behavior, local library search/filter semantics, transcription config, bundled model status checks, classified transcription failures, and transcript cache keys. The offline Whisper assets e2e harness verifies in real Chrome that the bundled manifest and seven required model files are locally reachable and report ready without downloading model assets. The optional slow offline transcription smoke harness loads the bundled model plus local ORT in real Chrome and runs inference on generated audio without remote model downloads. The optional generated-speech offline transcription harness creates temporary macOS `say` clean, deterministic noisy, and longer paused WAVs and verifies bundled Whisper recognizes expected words with monotonic word timestamps in all fixtures without remote model downloads. The optional built-extension surface smoke verifies the packaged extension can create and observe a completed local Chrome download id, loads packaged extension pages, mounts the packaged content script on a local page, opens the popup, verifies the Videos tab renders local-library text, and verifies rendered text/labels contain no paid, account-gated, sign-in, hosted-dashboard, cloud-recorder, cloud-upload, subscription, or Google Drive calls to action. The local recordings e2e harness covers project state persistence, media-only project sidecar migration, project sidecar export/import, export settings preservation, transcript JSON/WebVTT sidecars, generated thumbnail type/dimensions, browser-decoded audio silence suggestions including deterministic WebM, M4A export/decode, and noisy-room fixtures, timeline video/audio render aborts, zoom-rendered export pixels across wide/square/portrait synthetic recordings, caption burn-in render smoke coverage, WAV/M4A audio-only render coverage, transcript cache persistence/deletion, transcript-driven timeline edit/export after reopen, duplicate, import, thumbnail persistence, export packaging, bulk delete/export, storage pressure levels, missing-media repair, orphaned IndexedDB/OPFS cleanup, export-job progress/cancel/retry/reveal/dismiss state, and reopen behavior.

Current limitations:

- Audio-waveform silence detection and chapter marker generation are implemented with conservative local thresholding, unit coverage for long waveforms, and browser coverage for decoded WebM audio, timeline-rendered M4A export/decode, ideal-silence, and deterministic noisy-room audio, but still need manual QA across varied real browser codecs and real noisy microphone environments.
- Offline transcription has asset-readiness, generated-audio inference, and macOS generated-speech recognition/timing smoke coverage for clean, longer paused, and deterministic noisy speech, but real-recording timing and transcript quality still need manual QA across varied speakers, microphones, and noisy environments in a clean extension profile.
- Saved zoom keyframes are rendered in the editor preview and timeline-aware MP4 exports, with shared viewport-framing unit coverage for center and edge click positions, preview/export transform parity, and square/portrait/wide aspect ratios. Real-browser export pixel coverage now exercises wide, square, and portrait synthetic recordings; manual visual QA is still needed across varied real recordings.
- The integrated transcript panel is functional but still visually utilitarian compared with the rest of the editor.
- Applying edits still bakes the result into the blob and resets the timeline.
- Preview and media export are now connected through the persisted timeline; the editor Save panel exposes local project autosave state, clip/transcript/chapter/zoom counts, export preset, and sidecar selections. Preview still uses live source seeking while export uses the multi-segment renderer. Long-timeline preview has unit coverage for bounded ticks, reordered seeks, muted clips, and deleted-gap snaps, but real playback responsiveness still needs manual QA on long recordings.

## Camera Effects

- Camera preview and bubble use `getUserMedia`.
- MediaPipe assets under `src/assets/mediapipeVision/` support background blur and replacement.
- Effects are local and do not require a remote service.

## Diagnostics And Tests

Diagnostics:

- Local diagnostic log and recording debug helpers exist.
- Support ZIP generation exists and is useful for local troubleshooting.
- Report/help handlers no longer open inherited remote forms.

Tests present in this worktree:

- `npm run test:unit` runs Node tests for EDL, timeline, and EDL render planning.
- `npm run test:e2e:local-recordings` exercises local recording library behavior in a browser harness.
- `npm run test:e2e:offline-transcription-smoke` runs the bundled-Whisper startup/inference smoke included in `npm run qa:release:auto`.
- `npm run test:e2e:offline-transcription-speech` runs the optional macOS generated-speech bundled-Whisper recognition smoke.
- `npm run test:e2e:built-extension-surface` runs the packaged-extension bundled-Whisper asset probe plus page/content-script popup smoke for paid/account/cloud surface regressions.
- `npm run verify:release` fails on forbidden source or packaged locale copy related to paid tiers, accounts, sign-up, hosted dashboards, cloud upload, upgrade prompts, inherited account-quota wording, stale active Screenity product/debug/keepalive names, and missing dynamic local URL guards.
- `npm run qa:release:manual` verifies release-specific manual QA evidence after a human runs the real-recording checklist, including unique recording ids for every cross-referenced real recording.
- `npm run verify:release-package` verifies the canonical relative `extension.zip` path, its hash and uncompressed contents, `release-artifacts/package-release.json`, the current build fingerprint, and the automated/manual QA evidence hashes before the direct release artifact is attached or shared.
- `npm run verify:cws-package` verifies the canonical relative `release-artifacts/package-release.json`, `extension.zip`, and `build-cws.zip` paths plus their hashes. Chrome Web Store upload and publish scripts then run `npm run qa:release:status -- --require-ready` through `preflight:cws`, so store actions require the aggregate automated/manual/package/CWS evidence set to be ready.
- Chrome Web Store upload and publish scripts, including the force alias, are audited so they must route through verified CWS package evidence and manual release QA gates.
- Additional e2e harness scripts exist for transcription, EDL, and timeline flows.

## What Is No Longer True

These claims should not be used for SayLess documentation:

- "Screenity Pro" is part of the SayLess product direction.
- Cloud video dashboard, hosted link sharing, Bunny/TUS upload, or Screenity account auth are core features.
- Google Drive sharing belongs in the SayLess local-first sharing model.
- Multi-scene recording and fully automatic zoom are complete local features.
- Generated silent-audio smoke coverage alone proves real-speech transcript timing and quality.
