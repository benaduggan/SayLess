import { normalizeChapterMarkers } from "../../edl/chapters.ts";
import { normalizeZoomKeyframes } from "../../edl/zoom.ts";
import { normalizeCropRegion } from "../../edl/crop.ts";
import type { CropRegion } from "../../edl/crop.ts";
import { normalizeProjectAudioTrack } from "../../edl/projectAudio.ts";
import type { ProjectAudioTrack } from "../../edl/projectAudio.ts";

export const PROJECT_SCHEMA_VERSION = 4;

export const EXPORT_FORMATS = new Set<ExportFormat>(["mp4", "webm", "gif", "audio"]);
export const EXPORT_QUALITY_PRESETS = new Set<ExportQualityPreset>(["original", "compressed"]);
export const AUDIO_EXPORT_FORMATS = new Set<AudioExportFormat>(["wav", "m4a"]);
export const CAPTION_STYLE_PRESETS = new Set<CaptionStylePreset>([
  "clean",
  "large",
  "high-contrast",
]);

export type ExportFormat = "mp4" | "webm" | "gif" | "audio";
export type ExportQualityPreset = "original" | "compressed";
export type AudioExportFormat = "wav" | "m4a";
export type CaptionStylePreset = "clean" | "large" | "high-contrast";

export interface ExportSettings {
  format: ExportFormat;
  qualityPreset: ExportQualityPreset;
  includeProjectSidecar: boolean;
  includeTranscriptSidecar: boolean;
  includeCaptionSidecar: boolean;
  audioOnly: boolean;
  audioFormat: AudioExportFormat;
  captionStyle: { preset: CaptionStylePreset; burnIn: boolean };
  gif: { startSeconds: number; durationSeconds: number; fps: number; width: number };
}

export type UnknownRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function finiteNumber(
  value: unknown,
  fallback: null,
  bounds?: { min?: number; max?: number },
): number | null;
function finiteNumber(
  value: unknown,
  fallback: number,
  bounds?: { min?: number; max?: number },
): number;
function finiteNumber(
  value: unknown,
  fallback: number | null,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {},
): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeEnum = <T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return allowed.has(normalized as T) ? (normalized as T) : fallback;
};

export const DEFAULT_EXPORT_SETTINGS = Object.freeze({
  format: "mp4",
  qualityPreset: "original",
  includeProjectSidecar: true,
  includeTranscriptSidecar: false,
  includeCaptionSidecar: false,
  audioOnly: false,
  audioFormat: "wav",
  captionStyle: {
    preset: "clean",
    burnIn: false,
  },
  gif: {
    startSeconds: 0,
    durationSeconds: 6,
    fps: 12,
    width: 960,
  },
} satisfies ExportSettings);

export function normalizeExportSettings(
  settings: unknown = {},
  sourceInput: unknown = {},
): ExportSettings {
  const input = isPlainObject(settings) ? settings : {};
  const source = isPlainObject(sourceInput) ? sourceInput : {};
  const sourceDuration = finiteNumber(source.duration, null, { min: 0 });
  const format = normalizeEnum(input.format, EXPORT_FORMATS, DEFAULT_EXPORT_SETTINGS.format);
  const audioOnly = bool(input.audioOnly, format === "audio");
  const rawGif = isPlainObject(input.gif) ? input.gif : {};
  const maxGifDuration = sourceDuration == null ? 60 : Math.max(0.1, sourceDuration);
  const gifStart = finiteNumber(rawGif.startSeconds, 0, {
    min: 0,
    max: sourceDuration == null ? Infinity : Math.max(0, sourceDuration),
  });
  const gifDuration = finiteNumber(
    rawGif.durationSeconds,
    DEFAULT_EXPORT_SETTINGS.gif.durationSeconds,
    {
      min: 0.1,
      max: Math.max(0.1, Math.min(60, maxGifDuration - Math.min(gifStart, maxGifDuration))),
    },
  );
  const rawCaptionStyle = isPlainObject(input.captionStyle) ? input.captionStyle : {};

  return {
    format,
    qualityPreset: normalizeEnum(
      input.qualityPreset,
      EXPORT_QUALITY_PRESETS,
      DEFAULT_EXPORT_SETTINGS.qualityPreset,
    ),
    includeProjectSidecar: bool(
      input.includeProjectSidecar,
      DEFAULT_EXPORT_SETTINGS.includeProjectSidecar,
    ),
    includeTranscriptSidecar: bool(input.includeTranscriptSidecar, false),
    includeCaptionSidecar: bool(input.includeCaptionSidecar, false),
    audioOnly,
    audioFormat: normalizeEnum(
      input.audioFormat,
      AUDIO_EXPORT_FORMATS,
      DEFAULT_EXPORT_SETTINGS.audioFormat,
    ),
    captionStyle: {
      preset: normalizeEnum(
        rawCaptionStyle.preset,
        CAPTION_STYLE_PRESETS,
        DEFAULT_EXPORT_SETTINGS.captionStyle.preset,
      ),
      burnIn: bool(rawCaptionStyle.burnIn, false),
    },
    gif: {
      startSeconds: gifStart,
      durationSeconds: gifDuration,
      fps: Math.round(
        finiteNumber(rawGif.fps, DEFAULT_EXPORT_SETTINGS.gif.fps, {
          min: 4,
          max: 30,
        }),
      ),
      width: Math.round(
        finiteNumber(rawGif.width, DEFAULT_EXPORT_SETTINGS.gif.width, {
          min: 320,
          max: 1920,
        }),
      ),
    },
  };
}

export interface NormalizedProject extends UnknownRecord {
  version: number;
  source: UnknownRecord;
  chapterMarkers: ReturnType<typeof normalizeChapterMarkers>;
  zoomKeyframes: ReturnType<typeof normalizeZoomKeyframes>;
  crop: CropRegion | null;
  audioTrack: ProjectAudioTrack | null;
  exportSettings: ExportSettings;
}

export function normalizeProjectSchema(projectInput: unknown = {}): NormalizedProject | null {
  const project = projectInput;
  if (!isPlainObject(project)) return null;
  const source = isPlainObject(project.source) ? project.source : {};
  return {
    ...project,
    version: PROJECT_SCHEMA_VERSION,
    source,
    chapterMarkers: normalizeChapterMarkers(
      Array.isArray(project.chapterMarkers) ? project.chapterMarkers : [],
      {
        duration: Number(source.duration),
      },
    ),
    zoomKeyframes: normalizeZoomKeyframes(
      Array.isArray(project.zoomKeyframes) ? project.zoomKeyframes : [],
      {
        duration: Number(source.duration),
      },
    ),
    crop: normalizeCropRegion(project.crop),
    audioTrack: normalizeProjectAudioTrack(project.audioTrack),
    exportSettings: normalizeExportSettings(project.exportSettings, source),
  };
}
