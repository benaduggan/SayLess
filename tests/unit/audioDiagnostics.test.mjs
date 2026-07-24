import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinalWebCodecsAudioSnapshot,
  buildAudioDiagnosticsContext,
  buildAudioDiagnosticsSnapshot,
  formatAudioDiagnosticsLines,
  persistFinalWebCodecsAudioSnapshot,
} from "../../src/pages/utils/audioDiagnostics.ts";

const rawStore = {
  lastMicInputSnapshot: {
    at: 100,
    label: "Personal Headset Microphone",
    settings: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      deviceId: "private-device-id",
    },
  },
  lastRecordingAudioGraphSnapshot: {
    at: 110,
    mode: "direct-mic",
    audioContextSampleRate: null,
    route: {
      useDirectMicTrack: true,
      connectMicToMixer: false,
      connectSystemToMixer: false,
      attachMixedAudioTrack: false,
      stopUnusedSystemTrack: false,
    },
    liveStreamAudioTrackCount: 1,
    micTrack: {
      label: "Personal Headset Microphone",
      enabled: true,
      readyState: "live",
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      deviceId: "private-device-id",
    },
    liveAudioTrack: {
      label: "Personal Headset Microphone",
      enabled: true,
      readyState: "live",
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      deviceId: "private-device-id",
    },
  },
  lastRecordingAudioSnapshot: {
    at: 120,
    trackSettings: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      deviceId: "private-device-id",
    },
    encoderSampleRate: 16000,
    encoderChannelCount: 1,
    firstFrameSampleRate: 16000,
    firstFrameChannels: 1,
    firstFrameFormat: "f32-planar",
    paddedSilenceCount: 2,
    finalAudioElapsedUs: 3_050_000,
    finalAudioSamplesWritten: 146400,
    finalAudioSampleRate: 48000,
    finalFirstAudioFrameSampleRate: 48000,
    finalAudioSampleRateMismatchRebuilds: 1,
    finalDroppedAudioForBackpressure: 0,
    finalPeakAudioEncodeQueueSize: 2,
    finalAudioFlushMs: 14,
    finalMuxerFinalizeOk: true,
    finalFramesEncoded: 183,
  },
};

test("buildAudioDiagnosticsSnapshot keeps audio evidence and strips identifiers", () => {
  const snapshot = buildAudioDiagnosticsSnapshot(rawStore);

  assert.equal(snapshot.micInput.sampleRate, 16000);
  assert.equal(snapshot.micInput.lowSampleRate, true);
  assert.equal(snapshot.mainRoute.mode, "direct-mic");
  assert.equal(snapshot.mainRoute.liveAudioTrack.sampleRate, 16000);
  assert.equal(snapshot.encoder.encoderSampleRate, 16000);
  assert.equal(snapshot.encoder.paddedSilenceCount, 2);
  assert.equal(snapshot.encoder.finalAudioElapsedUs, 3_050_000);
  assert.equal(snapshot.encoder.finalDroppedAudioForBackpressure, 0);
  assert.equal(snapshot.encoder.finalPeakAudioEncodeQueueSize, 2);
  assert.equal(snapshot.encoder.finalAudioSampleRateMismatchRebuilds, 1);

  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /Personal Headset/);
  assert.doesNotMatch(json, /private-device-id/);
  assert.doesNotMatch(json, /deviceId/);
  assert.doesNotMatch(json, /label/);
});

test("buildAudioDiagnosticsContext gives compact support fields", () => {
  assert.deepEqual(buildAudioDiagnosticsContext(rawStore), {
    micHz: "16000",
    micCh: "1",
    micLowHz: "1",
    audioRoute: "direct-mic",
    liveAudioTracks: "1",
    encHz: "16000",
    firstAudioHz: "16000",
    padSilence: "2",
    finalAudioMs: "3050",
    audioDrops: "0",
    audioQPeak: "2",
    audioRateRebuilds: "1",
  });
});

test("formatAudioDiagnosticsLines produces readable support text", () => {
  assert.deepEqual(formatAudioDiagnosticsLines(rawStore), [
    "AudioRt:  direct-mic",
    "MicInput: 16000Hz ch=1 low-rate",
    "Encoder:  16000Hz first=16000Hz",
    "AudioEnd: 3050ms drops=0 qPeak=2",
    "RateFix:  rebuilds=1",
    "Silence:  padded=2",
  ]);
});

test("buildFinalWebCodecsAudioSnapshot extracts final audio counters", () => {
  assert.deepEqual(
    buildFinalWebCodecsAudioSnapshot(
      {
        muxerFinalizeOk: true,
        framesEncoded: 183,
        droppedForBackpressure: { audio: 0 },
        peakEncodeQueueSize: { audio: 2 },
        flushMs: { audio: 14 },
        diag: {
          audioElapsedUs: 3_050_000,
          audioSamplesWritten: 146400,
          audioSampleRate: 48000,
          firstAudioFrameSampleRate: 48000,
          audioSampleRateMismatchRebuilds: 1,
        },
      },
      456,
    ),
    {
      finalAudioAt: 456,
      finalAudioElapsedUs: 3_050_000,
      finalAudioSamplesWritten: 146400,
      finalAudioSampleRate: 48000,
      finalFirstAudioFrameSampleRate: 48000,
      finalAudioSampleRateMismatchRebuilds: 1,
      finalDroppedAudioForBackpressure: 0,
      finalPeakAudioEncodeQueueSize: 2,
      finalAudioFlushMs: 14,
      finalMuxerFinalizeOk: true,
      finalFramesEncoded: 183,
    },
  );
});

test("persistFinalWebCodecsAudioSnapshot merges final counters with startup snapshot", async () => {
  const originalChrome = globalThis.chrome;
  const storage = {
    lastRecordingAudioSnapshot: {
      at: 123,
      trackSettings: {
        sampleRate: 16000,
        channelCount: 1,
      },
      encoderSampleRate: 16000,
    },
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          assert.deepEqual(keys, ["lastRecordingAudioSnapshot"]);
          return {
            lastRecordingAudioSnapshot: storage.lastRecordingAudioSnapshot,
          };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
  };

  try {
    const finalSnapshot = await persistFinalWebCodecsAudioSnapshot({
      muxerFinalizeOk: true,
      framesEncoded: 183,
      droppedForBackpressure: { audio: 0 },
      peakEncodeQueueSize: { audio: 2 },
      flushMs: { audio: 14 },
      diag: {
        audioElapsedUs: 3_050_000,
        audioSamplesWritten: 146400,
        audioSampleRate: 48000,
        firstAudioFrameSampleRate: 48000,
        audioSampleRateMismatchRebuilds: 1,
      },
    });

    assert.equal(finalSnapshot.finalAudioElapsedUs, 3_050_000);
    assert.equal(storage.lastRecordingAudioSnapshot.at, 123);
    assert.equal(storage.lastRecordingAudioSnapshot.trackSettings.sampleRate, 16000);
    assert.equal(storage.lastRecordingAudioSnapshot.encoderSampleRate, 16000);
    assert.equal(storage.lastRecordingAudioSnapshot.finalAudioElapsedUs, 3_050_000);
    assert.equal(storage.lastRecordingAudioSnapshot.finalDroppedAudioForBackpressure, 0);
    assert.equal(storage.lastRecordingAudioSnapshot.finalPeakAudioEncodeQueueSize, 2);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("buildAudioDiagnosticsSnapshot returns null without audio evidence", () => {
  assert.equal(buildAudioDiagnosticsSnapshot({}), null);
});
