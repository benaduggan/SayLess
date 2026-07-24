import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProjectAudioTrack,
  resolveProjectAudioPreviewPosition,
  updateProjectAudioTrack,
} from "../../src/edl/projectAudio.ts";
import { sourceToOutput } from "../../src/edl/timeline.ts";

const validTrack = {
  version: 1,
  assetId: "sha256-abcdef",
  fileName: "Background.wav",
  mimeType: "audio/wav",
  byteSize: 1024,
  sha256: "a".repeat(64),
  volume: 0.8,
  sourceVolume: 0.7,
  mode: "mix",
  loop: false,
};

test("project audio metadata normalizes portable bounded fields", () => {
  assert.deepEqual(normalizeProjectAudioTrack(validTrack), validTrack);
  assert.deepEqual(
    updateProjectAudioTrack(validTrack, {
      volume: 5,
      sourceVolume: -2,
      mode: "replace",
      loop: true,
    }),
    {
      ...validTrack,
      volume: 1,
      sourceVolume: 0,
      mode: "replace",
      loop: true,
    },
  );
});

test("project audio metadata rejects unresolved or oversized assets", () => {
  assert.equal(normalizeProjectAudioTrack({ ...validTrack, sha256: "bad" }), null);
  assert.equal(normalizeProjectAudioTrack({ ...validTrack, byteSize: 0 }), null);
  assert.equal(normalizeProjectAudioTrack({ ...validTrack, byteSize: 50_000_001 }), null);
});

test("project audio preview wraps looping assets in output time", () => {
  assert.deepEqual(resolveProjectAudioPreviewPosition(7.25, 2, true), {
    currentTime: 1.25,
    shouldPlay: true,
  });
  assert.deepEqual(resolveProjectAudioPreviewPosition(2, 2, true), {
    currentTime: 0,
    shouldPlay: true,
  });
});

test("project audio preview becomes silent after a non-looping asset ends", () => {
  assert.deepEqual(resolveProjectAudioPreviewPosition(1.5, 2, false), {
    currentTime: 1.5,
    shouldPlay: true,
  });
  assert.deepEqual(resolveProjectAudioPreviewPosition(3, 2, false), {
    currentTime: 2,
    shouldPlay: false,
  });
});

test("project audio preview tolerates unavailable metadata and invalid time", () => {
  assert.deepEqual(resolveProjectAudioPreviewPosition(3, NaN, true), {
    currentTime: 3,
    shouldPlay: true,
  });
  assert.deepEqual(resolveProjectAudioPreviewPosition(NaN, 2, false), {
    currentTime: 0,
    shouldPlay: true,
  });
});

test("project audio preview follows reordered timeline output time", () => {
  const timeline = {
    version: 2,
    source: { duration: 8 },
    clips: [
      { id: "late", sourceStart: 6, sourceEnd: 8, muted: false },
      { id: "early", sourceStart: 0, sourceEnd: 2, muted: false },
    ],
  };

  assert.deepEqual(resolveProjectAudioPreviewPosition(sourceToOutput(timeline, 6.5), 1.5, true), {
    currentTime: 0.5,
    shouldPlay: true,
  });
  assert.deepEqual(resolveProjectAudioPreviewPosition(sourceToOutput(timeline, 0.5), 1.5, true), {
    currentTime: 1,
    shouldPlay: true,
  });
});
