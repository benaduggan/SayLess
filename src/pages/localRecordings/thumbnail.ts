export const DEFAULT_THUMBNAIL_MAX_WIDTH = 480;
export const DEFAULT_THUMBNAIL_MAX_HEIGHT = 270;
export const DEFAULT_THUMBNAIL_QUALITY = 0.84;

export const computeThumbnailCaptureTime = (
  durationSeconds: unknown,
  requestedSeconds: unknown = null,
): number => {
  const duration = Number(durationSeconds);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const requested = requestedSeconds == null ? NaN : Number(requestedSeconds);

  if (Number.isFinite(requested) && requested >= 0) {
    if (!hasDuration) return requested;
    return Math.min(requested, Math.max(0, duration - 0.05));
  }

  if (!hasDuration) return 0;
  if (duration <= 0.25) return 0;
  if (duration <= 2) return Math.max(0, duration / 2);
  return Math.min(Math.max(0.5, duration * 0.08), 2, duration - 0.05);
};

export const computeThumbnailCanvasSize = (
  sourceWidth: unknown,
  sourceHeight: unknown,
  maxWidth: unknown = DEFAULT_THUMBNAIL_MAX_WIDTH,
  maxHeight: unknown = DEFAULT_THUMBNAIL_MAX_HEIGHT,
): { width: number; height: number; scale: number } => {
  const safeMaxWidth = Math.max(1, Number(maxWidth) || DEFAULT_THUMBNAIL_MAX_WIDTH);
  const safeMaxHeight = Math.max(1, Number(maxHeight) || DEFAULT_THUMBNAIL_MAX_HEIGHT);
  const safeSourceWidth = Math.max(1, Number(sourceWidth) || safeMaxWidth);
  const safeSourceHeight = Math.max(1, Number(sourceHeight) || safeMaxHeight);
  const scale = Math.min(safeMaxWidth / safeSourceWidth, safeMaxHeight / safeSourceHeight, 1);
  return {
    width: Math.max(1, Math.round(safeSourceWidth * scale)),
    height: Math.max(1, Math.round(safeSourceHeight * scale)),
    scale,
  };
};
