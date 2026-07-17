const DEFAULT_ZOOM_SCALE = 1.6;
const DEFAULT_ZOOM_DURATION_SECONDS = 2.5;
const DEFAULT_PRE_ROLL_SECONDS = 0.35;
const DEFAULT_MIN_GAP_SECONDS = 1.5;

const finiteNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = (value) => clamp(value, 0, 1);

const normalizeLabel = (value, fallback) => {
  const label = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return label || fallback;
};

const keyframeId = (source, time, xRatio, yRatio) =>
  `zoom-${source}-${Math.round((Number(time) || 0) * 1000)}-${Math.round(
    (Number(xRatio) || 0) * 1000,
  )}-${Math.round((Number(yRatio) || 0) * 1000)}`;

export const normalizeZoomKeyframes = (
  keyframes = [],
  { duration = Infinity, maxKeyframes = 80 } = {},
) => {
  if (!Array.isArray(keyframes)) return [];
  const sourceDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : Infinity;

  return keyframes
    .map((keyframe, index) => {
      const time = finiteNumber(keyframe?.time);
      if (time == null) return null;
      const xRatio = finiteNumber(keyframe.xRatio, 0.5);
      const yRatio = finiteNumber(keyframe.yRatio, 0.5);
      const scale = finiteNumber(keyframe.scale, DEFAULT_ZOOM_SCALE);
      const durationSeconds = finiteNumber(
        keyframe.durationSeconds,
        DEFAULT_ZOOM_DURATION_SECONDS,
      );
      const normalizedTime = clamp(time, 0, sourceDuration);
      return {
        id:
          keyframe.id ||
          keyframeId(keyframe.source || "manual", normalizedTime, xRatio, yRatio),
        time: normalizedTime,
        durationSeconds: clamp(durationSeconds, 0.5, 12),
        scale: clamp(scale, 1.1, 3),
        xRatio: clamp01(xRatio),
        yRatio: clamp01(yRatio),
        label: normalizeLabel(keyframe.label, `Zoom ${index + 1}`),
        source: normalizeLabel(keyframe.source, "manual"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
    .slice(0, maxKeyframes);
};

export const buildZoomSuggestions = (
  activityEvents = [],
  {
    duration = Infinity,
    preRollSeconds = DEFAULT_PRE_ROLL_SECONDS,
    minGapSeconds = DEFAULT_MIN_GAP_SECONDS,
    scale = DEFAULT_ZOOM_SCALE,
    durationSeconds = DEFAULT_ZOOM_DURATION_SECONDS,
    maxSuggestions = 30,
  } = {},
) => {
  if (!Array.isArray(activityEvents)) return [];
  const sourceDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : Infinity;
  const suggestions = [];

  for (const event of activityEvents) {
    if (event?.type !== "click") continue;
    const clickTime = finiteNumber(event.time);
    if (clickTime == null) continue;
    const xRatio = finiteNumber(event.xRatio);
    const yRatio = finiteNumber(event.yRatio);
    if (xRatio == null || yRatio == null) continue;

    const time = clamp(clickTime - preRollSeconds, 0, sourceDuration);
    const previous = suggestions[suggestions.length - 1];
    if (previous && time - previous.time < minGapSeconds) {
      previous.durationSeconds = clamp(
        Math.max(previous.durationSeconds, clickTime - previous.time + 1),
        0.5,
        12,
      );
      continue;
    }

    suggestions.push({
      id: keyframeId("click", time, xRatio, yRatio),
      time,
      durationSeconds,
      scale,
      xRatio: clamp01(xRatio),
      yRatio: clamp01(yRatio),
      label: "Click zoom",
      source: "click",
    });
  }

  return normalizeZoomKeyframes(suggestions, {
    duration: sourceDuration,
    maxKeyframes: maxSuggestions,
  });
};
