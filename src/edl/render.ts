// Render an EDL to a final blob by composing the EXISTING mediabunny ops
// (cutVideo / muteVideo). This is the v1 renderer: correct and reuses battle-
// tested code. A v2 single-pass multi-segment exporter can replace the executor
// later without touching planEdlOps or any caller.
//
// planEdlOps() is pure and unit-tested. applyEdl() injects the op functions so
// it stays decoupled from the lazy-import wiring in ContentState (and testable).

import { mergeRanges } from "./model.ts";
import type { Edl } from "./model.ts";

export interface EdlOp {
  type: "mute" | "cut";
  start: number;
  end: number;
}

export type OperationProgress = (progress: number) => void;

export interface ApplyEdlDependencies {
  muteVideo: (
    blob: Blob,
    start: number,
    end: number,
    duration: number,
    onProgress?: OperationProgress,
  ) => Promise<Blob>;
  cutVideo: (
    blob: Blob,
    start: number,
    end: number,
    cut: boolean,
    duration: number,
    encode: boolean,
    onProgress?: OperationProgress,
  ) => Promise<Blob>;
  onProgress?: OperationProgress;
}

/**
 * Plan the ordered ops needed to realize an EDL:
 *  - mutes first, ascending (duration-preserving, so all times stay in source domain),
 *  - then deletes, DESCENDING by start (removing later ranges first keeps earlier
 *    timestamps valid as the media shrinks).
 * @param {import("./model.ts").Edl} edl
 * @returns {EdlOp[]}
 */
export function planEdlOps(edl: Edl): EdlOp[] {
  const mutes = mergeRanges(
    edl.edits.filter((e) => e.kind === "mute").map((e) => ({ start: e.start, end: e.end })),
  ).sort((a, b) => a.start - b.start);

  const deletes = mergeRanges(
    edl.edits.filter((e) => e.kind === "delete").map((e) => ({ start: e.start, end: e.end })),
  ).sort((a, b) => b.start - a.start); // descending

  return [
    ...mutes.map((r): EdlOp => ({ type: "mute", start: r.start, end: r.end })),
    ...deletes.map((r): EdlOp => ({ type: "cut", start: r.start, end: r.end })),
  ];
}

/** True if the EDL has no edits (caller can skip rendering and keep the source). */
export function isEmptyEdl(edl: Edl | null | undefined): boolean {
  return !edl || !edl.edits || edl.edits.length === 0;
}

/**
 * Execute the plan against a source blob.
 * @param {Blob} sourceBlob
 * @param {import("./model.ts").Edl} edl
 * @param {Object} deps
 * @param {(blob: Blob, start: number, end: number, duration: number, onProgress?: Function) => Promise<Blob>} deps.muteVideo
 * @param {(blob: Blob, start: number, end: number, cut: boolean, duration: number, encode: boolean, onProgress?: Function) => Promise<Blob>} deps.cutVideo
 * @param {(p: number) => void} [deps.onProgress] overall 0..1
 * @returns {Promise<Blob>}
 */
export async function applyEdl(
  sourceBlob: Blob,
  edl: Edl,
  deps: ApplyEdlDependencies,
): Promise<Blob> {
  const ops = planEdlOps(edl);
  if (ops.length === 0) return sourceBlob;

  let working = sourceBlob;
  let duration = edl.source.duration;
  let done = 0;

  for (const op of ops) {
    const stepProgress = (p: number) => deps.onProgress?.((done + (p || 0)) / ops.length);
    if (op.type === "mute") {
      working = await deps.muteVideo(working, op.start, op.end, duration, stepProgress);
      // duration unchanged
    } else {
      working = await deps.cutVideo(working, op.start, op.end, true, duration, true, stepProgress);
      duration = Math.max(0, duration - (op.end - op.start));
    }
    done += 1;
    deps.onProgress?.(done / ops.length);
  }
  return working;
}
