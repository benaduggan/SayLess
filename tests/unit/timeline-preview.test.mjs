import { test } from "node:test";
import assert from "node:assert/strict";

import { attachTimelinePreview } from "../../src/edl/timelinePreview.ts";

const makePlayer = (initialTime = 0) => {
  const events = [];
  let currentTime = initialTime;
  let tick = null;
  return {
    events,
    player: {
      getCurrentTime: () => currentTime,
      seek: (time) => {
        events.push(["seek", time]);
        currentTime = time;
      },
      setMuted: (muted) => {
        events.push(["muted", muted]);
      },
      pause: () => {
        events.push(["pause"]);
      },
      onTimeUpdate: (callback) => {
        tick = callback;
        return () => events.push(["unsubscribe"]);
      },
    },
    setTime(time) {
      currentTime = time;
    },
    tick() {
      assert.equal(typeof tick, "function");
      tick();
    },
  };
};

test("timeline preview follows output order and jumps to reordered next clip", () => {
  const timeline = {
    clips: [
      { id: "a", sourceStart: 8, sourceEnd: 10, muted: false },
      { id: "b", sourceStart: 2, sourceEnd: 4, muted: false },
    ],
  };
  const harness = makePlayer(9.99);
  attachTimelinePreview(harness.player, () => timeline);

  harness.tick();

  assert.deepEqual(harness.events, [["seek", 2]]);
});

test("timeline preview snaps forward from deleted source gaps", () => {
  const timeline = {
    clips: [
      { id: "a", sourceStart: 0, sourceEnd: 2, muted: false },
      { id: "b", sourceStart: 6, sourceEnd: 8, muted: false },
    ],
  };
  const harness = makePlayer(4);
  attachTimelinePreview(harness.player, () => timeline);

  harness.tick();

  assert.deepEqual(harness.events, [["seek", 6]]);
});

test("timeline preview applies muted clip state and restores audio on stop", () => {
  const timeline = {
    clips: [
      { id: "a", sourceStart: 0, sourceEnd: 2, muted: true },
      { id: "b", sourceStart: 2, sourceEnd: 4, muted: false },
    ],
  };
  const harness = makePlayer(1);
  const preview = attachTimelinePreview(harness.player, () => timeline);

  harness.tick();
  preview.stop();

  assert.deepEqual(harness.events, [["muted", true], ["unsubscribe"], ["muted", false]]);
});

test("timeline preview pauses at the final clip end", () => {
  const timeline = {
    clips: [{ id: "a", sourceStart: 0, sourceEnd: 2, muted: false }],
  };
  const harness = makePlayer(1.99);
  attachTimelinePreview(harness.player, () => timeline);

  harness.tick();

  assert.deepEqual(harness.events, [["pause"]]);
});

test("timeline preview tick remains bounded on long timelines", () => {
  const clips = Array.from({ length: 1000 }, (_, index) => ({
    id: `clip-${index}`,
    sourceStart: index * 2,
    sourceEnd: index * 2 + 1,
    muted: index % 2 === 0,
  }));
  const harness = makePlayer(1500.99);
  attachTimelinePreview(harness.player, () => ({ clips }));

  const started = performance.now();
  for (let i = 0; i < 250; i += 1) {
    harness.tick();
  }
  const elapsedMs = performance.now() - started;

  assert.ok(elapsedMs < 25, `preview ticks took ${elapsedMs.toFixed(2)}ms`);
  assert.deepEqual(harness.events[0], ["seek", 1502]);
});
