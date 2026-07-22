// ChunkReader interface. IdbChunkReader iterates chunksStore, OpfsChunkReader
// returns the OPFS file as a Blob; chooseReader picks via backendRef.
export type {
  ChunkReader,
  ChunkReadResult,
  RecordingBackendRef,
} from "../../Recorder/recorderStorage/chunkWriterInterface.ts";
