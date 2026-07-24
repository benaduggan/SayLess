import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocalRecordingStorageFields } from "../../src/pages/localRecordings/localRecordingEntry.ts";

test("local recording storage entries are normalized field by field", () => {
  const entry = normalizeLocalRecordingStorageFields(
    {
      id: "payload-id",
      title: 42,
      durationMs: -5,
      byteSize: "1024",
      backendRef: { backend: "remote", fileName: "recording.mp4" },
      blobKey: { injected: true },
      thumbnailDataUrl: "https://example.test/thumbnail.png",
      recordingMeta: ["not", "a", "record"],
    },
    "index-id",
  );

  assert.equal(entry.id, "index-id");
  assert.equal(entry.title, "Untitled recording");
  assert.equal(entry.durationMs, 0);
  assert.equal(entry.byteSize, 1024);
  assert.equal(entry.backendRef, null);
  assert.equal(entry.blobKey, null);
  assert.equal(entry.thumbnailDataUrl, null);
  assert.equal(entry.recordingMeta, null);
});

test("local recording storage accepts only a valid OPFS backend reference", () => {
  const entry = normalizeLocalRecordingStorageFields(
    {
      backendRef: { backend: "opfs", fileName: "recording-123.mp4" },
    },
    "recording-123",
  );

  assert.deepEqual(entry.backendRef, {
    backend: "opfs",
    fileName: "recording-123.mp4",
  });
});
