import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contiguousTranscriptWordIndexRanges,
  selectedTranscriptWordIndexes,
  updateTranscriptWordSelection,
} from "../../src/edl/transcriptSelection.ts";

test("plain clicks select endpoints and a third click starts a new selection", () => {
  let selection = updateTranscriptWordSelection(null, 4, false);
  assert.deepEqual(selection, { anchorWordIndex: 4, focusWordIndex: 4 });

  selection = updateTranscriptWordSelection(selection, 7, false);
  assert.deepEqual(selection, { anchorWordIndex: 4, focusWordIndex: 7 });

  selection = updateTranscriptWordSelection(selection, 2, false);
  assert.deepEqual(selection, { anchorWordIndex: 2, focusWordIndex: 2 });
});

test("shift-click extends the selection from its original anchor", () => {
  let selection = updateTranscriptWordSelection(null, 4, false);
  selection = updateTranscriptWordSelection(selection, 7, true);
  selection = updateTranscriptWordSelection(selection, 1, true);

  assert.deepEqual(selection, { anchorWordIndex: 4, focusWordIndex: 1 });
});

test("selection follows displayed order after clips are reordered", () => {
  const displayedWordIndexes = [2, 0, 1];
  const selected = selectedTranscriptWordIndexes(displayedWordIndexes, {
    anchorWordIndex: 2,
    focusWordIndex: 0,
  });

  assert.deepEqual(selected, [2, 0]);
});

test("selected source indexes are grouped into exact contiguous edit ranges", () => {
  assert.deepEqual(contiguousTranscriptWordIndexRanges([7, 2, 0, 1, 7, -1, 4.5]), [
    { fromIndex: 0, toIndex: 2 },
    { fromIndex: 7, toIndex: 7 },
  ]);
});
