import assert from "node:assert/strict";
import test from "node:test";

import {
  buildZoomSuggestions,
  mapZoomKeyframesToOutput,
  normalizeZoomKeyframes,
} from "../../src/edl/zoom.ts";

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

test("mapZoomKeyframesToOutput clips deleted spans and follows output order", () => {
  const keyframe = {
    id: "zoom-1",
    time: 1,
    durationSeconds: 7,
    scale: 2,
    xRatio: 0.25,
    yRatio: 0.75,
    label: "Long zoom",
    source: "manual",
  };
  const timeline = {
    version: 2,
    source: { duration: 10 },
    clips: [
      { id: "late", sourceStart: 6, sourceEnd: 10, muted: false },
      { id: "early", sourceStart: 0, sourceEnd: 3, muted: false },
    ],
  };

  const mapped = mapZoomKeyframesToOutput([keyframe], timeline);

  assert.deepEqual(
    mapped.map(({ id, time, durationSeconds }) => [id, time, durationSeconds]),
    [
      ["zoom-1:late", 0, 2],
      ["zoom-1:early", 5, 2],
    ],
  );
});

test("mapZoomKeyframesToOutput retains a zoom whose start was deleted", () => {
  const mapped = mapZoomKeyframesToOutput(
    [
      {
        id: "zoom-gap",
        time: 2,
        durationSeconds: 4,
        scale: 1.6,
        xRatio: 0.5,
        yRatio: 0.5,
        label: "Gap zoom",
        source: "click",
      },
    ],
    {
      version: 2,
      source: { duration: 8 },
      clips: [
        { id: "before", sourceStart: 0, sourceEnd: 2, muted: false },
        { id: "after", sourceStart: 4, sourceEnd: 8, muted: false },
      ],
    },
  );

  assert.deepEqual(
    mapped.map(({ time, durationSeconds }) => [time, durationSeconds]),
    [[2, 2]],
  );
});
