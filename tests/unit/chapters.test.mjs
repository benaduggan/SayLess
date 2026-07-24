import assert from "node:assert/strict";
import test from "node:test";

import { buildChapterMarkers, normalizeChapterMarkers } from "../../src/edl/chapters.ts";

test("buildChapterMarkers creates transcript pause section markers", () => {
  const markers = buildChapterMarkers({
    transcript: {
      version: 1,
      words: [
        { text: "intro", start: 0, end: 0.5 },
        { text: "setup", start: 1, end: 1.5 },
        { text: "next", start: 12, end: 12.4 },
        { text: "section", start: 12.5, end: 12.9 },
      ],
    },
    duration: 20,
    pauseSeconds: 1.2,
    minSectionSeconds: 4,
  });

  assert.deepEqual(
    markers.map((marker) => [marker.time, marker.label, marker.source]),
    [
      [0, "Intro setup next section", "start"],
      [12, "Next section", "transcript-pause"],
    ],
  );
});

test("buildChapterMarkers adds audio silence markers without a transcript", () => {
  const markers = buildChapterMarkers({
    silenceSuggestions: [
      { kind: "silence", start: 8, end: 9.5 },
      { kind: "silence", start: 20, end: 21.5 },
    ],
    duration: 30,
    minSectionSeconds: 8,
  });

  assert.deepEqual(
    markers.map((marker) => [marker.time, marker.label, marker.source]),
    [
      [0, "Start", "start"],
      [9.5, "Section 2", "audio-silence"],
      [21.5, "Section 3", "audio-silence"],
    ],
  );
});

test("normalizeChapterMarkers clamps sorts and deduplicates close markers", () => {
  const markers = normalizeChapterMarkers(
    [
      { id: "late", time: 99, label: "Late", source: "manual" },
      { id: "early", time: 5, label: "Early", source: "manual" },
      { id: "duplicate", time: 5.1, label: "Duplicate", source: "manual" },
    ],
    { duration: 10 },
  );

  assert.deepEqual(
    markers.map((marker) => [marker.id, marker.time, marker.label]),
    [
      ["early", 5, "Early"],
      ["late", 10, "Late"],
    ],
  );
});
