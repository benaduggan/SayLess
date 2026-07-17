import assert from "node:assert/strict";
import test from "node:test";

import {
  buildZoomSuggestions,
  normalizeZoomKeyframes,
} from "../../src/edl/zoom.js";

test("buildZoomSuggestions creates local click zoom keyframes", () => {
  const suggestions = buildZoomSuggestions(
    [
      { type: "click", time: 2, xRatio: 0.25, yRatio: 0.75 },
      { type: "click", time: 6, xRatio: 0.5, yRatio: 0.4 },
    ],
    { duration: 10, preRollSeconds: 0.5 },
  );

  assert.deepEqual(
    suggestions.map((suggestion) => [
      suggestion.time,
      suggestion.xRatio,
      suggestion.yRatio,
      suggestion.scale,
      suggestion.source,
    ]),
    [
      [1.5, 0.25, 0.75, 1.6, "click"],
      [5.5, 0.5, 0.4, 1.6, "click"],
    ],
  );
});

test("buildZoomSuggestions groups nearby click events", () => {
  const suggestions = buildZoomSuggestions(
    [
      { type: "click", time: 4, xRatio: 0.2, yRatio: 0.2 },
      { type: "click", time: 4.6, xRatio: 0.3, yRatio: 0.3 },
    ],
    { preRollSeconds: 0.25, minGapSeconds: 1.5 },
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].time, 3.75);
  assert.equal(suggestions[0].durationSeconds, 2.5);
});

test("normalizeZoomKeyframes clamps values for portable project data", () => {
  const keyframes = normalizeZoomKeyframes(
    [
      {
        time: 99,
        durationSeconds: 40,
        scale: 9,
        xRatio: -1,
        yRatio: 2,
        label: "  Demo zoom  ",
      },
    ],
    { duration: 12 },
  );

  assert.deepEqual(
    keyframes.map((keyframe) => [
      keyframe.time,
      keyframe.durationSeconds,
      keyframe.scale,
      keyframe.xRatio,
      keyframe.yRatio,
      keyframe.label,
    ]),
    [[12, 12, 3, 0, 1, "Demo zoom"]],
  );
});
