import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceAudioClock,
  shouldDropAudioForBackpressure,
} from "../../src/pages/Recorder/webcodecs/recorderLogic.ts";

test("advanceAudioClock keeps timestamps contiguous across sample-rate changes", () => {
  const chunks = [
    { frames: 44100, sampleRate: 44100 },
    { frames: 48000, sampleRate: 48000 },
    { frames: 22050, sampleRate: 44100 },
  ];

  let elapsedUs = 0;
  const timeline = chunks.map((chunk) => {
    const next = advanceAudioClock({ elapsedUs, ...chunk });
    elapsedUs = next.nextElapsedUs;
    return next;
  });

  assert.deepEqual(
    timeline.map(({ timestampUs, durationUs }) => ({
      timestampUs,
      durationUs,
    })),
    [
      { timestampUs: 0, durationUs: 1_000_000 },
      { timestampUs: 1_000_000, durationUs: 1_000_000 },
      { timestampUs: 2_000_000, durationUs: 500_000 },
    ],
  );
  assert.equal(elapsedUs, 2_500_000);
});

test("advanceAudioClock falls back to 48 kHz for missing frame metadata", () => {
  const next = advanceAudioClock({
    elapsedUs: 125_000,
    frames: 24000,
    sampleRate: null,
  });

  assert.deepEqual(next, {
    timestampUs: 125_000,
    durationUs: 500_000,
    nextElapsedUs: 625_000,
  });
});

test("advanceAudioClock does not accumulate rounding drift for small chunks", () => {
  const framesPerChunk = 128;
  const sampleRate = 44100;
  const chunks = 10_000;
  let elapsedUs = 0;

  for (let i = 0; i < chunks; i += 1) {
    const next = advanceAudioClock({
      elapsedUs,
      frames: framesPerChunk,
      sampleRate,
    });
    elapsedUs = next.nextElapsedUs;
  }

  const exactElapsedUs = (framesPerChunk * chunks * 1_000_000) / sampleRate;
  assert.ok(
    Math.abs(elapsedUs - exactElapsedUs) < 0.001,
    `elapsed ${elapsedUs} drifted from exact ${exactElapsedUs}`,
  );
});

test("shouldDropAudioForBackpressure preserves normal speech encoder bursts", () => {
  assert.equal(shouldDropAudioForBackpressure(10, 80), false);
  assert.equal(shouldDropAudioForBackpressure(80, 80), false);
  assert.equal(shouldDropAudioForBackpressure(81, 80), true);
});
