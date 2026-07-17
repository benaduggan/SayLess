import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTimeline,
  splitAtSource,
  deleteClip,
  moveClip,
  setClipMuted,
  deleteSourceRange,
  muteSourceRange,
  resolveTimeline,
  outputToSource,
  sourceToOutput,
  clipWords,
} from "../../src/edl/timeline.js";

test("createTimeline = one full-span clip", () => {
  const tl = createTimeline(10);
  assert.equal(tl.clips.length, 1);
  assert.deepEqual(
    [tl.clips[0].sourceStart, tl.clips[0].sourceEnd],
    [0, 10]
  );
});

test("splitAtSource splits the containing clip", () => {
  let tl = createTimeline(10);
  tl = splitAtSource(tl, 4);
  assert.equal(tl.clips.length, 2);
  assert.deepEqual(tl.clips.map((c) => [c.sourceStart, c.sourceEnd]), [
    [0, 4],
    [4, 10],
  ]);
  // splitting at a boundary is a no-op
  assert.equal(splitAtSource(tl, 4).clips.length, 2);
});

test("delete a clip removes it and shortens output", () => {
  let tl = createTimeline(10);
  tl = splitAtSource(tl, 4); // [0,4][4,10]
  tl = deleteClip(tl, tl.clips[0].id); // remove [0,4]
  const { outputDuration } = resolveTimeline(tl);
  assert.equal(tl.clips.length, 1);
  assert.equal(outputDuration, 6);
});

test("moveClip reorders output (timestamps remap)", () => {
  let tl = createTimeline(10);
  tl = splitAtSource(tl, 3); // [0,3][3,10]
  tl = splitAtSource(tl, 6); // [0,3][3,6][6,10]  (split lands in 2nd clip)
  // reorder: move last clip to front
  tl = moveClip(tl, 2, 0);
  const { segments } = resolveTimeline(tl);
  // first output segment is now the source [6,10]
  assert.deepEqual([segments[0].sourceStart, segments[0].sourceEnd], [6, 10]);
  assert.equal(segments[0].outStart, 0);
  assert.equal(segments[0].outEnd, 4);
});

test("outputToSource / sourceToOutput across a reorder", () => {
  let tl = createTimeline(10);
  tl = splitAtSource(tl, 4); // [0,4][4,10]
  tl = moveClip(tl, 1, 0); // [4,10][0,4]
  // output 0..6 = source 4..10 ; output 6..10 = source 0..4
  assert.equal(outputToSource(tl, 0).sourceTime, 4);
  assert.equal(outputToSource(tl, 6).sourceTime, 0);
  assert.equal(sourceToOutput(tl, 4), 0);
  assert.equal(sourceToOutput(tl, 0), 6);
});

test("deleteSourceRange splits and removes (transcript delete)", () => {
  let tl = createTimeline(10);
  tl = deleteSourceRange(tl, 3, 5);
  const { segments, outputDuration } = resolveTimeline(tl);
  assert.equal(outputDuration, 8);
  assert.deepEqual(
    segments.map((s) => [s.sourceStart, s.sourceEnd]),
    [
      [0, 3],
      [5, 10],
    ]
  );
});

test("muteSourceRange flags only the covered clip", () => {
  let tl = createTimeline(10);
  tl = muteSourceRange(tl, 2, 4);
  const muted = tl.clips.filter((c) => c.muted).map((c) => [c.sourceStart, c.sourceEnd]);
  assert.deepEqual(muted, [[2, 4]]);
});

test("clipWords is a derived view in output order, deletes drop words", () => {
  const words = [
    { text: "a", start: 0.5, end: 1 },
    { text: "b", start: 4.5, end: 5 },
    { text: "c", start: 7, end: 7.5 },
  ];
  let tl = createTimeline(10);
  tl = deleteSourceRange(tl, 4, 6); // drops "b"
  tl = moveClip(tl, 1, 0); // put [6,10] first
  const view = clipWords(tl, words);
  const flat = view.flatMap((g) => g.words.map((w) => w.text));
  assert.deepEqual(flat, ["c", "a"]); // reordered, "b" gone
  // "c" remapped to output near 0 (its clip is first now: source 6..10 -> out 0..4)
  assert.ok(view[0].words[0].outStart < 2);
});
