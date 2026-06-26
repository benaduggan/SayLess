// Non-destructive timeline preview. Plays the ORIGINAL source while walking the
// clips in OUTPUT order: when the playhead reaches a clip's end it seeks to the
// next clip's source start (so reordered/clipped output previews live, no encode).
// Muted clips are silenced. Seeks at clip boundaries aren't frame-seamless, but
// they're correct.
//
// player adapter: { getCurrentTime, seek, setMuted, pause, onTimeUpdate }
// getTimeline(): returns the latest Timeline each tick (edits change live).

const EPS = 0.03;

/**
 * @param {object} player
 * @param {() => import("./timeline.js").Timeline} getTimeline
 */
export function attachTimelinePreview(player, getTimeline) {
  let idx = 0;
  let muted = false;

  const setMuted = (m) => {
    if (m !== muted) {
      muted = m;
      player.setMuted(m);
    }
  };

  const tick = () => {
    const tl = getTimeline();
    const clips = tl?.clips || [];
    if (!clips.length) return;
    if (idx >= clips.length) idx = clips.length - 1;
    const t = player.getCurrentTime();
    let clip = clips[idx];

    // Resync after a user scrub: jump idx to whichever clip holds `t`.
    if (t < clip.sourceStart - 0.4 || t >= clip.sourceEnd + 0.4) {
      const j = clips.findIndex((c) => t >= c.sourceStart - EPS && t < c.sourceEnd - EPS);
      if (j >= 0) {
        idx = j;
        clip = clips[j];
      }
    }

    // Reached end of this clip -> advance to next clip in OUTPUT order.
    if (t >= clip.sourceEnd - EPS) {
      if (idx + 1 < clips.length) {
        idx += 1;
        player.seek(clips[idx].sourceStart);
        setMuted(clips[idx].muted);
      } else {
        player.pause();
      }
      return;
    }

    // Before this clip's range (e.g. landed in a deleted gap) -> snap forward.
    if (t < clip.sourceStart - EPS) {
      player.seek(clip.sourceStart);
      setMuted(clip.muted);
      return;
    }

    setMuted(clip.muted);
  };

  const unsubscribe = player.onTimeUpdate(tick);
  return {
    stop() {
      unsubscribe?.();
      if (muted) player.setMuted(false);
    },
    /** Reset to the start of the timeline's first clip. */
    reset() {
      idx = 0;
      const tl = getTimeline();
      if (tl?.clips?.length) player.seek(tl.clips[0].sourceStart);
    },
  };
}
