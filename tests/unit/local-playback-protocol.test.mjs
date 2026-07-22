import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_PLAYBACK_MAX_BYTES,
  LOCAL_PLAYBACK_MAX_CHUNKS,
  LOCAL_PLAYBACK_MAX_TTL_MS,
  normalizeLocalPlaybackOffer,
  parseLocalPlaybackChunk,
  parseStoredLocalPlaybackOffer,
} from "../../src/messaging/localPlaybackProtocol.ts";

test("local playback offers normalize untrusted protocol fields", () => {
  const now = 1_000_000;
  const offer = normalizeLocalPlaybackOffer(
    {
      offerId: 42,
      projectId: "project-1",
      sceneId: ["invalid"],
      chunkCount: LOCAL_PLAYBACK_MAX_CHUNKS + 50,
      estimatedBytes: -1,
      storageBackend: "opfs",
      opfsSessionId: { invalid: true },
      container: "text/html",
      expiresAt: now + LOCAL_PLAYBACK_MAX_TTL_MS * 2,
    },
    { now, createOfferId: () => "generated-offer" },
  );

  assert.equal(offer.offerId, "generated-offer");
  assert.equal(offer.projectId, "project-1");
  assert.equal(offer.sceneId, null);
  assert.equal(offer.chunkCount, LOCAL_PLAYBACK_MAX_CHUNKS);
  assert.equal(offer.estimatedBytes, 0);
  assert.equal(offer.storageBackend, "opfs");
  assert.equal(offer.opfsSessionId, null);
  assert.equal(offer.container, "video/webm");
  assert.equal(offer.expiresAt, now + LOCAL_PLAYBACK_MAX_TTL_MS);
  assert.equal(LOCAL_PLAYBACK_MAX_BYTES, 250 * 1024 * 1024);
});

test("stored local playback offers require an identity and unexpired TTL", () => {
  const now = 2_000_000;
  assert.equal(parseStoredLocalPlaybackOffer({}, now), null);
  assert.equal(
    parseStoredLocalPlaybackOffer({ offerId: "expired", expiresAt: now - 1 }, now),
    null,
  );

  const offer = parseStoredLocalPlaybackOffer(
    {
      offerId: "offer-1",
      projectId: "project-1",
      sceneId: "scene-1",
      chunkCount: 2,
      estimatedBytes: 1024,
      expiresAt: now + 60_000,
    },
    now,
  );
  assert.equal(offer?.offerId, "offer-1");
  assert.equal(offer?.trackType, "screen");
});

test("local playback chunks reject missing payloads and normalize metadata", () => {
  assert.equal(parseLocalPlaybackChunk({ mimeType: "video/mp4" }), null);
  assert.deepEqual(
    parseLocalPlaybackChunk({
      base64: "AQID",
      index: "3",
      size: -5,
      mimeType: "video/mp4",
    }),
    { base64: "AQID", index: 3, size: 0, mimeType: "video/mp4" },
  );
});
