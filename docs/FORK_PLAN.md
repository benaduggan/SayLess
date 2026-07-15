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

- Inherited cloud, auth, Pro, OAuth, external app, review prompt, and remote support surfaces still exist.
- First-run transcription still needs model download unless a local model path is configured.
- Local library UX is minimal.
- Timeline edits are not yet durable project state.
- Some local-first claims are stronger than the code currently proves.

## Principles

1. Local by default means no account, no hosted dashboard, no remote telemetry, and no background upload.
2. Network use must be explicit, removable, and off by default.
3. A recording is user data. Store it locally, make location and quota visible, and provide export/delete controls.
4. Editing should become non-destructive. Blob mutation can remain as an export/apply step, not the source of truth.
5. Reliability work stays conservative. The recorder recovery engine is valuable and should not be casually rewritten.

## Phase 1: Finish The Local-Only Cutover

Goal: make the extension's install surface and UI match the local-only product.

- Remove or disable inherited Screenity cloud recorder entries from the build when not used.
- Remove `externally_connectable` entries for `app.screenity.io` and localhost unless a local development handshake is explicitly needed.
- Remove Google Drive OAuth from the manifest, docs, and UI unless it is intentionally retained as an optional export plugin.
- Remove Pro/account/subscription/pricing/waitlist copy from popup, editor, welcome, and menu flows.
- Replace dashboard links with the local Videos tab or a local library page.
- Remove cloud video fetch/cache code once the local library path fully replaces it.
- Remove or localize remote support/error/report handlers. Keep local diagnostic ZIP export.
- Audit `SCREENITY_ENABLE_CLOUD_FEATURES`, `SCREENITY_APP_BASE`, and `SCREENITY_API_BASE_URL` usage and collapse dead branches.
- Rename remaining user-visible Screenity references to SayLess where license/acknowledgement context does not require the upstream name.

Validation:

- `npm run build:release` produces an extension that has no cloud recorder page, no account UI, no external app host, and no OAuth section.
- Searching for `app.screenity.io`, `SCREENITY_ENABLE_CLOUD_FEATURES`, `handle-login`, `pricing`, and `isSubscribed` finds no active product paths.
- A fresh unpacked install can record, reopen locally, edit, and export without signing in.

## Phase 2: Make Offline Transcription Complete

Goal: transcript editing works on a clean offline install after assets are bundled.

- Bundle a small default Whisper model as an extension asset or provide an explicit local model package step.
- Configure `local-whisper` with `localModelPath` and `allowRemoteModels: false` for release builds.
- Add a clear model status UI: not installed, ready, loading, failed, storage used.
- Add language selection and persist it in local transcription settings.
- Cache transcript results per local recording id, model id, language, and source checksum.
- Add transcript regeneration and delete-transcript controls.
- Improve failure messages for unsupported browser features, model load failure, quota exhaustion, and very long recordings.

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
- Save timeline/project state alongside the local recording entry.
- Reopen a local recording with the same transcript, timeline, selection, and unsaved edits.
- Replace "Apply edits" as the primary workflow with non-destructive preview plus explicit export.
- Keep blob checkpointing as a compatibility/autosave fallback, not the main edit model.
- Add migration handling for old local library entries that only have original/edited blobs.

Validation:

- Delete/mute/reorder timeline edits persist after editor reload without baking a new blob.
- Export from a reopened project matches the preview.
- Unit tests cover project schema migrations and source/output time mapping.

## Phase 4: Local Library UX

Goal: the Videos tab becomes a real local recording manager.

- Generate local thumbnails after recording finalization and after edited exports.
- Add rename, delete, duplicate, reveal/export file, copy local metadata, and import recording actions.
- Show duration, file size, created date, edited status, storage backend, and transcript status.
- Add search and filters: recorded today, has transcript, edited, large files, failed/missing media.
- Add storage/quota panel with OPFS and IndexedDB usage estimates.
- Add repair tools for orphaned OPFS files, missing blobs, and stale index entries.
- Add bulk delete/export actions.

Validation:

- Local recordings e2e covers create/list/open/rename/delete/sort.
- Missing OPFS file produces a repairable state, not a generic editor load error.

## Phase 5: Editor UX And Automation

Goal: make editing faster, more understandable, and less manual.

- Replace the rough transcript drawer with an integrated editor layout: video, transcript, and timeline visible together.
- Add keyboard editing:
  - click word to seek,
  - shift range selection,
  - delete to remove,
  - M to mute,
  - J/K/L or arrow shortcuts for review,
  - undo/redo scoped to timeline edits.
- Add silence detection and suggested cuts, computed locally from audio.
- Add filler-word and repeated-word suggestions from transcript text.
- Add automatic chapter/section markers from pauses and screen/cursor activity.
- Use captured click events to suggest zoom moments, but keep zoom keyframes editable and local.
- Add captions from the transcript with local style presets and WebVTT export.
- Add export presets: original quality MP4, compressed MP4, GIF snippet, audio-only, captions sidecar.
- Move long exports to a visible job queue with progress, cancel, retry, and completion notification.

Validation:

- Common editing tasks can be completed without modal-heavy flows.
- Preview remains responsive on long recordings.
- Export jobs can be canceled and retried without corrupting the local project.

## Phase 6: Export And Interop Without Cloud Lock-In

Goal: sharing remains user-controlled and local-first.

- Keep direct file download as the primary export.
- Add optional export to a user-chosen local file through browser-supported APIs where available.
- Add project backup/import as a portable archive containing project JSON, transcript, thumbnails, and media references or media copy.
- Add sidecar exports: `.vtt`, `.json` transcript, timeline/project JSON.
- If any network destination is added later, implement it as an explicit opt-in connector with clear docs and no default background upload.

## Near-Term Task List

Highest leverage next changes:

1. Remove Pro/account/dashboard UI from `RecordingTab.jsx`, `VideosTab.jsx`, `SettingsMenu.jsx`, `Welcome.jsx`, `Title.jsx`, `ShareModal.jsx`, `ProBanner.jsx`, and related i18n strings.
2. Remove cloud build/page entries and manifest external surfaces after confirming no local path depends on them.
3. Add local recording actions: rename, delete, and thumbnail generation.
4. Persist transcript and timeline state in `localRecordingLibrary`.
5. Bundle or configure a local Whisper model for release builds.
6. Build a first-pass integrated editor layout for transcript plus timeline.
7. Add e2e coverage for record -> local library -> reopen -> transcript edit -> export.

## Deferred Or Rejected For Now

- Hosted dashboard and automatic cloud upload.
- Screenity account auth and subscription gating.
- Bunny/TUS upload path.
- Remote telemetry as a default behavior.
- Multi-scene cloud projects before local timeline/project persistence is solid.
- Backend transcription as a default provider.

Remote providers can stay as development hooks only if privacy mode blocks them in release builds and the UI makes network use explicit.
