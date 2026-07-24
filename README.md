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
- Browse, import, rename, duplicate, export, delete, and reopen local recordings from the extension's Videos tab.
- Edit recordings in-browser: trim, cut, mute, crop, add/replace audio, adjust volume, and export MP4, WebM, or GIF.
- Generate transcripts with the local Whisper provider, then delete or mute selected words through the EDL/timeline editor.
- Export and import `.sayless-project.json` sidecars for transcript/timeline project backup.
- Export standalone transcript JSON and WebVTT caption sidecars.
- Autosave edited local recordings back into the local library.
- Export support diagnostics as a local ZIP for debugging.

## Local-First Notes

The intended product direction is offline, local-only, and not freemium. Everything developed for SayLess is free in the extension; features are not hidden behind paid plans, account levels, member-only modes, starter/team/business/enterprise plan names, subscriptions, trials, paywalls, or entitlement checks.

- Recording, annotation, local library, editing, EDL/timeline logic, and transcription inference all run in the browser.
- Release defaults do not download transcription models. The local Whisper provider resolves the bundled Whisper model from `assets/whisper/models/` in the extension package, with remote model downloads only available to explicit development harnesses.
- The release manifest has no OAuth section, no external website handshake, no hosted cloud recorder page, and no Google Drive export permission.
- Remaining roadmap work is focused on broader real-recording manual QA for offline transcription quality, export cancellation/retry/reveal behavior, silence suggestions, and zoom rendering.

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
npm run lint
npm run format:check
npm run typecheck
npm run verify:release
npm run qa:release:auto
npm run qa:release:status
npm run qa:release:manual:template
npm run qa:release:manual:profile -- --sync-template --launch
npm run qa:release:manual:progress
npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json /path/to/recording.mp4
npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json /path/to/recording.vtt
npm run qa:release:manual:measurements -- --json --write
npm run qa:release:manual
npm run package:release
npm run package:ci-extension
npm run test:unit
npm run test:e2e:local-recordings
```

JavaScript and TypeScript are linted with Oxlint and formatted with Oxfmt.
Tailwind CSS v4 is the CSS build layer; project design tokens live in
`src/styles/tailwind.css`, and the extension no longer requires Sass or
Stylelint.

`npm run package`, `npm run package:release`, and Chrome Web Store publish scripts use the release evidence gate; release-specific manual QA evidence is required before packaging or publishing. `npm run qa:release:status` reports the next blocked action and, once ready, prints the release handoff. It validates automated QA command inventory, run timing, git/worktree provenance, current build, bundled Whisper assets, versions, manifest surface, and the machine-scanned `docs/STORE_LISTING.md` publication draft before manual QA can be the next action. If a manual evidence template is missing canonical fields, still contains untouched retired placeholders, or has stale automated provenance, status tells the releaser to use `npm run qa:release:manual:profile -- --sync-template --launch`; once the template is current, it advances to `npm run qa:release:manual:profile -- --launch`, opening the clean Chrome profile without a redundant rewrite. Synchronization preserves user-entered legacy values while removing only recognized obsolete placeholder values. During the real-media session, `npm run qa:release:manual:media -- --json --require-complete --output=release-artifacts/manual-qa-media-probe.json <files...>` measures exact byte counts, durations, dimensions, containers, codecs, audio metadata, and SHA-256 identities without modifying the inputs or worksheet, atomically retains the JSON report, and exits nonzero unless the supplied candidates measurably cover MP4/WebM, the combined 180-second/25-MiB threshold, varied geometry, and WAV/M4A/MP3. Source-versus-export identity, playback, visual, audibility, and synchronization observations remain manual. `npm run qa:release:manual:sidecars -- --json --require-complete --output=release-artifacts/manual-qa-sidecar-probe.json <files...>` complements it with read-only WebVTT cue, transcript JSON, and current project-schema structural checks, atomically retains its report, and exits nonzero unless one filename-matched VTT/transcript/project set has agreeing JSON recording IDs. Both strict probes preserve their diagnostic report even when coverage is incomplete and refuse to overwrite an inspected input. Opening the text files and importing the project remain manual observations. Once tester-selected roles and filenames are present and both strict reports pass, preview `npm run qa:release:manual:measurements -- --json`, then add `--write` to copy only exact probe-measured fields into the worksheet; it does not fill or approve human observations. The local-recordings browser harness runs this same strict probe mode against product-generated exports. Omitting `--require-complete` keeps either probe advisory for incremental collection. `npm run qa:release:manual:progress` gives a read-only section summary of the same verifier issues; it is guidance and never substitutes for the strict `npm run qa:release:manual` gate. Complete the checklist and fill `release-artifacts/manual-qa-evidence.json` before running that gate. `npm run package:release` writes `release-artifacts/package-release.json` with the generated `extension.zip` path, size, SHA-256, and hashes of the automated and manual evidence files used for packaging. Failed or interrupted package attempts overwrite that evidence with a non-passing status and the failed step, so old passing package evidence cannot be reused accidentally. `npm run build:cws` writes `release-artifacts/cws-package.json` tying the canonical `build-cws.zip` path back to the verified `extension.zip`, package evidence, and the automated/manual QA evidence summaries used for the package; CWS upload/publish scripts run `npm run qa:release:status -- --require-ready` before store actions so automated, manual, release-package, and CWS package evidence all have to verify together. Release handoff should attach `release-artifacts/release-qa-automated.json`, `release-artifacts/manual-qa-evidence.json`, `release-artifacts/package-release.json`, `release-artifacts/cws-package.json`, `docs/STORE_LISTING.md`, `extension.zip`, and `build-cws.zip`.

The final manual gate requires the canonical media and sidecar reports to be strict, complete, generated between automated QA and `testedAt`, and consistent with worksheet file identities and measured metadata. Attach `release-artifacts/manual-qa-media-probe.json` and `release-artifacts/manual-qa-sidecar-probe.json` with the other release evidence.

The clean-profile helper marks each new manual-QA profile with its release/build and OS/browser provenance and prints a safe resume command. After the operating system acknowledges a launch, it stamps matching path-free `manualSession` provenance into the portable manual evidence and records an ignored machine-local pointer so `npm run qa:release:status` can recommend that exact resume command after strictly revalidating it. The stamp proves which prepared release session launched but never fills human observations; it omits the local profile and browser executable paths. If Chrome closes during the session, reuse only that validated marked profile with `--profile-dir=... --resume-profile --launch`; arbitrary existing Chrome profiles, changed test environments, and stale or tampered marked sessions are rejected.

Manual-QA progress output includes canonical `workTargets` for each section, so focused output points directly at the worksheet object or report artifact that needs attention while leaving all observations tester-owned.

GitHub Actions runs the TypeScript 7 typecheck and automated release QA on Node 24 for pull requests and `main`, then builds a verified extension zip with `npm run package:ci-extension`. The typecheck is also recorded as the first command in automated release evidence. That CI package is uploaded as the `sayless-extension` workflow artifact with a SHA-256 file and metadata JSON. Version tags matching `v*` create a GitHub Release with the same downloadable files; manual workflow dispatch can publish a release only when an explicit `release_tag` is supplied.

## Documentation

- [Capabilities inventory](docs/CAPABILITIES.md)
- [Fork plan and roadmap](docs/FORK_PLAN.md)
- [Release QA checklist](docs/RELEASE_QA.md)
- [Chrome Web Store listing draft](docs/STORE_LISTING.md)

## Acknowledgements

SayLess is built from Screenity 4.5.3. The original recording, annotation, and editor foundation comes from Screenity and its contributors.
