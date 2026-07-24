// IDB-backed ChunkWriter. Fallback when OPFS unavailable.
import localforage from "localforage";
import type { ChunkRecord, ChunkWriter, ChunkWriterCloseResult } from "./chunkWriterInterface.ts";

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

const chunksStore = localforage.createInstance({
  name: "chunks",
});

export class IdbChunkWriter implements ChunkWriter {
  private _byteSize: number;
  private _chunkCount: number;
  private _closed: boolean;
  private _aborted: boolean;

  constructor() {
    this._byteSize = 0;
    this._chunkCount = 0;
    this._closed = false;
    this._aborted = false;
  }

  async open(_recordingId: string): Promise<{ backendRef: { backend: "idb" } }> {
    // Clearing handled at recorder level (chunksStore is shared); no-op
    // here so OpfsChunkWriter's file-creation semantics don't leak in.
    return { backendRef: { backend: "idb" } };
  }

  async write({ chunk, index, timestamp }: ChunkRecord): Promise<void> {
    if (this._closed || this._aborted) {
      throw new Error("idb-chunk-writer-closed");
    }
    await chunksStore.setItem(`chunk_${index}`, {
      index,
      chunk,
      timestamp,
    });
    this._byteSize += chunk?.size || 0;
    this._chunkCount += 1;
  }

  async close(): Promise<ChunkWriterCloseResult> {
    this._closed = true;
    return {
      byteSize: this._byteSize,
      chunkCount: this._chunkCount,
      backendRef: { backend: "idb" },
    };
  }

  async abort(): Promise<void> {
    this._aborted = true;
    // Callers decide whether to chunksStore.clear(); aborting one writer
    // doesn't imply wiping all sessions.
  }
}

export { chunksStore as idbChunksStore };
