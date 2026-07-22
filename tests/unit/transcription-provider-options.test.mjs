import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWhisperDataType,
  normalizeWhisperDevice,
} from "../../src/transcription/providers/localWhisperProvider.ts";

test("local Whisper accepts only supported runtime device values", () => {
  assert.equal(normalizeWhisperDevice("wasm"), "wasm");
  assert.equal(normalizeWhisperDevice("webgpu"), "webgpu");
  assert.equal(normalizeWhisperDevice("remote-gpu"), null);
  assert.equal(normalizeWhisperDevice({ device: "wasm" }), null);
});

test("local Whisper accepts only supported model data types", () => {
  assert.equal(normalizeWhisperDataType("fp16"), "fp16");
  assert.equal(normalizeWhisperDataType("q8"), "q8");
  assert.equal(normalizeWhisperDataType("javascript"), null);
  assert.equal(normalizeWhisperDataType(8), null);
});
