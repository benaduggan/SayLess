const HISTORY_LIMIT = 50;

export function pushTimelineHistory({ past = [], future = [], current, next }) {
  if (!current || !next || next === current) {
    return { past, future, timeline: current || next || null };
  }
  return {
    past: [...past.slice(-(HISTORY_LIMIT - 1)), current],
    future: [],
    timeline: next,
  };
}

export function undoTimelineHistory({ past = [], future = [], current }) {
  if (!past.length) {
    return { past, future, timeline: current || null };
  }
  const previous = past[past.length - 1];
  return {
    past: past.slice(0, -1),
    future: [current, ...future].filter(Boolean).slice(0, HISTORY_LIMIT),
    timeline: previous,
  };
}

export function redoTimelineHistory({ past = [], future = [], current }) {
  if (!future.length) {
    return { past, future, timeline: current || null };
  }
  const next = future[0];
  return {
    past: [...past.slice(-(HISTORY_LIMIT - 1)), current].filter(Boolean),
    future: future.slice(1),
    timeline: next,
  };
}
