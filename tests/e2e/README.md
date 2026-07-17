# SayLess E2E harnesses

Browser harnesses that exercise the **real** SayLess modules in real Google Chrome
(via Playwright `channel: 'chrome'`, which has the WebCodecs H.264 codecs mediabunny
needs). They bundle the actual `src/` modules, serve them locally, and drive the
genuine code paths — not mocks.

## Harnesses

### Offline release harnesses

| Script | What it proves | Network |
|---|---|---|
| `run-offline-whisper-assets.cjs` | Offline release readiness for bundled Whisper assets: manifest load, required model file probes, byte count, and local ready status in real Chrome. | no |
| `run-offline-transcription-smoke.cjs` | Slow offline Whisper startup/inference smoke: loads bundled model + local ORT in real Chrome and transcribes generated audio without remote model downloads. | no |
| `run-offline-transcription-speech.cjs` | Slow real-speech offline Whisper smoke: generates temporary macOS `say` clean, deterministic noisy, and longer paused WAVs and verifies bundled Whisper recognizes expected words with monotonic timings in all fixtures without remote model downloads. | no |
| `run-built-extension-surface.cjs` | Packaged extension smoke: loads `build/` as an unpacked extension, verifies a completed local Chrome download id, fails on page-level JavaScript and console errors, scans rendered extension pages for paid/account/cloud calls to action plus account-tier, license-key, activation, and contact-sales gates, mounts the packaged content script on a local page, opens the popup, and verifies the Videos tab renders local-library text. | no |
| `run-edl.cjs` | Non-destructive EDL render: audio extraction, DELETE shortens the encoded output, MUTE silences the window interior, and `previewController` skips/mutes correctly. | no |
| `run-timeline.cjs` | Clip timeline render: split, reorder, delete, and verify encoded output order by audio frequency. | no |
| `run-local-recordings.cjs` | Local recording library: persistence, sidecars, transcript cache, transcript-driven edit -> reopen -> timeline export, browser-decoded silence suggestions including WebM, M4A export/decode, and noisy-room audio, timeline video/audio render aborts, zoom-rendered export pixels, import/export, thumbnails, bulk actions, storage pressure, missing-media repair, orphan cleanup, and export-job lifecycle state for progress/cancel/retry/reveal/dismiss. | no |

### Additional local harness

| Script | What it proves | Network |
|---|---|---|
| `run-transcription.cjs` | Developer regression coverage for the real transcription engine with bundled Whisper assets, local ORT files, and a generated local WAV fixture. It is not release QA; release automation uses the offline smoke harnesses above. | no |

## Run

```bash
node tests/e2e/run-offline-whisper-assets.cjs
npm run test:e2e:offline-transcription-smoke  # slow; loads bundled Whisper
npm run test:e2e:offline-transcription-speech # macOS clean + noisy + longer paused say/afconvert speech fixtures
npm run test:e2e:built-extension-surface      # requires build/
node tests/e2e/run-edl.cjs             # ~30s
node tests/e2e/run-timeline.cjs        # ~30s
npm run test:e2e:local-recordings      # local library + project workflow

SAYLESS_E2E_HEADLESS=1 node tests/e2e/run-transcription.cjs
```

Each prints a `✅ PASS` / `❌ FAIL` line and exits non-zero on failure, so they can
gate CI. They open a visible Chrome window (extensions/codecs need a real Chrome).
If `run-built-extension-surface.cjs` reports a missing Playwright browser, run
`npx playwright install chromium`; newer branded Chrome builds may refuse
command-line unpacked extension loading.
`run-offline-transcription-speech.cjs` currently requires macOS `say` and
`afconvert` to generate its local speech fixture.
`run-transcription.cjs` is a developer regression harness and must not be used
for release gating.

## Pure-logic unit tests (no browser)

```bash
npm run test:unit   # tests/unit/edl*.test.mjs — EDL model/compose/render math
```

## Not yet automated

The full in-extension UI flow still needs a real screen-capture grant for complete
manual QA. The local-recordings harness covers the project workflow after media
exists locally, including transcript-driven edits, reopen, timeline-rendered export,
decoded noisy-room silence suggestions, synthetic zoom-rendered export pixels, and
export-job progress/cancel/retry/reveal/dismiss state transitions.
