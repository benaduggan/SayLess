// wraps a FileSystemSyncAccessHandle as a WritableStream so mediabunny's
// StreamTarget writes to OPFS directly with zero buffered bytes. supports
// positioned writes (fastStart:false patches the mdat size header after
// samples). worker-only since createSyncAccessHandle isn't on the main thread.
export interface OpfsSyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
}

type OpfsChunkData = Uint8Array | ArrayBuffer | ArrayLike<number>;
type OpfsWritableChunk =
  | OpfsChunkData
  | { data: OpfsChunkData; position?: number };

const hasChunkData = (
  chunk: OpfsWritableChunk,
): chunk is { data: OpfsChunkData; position?: number } =>
  typeof chunk === "object" &&
  chunk !== null &&
  "data" in chunk;

export function createOpfsWritable(
  syncHandle: OpfsSyncAccessHandle,
): WritableStream<OpfsWritableChunk> {
  let writtenBytes = 0;
  return new WritableStream({
    write(chunk: OpfsWritableChunk): void {
      // Mediabunny StreamTarget emits { data, position, type }; fall back
      // to append-mode for plain bytes so the writable works elsewhere.
      const data = hasChunkData(chunk) ? chunk.data : chunk;
      const position = hasChunkData(chunk)
        ? (chunk.position ?? writtenBytes)
        : writtenBytes;
      const buf =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
      const bytesWritten = syncHandle.write(buf, { at: position });
      // Short write = OPFS quota hit mid-buffer. Hard error so the caller
      // falls back to the in-sandbox tier instead of silently truncating.
      if (
        typeof bytesWritten === "number" &&
        bytesWritten < buf.byteLength
      ) {
        throw new Error(
          `opfs-write-short:${bytesWritten}/${buf.byteLength}`,
        );
      }
      const end = position + (bytesWritten ?? buf.byteLength);
      if (end > writtenBytes) writtenBytes = end;
    },
    close(): void {
      syncHandle.flush();
    },
    abort(): void {
      syncHandle.flush();
    },
  });
}
