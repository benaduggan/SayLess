import localforage from "localforage";
import type { TranscriptionConfig } from "./config.ts";
import type { Transcript } from "./types.ts";

export const TRANSCRIPT_CACHE_SCHEMA_VERSION = 1;
export const TRANSCRIPT_CACHE_STORE_NAME = "sayless-transcription-cache";

const CACHE_STORE = localforage.createInstance({
  name: "sayless-transcription",
  storeName: "transcripts",
});

const textEncoder = () => new TextEncoder();

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export const hashTranscriptSource = async (blob: Blob | null): Promise<string | null> => {
  if (!blob) return null;
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi || typeof blob.arrayBuffer !== "function") {
    const fallback = `${blob.type || ""}:${blob.size || 0}`;
    return `meta:${fallback}`;
  }
  const hash = await cryptoApi.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${toHex(hash)}`;
};

export interface TranscriptCacheKeyInput {
  recordingId?: unknown;
  providerId?: unknown;
  model?: unknown;
  language?: unknown;
  sourceHash?: unknown;
}

export interface TranscriptCacheEntry {
  schemaVersion: number;
  cachedAt: number;
  transcript: Transcript;
  [key: string]: unknown;
}

export const buildTranscriptCacheKey = ({
  recordingId,
  providerId,
  model,
  language,
  sourceHash,
}: TranscriptCacheKeyInput): string => {
  const parts = [
    "transcript",
    TRANSCRIPT_CACHE_SCHEMA_VERSION,
    recordingId || "unsaved",
    providerId || "unknown-provider",
    model || "unknown-model",
    language || "auto",
    sourceHash || "unknown-source",
  ];
  return parts.map((part) => encodeURIComponent(String(part))).join(":");
};

const isCacheEntry = (entry: unknown): entry is TranscriptCacheEntry => {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<TranscriptCacheEntry>;
  return (
    candidate.schemaVersion === TRANSCRIPT_CACHE_SCHEMA_VERSION &&
    candidate.transcript?.version === 1 &&
    Array.isArray(candidate.transcript.words)
  );
};

export const getCachedTranscript = async (
  cacheKey: string | null,
): Promise<TranscriptCacheEntry | null> => {
  if (!cacheKey) return null;
  const entry = await CACHE_STORE.getItem(cacheKey);
  return isCacheEntry(entry) ? entry : null;
};

export const saveCachedTranscript = async (
  cacheKey: string | null,
  entry: { transcript: Transcript; [key: string]: unknown },
): Promise<TranscriptCacheEntry | null> => {
  if (!cacheKey || !entry?.transcript) return null;
  const next: TranscriptCacheEntry = {
    ...entry,
    schemaVersion: TRANSCRIPT_CACHE_SCHEMA_VERSION,
    cachedAt: Date.now(),
  };
  await CACHE_STORE.setItem(cacheKey, next);
  return next;
};

export const deleteCachedTranscript = async (cacheKey: string | null): Promise<boolean> => {
  if (!cacheKey) return false;
  await CACHE_STORE.removeItem(cacheKey);
  return true;
};

export const deleteCachedTranscriptsForRecording = async (
  recordingId: string | null,
): Promise<{ deletedCount: number }> => {
  if (!recordingId) return { deletedCount: 0 };
  const prefix = buildTranscriptCacheKey({
    recordingId,
    providerId: "",
    model: "",
    language: "",
    sourceHash: "",
  }).split("unknown-provider")[0];
  const keysToDelete: string[] = [];
  await CACHE_STORE.iterate((_value, key) => {
    if (String(key).startsWith(prefix)) keysToDelete.push(key);
  });
  await Promise.all(keysToDelete.map((key) => CACHE_STORE.removeItem(key)));
  return { deletedCount: keysToDelete.length };
};

export const buildTranscriptCacheMetadata = async ({
  blob,
  recordingId,
  config,
  language,
}: {
  blob: Blob | null;
  recordingId?: string | null;
  config?: TranscriptionConfig | null;
  language?: string;
}) => {
  const providerId = config?.providerId || "local-whisper";
  const providerOptions = config?.providerOptions?.[providerId] || {};
  const model = providerOptions.model || providerOptions.localModelPath || "local-model";
  const sourceHash = await hashTranscriptSource(blob);
  return {
    key: buildTranscriptCacheKey({
      recordingId,
      providerId,
      model,
      language,
      sourceHash,
    }),
    providerId,
    model,
    language,
    sourceHash,
  };
};
