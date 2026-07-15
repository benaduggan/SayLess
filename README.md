# SayLess

SayLess is a local-first Chrome extension for screen recording, annotation, and transcript-based video editing.

It records screen, tab, region, and camera video in the browser; stores recordings on the device; lets you annotate while recording; and opens the result in an in-browser editor. The current fork adds a local recording library plus an on-device transcription and non-destructive timeline foundation for editing video by selecting words.

SayLess is a fork of [Screenity](https://github.com/alyssaxuu/screenity) by [Alyssa X](https://alyssax.com), licensed under GPLv3. See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) for the current feature inventory and [docs/FORK_PLAN.md](docs/FORK_PLAN.md) for the roadmap.

## Current Features

- Record desktop, application window, browser tab/region, or camera-only video.
- Capture microphone audio, system audio where Chrome exposes it, and mixed audio sources.
- Use a local-first recorder pipeline with WebCodecs MP4 when available and MediaRecorder WebM fallback.
- Store recording chunks in OPFS when available, with IndexedDB fallback.
- Recover recordings after service worker restarts, tab closure, encoder stalls, or incomplete finalization.
- Annotate pages while recording with pen, highlighter, shapes, arrows, text, image insert, eraser, undo/redo, blur, cursor effects, countdown, and camera overlay controls.
- Apply local MediaPipe camera blur and background replacement.
- Browse local recordings from the extension's Videos tab and reopen them in the editor.
- Edit recordings in-browser: trim, cut, mute, crop, add/replace audio, adjust volume, and export MP4, WebM, or GIF.
- Generate transcripts with the local Whisper provider, then delete or mute selected words through the EDL/timeline editor.
- Autosave edited local recordings back into the local library.
- Export support diagnostics as a local ZIP for debugging.

## Local-First Notes

The intended product direction is offline and local-only. The current codebase is partway through that migration:

- Recording, annotation, local library, editing, EDL/timeline logic, and transcription inference all run in the browser.
- First-run transcription may still download a Whisper model through `@huggingface/transformers` unless a local model path is configured. After the model is cached, inference is local.
- Inherited Screenity cloud, auth, Pro, Google Drive OAuth, external-connectable, and telemetry-related code still exists in places. Most cloud video listing is disabled in the current local library path, but the code has not been fully removed yet.
- The roadmap prioritizes removing those inherited network surfaces before adding new hosted features.

## Development

Requirements:

- Node.js 14 or newer.
- Chrome or a Chromium browser that supports Manifest V3 extensions.

Install and run:

```sh
npm install
npm start
```

Then open `chrome://extensions/`, enable Developer Mode, choose **Load unpacked**, and select the generated `build` folder.

Useful commands:

```sh
npm run build:dev
npm run build:release
npm run test:unit
npm run test:e2e:local-recordings
```

## Documentation

- [Capabilities inventory](docs/CAPABILITIES.md)
- [Fork plan and roadmap](docs/FORK_PLAN.md)

## Acknowledgements

SayLess is built from Screenity 4.5.3. The original recording, annotation, and editor foundation comes from Screenity and its contributors.
