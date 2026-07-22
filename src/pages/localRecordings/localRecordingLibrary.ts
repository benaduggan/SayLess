import localforage from "localforage";
import type { NormalizedProject, UnknownRecord } from "./projectSchema";
import type { CaptionProject, CaptionWord } from "../../edl/captions";
import {
  buildCaptionCues,
  normalizeCaptionWords,
  sanitizeCaptionText,
} from "../../edl/captions";
import { createTimeline } from "../../edl/timeline";
import {
  PROJECT_SCHEMA_VERSION,
  normalizeExportSettings,
  normalizeProjectSchema,
} from "./projectSchema";
import {
  DEFAULT_THUMBNAIL_MAX_HEIGHT,
  DEFAULT_THUMBNAIL_MAX_WIDTH,
  DEFAULT_THUMBNAIL_QUALITY,
  computeThumbnailCanvasSize,
  computeThumbnailCaptureTime,
} from "./thumbnail";
import { normalizeLocalRecordingStorageFields } from "./localRecordingEntry";

export interface LocalRecordingBackendRef {
  backend: "opfs";
  fileName: string;
}

export type LocalRecordingProject = NormalizedProject &
  CaptionProject & {
    recordingId?: string | null;
    updatedAt?: number;
  };

export interface LocalRecordingEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  byteSize: number;
  mimeType: string;
  backendRef: LocalRecordingBackendRef | null;
  blobKey: string | null;
  editedBlobKey: string | null;
  editedAt: number | null;
  thumbnailDataUrl: string | null;
  thumbnailUpdatedAt: number | null;
  recordingMeta: UnknownRecord | null;
  project: LocalRecordingProject | null;
}

export type LocalRecordingEntryInput = Partial<LocalRecordingEntry> & {
  id: string;
};
export type LocalRecordingIndex = Record<string, LocalRecordingEntry>;

interface ThumbnailOptions {
  atSeconds?: number | null;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  timeoutMs?: number;
}

interface RegisterLocalRecordingOptions {
  id?: string;
  title?: string;
  blob?: Blob | null;
  backendRef?: LocalRecordingBackendRef | null;
  durationMs?: number;
  mimeType?: string | null;
  recordingMeta?: UnknownRecord | null;
  createdAt?: number | null;
}

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

const INDEX_KEY = "localRecordingLibraryIndex";
const BLOB_STORE = localforage.createInstance({
  name: "local-recordings",
  storeName: "blobs",
});

const OPFS_RECORDING_PREFIX = "recording-";
const MIN_VALID_RECORDING_BYTES = 4096;
const PROJECT_SIDECAR_SCHEMA_VERSION = 1;
const PROJECT_SIDECAR_KIND = "sayless.localRecordingProject";
const TRANSCRIPT_SIDECAR_SCHEMA_VERSION = 1;
const TRANSCRIPT_SIDECAR_KIND = "sayless.localRecordingTranscript";
const THUMBNAIL_TIMEOUT_MS = 5000;

const storageGet = (keys: string[]) => chrome.storage.local.get(keys);
const storageSet = (value: Record<string, unknown>) =>
  chrome.storage.local.set(value);

const now = () => Date.now();

export const localRecordingIdFromBackendRef = (
  backendRef: LocalRecordingBackendRef | null,
  fallback: string | null = null
): string => {
  if (backendRef?.backend === "opfs" && backendRef.fileName) {
    return backendRef.fileName.replace(/\.(mp4|webm)$/i, "");
  }
  return fallback || `local-${now()}-${Math.random().toString(16).slice(2)}`;
};

const inferMimeFromName = (name: string | null | undefined): string =>
  /\.webm$/i.test(name || "") ? "video/webm" : "video/mp4";

const extensionForMime = (
  mimeType: string | null | undefined
): "webm" | "mp4" => (/webm/i.test(mimeType || "") ? "webm" : "mp4");

const safeFileBaseName = (name: unknown): string => {
  const cleaned = String(name || "recording")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return cleaned || "recording";
};

const titleFromFileName = (name: string): string =>
  safeFileBaseName(
    String(name || "Imported recording").replace(/\.[^.]+$/, "")
  );

const formatVttTimestamp = (seconds: unknown): string => {
  const totalMillis = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hours = Math.floor(totalMillis / 3_600_000);
  const minutes = Math.floor((totalMillis % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(
    3,
    "0"
  )}`;
};

const buildWebVtt = (words: readonly CaptionWord[]): string => {
  const cues = buildCaptionCues(words).map(
    (cue) =>
      `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(
        cue.end
      )}\n${sanitizeCaptionText(cue.text)}`
  );
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
};

const referencedBlobKeys = (index: LocalRecordingIndex): Set<string> =>
  new Set(
    Object.values(index)
      .flatMap((entry) => [entry.blobKey, entry.editedBlobKey])
      .filter((key): key is string => Boolean(key))
  );

const referencedOpfsFileNames = (index: LocalRecordingIndex): Set<string> =>
  new Set(
    Object.values(index)
      .map((entry) =>
        entry.backendRef?.backend === "opfs" ? entry.backendRef.fileName : null
      )
      .filter((name): name is string => Boolean(name))
  );

const listBlobStoreKeys = async () => {
  const keys: string[] = [];
  await BLOB_STORE.iterate((_value, key) => {
    keys.push(key);
  });
  return keys;
};

const listOpfsRecordingFiles = async () => {
  if (
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    return [];
  }
  const dir = await navigator.storage.getDirectory();
  const files = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file") continue;
    if (!name.startsWith(OPFS_RECORDING_PREFIX)) continue;
    if (!/\.(mp4|webm)$/i.test(name)) continue;
    files.push(name);
  }
  return files;
};

const isPlainObject = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const jsonClone = (value: unknown): unknown => {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const sanitizeProject = (project: unknown): LocalRecordingProject | null => {
  if (!isPlainObject(project)) return null;
  const timeline = isPlainObject(project.timeline)
    ? jsonClone(project.timeline)
    : null;
  const transcript = isPlainObject(project.transcript)
    ? jsonClone(project.transcript)
    : null;
  const chapterMarkers = Array.isArray(project.chapterMarkers)
    ? jsonClone(project.chapterMarkers)
    : [];
  const zoomKeyframes = Array.isArray(project.zoomKeyframes)
    ? jsonClone(project.zoomKeyframes)
    : [];
  const exportSettings = normalizeExportSettings(
    isPlainObject(project.exportSettings) ? project.exportSettings : {},
    project.source
  );
  return normalizeProjectSchema({
    version: PROJECT_SCHEMA_VERSION,
    updatedAt: Number(project.updatedAt) || now(),
    recordingId: project.recordingId || null,
    source: isPlainObject(project.source) ? jsonClone(project.source) : {},
    timeline,
    transcript,
    chapterMarkers,
    zoomKeyframes,
    selectedClipId: project.selectedClipId || null,
    exportSettings,
  }) as LocalRecordingProject | null;
};

export function normalizeLocalRecordingEntry(
  entry: LocalRecordingEntryInput
): LocalRecordingEntry;
export function normalizeLocalRecordingEntry(
  entry: unknown,
  fallbackId: string
): LocalRecordingEntry;
export function normalizeLocalRecordingEntry(
  entry: LocalRecordingEntryInput | unknown,
  fallbackId?: string
): LocalRecordingEntry {
  const value = isPlainObject(entry) ? entry : {};
  const fields = normalizeLocalRecordingStorageFields(value, fallbackId);
  const project = sanitizeProject(value.project);
  return {
    ...fields,
    backendRef: fields.backendRef,
    recordingMeta: fields.recordingMeta,
    project,
  };
}

const makeThumbnailFromBlob = async (
  blob: Blob,
  {
    atSeconds = null,
    maxWidth = DEFAULT_THUMBNAIL_MAX_WIDTH,
    maxHeight = DEFAULT_THUMBNAIL_MAX_HEIGHT,
    quality = DEFAULT_THUMBNAIL_QUALITY,
    timeoutMs = THUMBNAIL_TIMEOUT_MS,
  }: ThumbnailOptions = {}
): Promise<string | null> => {
  if (!blob || typeof document === "undefined" || typeof URL === "undefined") {
    return null;
  }

  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(blob);

  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const waitFor = (eventName: keyof HTMLMediaElementEventMap) =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener(eventName, onEvent);
          video.removeEventListener("error", onError);
        };
        const onEvent = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("local-recording-thumbnail-video-error"));
        };
        video.addEventListener(eventName, onEvent, { once: true });
        video.addEventListener("error", onError, { once: true });
      });

    const timed = (promise: Promise<void>): Promise<void> => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        promise,
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("local-recording-thumbnail-timeout")),
            timeoutMs
          );
        }),
      ]).finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      });
    };

    video.src = objectUrl;
    await timed(waitFor("loadedmetadata"));

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const seekTo = computeThumbnailCaptureTime(duration, atSeconds);
    if (seekTo > 0) {
      video.currentTime = seekTo;
      await timed(waitFor("seeked"));
    } else if (!video.videoWidth || !video.videoHeight) {
      await timed(waitFor("loadeddata"));
    }

    const { width, height } = computeThumbnailCanvasSize(
      video.videoWidth,
      video.videoHeight,
      maxWidth,
      maxHeight
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
};

export const getLocalRecordingIndex =
  async (): Promise<LocalRecordingIndex> => {
    const result = await storageGet([INDEX_KEY]);
    const raw = result?.[INDEX_KEY] || {};
    return Object.fromEntries(
      Object.entries(isPlainObject(raw) ? raw : {})
        .filter(([, entry]) => isPlainObject(entry))
        .map(([id, entry]) => [id, normalizeLocalRecordingEntry(entry, id)])
    );
  };

export const saveLocalRecordingEntry = async (
  entry: LocalRecordingEntryInput
): Promise<LocalRecordingEntry> => {
  if (!entry?.id) throw new Error("local-recording-entry-missing-id");
  const index = await getLocalRecordingIndex();
  const existing = index[entry.id] || {};
  const next = normalizeLocalRecordingEntry({
    ...existing,
    ...entry,
    updatedAt: entry.updatedAt || now(),
  });
  index[next.id] = next;
  await storageSet({ [INDEX_KEY]: index });
  return next;
};

export const renameLocalRecording = async (
  recordingId: string,
  title: string
) => {
  if (!recordingId) throw new Error("local-recording-rename-missing-id");
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("local-recording-rename-empty-title");
  return saveLocalRecordingEntry({
    id: recordingId,
    title: cleanTitle,
    updatedAt: now(),
  });
};

export const deleteLocalRecording = async (
  recordingId: string
): Promise<boolean> => {
  if (!recordingId) throw new Error("local-recording-delete-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) return false;

  const keys = [entry.blobKey, entry.editedBlobKey].filter(
    (key): key is string => Boolean(key)
  );
  await Promise.all(
    keys.map((key) => BLOB_STORE.removeItem(key).catch(() => {}))
  );

  if (entry.backendRef?.backend === "opfs" && entry.backendRef.fileName) {
    try {
      const dir = await navigator.storage.getDirectory();
      await dir.removeEntry(entry.backendRef.fileName);
    } catch {}
  }

  delete index[recordingId];
  await storageSet({ [INDEX_KEY]: index });
  return true;
};

export const deleteLocalRecordings = async (recordingIds: string[] = []) => {
  const uniqueIds = [...new Set(recordingIds.filter(Boolean))];
  const results = [];
  for (const recordingId of uniqueIds) {
    results.push({
      id: recordingId,
      deleted: await deleteLocalRecording(recordingId),
    });
  }
  return {
    deletedCount: results.filter((result) => result.deleted).length,
    results,
  };
};

export const duplicateLocalRecording = async (
  recordingId: string,
  title: string | null = null
) => {
  if (!recordingId) throw new Error("local-recording-duplicate-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");

  const blob = await readLocalRecordingBlob(entry);
  const duplicatedId = localRecordingIdFromBackendRef(null);
  const blobKey = `original:${duplicatedId}`;
  await BLOB_STORE.setItem(blobKey, blob);

  const project = entry.project
    ? sanitizeProject({
        ...entry.project,
        recordingId: duplicatedId,
      })
    : null;

  return saveLocalRecordingEntry({
    id: duplicatedId,
    title: title || `${entry.title || "Untitled recording"} copy`,
    createdAt: now(),
    updatedAt: now(),
    durationMs: entry.durationMs,
    byteSize: blob.size || entry.byteSize || 0,
    mimeType: blob.type || entry.mimeType || "video/mp4",
    blobKey,
    backendRef: null,
    editedBlobKey: null,
    editedAt: null,
    thumbnailDataUrl: entry.thumbnailDataUrl,
    thumbnailUpdatedAt: entry.thumbnailUpdatedAt,
    recordingMeta: entry.recordingMeta,
    project,
  });
};

export const getLocalRecordingExport = async (recordingId: string) => {
  if (!recordingId) throw new Error("local-recording-export-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  const blob = await readLocalRecordingBlob(entry);
  const mimeType = blob.type || entry.mimeType || "video/mp4";
  return {
    entry,
    blob,
    fileName: `${safeFileBaseName(entry.title)}.${extensionForMime(mimeType)}`,
    mimeType,
  };
};

export const buildDefaultProjectForEntry = (
  entry: LocalRecordingEntryInput
): LocalRecordingProject => {
  if (!entry?.id) throw new Error("local-recording-project-missing-entry");
  const sanitized = normalizeLocalRecordingEntry(entry);
  const duration = Math.max(0, (Number(sanitized.durationMs) || 0) / 1000);
  const project = sanitizeProject({
    version: PROJECT_SCHEMA_VERSION,
    updatedAt: now(),
    recordingId: sanitized.id,
    source: {
      duration,
      mimeType: sanitized.mimeType,
      byteSize: sanitized.byteSize,
    },
    timeline: createTimeline(duration),
    transcript: null,
    selectedClipId: null,
    exportSettings: { format: extensionForMime(sanitized.mimeType) },
  });
  if (!project) throw new Error("local-recording-project-invalid");
  return project;
};

export const ensureLocalRecordingProject = async (recordingId: string) => {
  if (!recordingId) throw new Error("local-recording-project-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  if (entry.project) return entry;
  return saveLocalRecordingEntry({
    id: recordingId,
    project: buildDefaultProjectForEntry(entry),
    updatedAt: now(),
  });
};

export const migrateLocalRecordingProjects = async (
  recordingIds: string[] | null = null
) => {
  const index = await getLocalRecordingIndex();
  const ids =
    recordingIds == null
      ? Object.keys(index)
      : [...new Set(recordingIds.filter(Boolean))];
  const migratedIds = [];
  for (const recordingId of ids) {
    const entry = index[recordingId];
    if (!entry || entry.project) continue;
    if (!entry.blobKey && !entry.editedBlobKey && !entry.backendRef) continue;
    await ensureLocalRecordingProject(recordingId);
    migratedIds.push(recordingId);
  }
  return {
    migratedCount: migratedIds.length,
    ids: migratedIds,
  };
};

export const buildLocalRecordingProjectSidecar = (
  entry: LocalRecordingEntryInput
) => {
  if (!entry?.id)
    throw new Error("local-recording-project-export-missing-entry");
  const sanitized = normalizeLocalRecordingEntry(entry);
  return {
    kind: PROJECT_SIDECAR_KIND,
    schemaVersion: PROJECT_SIDECAR_SCHEMA_VERSION,
    exportedAt: now(),
    recording: {
      id: sanitized.id,
      title: sanitized.title,
      createdAt: sanitized.createdAt,
      updatedAt: sanitized.updatedAt,
      durationMs: sanitized.durationMs,
      byteSize: sanitized.byteSize,
      mimeType: sanitized.mimeType,
      editedAt: sanitized.editedAt,
      recordingMeta: sanitized.recordingMeta,
      thumbnailDataUrl: sanitized.thumbnailDataUrl,
      thumbnailUpdatedAt: sanitized.thumbnailUpdatedAt,
    },
    project: sanitized.project,
  };
};

export const getLocalRecordingProjectExport = async (recordingId: string) => {
  if (!recordingId)
    throw new Error("local-recording-project-export-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  const projectEntry = entry.project
    ? entry
    : await ensureLocalRecordingProject(recordingId);
  const sidecar = buildLocalRecordingProjectSidecar(projectEntry);
  return {
    entry: projectEntry,
    sidecar,
    blob: new Blob([JSON.stringify(sidecar, null, 2)], {
      type: "application/json",
    }),
    fileName: `${safeFileBaseName(entry.title)}.sayless-project.json`,
    mimeType: "application/json",
  };
};

export const buildLocalRecordingTranscriptSidecar = (
  entry: LocalRecordingEntryInput
) => {
  if (!entry?.id)
    throw new Error("local-recording-transcript-export-missing-entry");
  const sanitized = normalizeLocalRecordingEntry(entry);
  if (!sanitized.project?.transcript) {
    throw new Error("local-recording-transcript-missing");
  }
  return {
    kind: TRANSCRIPT_SIDECAR_KIND,
    schemaVersion: TRANSCRIPT_SIDECAR_SCHEMA_VERSION,
    exportedAt: now(),
    recording: {
      id: sanitized.id,
      title: sanitized.title,
      durationMs: sanitized.durationMs,
      mimeType: sanitized.mimeType,
    },
    transcript: sanitized.project.transcript,
    timelineAwareWords: normalizeCaptionWords(sanitized.project),
  };
};

export const getLocalRecordingTranscriptExport = async (
  recordingId: string
) => {
  if (!recordingId)
    throw new Error("local-recording-transcript-export-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  const sidecar = buildLocalRecordingTranscriptSidecar(entry);
  return {
    entry,
    sidecar,
    blob: new Blob([JSON.stringify(sidecar, null, 2)], {
      type: "application/json",
    }),
    fileName: `${safeFileBaseName(entry.title)}.transcript.json`,
    mimeType: "application/json",
  };
};

export const getLocalRecordingCaptionExport = async (recordingId: string) => {
  if (!recordingId)
    throw new Error("local-recording-caption-export-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  if (!entry.project?.transcript)
    throw new Error("local-recording-transcript-missing");
  const words = normalizeCaptionWords(entry.project);
  const vtt = buildWebVtt(words);
  return {
    entry,
    vtt,
    blob: new Blob([vtt], { type: "text/vtt" }),
    fileName: `${safeFileBaseName(entry.title)}.vtt`,
    mimeType: "text/vtt",
  };
};

export const getLocalRecordingExports = async (recordingIds: string[] = []) => {
  const uniqueIds = [...new Set(recordingIds.filter(Boolean))];
  const exports = [];
  for (const recordingId of uniqueIds) {
    exports.push(await getLocalRecordingExport(recordingId));
  }
  return exports;
};

export const getLocalRecordingProjectExports = async (
  recordingIds: string[] = []
) => {
  const uniqueIds = [...new Set(recordingIds.filter(Boolean))];
  const exports = [];
  for (const recordingId of uniqueIds) {
    exports.push(await getLocalRecordingProjectExport(recordingId));
  }
  return exports;
};

export const getLocalRecordingTranscriptExports = async (
  recordingIds: string[] = []
) => {
  const uniqueIds = [...new Set(recordingIds.filter(Boolean))];
  const exports = [];
  for (const recordingId of uniqueIds) {
    const index = await getLocalRecordingIndex();
    if (!index[recordingId]?.project?.transcript) continue;
    exports.push(await getLocalRecordingTranscriptExport(recordingId));
  }
  return exports;
};

export const getLocalRecordingCaptionExports = async (
  recordingIds: string[] = []
) => {
  const uniqueIds = [...new Set(recordingIds.filter(Boolean))];
  const exports = [];
  for (const recordingId of uniqueIds) {
    const index = await getLocalRecordingIndex();
    if (!index[recordingId]?.project?.transcript) continue;
    exports.push(await getLocalRecordingCaptionExport(recordingId));
  }
  return exports;
};

export const getLocalRecordingProject = async (recordingId: string) => {
  if (!recordingId) return null;
  const index = await getLocalRecordingIndex();
  return index[recordingId]?.project || null;
};

export const saveLocalRecordingProject = async (
  recordingId: string,
  project: unknown = {}
) => {
  if (!recordingId) throw new Error("local-recording-project-missing-id");
  const index = await getLocalRecordingIndex();
  if (!index[recordingId]) {
    throw new Error("local-recording-project-entry-missing");
  }
  const nextProject = sanitizeProject({
    ...(isPlainObject(project) ? project : {}),
    recordingId,
    updatedAt: now(),
  });
  return saveLocalRecordingEntry({
    id: recordingId,
    project: nextProject,
    updatedAt: now(),
  });
};

export const clearLocalRecordingProject = async (recordingId: string) => {
  if (!recordingId) throw new Error("local-recording-project-missing-id");
  const index = await getLocalRecordingIndex();
  if (!index[recordingId]) return null;
  index[recordingId] = normalizeLocalRecordingEntry({
    ...index[recordingId],
    project: null,
    updatedAt: now(),
  });
  await storageSet({ [INDEX_KEY]: index });
  return index[recordingId];
};

export const listLocalRecordings = async ({
  sortBy = "newest",
}: { sortBy?: string } = {}) => {
  const index = await getLocalRecordingIndex();
  const entries = Object.values(index);
  const titleSort = (a: LocalRecordingEntry, b: LocalRecordingEntry) =>
    a.title.localeCompare(b.title);
  if (sortBy === "oldest") {
    entries.sort((a, b) => a.createdAt - b.createdAt);
  } else if (sortBy === "alphabetical") {
    entries.sort(titleSort);
  } else if (sortBy === "reverse-alphabetical") {
    entries.sort((a, b) => titleSort(b, a));
  } else {
    entries.sort((a, b) => b.createdAt - a.createdAt);
  }
  return entries;
};

export const classifyLocalRecordingStoragePressure = ({
  usage = null,
  quota = null,
}: { usage?: number | null; quota?: number | null } = {}) => {
  const numericUsage = Number(usage);
  const numericQuota = Number(quota);
  if (
    !Number.isFinite(numericUsage) ||
    !Number.isFinite(numericQuota) ||
    numericQuota <= 0
  ) {
    return { level: "unknown", ratio: null };
  }
  const ratio = Math.max(0, Math.min(1, numericUsage / numericQuota));
  if (ratio >= 0.95) return { level: "critical", ratio };
  if (ratio >= 0.8) return { level: "near-limit", ratio };
  return { level: "normal", ratio };
};

export const estimateLocalRecordingStorage = async () => {
  const index = await getLocalRecordingIndex();
  const indexedBytes = Object.values(index).reduce(
    (total, entry) => total + (Number(entry.byteSize) || 0),
    0
  );
  const estimate =
    navigator.storage && typeof navigator.storage.estimate === "function"
      ? await navigator.storage.estimate().catch(() => null)
      : null;
  const pressure = classifyLocalRecordingStoragePressure({
    usage: estimate?.usage,
    quota: estimate?.quota,
  });
  return {
    count: Object.keys(index).length,
    indexedBytes,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
    pressure,
  };
};

export const inspectLocalRecordingStorage = async () => {
  const index = await getLocalRecordingIndex();
  const [summary, blobKeys, opfsFileNames] = await Promise.all([
    estimateLocalRecordingStorage(),
    listBlobStoreKeys(),
    listOpfsRecordingFiles(),
  ]);
  const blobRefs = referencedBlobKeys(index);
  const opfsRefs = referencedOpfsFileNames(index);
  const orphanBlobKeys = blobKeys.filter((key) => !blobRefs.has(key));
  const orphanOpfsFileNames = opfsFileNames.filter(
    (name) => !opfsRefs.has(name)
  );
  return {
    ...summary,
    blobKeys,
    opfsFileNames,
    orphanBlobKeys,
    orphanOpfsFileNames,
    orphanCount: orphanBlobKeys.length + orphanOpfsFileNames.length,
  };
};

export const cleanupLocalRecordingStorage = async ({
  removeOrphanBlobs = true,
  removeOrphanOpfsFiles = true,
}: {
  removeOrphanBlobs?: boolean;
  removeOrphanOpfsFiles?: boolean;
} = {}) => {
  const inspection = await inspectLocalRecordingStorage();
  const removedBlobKeys: string[] = [];
  const removedOpfsFileNames: string[] = [];

  if (removeOrphanBlobs) {
    await Promise.all(
      inspection.orphanBlobKeys.map(async (key) => {
        await BLOB_STORE.removeItem(key);
        removedBlobKeys.push(key);
      })
    );
  }

  if (
    removeOrphanOpfsFiles &&
    inspection.orphanOpfsFileNames.length &&
    navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  ) {
    const dir = await navigator.storage.getDirectory();
    await Promise.all(
      inspection.orphanOpfsFileNames.map(async (name) => {
        await dir.removeEntry(name).catch(() => {});
        removedOpfsFileNames.push(name);
      })
    );
  }

  return {
    inspection,
    removedBlobKeys,
    removedOpfsFileNames,
    removedCount: removedBlobKeys.length + removedOpfsFileNames.length,
  };
};

export const inspectLocalRecording = async (recordingId: string) => {
  if (!recordingId) throw new Error("local-recording-inspect-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) {
    return { ok: false, status: "missing-entry", entry: null };
  }
  try {
    const blob = await readLocalRecordingBlob(entry);
    return {
      ok: true,
      status: "ok",
      entry,
      byteSize: blob.size || 0,
      mimeType: blob.type || entry.mimeType,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      status: String(err instanceof Error ? err.message : err),
      entry,
    };
  }
};

export const repairLocalRecording = async (
  recordingId: string,
  { action = "remove-stale-entry" }: { action?: string } = {}
) => {
  if (!recordingId) throw new Error("local-recording-repair-missing-id");
  if (action !== "remove-stale-entry") {
    throw new Error(`local-recording-repair-unsupported:${action}`);
  }
  const inspection = await inspectLocalRecording(recordingId);
  if (inspection.ok) {
    return { repaired: false, reason: "recording-ok", inspection };
  }
  await deleteLocalRecording(recordingId);
  return { repaired: true, action, inspection };
};

export const saveLocalRecordingThumbnail = async (
  recordingId: string,
  thumbnailDataUrl: string
) => {
  if (!recordingId) throw new Error("local-recording-thumbnail-missing-id");
  if (
    typeof thumbnailDataUrl !== "string" ||
    !thumbnailDataUrl.startsWith("data:image/")
  ) {
    throw new Error("local-recording-thumbnail-invalid");
  }
  return saveLocalRecordingEntry({
    id: recordingId,
    thumbnailDataUrl,
    thumbnailUpdatedAt: now(),
    updatedAt: now(),
  });
};

export const generateLocalRecordingThumbnail = async (
  recordingId: string,
  options: ThumbnailOptions = {}
) => {
  if (!recordingId) throw new Error("local-recording-thumbnail-missing-id");
  const index = await getLocalRecordingIndex();
  const entry = index[recordingId];
  if (!entry) throw new Error("local-recording-not-found");
  const blob = await readLocalRecordingBlob(entry);
  const thumbnailDataUrl = await makeThumbnailFromBlob(blob, options);
  if (!thumbnailDataUrl) return null;
  return saveLocalRecordingThumbnail(recordingId, thumbnailDataUrl);
};

export const registerLocalRecording = async ({
  id,
  title,
  blob = null,
  backendRef = null,
  durationMs = 0,
  mimeType = null,
  recordingMeta = null,
  createdAt = null,
}: RegisterLocalRecordingOptions = {}) => {
  const recordingId = id || localRecordingIdFromBackendRef(backendRef);
  const isOpfs = backendRef?.backend === "opfs" && backendRef.fileName;
  const blobKey = isOpfs ? null : `original:${recordingId}`;
  if (blob && blobKey) {
    await BLOB_STORE.setItem(blobKey, blob);
  }
  const entry: LocalRecordingEntryInput = {
    id: recordingId,
    title,
    durationMs,
    byteSize: blob?.size || 0,
    mimeType: mimeType || blob?.type || inferMimeFromName(backendRef?.fileName),
    backendRef,
    blobKey,
    recordingMeta,
  };
  if (createdAt) entry.createdAt = createdAt;
  return saveLocalRecordingEntry(entry);
};

export const importLocalRecordingFile = async (
  file: File,
  options: {
    title?: string;
    durationMs?: number;
    recordingMeta?: UnknownRecord;
    createdAt?: number;
  } = {}
) => {
  if (!file) throw new Error("local-recording-import-missing-file");
  const hasSupportedType =
    /^video\//i.test(file.type || "") || /\.(mp4|webm)$/i.test(file.name || "");
  if (!hasSupportedType) {
    throw new Error("local-recording-import-unsupported-type");
  }
  const entry = await registerLocalRecording({
    title: options.title || titleFromFileName(file.name),
    blob: file,
    durationMs: options.durationMs || 0,
    mimeType: file.type || inferMimeFromName(file.name),
    recordingMeta: {
      source: "import",
      fileName: file.name || null,
      importedAt: now(),
      ...(options.recordingMeta || {}),
    },
    createdAt: options.createdAt || now(),
  });
  await generateLocalRecordingThumbnail(entry.id).catch(() => null);
  return getLocalRecordingIndex().then((index) => index[entry.id] || entry);
};

export const importLocalRecordingProjectSidecar = async (
  file: File,
  options: { recordingId?: string } = {}
) => {
  if (!file) throw new Error("local-recording-project-import-missing-file");
  const raw = await file.text();
  let sidecar: unknown = null;
  try {
    sidecar = JSON.parse(raw);
  } catch {
    throw new Error("local-recording-project-import-invalid-json");
  }
  if (
    !isPlainObject(sidecar) ||
    sidecar.kind !== PROJECT_SIDECAR_KIND ||
    Number(sidecar.schemaVersion) !== PROJECT_SIDECAR_SCHEMA_VERSION ||
    !isPlainObject(sidecar.project)
  ) {
    throw new Error("local-recording-project-import-invalid-sidecar");
  }
  const sidecarRecording = isPlainObject(sidecar.recording)
    ? sidecar.recording
    : {};
  const targetId =
    options.recordingId ||
    (typeof sidecarRecording.id === "string" ? sidecarRecording.id : null) ||
    (typeof sidecar.project.recordingId === "string"
      ? sidecar.project.recordingId
      : null) ||
    null;
  if (!targetId) throw new Error("local-recording-project-import-missing-id");
  const index = await getLocalRecordingIndex();
  if (!index[targetId]) {
    throw new Error("local-recording-project-import-recording-missing");
  }
  const project = sanitizeProject({
    ...sidecar.project,
    recordingId: targetId,
    updatedAt: now(),
  });
  const thumbnailDataUrl =
    typeof sidecarRecording.thumbnailDataUrl === "string" &&
    sidecarRecording.thumbnailDataUrl.startsWith("data:image/")
      ? sidecarRecording.thumbnailDataUrl
      : null;
  return saveLocalRecordingEntry({
    id: targetId,
    project,
    ...(thumbnailDataUrl
      ? {
          thumbnailDataUrl,
          thumbnailUpdatedAt:
            Number(sidecarRecording.thumbnailUpdatedAt) || now(),
        }
      : {}),
    updatedAt: now(),
  });
};

export const checkpointEditedLocalRecording = async (
  recordingId: string,
  blob: Blob
) => {
  if (!recordingId || !blob) return null;
  const editedBlobKey = `edited:${recordingId}`;
  await BLOB_STORE.setItem(editedBlobKey, blob);
  const entry = await saveLocalRecordingEntry({
    id: recordingId,
    editedBlobKey,
    editedAt: now(),
    byteSize: blob.size || 0,
    mimeType: blob.type || "video/mp4",
  });
  await generateLocalRecordingThumbnail(recordingId).catch(() => null);
  const index = await getLocalRecordingIndex();
  return index[recordingId] || entry;
};

export const readOpfsRecordingBlob = async (
  fileName: string
): Promise<Blob> => {
  if (!fileName) throw new Error("local-recording-opfs-missing-filename");
  if (
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    throw new Error("local-recording-opfs-unavailable");
  }
  const dir = await navigator.storage.getDirectory();
  const handle = await dir.getFileHandle(fileName);
  const file = await handle.getFile();
  if (file.size < MIN_VALID_RECORDING_BYTES) {
    throw new Error(`local-recording-opfs-too-small:${file.size}`);
  }
  return new Blob([file], { type: inferMimeFromName(fileName) });
};

export const readLocalRecordingBlob = async (
  entry: LocalRecordingEntry | null
): Promise<Blob> => {
  if (!entry) throw new Error("local-recording-not-found");
  if (entry.editedBlobKey) {
    const edited = await BLOB_STORE.getItem<Blob>(entry.editedBlobKey);
    if (edited) return edited;
  }
  if (entry.blobKey) {
    const blob = await BLOB_STORE.getItem<Blob>(entry.blobKey);
    if (blob) return blob;
  }
  if (entry.backendRef?.backend === "opfs") {
    return readOpfsRecordingBlob(entry.backendRef.fileName);
  }
  throw new Error("local-recording-blob-missing");
};

export const findMostRecentOpfsRecording = async () => {
  if (
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    return null;
  }
  const dir = await navigator.storage.getDirectory();
  const files = [];
  for await (const [name, handle] of dir.entries()) {
    if (!name.startsWith(OPFS_RECORDING_PREFIX)) continue;
    if (!/\.(mp4|webm)$/i.test(name)) continue;
    try {
      if (handle.kind !== "file") continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      if (file.size >= MIN_VALID_RECORDING_BYTES) {
        files.push({ name, size: file.size, lastModified: file.lastModified });
      }
    } catch {}
  }
  files.sort((a, b) => b.lastModified - a.lastModified);
  return files[0] || null;
};
