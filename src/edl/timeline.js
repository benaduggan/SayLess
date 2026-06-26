// Clip-based timeline — EDL v2. The timeline is an ORDERED list of clips, each a
// slice of the source. This subsumes the v1 delete/mute model and adds split and
// reorder:
//   - split  = cut a clip in two at a time,
//   - delete = remove a clip,
//   - move   = reorder clips,
//   - mute   = silence a clip.
// Output video = clips concatenated in array order (so reordering changes output
// order; the exporter re-timestamps each clip to a running cursor).
//
// Pure data + pure functions (no React / chrome / DOM) so it unit-tests cleanly.
// Times are SECONDS in the SOURCE timeline.

/**
 * @typedef {Object} Clip
 * @property {string} id
 * @property {number} sourceStart
 * @property {number} sourceEnd
 * @property {boolean} muted
 */

/**
 * @typedef {Object} Timeline
 * @property {2} version
 * @property {{ duration: number }} source
 * @property {Clip[]} clips   ordered (output order)
 */

let _seq = 0;
function newId() {
  _seq += 1;
  return `clip_${_seq}`;
}

const EPS = 1e-4;

/** @param {number} duration @param {{id?:string}} [o] @returns {Timeline} */
export function createTimeline(duration, o = {}) {
  return {
    version: 2,
    source: { duration },
    clips:
      duration > 0
        ? [{ id: o.id || newId(), sourceStart: 0, sourceEnd: duration, muted: false }]
        : [],
  };
}

/** Index of the clip whose source range strictly contains `t` (not a boundary). */
function clipIndexContaining(clips, t) {
  return clips.findIndex((c) => t > c.sourceStart + EPS && t < c.sourceEnd - EPS);
}

/**
 * Split the clip containing source time `t` into two at `t`. No-op if `t` is at a
 * boundary or in a gap.
 * @param {Timeline} tl @param {number} t @returns {Timeline}
 */
export function splitAtSource(tl, t) {
  const i = clipIndexContaining(tl.clips, t);
  if (i < 0) return tl;
  const c = tl.clips[i];
  const a = { id: newId(), sourceStart: c.sourceStart, sourceEnd: t, muted: c.muted };
  const b = { id: newId(), sourceStart: t, sourceEnd: c.sourceEnd, muted: c.muted };
  const clips = [...tl.clips.slice(0, i), a, b, ...tl.clips.slice(i + 1)];
  return { ...tl, clips };
}

/** @param {Timeline} tl @param {string} id @returns {Timeline} */
export function deleteClip(tl, id) {
  return { ...tl, clips: tl.clips.filter((c) => c.id !== id) };
}

/** @param {Timeline} tl @param {string} id @param {boolean} muted @returns {Timeline} */
export function setClipMuted(tl, id, muted) {
  return { ...tl, clips: tl.clips.map((c) => (c.id === id ? { ...c, muted } : c)) };
}

/**
 * Move the clip at `fromIndex` to `toIndex` (reorder).
 * @param {Timeline} tl @param {number} fromIndex @param {number} toIndex @returns {Timeline}
 */
export function moveClip(tl, fromIndex, toIndex) {
  const clips = [...tl.clips];
  if (fromIndex < 0 || fromIndex >= clips.length) return tl;
  const [c] = clips.splice(fromIndex, 1);
  const to = Math.max(0, Math.min(clips.length, toIndex));
  clips.splice(to, 0, c);
  return { ...tl, clips };
}

/** Split at both ends so a clip boundary lands exactly on [s,e]. */
function splitAtRange(tl, s, e) {
  return splitAtSource(splitAtSource(tl, s), e);
}

/** Clips whose source range falls within [s,e] (after splitAtRange). */
function clipsWithin(clips, s, e) {
  return clips.filter((c) => c.sourceStart >= s - EPS && c.sourceEnd <= e + EPS);
}

/**
 * Delete a source range (e.g. selected words) — used by transcript editing.
 * @param {Timeline} tl @param {number} s @param {number} e @returns {Timeline}
 */
export function deleteSourceRange(tl, s, e) {
  if (e - s <= EPS) return tl;
  const split = splitAtRange(tl, s, e);
  const ids = new Set(clipsWithin(split.clips, s, e).map((c) => c.id));
  return { ...split, clips: split.clips.filter((c) => !ids.has(c.id)) };
}

/** Mute a source range. @param {Timeline} tl @param {number} s @param {number} e @returns {Timeline} */
export function muteSourceRange(tl, s, e) {
  if (e - s <= EPS) return tl;
  const split = splitAtRange(tl, s, e);
  const ids = new Set(clipsWithin(split.clips, s, e).map((c) => c.id));
  return { ...split, clips: split.clips.map((c) => (ids.has(c.id) ? { ...c, muted: true } : c)) };
}

/**
 * @typedef {Object} ResolvedSegment
 * @property {string} clipId
 * @property {number} sourceStart @property {number} sourceEnd
 * @property {boolean} muted
 * @property {number} outStart @property {number} outEnd
 */

/** @param {Timeline} tl @returns {{segments: ResolvedSegment[], outputDuration: number}} */
export function resolveTimeline(tl) {
  const segments = [];
  let cursor = 0;
  for (const c of tl.clips) {
    const len = Math.max(0, c.sourceEnd - c.sourceStart);
    segments.push({
      clipId: c.id,
      sourceStart: c.sourceStart,
      sourceEnd: c.sourceEnd,
      muted: c.muted,
      outStart: cursor,
      outEnd: cursor + len,
    });
    cursor += len;
  }
  return { segments, outputDuration: cursor };
}

/** Output time -> source time + clip (null if past end). */
export function outputToSource(tl, outTime) {
  const { segments } = resolveTimeline(tl);
  for (const s of segments) {
    if (outTime >= s.outStart - EPS && outTime < s.outEnd - EPS) {
      return { clipId: s.clipId, sourceTime: s.sourceStart + (outTime - s.outStart) };
    }
  }
  return null;
}

/** Source time -> output time (null if in a deleted gap). */
export function sourceToOutput(tl, srcTime) {
  const { segments } = resolveTimeline(tl);
  for (const s of segments) {
    if (srcTime >= s.sourceStart - EPS && srcTime < s.sourceEnd - EPS) {
      return s.outStart + (srcTime - s.sourceStart);
    }
  }
  return null;
}

/**
 * Derived transcript view: words grouped by clip in OUTPUT order, with output
 * timings and the clip's muted flag. Deleted clips' words vanish; reordered clips
 * move; muted clips' words are flagged — all automatically from the timeline.
 * @param {Timeline} tl
 * @param {{text:string,start:number,end:number}[]} words
 * @returns {{clipId:string, muted:boolean, outStart:number, words: Array}[]}
 */
export function clipWords(tl, words) {
  const { segments } = resolveTimeline(tl);
  return segments.map((seg) => {
    const inClip = [];
    words.forEach((w, index) => {
      const mid = (w.start + w.end) / 2;
      if (mid >= seg.sourceStart - EPS && mid < seg.sourceEnd - EPS) {
        inClip.push({
          ...w,
          index, // position in the original transcript.words (for editing)
          outStart: seg.outStart + (w.start - seg.sourceStart),
          outEnd: seg.outStart + (w.end - seg.sourceStart),
        });
      }
    });
    return { clipId: seg.clipId, muted: seg.muted, outStart: seg.outStart, words: inClip };
  });
}
