import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAudioSilenceSuggestions,
  buildTranscriptSuggestions,
  mergeEditSuggestions,
} from "../../src/edl/suggestions.js";

const transcript = (words) => ({ version: 1, words });

test("buildTranscriptSuggestions finds filler words and phrases", () => {
  const suggestions = buildTranscriptSuggestions(
    transcript([
      { text: "Um", start: 0.1, end: 0.2 },
      { text: "you", start: 0.4, end: 0.5 },
      { text: "know", start: 0.5, end: 0.7 },
      { text: "ship", start: 0.8, end: 1.0 },
    ]),
  );

  assert.deepEqual(
    suggestions
      .filter((suggestion) => suggestion.kind === "filler")
      .map((suggestion) => [suggestion.label, suggestion.fromIndex, suggestion.toIndex]),
    [
      ["Um", 0, 0],
      ["you know", 1, 2],
    ],
  );
});

test("buildTranscriptSuggestions cuts only the duplicate repeated word", () => {
  const suggestions = buildTranscriptSuggestions(
    transcript([
      { text: "we", start: 0.0, end: 0.2 },
      { text: "can", start: 0.3, end: 0.5 },
      { text: "can", start: 0.55, end: 0.7 },
      { text: "ship", start: 0.8, end: 1.0 },
    ]),
  );

  const repeat = suggestions.find(
    (suggestion) => suggestion.kind === "repeated-word",
  );
  assert.equal(repeat.label, "can");
  assert.equal(repeat.fromIndex, 2);
  assert.equal(repeat.toIndex, 2);
});

test("buildTranscriptSuggestions detects long pauses between words", () => {
  const suggestions = buildTranscriptSuggestions(
    transcript([
      { text: "hello", start: 0.0, end: 0.4 },
      { text: "there", start: 1.4, end: 1.8 },
    ]),
    { minSilenceSeconds: 0.75 },
  );

  const silence = suggestions.find((suggestion) => suggestion.kind === "silence");
  assert.equal(silence.label, "1.0s pause");
  assert.equal(silence.start, 0.4);
  assert.equal(silence.end, 1.4);
  assert.equal(silence.fromIndex, null);
});

test("buildAudioSilenceSuggestions detects quiet waveform ranges", () => {
  const sampleRate = 10;
  const samples = Float32Array.from([
    0.2, 0.2, 0.2,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0.2, 0.2,
  ]);

  const suggestions = buildAudioSilenceSuggestions(
    { sampleRate, channels: [samples] },
    {
      frameSeconds: 0.1,
      minSilenceSeconds: 0.7,
      paddingSeconds: 0.1,
      silenceThresholdDb: -45,
    },
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].kind, "silence");
  assert.equal(suggestions[0].reason, "Audio silence");
  assert.equal(suggestions[0].label, "0.8s silence");
  assert.equal(suggestions[0].start, 0.4);
  assert.equal(suggestions[0].end, 1.2);
});

test("buildAudioSilenceSuggestions ignores quiet spans below minimum duration", () => {
  const suggestions = buildAudioSilenceSuggestions(
    {
      sampleRate: 10,
      channels: [Float32Array.from([0.2, 0.2, 0, 0, 0, 0, 0.2])],
    },
    { frameSeconds: 0.1, minSilenceSeconds: 0.7 },
  );

  assert.deepEqual(suggestions, []);
});

test("buildAudioSilenceSuggestions handles long recordings with separated pauses", () => {
  const sampleRate = 1000;
  const durationSeconds = 600;
  const samples = new Float32Array(sampleRate * durationSeconds).fill(0.08);
  const quietRanges = [
    [60, 65],
    [300.5, 303],
    [590, 599.5],
  ];

  for (const [start, end] of quietRanges) {
    samples.fill(0, Math.round(start * sampleRate), Math.round(end * sampleRate));
  }

  const suggestions = buildAudioSilenceSuggestions(
    { sampleRate, channels: [samples] },
    {
      frameSeconds: 0.1,
      minSilenceSeconds: 1,
      paddingSeconds: 0.1,
      silenceThresholdDb: -45,
      maxSuggestions: 10,
    },
  );

  assert.equal(suggestions.length, 3);
  assert.deepEqual(
    suggestions.map((suggestion) => [
      Number(suggestion.start.toFixed(1)),
      Number(suggestion.end.toFixed(1)),
      suggestion.label,
    ]),
    [
      [60.1, 64.9, "4.8s silence"],
      [300.6, 302.9, "2.3s silence"],
      [590.1, 599.4, "9.3s silence"],
    ],
  );
  assert.ok(
    suggestions.every((suggestion) => suggestion.start >= 0 && suggestion.end <= durationSeconds),
  );
});

test("buildAudioSilenceSuggestions requires all channels to be quiet", () => {
  const sampleRate = 10;
  const left = Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const right = Float32Array.from([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);

  const suggestions = buildAudioSilenceSuggestions(
    { sampleRate, channels: [left, right] },
    {
      frameSeconds: 0.1,
      minSilenceSeconds: 0.7,
      silenceThresholdDb: -45,
    },
  );

  assert.deepEqual(suggestions, []);
});

test("mergeEditSuggestions removes overlapping silence duplicates", () => {
  const transcriptPause = {
    id: "silence-transcript",
    kind: "silence",
    start: 1,
    end: 2,
  };
  const audioPause = {
    id: "silence-audio",
    kind: "silence",
    start: 1.05,
    end: 2.05,
  };
  const filler = {
    id: "filler",
    kind: "filler",
    start: 1.1,
    end: 1.2,
  };

  assert.deepEqual(
    mergeEditSuggestions([transcriptPause, filler], [audioPause]).map(
      (suggestion) => suggestion.id,
    ),
    ["silence-transcript", "filler"],
  );
});
