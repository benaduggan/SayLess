// Bridge: transcript word selection -> EDL edits. This is the headline feature
// (edit-by-transcript / mute words) expressed against the non-destructive model.
//
// Pad ranges slightly so we don't clip the leading/trailing phoneme of adjacent
// words; padding is bounded by neighbors so we never overlap kept words.

import { addEdit } from "./model.js";

/**
 * Build a source time range covering a contiguous span of words, padded toward
 * (but not into) neighbors.
 * @param {import("../transcription/types.js").Word[]} words full transcript words
 * @param {number} fromIndex inclusive
 * @param {number} toIndex inclusive
 * @param {number} [pad] seconds
 * @returns {{start:number,end:number}}
 */
export function wordRange(words, fromIndex, toIndex, pad = 0.04) {
  const first = words[fromIndex];
  const last = words[toIndex];
  const prev = words[fromIndex - 1];
  const next = words[toIndex + 1];
  const start = Math.max(first.start - pad, prev ? prev.end : 0);
  const end = next ? Math.min(last.end + pad, next.start) : last.end + pad;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Apply an edit to a selected word span.
 * @param {import("./model.js").Edl} edl
 * @param {import("../transcription/types.js").Word[]} words
 * @param {number} fromIndex
 * @param {number} toIndex
 * @param {"delete"|"mute"} kind
 * @returns {import("./model.js").Edl}
 */
export function editWords(edl, words, fromIndex, toIndex, kind) {
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const { start, end } = wordRange(words, lo, hi);
  const label = words
    .slice(lo, hi + 1)
    .map((w) => w.text)
    .join(" ")
    .trim();
  return addEdit(edl, kind, start, end, { label });
}
