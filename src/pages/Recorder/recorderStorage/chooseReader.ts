import { IdbChunkReader } from "./idbChunkReader.ts";
import { OpfsChunkReader } from "./opfs/opfsChunkReader.ts";
import type {
  ChunkReader,
  RecordingBackendRef,
} from "./chunkWriterInterface.ts";

export const chooseReader = (
  backendRef: RecordingBackendRef | null,
): ChunkReader => {
  const backend = backendRef?.backend || "idb";
  switch (backend) {
    case "opfs":
      return new OpfsChunkReader();
    case "idb":
    default:
      return new IdbChunkReader();
  }
};
