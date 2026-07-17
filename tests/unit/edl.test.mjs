import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createEdl,
  addEdit,
  removeEdit,
  mergeRanges,
} from "../../src/edl/model.js";
import { compose, sourceToOutput, outputToSource } from "../../src/edl/compose.js";
import { editWords, wordRange } from "../../src/edl/fromTranscript.js";

test("mergeRanges merges overlapping and adjacent", () => {
  assert.deepEqual(
    mergeRanges([
      { start: 0, end: 2 },
      { start: 1.5, end: 3 },
      { start: 5, end: 6 },
    ]),
    [
      { start: 0, end: 3 },
      { start: 5, end: 6 },
    ]
  );
});

test("addEdit clamps to source and ignores empty ranges", () => {
  let edl = createEdl(10);
  edl = addEdit(edl, "delete", -5, 3, { id: "a" });
  edl = addEdit(edl, "delete", 8, 100, { id: "b" });
  edl = addEdit(edl, "delete", 4, 4, { id: "c" }); // empty -> no-op
  assert.equal(edl.edits.length, 2);
  assert.deepEqual(
    edl.edits.map((e) => [e.start, e.end]),
    [
      [0, 3],
      [8, 10],
    ]
  );
});

test("compose: deletes produce kept segments + shorter duration", () => {
  let edl = createEdl(10);
  edl = addEdit(edl, "delete", 2, 4, { id: "d1" });
  const plan = compose(edl);
  assert.deepEqual(plan.keptSegments, [
    { start: 0, end: 2 },
    { start: 4, end: 10 },
  ]);
  assert.equal(plan.outputDuration, 8);
});

test("compose: mute range maps into output time across a delete", () => {
  let edl = createEdl(10);
  edl = addEdit(edl, "delete", 2, 4, { id: "d1" }); // removes [2,4)
  edl = addEdit(edl, "mute", 5, 6, { id: "m1" }); // source 5..6
  const plan = compose(edl);
  // After removing [2,4), source 5..6 sits at output 3..4.
  assert.deepEqual(plan.outputMutes, [{ start: 3, end: 4 }]);
});

test("source/output time mapping round-trips inside kept segments", () => {
  let edl = createEdl(10);
  edl = addEdit(edl, "delete", 2, 4, { id: "d1" });
  const plan = compose(edl);
  // source 6 -> output 4 -> source 6
  assert.equal(sourceToOutput(plan, 6), 4);
  assert.equal(outputToSource(plan, 4), 6);
  // inside a deleted range -> null
  assert.equal(sourceToOutput(plan, 3), null);
});

test("removeEdit drops by id", () => {
  let edl = createEdl(5);
  edl = addEdit(edl, "mute", 1, 2, { id: "x" });
  edl = removeEdit(edl, "x");
  assert.equal(edl.edits.length, 0);
});

test("editWords: deleting a word span padded but bounded by neighbors", () => {
  const words = [
    { text: "the", start: 0, end: 0.5 },
    { text: "um", start: 0.6, end: 0.9 },
    { text: "cat", start: 1.0, end: 1.4 },
  ];
  // raw padded range for "um"
  const r = wordRange(words, 1, 1);
  assert.ok(r.start >= 0.5, "start clamped to prev word end");
  assert.ok(r.end <= 1.0, "end clamped to next word start");

  let edl = createEdl(2);
  edl = editWords(edl, words, 1, 1, "delete");
  assert.equal(edl.edits.length, 1);
  assert.equal(edl.edits[0].kind, "delete");
  assert.equal(edl.edits[0].label, "um");
});
