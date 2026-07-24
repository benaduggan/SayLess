import assert from "node:assert/strict";
import test from "node:test";

import {
  cropPreviewLayout,
  cropRelativePoint,
  cropRegionFromPixels,
  cropRegionToPixels,
  normalizeCropRegion,
} from "../../src/edl/crop.ts";

test("crop regions round-trip between pixels and durable ratios", () => {
  const crop = cropRegionFromPixels({ x: 320, y: 180, width: 1280, height: 720 }, 1920, 1080);

  assert.deepEqual(crop, {
    xRatio: 1 / 6,
    yRatio: 1 / 6,
    widthRatio: 2 / 3,
    heightRatio: 2 / 3,
  });
  assert.deepEqual(cropRegionToPixels(crop, 1920, 1080), {
    x: 320,
    y: 180,
    width: 1280,
    height: 720,
  });
});

test("source-relative zoom points map into the cropped viewport", () => {
  const crop = {
    xRatio: 0.4,
    yRatio: 0.2,
    widthRatio: 0.5,
    heightRatio: 0.6,
  };
  const mapped = cropRelativePoint(crop, 0.45, 0.35);
  assert.ok(Math.abs(mapped.xRatio - 0.1) < 1e-10);
  assert.ok(Math.abs(mapped.yRatio - 0.25) < 1e-10);
  assert.deepEqual(cropRelativePoint(crop, 0.2, 0.95), {
    xRatio: 0,
    yRatio: 1,
  });
  assert.deepEqual(cropRelativePoint(null, 0.2, 0.8), {
    xRatio: 0.2,
    yRatio: 0.8,
  });
});

test("crop normalization clamps bounds and treats the full frame as no edit", () => {
  assert.equal(normalizeCropRegion({ xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }), null);
  const clamped = normalizeCropRegion({
    xRatio: 0.8,
    yRatio: -1,
    widthRatio: 0.9,
    heightRatio: 2,
  });
  assert.equal(clamped.xRatio, 0.8);
  assert.equal(clamped.yRatio, 0);
  assert.ok(Math.abs(clamped.widthRatio - 0.2) < 1e-10);
  assert.equal(clamped.heightRatio, 1);
  assert.equal(
    normalizeCropRegion({ xRatio: 1, yRatio: 0, widthRatio: 0.5, heightRatio: 1 }),
    null,
  );
});

test("crop preview layout describes the same viewport as export", () => {
  const layout = cropPreviewLayout(
    { xRatio: 0.25, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.8 },
    1600,
    900,
  );

  assert.deepEqual(layout, {
    aspectRatio: 10 / 9,
    leftPercent: -50,
    topPercent: -12.5,
    widthPercent: 200,
    heightPercent: 125,
  });
});
