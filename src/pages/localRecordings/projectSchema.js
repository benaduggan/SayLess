import { normalizeChapterMarkers } from "../../edl/chapters.js";
import { normalizeZoomKeyframes } from "../../edl/zoom.js";

export const PROJECT_SCHEMA_VERSION = 2;

export const EXPORT_FORMATS = new Set(["mp4", "webm", "gif", "audio"]);
export const EXPORT_QUALITY_PRESETS = new Set(["original", "compressed"]);
export const AUDIO_EXPORT_FORMATS = new Set(["wav", "m4a"]);
export const CAPTION_STYLE_PRESETS = new Set(["clean", "large", "high-contrast"]);

const isPlainObject = (value) =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const finiteNumber = (value, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

const bool = (value, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const normalizeEnum = (value, allowed, fallback) => {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
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
});

export function normalizeExportSettings(settings = {}, source = {}) {
  const input = isPlainObject(settings) ? settings : {};
  const sourceDuration = finiteNumber(source.duration, null, { min: 0 });
  const format = normalizeEnum(input.format, EXPORT_FORMATS, DEFAULT_EXPORT_SETTINGS.format);
  const audioOnly = bool(input.audioOnly, format === "audio");
  const rawGif = isPlainObject(input.gif) ? input.gif : {};
  const maxGifDuration = sourceDuration == null ? 60 : Math.max(0.1, sourceDuration);
  const gifStart = finiteNumber(rawGif.startSeconds, 0, {
    min: 0,
    max: sourceDuration == null ? Infinity : Math.max(0, sourceDuration),
  });
  const gifDuration = finiteNumber(rawGif.durationSeconds, DEFAULT_EXPORT_SETTINGS.gif.durationSeconds, {
    min: 0.1,
    max: Math.max(0.1, Math.min(60, maxGifDuration - Math.min(gifStart, maxGifDuration))),
  });
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
      fps: Math.round(finiteNumber(rawGif.fps, DEFAULT_EXPORT_SETTINGS.gif.fps, {
        min: 4,
        max: 30,
      })),
      width: Math.round(finiteNumber(rawGif.width, DEFAULT_EXPORT_SETTINGS.gif.width, {
        min: 320,
        max: 1920,
      })),
    },
  };
}

export function normalizeProjectSchema(project = {}) {
  if (!isPlainObject(project)) return null;
  const source = isPlainObject(project.source) ? project.source : {};
  return {
    ...project,
    version: PROJECT_SCHEMA_VERSION,
    source,
    chapterMarkers: normalizeChapterMarkers(project.chapterMarkers, {
      duration: source.duration,
    }),
    zoomKeyframes: normalizeZoomKeyframes(project.zoomKeyframes, {
      duration: source.duration,
    }),
    exportSettings: normalizeExportSettings(project.exportSettings, source),
  };
}
