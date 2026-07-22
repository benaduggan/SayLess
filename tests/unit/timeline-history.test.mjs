import assert from "node:assert/strict";
import test from "node:test";

import { createTimeline, splitAtSource } from "../../src/edl/timeline.ts";
import {
  pushTimelineHistory,
  redoTimelineHistory,
  undoTimelineHistory,
} from "../../src/edl/timelineHistory.ts";

test("timeline history pushes edits and supports undo redo", () => {
  const original = createTimeline(10, { id: "base" });
  const edited = splitAtSource(original, 4);
  const pushed = pushTimelineHistory({ current: original, next: edited });

  assert.equal(pushed.timeline, edited);
  assert.deepEqual(pushed.past, [original]);
  assert.deepEqual(pushed.future, []);

  const undone = undoTimelineHistory({
    past: pushed.past,
    future: pushed.future,
    current: pushed.timeline,
  });
  assert.equal(undone.timeline, original);
  assert.deepEqual(undone.past, []);
  assert.deepEqual(undone.future, [edited]);

  const redone = redoTimelineHistory({
    past: undone.past,
    future: undone.future,
    current: undone.timeline,
  });
  assert.equal(redone.timeline, edited);
  assert.deepEqual(redone.past, [original]);
  assert.deepEqual(redone.future, []);
});

test("new timeline edits clear redo history", () => {
  const original = createTimeline(10, { id: "base" });
  const edited = splitAtSource(original, 4);
  const pushedOriginal = pushTimelineHistory({ current: original, next: edited });
  const undone = undoTimelineHistory({
    past: pushedOriginal.past,
    future: pushedOriginal.future,
    current: pushedOriginal.timeline,
  });
  const alternate = splitAtSource(original, 6);
  const pushed = pushTimelineHistory({
    past: undone.past,
    future: undone.future,
    current: undone.timeline,
    next: alternate,
  });

  assert.equal(pushed.timeline, alternate);
  assert.deepEqual(pushed.future, []);
  assert.deepEqual(pushed.past, [original]);
});

test("no-op timeline edits preserve redo history", () => {
  const original = createTimeline(10, { id: "base" });
  const edited = splitAtSource(original, 4);
  const pushedOriginal = pushTimelineHistory({ current: original, next: edited });
  const undone = undoTimelineHistory({
    past: pushedOriginal.past,
    future: pushedOriginal.future,
    current: pushedOriginal.timeline,
  });
  const pushed = pushTimelineHistory({
    past: undone.past,
    future: undone.future,
    current: undone.timeline,
    next: undone.timeline,
  });

  assert.equal(pushed.timeline, original);
  assert.deepEqual(pushed.future, [edited]);
});

test("timeline history keeps the newest fifty undo entries", () => {
  let current = createTimeline(60, { id: "base" });
  let history = { past: [], future: [], timeline: current };
  for (let i = 1; i <= 55; i += 1) {
    const next = splitAtSource(current, i);
    history = pushTimelineHistory({
      past: history.past,
      future: history.future,
      current,
      next,
    });
    current = next;
  }

  assert.equal(history.past.length, 50);
});
