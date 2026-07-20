import assert from "node:assert/strict";
import test from "node:test";

import { startAudioStream } from "../../src/pages/utils/startAudioStream.js";

const withBrowserAudioMocks = async (
  {
    sampleRate = 48000,
    label = "USB Mic",
    getUserMediaImpl = null,
  } = {},
  fn,
) => {
  const originalChrome = globalThis.chrome;
  const originalNavigator = globalThis.navigator;
  const originalConsoleWarn = console.warn;
  const getUserMediaCalls = [];
  const runtimeMessages = [];
  const warnings = [];
  const stream = {
    getAudioTracks() {
      return [
        {
          label,
          getSettings() {
            return { sampleRate };
          },
        },
      ];
    },
  };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          getUserMediaCalls.push(constraints);
          if (getUserMediaImpl) {
            return getUserMediaImpl(constraints, getUserMediaCalls.length);
          }
          return stream;
        },
        async enumerateDevices() {
          return [];
        },
      },
    },
  });
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            defaultAudioInputLabel: label,
            audioinput: [{ deviceId: "mic-1", label }],
          };
        },
        async set() {},
      },
    },
    runtime: {
      sendMessage(message) {
        runtimeMessages.push(message);
      },
    },
  };
  console.warn = (...args) => warnings.push(args);

  try {
    return await fn({ getUserMediaCalls, runtimeMessages, warnings, stream });
  } finally {
    console.warn = originalConsoleWarn;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
};

test("startAudioStream requests stable speech capture constraints for the selected mic", async () => {
  await withBrowserAudioMocks({}, async ({ getUserMediaCalls }) => {
    await startAudioStream("mic-1");

    assert.equal(getUserMediaCalls.length, 1);
    assert.deepEqual(getUserMediaCalls[0].audio, {
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: true },
      deviceId: { exact: "mic-1" },
    });
  });
});

test("startAudioStream keeps mic quality diagnostics when falling back to the default mic", async () => {
  await withBrowserAudioMocks(
    {
      sampleRate: 16000,
      label: "Fallback Bluetooth Headset",
      getUserMediaImpl: (_constraints, callNumber) => {
        if (callNumber === 1) {
          const err = new Error("selected mic unavailable");
          err.name = "NotAllowedError";
          throw err;
        }
        return {
          getAudioTracks() {
            return [
              {
                label: "Fallback Bluetooth Headset",
                getSettings() {
                  return {
                    sampleRate: 16000,
                    channelCount: 1,
                  };
                },
              },
            ];
          },
        };
      },
    },
    async ({ getUserMediaCalls, runtimeMessages, warnings }) => {
      await startAudioStream("mic-1", { bluetoothDiag: true });

      assert.equal(getUserMediaCalls.length, 2);
      assert.deepEqual(getUserMediaCalls[1].audio, {
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: true },
      });
      assert.equal(warnings.length, 1);
      assert.equal(runtimeMessages[0].type, "diag-forward");
      assert.equal(runtimeMessages[0].event, "recorder-low-sample-rate-mic");
      assert.deepEqual(runtimeMessages[0].data, {
        trackSampleRate: 16000,
        trackChannelCount: 1,
        label: "Fallback Bluetooth Headset",
      });
      assert.equal(runtimeMessages[1].type, "show-toast");
    },
  );
});

test("startAudioStream warns when a mic opens in low-quality Bluetooth call mode", async () => {
  await withBrowserAudioMocks(
    { sampleRate: 16000, label: "Bluetooth Headset" },
    async ({ runtimeMessages, warnings }) => {
      await startAudioStream("mic-1", { bluetoothDiag: true });

      assert.equal(warnings.length, 1);
      assert.equal(runtimeMessages[0].type, "diag-forward");
      assert.equal(runtimeMessages[0].event, "recorder-low-sample-rate-mic");
      assert.deepEqual(runtimeMessages[0].data, {
        trackSampleRate: 16000,
        trackChannelCount: null,
        label: "Bluetooth Headset",
      });
      assert.equal(runtimeMessages[1].type, "show-toast");
      assert.match(runtimeMessages[1].message, /low-quality Bluetooth call mode/);
      assert.equal(runtimeMessages[1].timeout, 10000);
    },
  );
});
