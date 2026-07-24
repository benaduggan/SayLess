export interface NormalizedLocalRecordingBackendRef {
  backend: "opfs";
  fileName: string;
}

export interface NormalizedLocalRecordingStorageFields {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  byteSize: number;
  mimeType: string;
  backendRef: NormalizedLocalRecordingBackendRef | null;
  blobKey: string | null;
  editedBlobKey: string | null;
  editedAt: number | null;
  thumbnailDataUrl: string | null;
  thumbnailUpdatedAt: number | null;
  recordingMeta: Record<string, unknown> | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeBackendRef = (value: unknown): NormalizedLocalRecordingBackendRef | null => {
  if (
    !isRecord(value) ||
    value.backend !== "opfs" ||
    typeof value.fileName !== "string" ||
    !value.fileName.trim()
  ) {
    return null;
  }
  return { backend: "opfs", fileName: value.fileName };
};

export const normalizeLocalRecordingStorageFields = (
  entry: unknown,
  fallbackId?: string,
  now = Date.now(),
): NormalizedLocalRecordingStorageFields => {
  const value = isRecord(entry) ? entry : {};
  const id =
    typeof fallbackId === "string" && fallbackId
      ? fallbackId
      : typeof value.id === "string"
        ? value.id
        : "";
  if (!id) throw new Error("local-recording-entry-missing-id");

  const createdAt = Number(value.createdAt) || now;
  return {
    id,
    title:
      typeof value.title === "string" && value.title.trim() ? value.title : "Untitled recording",
    createdAt,
    updatedAt: Number(value.updatedAt) || createdAt,
    durationMs: Math.max(0, Number(value.durationMs) || 0),
    byteSize: Math.max(0, Number(value.byteSize) || 0),
    mimeType: typeof value.mimeType === "string" && value.mimeType ? value.mimeType : "video/mp4",
    backendRef: normalizeBackendRef(value.backendRef),
    blobKey: typeof value.blobKey === "string" ? value.blobKey : null,
    editedBlobKey: typeof value.editedBlobKey === "string" ? value.editedBlobKey : null,
    editedAt: Number(value.editedAt) || null,
    thumbnailDataUrl:
      typeof value.thumbnailDataUrl === "string" && value.thumbnailDataUrl.startsWith("data:image/")
        ? value.thumbnailDataUrl
        : null,
    thumbnailUpdatedAt: Number(value.thumbnailUpdatedAt) || null,
    recordingMeta: isRecord(value.recordingMeta) ? value.recordingMeta : null,
  };
};
