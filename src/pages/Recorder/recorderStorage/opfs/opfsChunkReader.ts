/*
 * Caller MUST close the writer's sync handle before reading: getFile()
 * returns stale/empty while the sync handle is held.
 */
const MIN_VALID_RECORDING_BYTES = 4096;

import type { ChunkReader, ChunkReadResult, RecordingBackendRef } from "../chunkWriterInterface.ts";

export class OpfsChunkReader implements ChunkReader {
  private _fileName: string | null;

  constructor() {
    this._fileName = null;
  }

  async open(backendRef: RecordingBackendRef): Promise<void> {
    const name = backendRef?.fileName;
    if (!name) throw new Error("opfs-chunk-reader-no-filename");
    this._fileName = name;
  }

  async readBlob(): Promise<ChunkReadResult> {
    if (!this._fileName) throw new Error("opfs-chunk-reader-not-opened");
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(this._fileName);
    const file = await handle.getFile();
    if (file.size < MIN_VALID_RECORDING_BYTES) {
      const err = Object.assign(
        new Error(`opfs-file-too-small: ${file.size} bytes < ${MIN_VALID_RECORDING_BYTES}`),
        { code: "opfs-file-too-small" },
      );
      throw err;
    }
    const blob = new Blob([file], { type: "video/mp4" });
    return { blob, byteSize: blob.size, chunkCount: 1 };
  }

  async close(): Promise<void> {}
}
