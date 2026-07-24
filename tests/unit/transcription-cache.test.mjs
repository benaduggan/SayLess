import assert from "node:assert/strict";
import test from "node:test";

import { buildTranscriptCacheKey, hashTranscriptSource } from "../../src/transcription/cache.ts";

test("transcript cache keys include provider model language and source", () => {
  const base = {
    recordingId: "rec-1",
    providerId: "local-whisper",
    model: "whisper-base",
    language: "en",
    sourceHash: "sha256:a",
  };

  const key = buildTranscriptCacheKey(base);
  assert.match(key, /rec-1/);
  assert.match(key, /local-whisper/);
  assert.match(key, /whisper-base/);
  assert.match(key, /en/);
  assert.notEqual(key, buildTranscriptCacheKey({ ...base, language: "es" }));
  assert.notEqual(key, buildTranscriptCacheKey({ ...base, sourceHash: "sha256:b" }));
});

test("transcript source hash changes with blob content", async () => {
  const first = await hashTranscriptSource(new Blob(["alpha"], { type: "video/mp4" }));
  const second = await hashTranscriptSource(new Blob(["beta"], { type: "video/mp4" }));

  assert.match(first, /^(sha256|meta):/);
  assert.notEqual(first, second);
});
