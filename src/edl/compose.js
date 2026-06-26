// EDL -> ExportPlan. The single, pure boundary between the editing MODEL and any
// RENDERER. Resolving here (not in the renderer) keeps renderers swappable:
//   - v1 renderer: chain the existing mediabunny ops (cutVideo/muteVideo).
//   - v2 renderer: a single-pass multi-segment mediabunny exporter (less re-encode).
// Both consume the same ExportPlan.

import { mergeRanges } from "./model.js";

/**
 * @typedef {Object} ExportPlan
 * @property {{start:number,end:number}[]} keptSegments  Disjoint, sorted, in SOURCE time. Concatenated in order = output video.
 * @property {{start:number,end:number}[]} outputMutes   Mute ranges expressed in OUTPUT time (after deletes removed).
 * @property {number} outputDuration                     Final duration after deletes.
 * @property {number} sourceDuration
 */

/**
 * Resolve an EDL into kept segments + output-mapped mute ranges.
 * @param {import("./model.js").Edl} edl
 * @returns {ExportPlan}
 */
export function compose(edl) {
  const duration = edl.source.duration;
  const deletes = mergeRanges(
    edl.edits.filter((e) => e.kind === "delete").map((e) => ({ start: e.start, end: e.end }))
  );
  const mutes = mergeRanges(
    edl.edits.filter((e) => e.kind === "mute").map((e) => ({ start: e.start, end: e.end }))
  );

  // keptSegments = source minus deletes.
  /** @type {{start:number,end:number}[]} */
  const keptSegments = [];
  let cursor = 0;
  for (const d of deletes) {
    if (d.start > cursor) keptSegments.push({ start: cursor, end: Math.min(d.start, duration) });
    cursor = Math.max(cursor, d.end);
  }
  if (cursor < duration) keptSegments.push({ start: cursor, end: duration });

  const outputDuration = keptSegments.reduce((acc, s) => acc + (s.end - s.start), 0);

  // Map each mute range (source time) into output time by walking kept segments
  // and accumulating offsets, clipping mutes to the parts that survive deletes.
  /** @type {{start:number,end:number}[]} */
  const outputMutes = [];
  for (const m of mutes) {
    let outOffset = 0;
    for (const seg of keptSegments) {
      const segLen = seg.end - seg.start;
      const overlapStart = Math.max(m.start, seg.start);
      const overlapEnd = Math.min(m.end, seg.end);
      if (overlapEnd > overlapStart) {
        outputMutes.push({
          start: outOffset + (overlapStart - seg.start),
          end: outOffset + (overlapEnd - seg.start),
        });
      }
      outOffset += segLen;
    }
  }

  return {
    keptSegments,
    outputMutes: mergeRanges(outputMutes),
    outputDuration,
    sourceDuration: duration,
  };
}

/**
 * Map a SOURCE time to OUTPUT time (for syncing the preview scrubber/transcript
 * cursor to the edited timeline). Returns null if the source time falls inside
 * a deleted range.
 * @param {ExportPlan} plan @param {number} sourceTime @returns {number|null}
 */
export function sourceToOutput(plan, sourceTime) {
  let outOffset = 0;
  for (const seg of plan.keptSegments) {
    if (sourceTime >= seg.start && sourceTime < seg.end) {
      return outOffset + (sourceTime - seg.start);
    }
    outOffset += seg.end - seg.start;
  }
  return null;
}

/**
 * Map an OUTPUT time back to SOURCE time (for seeking the underlying player).
 * @param {ExportPlan} plan @param {number} outputTime @returns {number}
 */
export function outputToSource(plan, outputTime) {
  let remaining = outputTime;
  for (const seg of plan.keptSegments) {
    const segLen = seg.end - seg.start;
    if (remaining < segLen) return seg.start + remaining;
    remaining -= segLen;
  }
  // past the end: clamp to last kept frame
  const last = plan.keptSegments[plan.keptSegments.length - 1];
  return last ? last.end : 0;
}
