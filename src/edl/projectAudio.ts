export const PROJECT_AUDIO_TRACK_VERSION = 1;
export const MAX_PROJECT_AUDIO_BYTES = 50_000_000;

export type ProjectAudioMode = "mix" | "replace";

export interface ProjectAudioTrack {
  version: number;
  assetId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  volume: number;
  sourceVolume: number;
  mode: ProjectAudioMode;
  loop: boolean;
}

export interface ProjectAudioPreviewPosition {
  currentTime: number;
  shouldPlay: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
};

const cleanText = (value: unknown, fallback: string, maxLength = 255): string => {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
};

export function normalizeProjectAudioTrack(
  value: unknown,
): ProjectAudioTrack | null {
  if (!isRecord(value)) return null;
  const assetId = cleanText(value.assetId, "", 160);
  const rawByteSize = Number(value.byteSize);
  if (
    !Number.isFinite(rawByteSize) ||
    rawByteSize <= 0 ||
    rawByteSize > MAX_PROJECT_AUDIO_BYTES
  ) {
    return null;
  }
  const byteSize = Math.round(rawByteSize);
  const sha256 = String(value.sha256 || "").trim().toLowerCase();
  if (!assetId || !byteSize || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  const rawMimeType = cleanText(value.mimeType, "audio/*", 120).toLowerCase();
  const mimeType = rawMimeType.startsWith("audio/") ? rawMimeType : "audio/*";
  return {
    version: PROJECT_AUDIO_TRACK_VERSION,
    assetId,
    fileName: cleanText(value.fileName, "Project audio"),
    mimeType,
    byteSize,
    sha256,
    volume: clamp(value.volume, 1, 0, 1),
    sourceVolume: clamp(value.sourceVolume, 0.7, 0, 1),
    mode: value.mode === "replace" ? "replace" : "mix",
    loop: value.loop === true,
  };
}

export function updateProjectAudioTrack(
  track: ProjectAudioTrack,
  patch: Partial<Pick<ProjectAudioTrack, "volume" | "sourceVolume" | "mode" | "loop">>,
): ProjectAudioTrack {
  return normalizeProjectAudioTrack({ ...track, ...patch }) || track;
}

/**
 * Resolve the added-audio playhead from project output time. Native `Audio`
 * exposes its looped playhead modulo the asset duration, while the project
 * timeline continues increasing; comparing those domains directly causes
 * repeated seeks and eventually pins looping audio at its end.
 */
export function resolveProjectAudioPreviewPosition(
  outputTime: unknown,
  audioDuration: unknown,
  loop: boolean,
): ProjectAudioPreviewPosition {
  const rawOutputTime = Number(outputTime);
  const time = Number.isFinite(rawOutputTime) ? Math.max(0, rawOutputTime) : 0;
  const duration = Number(audioDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { currentTime: time, shouldPlay: true };
  }
  if (loop) {
    return { currentTime: time % duration, shouldPlay: true };
  }
  return {
    currentTime: Math.min(time, duration),
    shouldPlay: time < duration,
  };
}
