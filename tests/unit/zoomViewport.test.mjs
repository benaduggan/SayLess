import assert from "node:assert/strict";
import test from "node:test";

import {
  clampZoomRatio,
  computeZoomViewportTransform,
  zoomTransformToCss,
} from "../../src/edl/zoomViewport.ts";

const cssTranslate = (css) => {
  const match = css.transform.match(
    /^translate\((-?\d+(?:\.\d+)?)%, (-?\d+(?:\.\d+)?)%\) scale\((\d+(?:\.\d+)?)\)$/,
  );
  assert.ok(match, `unexpected transform: ${css.transform}`);
  return {
    dxPercent: Number(match[1]),
    dyPercent: Number(match[2]),
    scale: Number(match[3]),
  };
};

test("clampZoomRatio bounds invalid and out-of-range focus ratios", () => {
  assert.equal(clampZoomRatio(-1), 0);
  assert.equal(clampZoomRatio(2), 1);
  assert.equal(clampZoomRatio("bad"), 0.5);
  assert.equal(clampZoomRatio(0.25), 0.25);
});

test("computeZoomViewportTransform centers middle focus points", () => {
  const transform = computeZoomViewportTransform(
    { scale: 2, xRatio: 0.5, yRatio: 0.5 },
    320,
    180,
  );
  assert.equal(transform.scale, 2);
  assert.equal(transform.dx, -160);
  assert.equal(transform.dy, -90);
  assert.equal(transform.drawWidth, 640);
  assert.equal(transform.drawHeight, 360);
});

test("computeZoomViewportTransform clamps edge focus points inside viewport", () => {
  const topLeft = computeZoomViewportTransform(
    { scale: 2, xRatio: 0, yRatio: 0 },
    320,
    180,
  );
  assert.equal(topLeft.dx, 0);
  assert.equal(topLeft.dy, 0);

  const bottomRight = computeZoomViewportTransform(
    { scale: 2, xRatio: 1, yRatio: 1 },
    320,
    180,
  );
  assert.equal(bottomRight.dx, -320);
  assert.equal(bottomRight.dy, -180);
});

test("zoomTransformToCss expresses renderer transform as percent CSS", () => {
  const css = zoomTransformToCss(
    computeZoomViewportTransform(
      { scale: 1.5, xRatio: 0.75, yRatio: 0.25 },
      320,
      180,
    ),
    320,
    180,
  );
  assert.deepEqual(css, {
    transform: "translate(-50%, 0%) scale(1.5)",
    transformOrigin: "0 0",
  });
});

test("zoom preview CSS matches export renderer offsets across aspect ratios", () => {
  const cases = [
    {
      name: "square center",
      zoom: { scale: 1.8, xRatio: 0.5, yRatio: 0.5 },
      width: 400,
      height: 400,
    },
    {
      name: "portrait lower-left",
      zoom: { scale: 2.25, xRatio: 0.05, yRatio: 0.95 },
      width: 720,
      height: 1280,
    },
    {
      name: "wide upper-right",
      zoom: { scale: 1.6, xRatio: 0.95, yRatio: 0.05 },
      width: 1920,
      height: 720,
    },
  ];

  for (const { name, zoom, width, height } of cases) {
    const transform = computeZoomViewportTransform(zoom, width, height);
    const css = cssTranslate(zoomTransformToCss(transform, width, height));

    assert.equal(css.scale, transform.scale, name);
    assert.equal(Number(((css.dxPercent / 100) * width).toFixed(6)), transform.dx, name);
    assert.equal(Number(((css.dyPercent / 100) * height).toFixed(6)), transform.dy, name);
    assert.equal(transform.drawWidth, width * transform.scale, name);
    assert.equal(transform.drawHeight, height * transform.scale, name);
  }
});

test("computeZoomViewportTransform keeps focused edges framed on tall and wide videos", () => {
  const tallBottomRight = computeZoomViewportTransform(
    { scale: 2.5, xRatio: 1, yRatio: 1 },
    720,
    1280,
  );
  assert.equal(tallBottomRight.dx, -1080);
  assert.equal(tallBottomRight.dy, -1920);
  assert.equal(tallBottomRight.dx + tallBottomRight.drawWidth, 720);
  assert.equal(tallBottomRight.dy + tallBottomRight.drawHeight, 1280);

  const wideTopLeft = computeZoomViewportTransform(
    { scale: 2.5, xRatio: 0, yRatio: 0 },
    1920,
    720,
  );
  assert.equal(wideTopLeft.dx, 0);
  assert.equal(wideTopLeft.dy, 0);
  assert.equal(wideTopLeft.dx + wideTopLeft.drawWidth, 4800);
  assert.equal(wideTopLeft.dy + wideTopLeft.drawHeight, 1800);
});
