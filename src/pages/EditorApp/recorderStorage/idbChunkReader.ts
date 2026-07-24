// IDB ChunkReader. Iterates chunksStore, sorts by (timestamp, index).
import localforage from "localforage";
import type { ChunkReader, ChunkReadResult, RecordingBackendRef } from "./chunkReaderInterface.ts";

interface StoredChunk {
  timestamp?: number;
  index?: number;
  chunk: Blob | BlobPart;
}

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

const chunksStore = localforage.createInstance({
  name: "chunks",
});

export class IdbChunkReader implements ChunkReader {
  private _opened: boolean;

  constructor() {
    this._opened = false;
  }

  async open(_backendRef: RecordingBackendRef): Promise<void> {
    await chunksStore.ready();
    this._opened = true;
  }

  async readBlob(): Promise<ChunkReadResult> {
    if (!this._opened) {
      throw new Error("idb-chunk-reader-not-opened");
    }
    const items: StoredChunk[] = [];
    await chunksStore.iterate((value) => {
      items.push(value as StoredChunk);
      return undefined;
    });
    // Tiebreak by index: WebCodecs-path chunks share timestamp; index
    // is the real byte order.
    items.sort((a, b) => {
      const dt = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      if (dt !== 0) return dt;
      return (a.index ?? 0) - (b.index ?? 0);
    });
    const parts = items.map((c) => (c.chunk instanceof Blob ? c.chunk : new Blob([c.chunk])));
    const byteSize = parts.reduce((s, p) => s + (p?.size || 0), 0);
    const inferredType = parts[0]?.type || "video/mp4";
    const blob = parts.length
      ? new Blob(parts, { type: inferredType })
      : new Blob([], { type: inferredType });
    return { blob, byteSize, chunkCount: parts.length };
  }

  async close(): Promise<void> {
    this._opened = false;
  }
}

export { chunksStore as idbChunksStore };
