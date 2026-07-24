import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStreamingDataPayload,
  parseStreamingDataPayload,
} from "../../src/messaging/streamingDataProtocol.ts";

test("streaming data normalizes storage and message fields", () => {
  assert.deepEqual(
    normalizeStreamingDataPayload({
      micActive: true,
      defaultAudioInput: "mic-1",
      defaultAudioOutput: 42,
      defaultVideoInput: "camera-1",
      systemAudio: "yes",
      recordingType: "camera",
    }),
    {
      micActive: true,
      defaultAudioInput: "mic-1",
      defaultAudioOutput: null,
      defaultVideoInput: "camera-1",
      systemAudio: false,
      recordingType: "camera",
    },
  );
});

test("streaming data parser rejects invalid envelopes and supplies safe defaults", () => {
  assert.equal(parseStreamingDataPayload(null), null);
  assert.equal(parseStreamingDataPayload("not-json"), null);
  assert.equal(parseStreamingDataPayload("[]"), null);
  assert.deepEqual(parseStreamingDataPayload("{}"), {
    micActive: false,
    defaultAudioInput: null,
    defaultAudioOutput: null,
    defaultVideoInput: null,
    systemAudio: false,
    recordingType: "screen",
  });
});
