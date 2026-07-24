import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSCRIPTION_ERROR_CODES,
  TranscriptionError,
  classifyTranscriptionError,
  formatTranscriptionError,
} from "../../src/transcription/errors.ts";

test("transcription errors preserve structured user-facing guidance", () => {
  const err = new TranscriptionError({
    code: TRANSCRIPTION_ERROR_CODES.MODEL_LOAD_FAILED,
    message: "The bundled Whisper model could not be loaded.",
    action: "Verify every required model file is packaged.",
    phase: "model-load",
  });

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.MODEL_LOAD_FAILED);
  assert.equal(err.phase, "model-load");
  assert.match(formatTranscriptionError(err), /Verify every required model file/);
});

test("classifier reports unsupported browser audio decode contexts", () => {
  const err = classifyTranscriptionError(new Error("audio: WebAudio not available"), {
    phase: "audio-decode",
  });

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_BROWSER);
  assert.match(err.userMessage, /current Chromium browser/);
});

test("classifier reports quota exhaustion with local cleanup guidance", () => {
  const err = classifyTranscriptionError(
    Object.assign(new Error("QuotaExceededError: storage is full"), {
      name: "QuotaExceededError",
    }),
    { phase: "audio-decode" },
  );

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.QUOTA_EXHAUSTED);
  assert.match(err.userMessage, /export\/delete old local recordings/);
});

test("classifier reports very large recordings as local resource failures", () => {
  const err = classifyTranscriptionError(new RangeError("Array buffer allocation failed"), {
    phase: "audio-decode",
  });

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.RECORDING_TOO_LONG);
  assert.match(err.userMessage, /split a shorter section/);
});

test("classifier reports bundled model loading failures", () => {
  const err = classifyTranscriptionError(
    new Error("failed to fetch tokenizer.json: 404 not found"),
    { phase: "model-load" },
  );

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.MODEL_LOAD_FAILED);
  assert.match(err.userMessage, /model status panel/);
});

test("classifier reports privacy-mode network provider blocks", () => {
  const err = classifyTranscriptionError(
    new Error('transcription: provider "remote" needs network but privacyMode is on'),
    { phase: "provider" },
  );

  assert.equal(err.code, TRANSCRIPTION_ERROR_CODES.PRIVACY_BLOCKED);
  assert.match(err.userMessage, /local-only privacy mode/);
});
