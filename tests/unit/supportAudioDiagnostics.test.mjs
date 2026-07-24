import assert from "node:assert/strict";
import test from "node:test";

import { buildSupportContext } from "../../src/pages/utils/buildSupportContext.ts";
import { buildSupportDebugInfo } from "../../src/pages/utils/buildSupportDebugInfo.ts";

const originalChrome = globalThis.chrome;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

const installMocks = (storage = {}) => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 Chrome/126.0.0.0",
      deviceMemory: 8,
      hardwareConcurrency: 10,
    },
  });
  globalThis.chrome = {
    i18n: {
      getMessage(key) {
        return key === "@@ui_locale" ? "en" : "";
      },
    },
    runtime: {
      getManifest() {
        return { version: "9.9.9" };
      },
      async getPlatformInfo() {
        return { os: "mac" };
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          return { ...storage };
        },
      },
    },
  };
};

const restoreMocks = () => {
  globalThis.chrome = originalChrome;
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
};

const audioStorage = {
  recordingAttemptId: "attempt-private-1234",
  recordingType: "screen",
  fastRecorderInUse: true,
  lastMicInputSnapshot: {
    at: 1,
    label: "Private Mic Label",
    settings: {
      sampleRate: 16000,
      channelCount: 1,
      deviceId: "private-device-id",
    },
  },
  lastRecordingAudioGraphSnapshot: {
    at: 2,
    mode: "direct-mic",
    liveStreamAudioTrackCount: 1,
    route: { useDirectMicTrack: true },
    micTrack: {
      label: "Private Mic Label",
      enabled: true,
      readyState: "live",
      sampleRate: 16000,
      channelCount: 1,
      deviceId: "private-device-id",
    },
    liveAudioTrack: {
      label: "Private Mic Label",
      enabled: true,
      readyState: "live",
      sampleRate: 16000,
      channelCount: 1,
      deviceId: "private-device-id",
    },
  },
  lastRecordingAudioSnapshot: {
    at: 3,
    trackSettings: {
      sampleRate: 16000,
      channelCount: 1,
      deviceId: "private-device-id",
    },
    encoderSampleRate: 16000,
    firstFrameSampleRate: 16000,
    paddedSilenceCount: 4,
    finalAudioElapsedUs: 3_050_000,
    finalDroppedAudioForBackpressure: 0,
    finalPeakAudioEncodeQueueSize: 2,
    finalAudioSampleRateMismatchRebuilds: 1,
  },
};

test("buildSupportContext includes compact sanitized audio fields", async () => {
  installMocks(audioStorage);
  try {
    const ctx = await buildSupportContext({ includeRecordingState: true });

    assert.equal(ctx.micHz, "16000");
    assert.equal(ctx.micCh, "1");
    assert.equal(ctx.micLowHz, "1");
    assert.equal(ctx.audioRoute, "direct-mic");
    assert.equal(ctx.liveAudioTracks, "1");
    assert.equal(ctx.encHz, "16000");
    assert.equal(ctx.firstAudioHz, "16000");
    assert.equal(ctx.padSilence, "4");
    assert.equal(ctx.finalAudioMs, "3050");
    assert.equal(ctx.audioDrops, "0");
    assert.equal(ctx.audioQPeak, "2");
    assert.equal(ctx.audioRateRebuilds, "1");

    const json = JSON.stringify(ctx);
    assert.doesNotMatch(json, /Private Mic Label/);
    assert.doesNotMatch(json, /private-device-id/);
    assert.doesNotMatch(json, /deviceId/);
    assert.doesNotMatch(json, /label/);
  } finally {
    restoreMocks();
  }
});

test("buildSupportDebugInfo prints audio diagnostics without identifiers", async () => {
  installMocks(audioStorage);
  try {
    const text = await buildSupportDebugInfo();

    assert.match(text, /AudioRt:\s+direct-mic/);
    assert.match(text, /MicInput:\s+16000Hz ch=1 low-rate/);
    assert.match(text, /Encoder:\s+16000Hz first=16000Hz/);
    assert.match(text, /AudioEnd:\s+3050ms drops=0 qPeak=2/);
    assert.match(text, /RateFix:\s+rebuilds=1/);
    assert.match(text, /Silence:\s+padded=4/);
    assert.doesNotMatch(text, /Private Mic Label/);
    assert.doesNotMatch(text, /private-device-id/);
  } finally {
    restoreMocks();
  }
});
