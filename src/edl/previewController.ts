// Non-destructive preview: play the ORIGINAL source while live-applying the EDL.
// Deleted ranges are skipped (seek past them); muted ranges drop volume. No
// re-encode — this is what replaces the legacy "encode on every edit" loop.
//
// Player-agnostic: pass a thin adapter so this works with native <video> or
// another local playback surface.
//
// @typedef {Object} PlayerAdapter
// @property {() => number} getCurrentTime   source seconds
// @property {(t: number) => void} seek      seek to source seconds
// @property {(muted: boolean) => void} setMuted
// @property {() => void} [pause]
// @property {(cb: () => void) => () => void} onTimeUpdate  subscribe; returns unsubscribe

import { mergeRanges } from "./model.ts";
import type { Edl } from "./model.ts";

export interface PlayerAdapter {
  getCurrentTime: () => number;
  seek: (time: number) => void;
  setMuted: (muted: boolean) => void;
  pause?: () => void;
  onTimeUpdate: (callback: () => void) => (() => void) | void;
}

const EPS = 0.02;

/**
 * @param {PlayerAdapter} player
 * @param {() => import("./model.ts").Edl} getEdl  read latest EDL each tick (edits change live)
 * @returns {{ stop: () => void }}
 */
export function attachPreview(
  player: PlayerAdapter,
  getEdl: () => Edl | null,
): { stop: () => void } {
  let muted = false;

  const tick = () => {
    const edl = getEdl();
    if (!edl) return;
    const t = player.getCurrentTime();

    const deletes = mergeRanges(
      edl.edits.filter((e) => e.kind === "delete").map((e) => ({ start: e.start, end: e.end }))
    );
    const mutes = mergeRanges(
      edl.edits.filter((e) => e.kind === "mute").map((e) => ({ start: e.start, end: e.end }))
    );

    // Skip deleted ranges: if inside one, jump to its end (or to the next kept
    // frame / end-of-media).
    for (const d of deletes) {
      if (t >= d.start - EPS && t < d.end - EPS) {
        if (d.end >= edl.source.duration - EPS) {
          player.pause?.();
        } else {
          player.seek(d.end);
        }
        return;
      }
    }

    // Mute during muted ranges.
    const shouldMute = mutes.some((m) => t >= m.start - EPS && t < m.end - EPS);
    if (shouldMute !== muted) {
      muted = shouldMute;
      player.setMuted(shouldMute);
    }
  };

  const unsubscribe = player.onTimeUpdate(tick);
  return {
    stop() {
      unsubscribe?.();
      if (muted) player.setMuted(false);
    },
  };
}
