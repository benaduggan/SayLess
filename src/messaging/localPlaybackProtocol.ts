export const LOCAL_PLAYBACK_MAX_BYTES = 250 * 1024 * 1024;
export const LOCAL_PLAYBACK_MAX_CHUNKS = 4000;
export const LOCAL_PLAYBACK_MIN_TTL_MS = 60 * 1000;
export const LOCAL_PLAYBACK_MAX_TTL_MS = 24 * 60 * 60 * 1000;

export interface LocalPlaybackOffer {
  offerId: string;
  projectId: string | null;
  sceneId: string | null;
  recordingSessionId: string | null;
  trackType: "screen";
  source: string;
  status: string;
  chunkCount: number;
  estimatedBytes: number;
  mediaId: string | null;
  bunnyVideoId: string | null;
  storageBackend: "idb" | "opfs";
  opfsSessionId: string | null;
  container: "video/mp4" | "video/webm";
  encoderKind: "webcodecs" | "mediarecorder";
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

export interface LocalPlaybackChunk {
  index: number;
  size: number;
  mimeType: string;
  base64: string;
}

export interface ActiveLocalPlaybackSource {
  offerId: string;
  projectId: string | null;
  sceneId: string | null;
  url: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  expiresAt: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value ? value : fallback;
const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const finiteNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const normalizeLocalPlaybackOffer = (
  value: unknown,
  {
    now = Date.now(),
    createOfferId = () => crypto.randomUUID(),
  }: { now?: number; createOfferId?: () => string } = {},
): LocalPlaybackOffer => {
  const offer = isRecord(value) ? value : {};
  const offerId = nullableString(offer.offerId) || createOfferId();
  const expiresAtRaw = finiteNumber(offer.expiresAt);
  const ttl =
    expiresAtRaw > now
      ? clamp(expiresAtRaw - now, LOCAL_PLAYBACK_MIN_TTL_MS, LOCAL_PLAYBACK_MAX_TTL_MS)
      : LOCAL_PLAYBACK_MIN_TTL_MS;
  const storageBackend = offer.storageBackend === "opfs" ? "opfs" : "idb";

  return {
    offerId,
    projectId: nullableString(offer.projectId),
    sceneId: nullableString(offer.sceneId),
    recordingSessionId: nullableString(offer.recordingSessionId),
    trackType: "screen",
    source: stringOr(offer.source, "indexeddb-screen-chunks"),
    status: stringOr(offer.status, "available"),
    chunkCount: clamp(Math.max(0, finiteNumber(offer.chunkCount)), 0, LOCAL_PLAYBACK_MAX_CHUNKS),
    estimatedBytes: Math.max(0, finiteNumber(offer.estimatedBytes)),
    mediaId: nullableString(offer.mediaId),
    bunnyVideoId: nullableString(offer.bunnyVideoId),
    storageBackend,
    opfsSessionId: storageBackend === "opfs" ? nullableString(offer.opfsSessionId) : null,
    container: offer.container === "video/mp4" ? "video/mp4" : "video/webm",
    encoderKind: offer.encoderKind === "webcodecs" ? "webcodecs" : "mediarecorder",
    createdAt: finiteNumber(offer.createdAt, now),
    expiresAt: now + ttl,
    updatedAt: now,
  };
};

export const parseStoredLocalPlaybackOffer = (
  value: unknown,
  now = Date.now(),
): LocalPlaybackOffer | null => {
  if (!isRecord(value) || typeof value.offerId !== "string" || !value.offerId) {
    return null;
  }
  if (finiteNumber(value.expiresAt) <= now) return null;
  const offerId = value.offerId;
  const offer = normalizeLocalPlaybackOffer(value, {
    now,
    createOfferId: () => offerId,
  });
  return offer.expiresAt > now ? offer : null;
};

export const parseLocalPlaybackChunk = (value: unknown): LocalPlaybackChunk | null => {
  if (!isRecord(value) || typeof value.base64 !== "string" || !value.base64) {
    return null;
  }
  return {
    index: Math.max(0, Math.trunc(finiteNumber(value.index))),
    size: Math.max(0, finiteNumber(value.size)),
    mimeType: stringOr(value.mimeType, "video/webm"),
    base64: value.base64,
  };
};
