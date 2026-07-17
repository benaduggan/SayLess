export function clampZoomRatio(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function computeZoomViewportTransform(
  zoom,
  width,
  height,
) {
  const viewportWidth = Math.max(1, Number(width) || 1);
  const viewportHeight = Math.max(1, Number(height) || 1);
  const scale = Math.max(1, Number(zoom?.scale) || 1);
  const drawWidth = viewportWidth * scale;
  const drawHeight = viewportHeight * scale;
  const focusX = clampZoomRatio(zoom?.xRatio) * viewportWidth;
  const focusY = clampZoomRatio(zoom?.yRatio) * viewportHeight;
  const minX = viewportWidth - drawWidth;
  const minY = viewportHeight - drawHeight;
  const dx = Math.max(minX, Math.min(0, viewportWidth / 2 - focusX * scale));
  const dy = Math.max(minY, Math.min(0, viewportHeight / 2 - focusY * scale));
  return {
    scale,
    dx,
    dy,
    drawWidth,
    drawHeight,
    focusX,
    focusY,
  };
}

export function zoomTransformToCss(transform, width = 100, height = 100) {
  const scale = Math.max(1, Number(transform?.scale) || 1);
  const viewportWidth = Math.max(1, Number(width) || 1);
  const viewportHeight = Math.max(1, Number(height) || 1);
  const dxPercent = ((Number(transform?.dx) || 0) / viewportWidth) * 100;
  const dyPercent = ((Number(transform?.dy) || 0) / viewportHeight) * 100;
  return {
    transform: `translate(${dxPercent}%, ${dyPercent}%) scale(${scale})`,
    transformOrigin: "0 0",
  };
}
