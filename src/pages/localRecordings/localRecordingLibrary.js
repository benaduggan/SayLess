import localforage from "localforage";

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "screenity",
  version: 1,
});

const INDEX_KEY = "localRecordingLibraryIndex";
const BLOB_STORE = localforage.createInstance({
  name: "local-recordings",
  storeName: "blobs",
});

const OPFS_RECORDING_PREFIX = "recording-";
const MIN_VALID_RECORDING_BYTES = 4096;

const storageGet = (keys) => chrome.storage.local.get(keys);
const storageSet = (value) => chrome.storage.local.set(value);

const now = () => Date.now();

export const localRecordingIdFromBackendRef = (backendRef, fallback = null) => {
  if (backendRef?.backend === "opfs" && backendRef.fileName) {
    return backendRef.fileName.replace(/\.(mp4|webm)$/i, "");
  }
  return fallback || `local-${now()}-${Math.random().toString(16).slice(2)}`;
};

const inferMimeFromName = (name) =>
  /\.webm$/i.test(name || "") ? "video/webm" : "video/mp4";

const sanitizeEntry = (entry) => ({
  id: entry.id,
  title: entry.title || "Untitled recording",
  createdAt: Number(entry.createdAt) || now(),
  updatedAt: Number(entry.updatedAt) || Number(entry.createdAt) || now(),
  durationMs: Number(entry.durationMs) || 0,
  byteSize: Number(entry.byteSize) || 0,
  mimeType: entry.mimeType || "video/mp4",
  backendRef: entry.backendRef || null,
  blobKey: entry.blobKey || null,
  editedBlobKey: entry.editedBlobKey || null,
  editedAt: entry.editedAt || null,
  recordingMeta: entry.recordingMeta || null,
});

export const getLocalRecordingIndex = async () => {
  const result = await storageGet([INDEX_KEY]);
  const raw = result?.[INDEX_KEY] || {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, entry]) => entry?.id)
      .map(([id, entry]) => [id, sanitizeEntry(entry)]),
  );
};

export const saveLocalRecordingEntry = async (entry) => {
  if (!entry?.id) throw new Error("local-recording-entry-missing-id");
  const index = await getLocalRecordingIndex();
  const existing = index[entry.id] || {};
  const next = sanitizeEntry({
    ...existing,
    ...entry,
    updatedAt: entry.updatedAt || now(),
  });
  index[next.id] = next;
  await storageSet({ [INDEX_KEY]: index });
  return next;
};

export const listLocalRecordings = async ({ sortBy = "newest" } = {}) => {
  const index = await getLocalRecordingIndex();
  const entries = Object.values(index);
  const titleSort = (a, b) => a.title.localeCompare(b.title);
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

export const registerLocalRecording = async ({
  id,
  title,
  blob = null,
  backendRef = null,
  durationMs = 0,
  recordingMeta = null,
  createdAt = null,
} = {}) => {
  const recordingId = id || localRecordingIdFromBackendRef(backendRef);
  const isOpfs = backendRef?.backend === "opfs" && backendRef.fileName;
  const blobKey = isOpfs ? null : `original:${recordingId}`;
  if (blob && !isOpfs) {
    await BLOB_STORE.setItem(blobKey, blob);
  }
  const entry = {
    id: recordingId,
    title,
    durationMs,
    byteSize: blob?.size || 0,
    mimeType: blob?.type || inferMimeFromName(backendRef?.fileName),
    backendRef,
    blobKey,
    recordingMeta,
  };
  if (createdAt) entry.createdAt = createdAt;
  return saveLocalRecordingEntry(entry);
};

export const checkpointEditedLocalRecording = async (recordingId, blob) => {
  if (!recordingId || !blob) return null;
  const editedBlobKey = `edited:${recordingId}`;
  await BLOB_STORE.setItem(editedBlobKey, blob);
  return saveLocalRecordingEntry({
    id: recordingId,
    editedBlobKey,
    editedAt: now(),
    byteSize: blob.size || 0,
    mimeType: blob.type || "video/mp4",
  });
};

export const readOpfsRecordingBlob = async (fileName) => {
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

export const readLocalRecordingBlob = async (entry) => {
  if (!entry) throw new Error("local-recording-not-found");
  if (entry.editedBlobKey) {
    const edited = await BLOB_STORE.getItem(entry.editedBlobKey);
    if (edited) return edited;
  }
  if (entry.blobKey) {
    const blob = await BLOB_STORE.getItem(entry.blobKey);
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
      const file = await handle.getFile();
      if (file.size >= MIN_VALID_RECORDING_BYTES) {
        files.push({ name, size: file.size, lastModified: file.lastModified });
      }
    } catch {}
  }
  files.sort((a, b) => b.lastModified - a.lastModified);
  return files[0] || null;
};
