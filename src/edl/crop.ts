export interface CropRegion {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface PixelCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPreviewLayout {
  aspectRatio: number;
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export interface RatioPoint {
  xRatio: number;
  yRatio: number;
}

const finite = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function normalizeCropRegion(value: unknown): CropRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const xRatio = clamp(finite(input.xRatio, 0), 0, 1);
  const yRatio = clamp(finite(input.yRatio, 0), 0, 1);
  const widthRatio = clamp(finite(input.widthRatio, 1), 0, 1 - xRatio);
  const heightRatio = clamp(finite(input.heightRatio, 1), 0, 1 - yRatio);
  if (widthRatio <= 0 || heightRatio <= 0) return null;
  if (
    xRatio <= 0.000001 &&
    yRatio <= 0.000001 &&
    widthRatio >= 0.999999 &&
    heightRatio >= 0.999999
  ) {
    return null;
  }
  return { xRatio, yRatio, widthRatio, heightRatio };
}

export function cropRegionFromPixels(
  value: PixelCropRegion,
  sourceWidth: number,
  sourceHeight: number,
): CropRegion | null {
  const width = finite(sourceWidth, 0);
  const height = finite(sourceHeight, 0);
  if (width <= 0 || height <= 0) return null;
  return normalizeCropRegion({
    xRatio: finite(value.x, 0) / width,
    yRatio: finite(value.y, 0) / height,
    widthRatio: finite(value.width, width) / width,
    heightRatio: finite(value.height, height) / height,
  });
}

export function cropRegionToPixels(
  value: CropRegion | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
): PixelCropRegion {
  const width = Math.max(1, Math.round(finite(sourceWidth, 1)));
  const height = Math.max(1, Math.round(finite(sourceHeight, 1)));
  const crop = normalizeCropRegion(value);
  if (!crop) return { x: 0, y: 0, width, height };
  const x = clamp(Math.round(crop.xRatio * width), 0, width - 1);
  const y = clamp(Math.round(crop.yRatio * height), 0, height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(crop.widthRatio * width), 1, width - x),
    height: clamp(Math.round(crop.heightRatio * height), 1, height - y),
  };
}

export function cropPreviewLayout(
  value: CropRegion | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
): CropPreviewLayout | null {
  const crop = normalizeCropRegion(value);
  const width = finite(sourceWidth, 0);
  const height = finite(sourceHeight, 0);
  if (!crop || width <= 0 || height <= 0) return null;
  return {
    aspectRatio: (width * crop.widthRatio) / (height * crop.heightRatio),
    leftPercent: (-crop.xRatio / crop.widthRatio) * 100,
    topPercent: (-crop.yRatio / crop.heightRatio) * 100,
    widthPercent: 100 / crop.widthRatio,
    heightPercent: 100 / crop.heightRatio,
  };
}

/** Convert a source-relative point into the cropped viewport's coordinates. */
export function cropRelativePoint(
  value: CropRegion | null | undefined,
  xRatio: unknown,
  yRatio: unknown,
): RatioPoint {
  const sourceX = clamp(finite(xRatio, 0.5), 0, 1);
  const sourceY = clamp(finite(yRatio, 0.5), 0, 1);
  const crop = normalizeCropRegion(value);
  if (!crop) return { xRatio: sourceX, yRatio: sourceY };
  return {
    xRatio: clamp((sourceX - crop.xRatio) / crop.widthRatio, 0, 1),
    yRatio: clamp((sourceY - crop.yRatio) / crop.heightRatio, 0, 1),
  };
}
