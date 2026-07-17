import localforage from "localforage";

export const TRANSCRIPT_CACHE_SCHEMA_VERSION = 1;
export const TRANSCRIPT_CACHE_STORE_NAME = "sayless-transcription-cache";

const CACHE_STORE = localforage.createInstance({
  name: "sayless-transcription",
  storeName: "transcripts",
});

const textEncoder = () => new TextEncoder();

const toHex = (buffer) =>
  [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export const hashTranscriptSource = async (blob) => {
  if (!blob) return null;
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi || typeof blob.arrayBuffer !== "function") {
    const fallback = `${blob.type || ""}:${blob.size || 0}`;
    return `meta:${fallback}`;
  }
  const hash = await cryptoApi.digest("SHA-256", await blob.arrayBuffer());
  return `sha256:${toHex(hash)}`;
};

export const buildTranscriptCacheKey = ({
  recordingId,
  providerId,
  model,
  language,
  sourceHash,
}) => {
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

const isCacheEntry = (entry) =>
  entry?.schemaVersion === TRANSCRIPT_CACHE_SCHEMA_VERSION &&
  entry?.transcript?.version === 1 &&
  Array.isArray(entry.transcript.words);

export const getCachedTranscript = async (cacheKey) => {
  if (!cacheKey) return null;
  const entry = await CACHE_STORE.getItem(cacheKey);
  return isCacheEntry(entry) ? entry : null;
};

export const saveCachedTranscript = async (cacheKey, entry) => {
  if (!cacheKey || !entry?.transcript) return null;
  const next = {
    schemaVersion: TRANSCRIPT_CACHE_SCHEMA_VERSION,
    cachedAt: Date.now(),
    ...entry,
  };
  await CACHE_STORE.setItem(cacheKey, next);
  return next;
};

export const deleteCachedTranscript = async (cacheKey) => {
  if (!cacheKey) return false;
  await CACHE_STORE.removeItem(cacheKey);
  return true;
};

export const deleteCachedTranscriptsForRecording = async (recordingId) => {
  if (!recordingId) return { deletedCount: 0 };
  const prefix = buildTranscriptCacheKey({
    recordingId,
    providerId: "",
    model: "",
    language: "",
    sourceHash: "",
  }).split("unknown-provider")[0];
  const keysToDelete = [];
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
