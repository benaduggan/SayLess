import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCaptionCues,
  normalizeCaptionWords,
  sanitizeCaptionText,
} from "../../src/edl/captions.js";

test("normalizeCaptionWords maps transcript words through timeline output order", () => {
  const project = {
    timeline: {
      version: 2,
      source: { duration: 6 },
      clips: [
        { id: "b", sourceStart: 3, sourceEnd: 5, muted: false },
        { id: "a", sourceStart: 0, sourceEnd: 2, muted: false },
        { id: "m", sourceStart: 2, sourceEnd: 3, muted: true },
      ],
    },
    transcript: {
      words: [
        { text: "zero", start: 0.2, end: 0.5 },
        { text: "muted", start: 2.2, end: 2.5 },
        { text: "three", start: 3.2, end: 3.5 },
        { text: "four", start: 4.2, end: 4.5 },
      ],
    },
  };

  const words = normalizeCaptionWords(project).map((word) => ({
    ...word,
    start: Number(word.start.toFixed(2)),
    end: Number(word.end.toFixed(2)),
  }));

  assert.deepEqual(words, [
    { text: "three", start: 0.2, end: 0.5 },
    { text: "four", start: 1.2, end: 1.5 },
    { text: "zero", start: 2.2, end: 2.5 },
  ]);
});

test("buildCaptionCues groups nearby words and sanitizes cue text", () => {
  const cues = buildCaptionCues([
    { text: "hello", start: 0, end: 0.2 },
    { text: "there", start: 0.3, end: 0.5 },
    { text: "a --> b", start: 2, end: 2.3 },
  ]);

  assert.deepEqual(cues, [
    { start: 0, end: 0.5, text: "hello there" },
    { start: 2, end: 2.3, text: "a -> b" },
  ]);
  assert.equal(sanitizeCaptionText("one\n two --> three"), "one  two -> three");
});
