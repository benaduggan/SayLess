import test from "node:test";
import assert from "node:assert/strict";

import {
  computeThumbnailCanvasSize,
  computeThumbnailCaptureTime,
} from "../../src/pages/localRecordings/thumbnail.ts";

test("computeThumbnailCaptureTime uses an explicit requested time when safe", () => {
  assert.equal(computeThumbnailCaptureTime(10, 3), 3);
  assert.equal(computeThumbnailCaptureTime(10, 20), 9.95);
  assert.equal(computeThumbnailCaptureTime(0, 2), 2);
});

test("computeThumbnailCaptureTime avoids the likely blank first frame by default", () => {
  assert.equal(computeThumbnailCaptureTime(0), 0);
  assert.equal(computeThumbnailCaptureTime(0.2), 0);
  assert.equal(computeThumbnailCaptureTime(1.5), 0.75);
  assert.equal(computeThumbnailCaptureTime(8), 0.64);
  assert.equal(computeThumbnailCaptureTime(120), 2);
});

test("computeThumbnailCanvasSize preserves aspect ratio without upscaling", () => {
  assert.deepEqual(computeThumbnailCanvasSize(1920, 1080, 480, 270), {
    width: 480,
    height: 270,
    scale: 0.25,
  });
  assert.deepEqual(computeThumbnailCanvasSize(1080, 1920, 480, 270), {
    width: 152,
    height: 270,
    scale: 0.140625,
  });
  assert.deepEqual(computeThumbnailCanvasSize(320, 180, 480, 270), {
    width: 320,
    height: 180,
    scale: 1,
  });
});

test("computeThumbnailCanvasSize falls back for missing metadata", () => {
  assert.deepEqual(computeThumbnailCanvasSize(0, 0, 480, 270), {
    width: 480,
    height: 270,
    scale: 1,
  });
});
