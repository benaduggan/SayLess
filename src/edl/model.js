// EDL (Edit Decision List) — the non-destructive editing model.
//
// WHY: the legacy editor is destructive — every trim/cut/mute re-encodes a new
// blob and replaces the source (see editorOps.js). That can't express
// edit-by-transcript, multi-clip reorder, captions, or zoom layers, and it
// re-encodes on every keystroke. The EDL is the source of truth instead:
// edits are recorded against the ORIGINAL source's time domain, preview applies
// them live (no encode), and we encode exactly once at export.
//
// v1 scope: a single source with `delete` and `mute` edits — enough for
// transcript-driven editing and classic trim/cut. The shape is intentionally
// forward-compatible with multi-clip/track/layer editing (see NOTES at bottom),
// so extending it later is additive, not a rewrite.
//
// All times are SECONDS in the SOURCE timeline. Pure data + pure functions —
// no React, no chrome APIs — so it unit-tests cleanly.

/**
 * @typedef {Object} Edit
 * @property {string} id
 * @property {"delete"|"mute"} kind
 * @property {number} start   inclusive, source seconds
 * @property {number} end     exclusive, source seconds
 * @property {string} [label] e.g. the deleted word(s), for UI/undo
 */

/**
 * @typedef {Object} Edl
 * @property {1} version
 * @property {{ id?: string, duration: number }} source
 * @property {Edit[]} edits   unordered; resolution sorts/merges
 */

/**
 * @param {number} duration source duration in seconds
 * @param {{ id?: string }} [opts]
 * @returns {Edl}
 */
export function createEdl(duration, opts = {}) {
  return { version: 1, source: { id: opts.id, duration }, edits: [] };
}

let _seq = 0;
/** Deterministic-ish id (Math.random is fine in app code; tests pass explicit ids). */
function newId() {
  _seq += 1;
  return `edit_${_seq}`;
}

/**
 * @param {Edl} edl
 * @param {"delete"|"mute"} kind
 * @param {number} start
 * @param {number} end
 * @param {{ id?: string, label?: string }} [opts]
 * @returns {Edl} new EDL (immutable update)
 */
export function addEdit(edl, kind, start, end, opts = {}) {
  if (kind !== "delete" && kind !== "mute") {
    throw new Error(`addEdit: invalid kind "${kind}"`);
  }
  const s = clamp(Math.min(start, end), 0, edl.source.duration);
  const e = clamp(Math.max(start, end), 0, edl.source.duration);
  if (e - s <= 0) return edl; // no-op empty range
  const edit = { id: opts.id || newId(), kind, start: s, end: e, label: opts.label };
  return { ...edl, edits: [...edl.edits, edit] };
}

/** @param {Edl} edl @param {string} id @returns {Edl} */
export function removeEdit(edl, id) {
  return { ...edl, edits: edl.edits.filter((x) => x.id !== id) };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Merge overlapping/adjacent [start,end] ranges. @param {{start:number,end:number}[]} ranges */
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  /** @type {{start:number,end:number}[]} */
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}

// NOTES — forward compatibility (no code yet, just the intended growth path):
//  * multi-clip / reorder: replace the implicit single source with a `clips`
//    array [{ sourceId, sourceStart, sourceEnd }]; `delete` becomes "omit clip".
//  * layers: add `layers` (zoom keyframes, captions, callouts, backdrops) that
//    the export compositor draws over the resolved video timeline.
//  * speed ramps: per-clip `rate`.
// `compose()` (see compose.js) is the single place that turns any of this into
// a renderer plan, so renderers stay decoupled from the model's growth.
