# SayLess Capabilities Inventory

This document describes the current worktree, not the upstream Screenity product page. It is meant to separate working local features from inherited code that still needs removal.

## Product Shape

SayLess is a Manifest V3 Chrome extension for local screen recording, live annotation, local recording management, and in-browser editing. The fork is moving away from Screenity's hosted Pro product toward a device-local tool:

- No account is required for the main recording and editing flow.
- Recordings are stored locally in OPFS or IndexedDB.
- The Videos tab now loads the local recording library by default.
- Transcript editing is implemented through a local Whisper provider and a non-destructive timeline/EDL layer.

The migration is not finished. Cloud recorder, auth, Pro, OAuth, external app, and telemetry-adjacent modules still exist in the repository and should be treated as inherited surface area until removed.

## Build And Extension Surface

- Bundler: Webpack with multiple extension page entries.
- Extension model: Manifest V3 service worker plus content script on `<all_urls>`.
- Main pages: background, content script, recorder, offscreen recorder, remux offscreen page, camera, editor, waveform, region, permissions, setup, playground, download, and inherited cloud recorder.
- Required permissions in `src/manifest.json`: `identity`, `activeTab`, `storage`, `unlimitedStorage`, `downloads`, `tabs`, `tabCapture`, `scripting`, `system.display`.
- Optional permissions: `offscreen`, `desktopCapture`, `alarms`, `clipboardWrite`.
- Remaining inherited network surfaces:
  - `oauth2` with Google Drive `drive.file`.
  - `externally_connectable` for `app.screenity.io` and `localhost:3000`.
  - `SCREENITY_ENABLE_CLOUD_FEATURES` build flag in `webpack.config.js`.
  - Cloud recorder and Pro/auth modules still present.

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

- Multi-scene and Pro prompts still appear in parts of the popup.
- The bottom dashboard link in the Videos tab still points at `SCREENITY_APP_BASE`.
- Login/pricing/support handlers still exist in menu and welcome flows.

## Local Recording Library

Implemented in `src/pages/localRecordings/localRecordingLibrary.js` and wired into `VideosTab.jsx`.

Current behavior:

- Stores a local index in `chrome.storage.local` under `localRecordingLibraryIndex`.
- Stores small/non-OPFS blobs in an IndexedDB-backed localforage store named `local-recordings`.
- References OPFS recordings by file name instead of duplicating the full blob.
- Sorts recordings by newest, oldest, A-Z, or Z-A.
- Opens recordings with `editor.html?localRecordingId=...`.
- Saves edited blobs as `edited:<recordingId>` and prefers the edited version when reopening.

Current gaps:

- No delete, rename, duplicate, import, or export-from-library actions.
- No thumbnails generated for local recordings; the UI falls back to a placeholder.
- No quota/storage pressure UI.
- No explicit repair flow for missing OPFS files or orphaned blobs.
- No migration away from the inherited `screenity` localforage database name.

## Editor

The editor is an in-browser React app with mediabunny-based operations.

Current capabilities:

- Opens freshly recorded blobs from OPFS or IDB.
- Reopens saved local recordings by `localRecordingId`.
- Plays recordings through Plyr-based player components.
- Supports trim, cut, mute, volume/gain, add or replace audio, crop, GIF export, WebM export, and MP4 download/remux paths.
- Uses lazy mediabunny imports and OPFS-backed reads to avoid loading large videos into memory where possible.
- Has undo/redo history for destructive editor operations.
- Autosaves local edits when a recording has a local library id.

Known limitations:

- Many classic editor operations still mutate the working blob destructively.
- Some UI and state names still refer to ffmpeg even though mediabunny is the active implementation.
- Crop and some editor surfaces still carry inherited Pro-era assumptions.
- Local edit checkpoints are blob-level snapshots, not a durable project/timeline file.

## Transcript And Timeline Editing

Implemented foundations:

- `src/transcription/` provides a provider registry, config resolver, and engine entry point.
- Default provider is `local-whisper` with `privacyMode: true`.
- Local provider uses `@huggingface/transformers`, ONNX Runtime WASM, and a timestamped Whisper model.
- Remote provider exists but is blocked by privacy mode unless configuration changes.
- `src/edl/model.js` provides v1 delete/mute EDL primitives.
- `src/edl/timeline.js` provides a v2 ordered clip timeline with split, delete, mute, move, source/output time mapping, and transcript grouping.
- `src/edl/render.js` plans and applies delete/mute operations through existing editor operations.
- `TranscriptPanel.jsx` can generate a transcript, seek by word, select spans, delete or mute words, reset edits, and apply edits.
- Unit tests cover EDL math, timeline behavior, and render planning.

Current limitations:

- First-run transcription downloads a model unless a local model bundle is configured.
- The transcript drawer is functional but visually rough compared with the rest of the editor.
- Applying edits bakes the result into the blob; the project timeline is not yet saved as durable editable state.
- Preview and export are not yet unified around a single multi-segment renderer.
- Caption export is not implemented.

## Camera Effects

- Camera preview and bubble use `getUserMedia`.
- MediaPipe assets under `src/assets/mediapipeVision/` support background blur and replacement.
- Effects are local and do not require a remote service.

## Diagnostics And Tests

Diagnostics:

- Local diagnostic log and recording debug helpers exist.
- Support ZIP generation exists and is useful for local troubleshooting.
- Some reporting handlers still reference inherited remote support/error flows and should be removed or redirected to local-only export.

Tests present in this worktree:

- `npm run test:unit` runs Node tests for EDL, timeline, and EDL render planning.
- `npm run test:e2e:local-recordings` exercises local recording library behavior in a browser harness.
- Additional e2e harness scripts exist for transcription, EDL, and timeline flows.

## What Is No Longer True

These claims should not be used for SayLess documentation:

- "Screenity Pro" is part of the SayLess product direction.
- Cloud video dashboard, hosted link sharing, Bunny/TUS upload, or Screenity account auth are core features.
- Google Drive sharing is the primary local-first sharing model.
- Multi-scene recording, captions, and auto-zoom are complete local features.
- A clean install is fully offline for transcription before the model has been bundled or cached.
- The current codebase has already removed all cloud, Pro, auth, telemetry, and external app surfaces.
