// Mirrors Sandbox/recorderStorage/idbChunkReader, scoped to the recorder page.
import { idbChunksStore as chunksStore } from "./idbChunkWriter.ts";
import type {
  ChunkReader,
  ChunkReadResult,
  ChunkRecord,
  RecordingBackendRef,
} from "./chunkWriterInterface.ts";

export class IdbChunkReader implements ChunkReader {
  async open(_backendRef: RecordingBackendRef): Promise<void> {
    await chunksStore.ready();
  }

  async readBlob(): Promise<ChunkReadResult> {
    const items: ChunkRecord[] = [];
    await chunksStore.iterate((value) => {
      items.push(value as ChunkRecord);
      return undefined;
    });
    items.sort((a, b) => {
      const dt = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      if (dt !== 0) return dt;
      return (a.index ?? 0) - (b.index ?? 0);
    });
    const parts = items.map((c) =>
      c.chunk instanceof Blob ? c.chunk : new Blob([c.chunk]),
    );
    if (!parts.length) return { blob: null, byteSize: 0, chunkCount: 0 };
    const inferredType = parts[0]?.type || "video/mp4";
    const blob = new Blob(parts, { type: inferredType });
    return { blob, byteSize: blob.size, chunkCount: parts.length };
  }

  async close(): Promise<void> {}
}
