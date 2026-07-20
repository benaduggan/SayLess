import assert from "node:assert/strict";
import test from "node:test";

import { buildDiagnosticZip } from "../../src/pages/utils/buildDiagnosticZip.js";

const originalChrome = globalThis.chrome;
const originalWindow = globalThis.window;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

const installBrowserMocks = ({ storage = {}, runtimeMessages = [] } = {}) => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Chrome/126 Test",
      deviceMemory: 8,
    },
  });
  globalThis.window = {
    screen: {
      availWidth: 1440,
      availHeight: 900,
    },
    devicePixelRatio: 2,
  };
  globalThis.chrome = {
    runtime: {
      getManifest() {
        return { version: "9.9.9" };
      },
      async sendMessage(message) {
        runtimeMessages.push(message);
        if (message.type === "get-platform-info") return { os: "mac" };
        if (message.type === "get-diagnostic-log") return { log: null };
        if (message.type === "make-zip") {
          return {
            ok: true,
            base64: btoa("zip-bytes"),
            filename: message.filename,
          };
        }
        return {};
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const resolve = (result) => {
            if (typeof callback === "function") callback(result);
            return Promise.resolve(result);
          };
          if (keys == null) return resolve({ ...storage });
          if (typeof keys === "string") return resolve({ [keys]: storage[keys] });
          if (Array.isArray(keys)) {
            return resolve(
              Object.fromEntries(keys.map((key) => [key, storage[key]])),
            );
          }
          return resolve({ ...storage });
        },
      },
    },
  };
};

const restoreBrowserMocks = () => {
  globalThis.chrome = originalChrome;
  globalThis.window = originalWindow;
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
};

test("buildDiagnosticZip includes sanitized audio diagnostics in config", async () => {
  const runtimeMessages = [];
  installBrowserMocks({
    runtimeMessages,
    storage: {
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
        finalAudioElapsedUs: 3_050_000,
        finalDroppedAudioForBackpressure: 0,
        finalPeakAudioEncodeQueueSize: 2,
        finalAudioSampleRateMismatchRebuilds: 1,
      },
    },
  });

  try {
    const result = await buildDiagnosticZip({ source: "unit-test" });
    assert.equal(result.filename.endsWith(".zip"), true);

    const makeZipMessage = runtimeMessages.find(
      (message) => message.type === "make-zip",
    );
    assert.ok(makeZipMessage);
    const config = JSON.parse(makeZipMessage.files["config.json"]);

    assert.equal(config.audioDiagnostics.micInput.sampleRate, 16000);
    assert.equal(config.audioDiagnostics.micInput.lowSampleRate, true);
    assert.equal(config.audioDiagnostics.mainRoute.mode, "direct-mic");
    assert.equal(config.audioDiagnostics.encoder.encoderSampleRate, 16000);
    assert.equal(config.audioDiagnostics.encoder.finalAudioElapsedUs, 3_050_000);
    assert.equal(
      config.audioDiagnostics.encoder.finalDroppedAudioForBackpressure,
      0,
    );
    assert.equal(config.audioDiagnostics.encoder.finalPeakAudioEncodeQueueSize, 2);
    assert.equal(
      config.audioDiagnostics.encoder.finalAudioSampleRateMismatchRebuilds,
      1,
    );

    const json = JSON.stringify(config.audioDiagnostics);
    assert.doesNotMatch(json, /Private Mic Label/);
    assert.doesNotMatch(json, /private-device-id/);
    assert.doesNotMatch(json, /deviceId/);
    assert.doesNotMatch(json, /label/);
  } finally {
    restoreBrowserMocks();
  }
});
