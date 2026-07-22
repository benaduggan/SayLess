const HISTORY_LIMIT = 50;

export interface TimelineHistoryInput<T> {
  past?: T[];
  future?: T[];
  current?: T | null;
}

export interface TimelineHistoryUpdateInput<T> extends TimelineHistoryInput<T> {
  next?: T | null;
}

export interface TimelineHistoryResult<T> {
  past: T[];
  future: T[];
  timeline: T | null;
}

export function pushTimelineHistory<T>({
  past = [],
  future = [],
  current,
  next,
}: TimelineHistoryUpdateInput<T>): TimelineHistoryResult<T> {
  if (!current || !next || next === current) {
    return { past, future, timeline: current || next || null };
  }
  return {
    past: [...past.slice(-(HISTORY_LIMIT - 1)), current],
    future: [],
    timeline: next,
  };
}

export function undoTimelineHistory<T>({
  past = [],
  future = [],
  current,
}: TimelineHistoryInput<T>): TimelineHistoryResult<T> {
  if (!past.length) {
    return { past, future, timeline: current || null };
  }
  const previous = past[past.length - 1];
  return {
    past: past.slice(0, -1),
    future: [current, ...future]
      .filter((value): value is T => value != null)
      .slice(0, HISTORY_LIMIT),
    timeline: previous,
  };
}

export function redoTimelineHistory<T>({
  past = [],
  future = [],
  current,
}: TimelineHistoryInput<T>): TimelineHistoryResult<T> {
  if (!future.length) {
    return { past, future, timeline: current || null };
  }
  const next = future[0];
  return {
    past: [...past.slice(-(HISTORY_LIMIT - 1)), current].filter(
      (value): value is T => value != null,
    ),
    future: future.slice(1),
    timeline: next,
  };
}
