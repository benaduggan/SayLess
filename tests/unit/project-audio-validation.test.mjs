import assert from "node:assert/strict";
import test from "node:test";

import { validateProjectAudioBlob } from "../../src/pages/Editor/utils/validateProjectAudio.ts";

test("project audio validation accepts decoded audio independent of MIME metadata", async () => {
  let closed = false;
  const probe = await validateProjectAudioBlob(new Blob([new Uint8Array([1, 2, 3])]), {
    createAudioContext: () => ({
      decodeAudioData: async () => ({
        duration: 2.5,
        numberOfChannels: 2,
        sampleRate: 48000,
      }),
      close: async () => {
        closed = true;
      },
    }),
  });

  assert.deepEqual(probe, {
    duration: 2.5,
    numberOfChannels: 2,
    sampleRate: 48000,
  });
  assert.equal(closed, true);
});

test("project audio validation rejects corrupt encoded audio and closes context", async () => {
  let closed = false;
  await assert.rejects(
    validateProjectAudioBlob(new Blob(["not audio"], { type: "audio/mpeg" }), {
      createAudioContext: () => ({
        decodeAudioData: async () => {
          throw new DOMException("Unable to decode audio data");
        },
        close: async () => {
          closed = true;
        },
      }),
    }),
    /project-audio-decode-unsupported/,
  );
  assert.equal(closed, true);
});

test("project audio validation rejects empty and invalid decoded assets", async () => {
  await assert.rejects(validateProjectAudioBlob(new Blob([])), /project-audio-invalid/);
  await assert.rejects(
    validateProjectAudioBlob(new Blob(["x"]), {
      createAudioContext: () => ({
        decodeAudioData: async () => ({
          duration: 0,
          numberOfChannels: 1,
          sampleRate: 48000,
        }),
        close: async () => {},
      }),
    }),
    /project-audio-decode-invalid/,
  );
});
