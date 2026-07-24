// ChunkWriter interface for WebCodecs/fMP4 recording.
// implementations: IdbChunkWriter (localforage/IDB fallback) and
// OpfsChunkWriter (worker with FileSystemSyncAccessHandle).
// single-use: one open() per recording, order kept by chunk.index.
export interface RecordingBackendRef {
  backend: "idb" | "opfs";
  fileName?: string | null;
  [key: string]: unknown;
}

export interface ChunkRecord {
  chunk: Blob;
  index: number;
  timestamp: number;
}

export interface ChunkWriterCloseResult {
  byteSize: number;
  chunkCount: number;
  backendRef: RecordingBackendRef;
}

export interface ChunkWriter {
  open: (
    recordingId: string,
    options?: { extension?: "mp4" | "webm" },
  ) => Promise<{ backendRef: RecordingBackendRef }>;
  write: (record: ChunkRecord) => Promise<void>;
  close: () => Promise<ChunkWriterCloseResult>;
  abort: () => Promise<void>;
}

export interface ChunkReadResult {
  blob: Blob | null;
  byteSize: number;
  chunkCount: number;
}

export interface ChunkReader {
  open: (backendRef: RecordingBackendRef) => Promise<void>;
  readBlob: (options?: { onSlowFinalize?: () => void }) => Promise<ChunkReadResult>;
  close: () => Promise<void>;
}
