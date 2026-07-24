// owns an OPFS file via FileSystemSyncAccessHandle. near-zero RAM, no
// IDB overhead per write. writes serial; main awaits each 'written'
// for backpressure. file persists across restarts, cleaned up by
// abort() or post-read delete in the sandbox.
// protocol: main {type, requestId, ...} -> worker {type, requestId, ok, ...}

export {};

const FILE_PREFIX = "recording-";

interface SyncAccessHandle {
  truncate(size: number): void;
  write(data: ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  getSize(): number;
  close(): void;
}

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

type WorkerRequest =
  | { type: "open"; requestId: number; recordingId: string; extension?: string }
  | { type: "write"; requestId: number; chunk: Blob }
  | { type: "close"; requestId: number }
  | { type: "abort"; requestId: number };

type WorkerResponse = Record<string, unknown> & {
  type: "ready" | "written" | "closed" | "aborted";
  requestId: number;
  ok: boolean;
};

const workerScope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

const errorName = (error: unknown): string =>
  error instanceof DOMException || error instanceof Error ? error.name : "Error";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const devLog =
  process.env.SAYLESS_DEV_MODE === "true"
    ? (label: string, data?: unknown): void =>
        console.log("[recorder-opfs][worker]", label, data || "")
    : (_label: string, _data?: unknown): void => {};

let fileName: string | null = null;
let syncHandle: SyncAccessHandle | null = null;
let offset = 0;
let chunkCount = 0;
let closed = false;

// Keep completed recordings. The local recording library indexes these files,
// so deleting older OPFS files on every new recording breaks "all videos" and
// tab-close recovery for previous edits.
const clearPreviousRecordings = async (): Promise<void> => {
  return;
};

const post = (payload: WorkerResponse): void => {
  workerScope.postMessage(payload);
};

// crbug/453704691: createSyncAccessHandle can throw NoModificationAllowedError
// briefly while GC reclaims a prior handle. Retry with backoff before failing.
const openSyncAccessHandleWithRetry = async (handle: SyncFileHandle): Promise<SyncAccessHandle> => {
  const delaysMs = [0, 200, 400, 600, 800];
  let lastErr: unknown = new Error("opfs-sync-handle-open-failed");
  for (let i = 0; i < delaysMs.length; i += 1) {
    if (delaysMs[i] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
    try {
      return await handle.createSyncAccessHandle();
    } catch (err) {
      lastErr = err;
      if (errorName(err) !== "NoModificationAllowedError") break;
    }
  }
  throw lastErr;
};

const openFile = async (recordingId: string, extension?: string): Promise<{ fileName: string }> => {
  // Create NEW before deleting old: if creation fails, the previous
  // recording remains intact for recovery, and a recovery editor
  // already loading the old file doesn't lose it mid-load.
  const dir = await navigator.storage.getDirectory();
  const ext = extension === "webm" ? "webm" : "mp4";
  const name = `${FILE_PREFIX}${recordingId}.${ext}`;
  const handle = await dir.getFileHandle(name, { create: true });
  const sync = await openSyncAccessHandleWithRetry(handle as SyncFileHandle);
  sync.truncate(0);
  fileName = name;
  syncHandle = sync;
  offset = 0;
  chunkCount = 0;
  closed = false;
  await clearPreviousRecordings();
  devLog("open", { fileName: name });
  return { fileName: name };
};

const writeChunk = async (blob: Blob): Promise<{ totalSize: number }> => {
  if (closed) throw new Error("opfs-writer-closed");
  if (!syncHandle) throw new Error("opfs-writer-not-open");
  // arrayBuffer() is async; sync handle write is synchronous once bytes are in hand.
  const buf = await blob.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const written = syncHandle.write(u8, { at: offset });
  offset += typeof written === "number" ? written : u8.byteLength;
  chunkCount += 1;
  return { totalSize: offset };
};

const closeFile = (): {
  byteSize: number;
  chunkCount: number;
  fileName: string | null;
  timings?: { flushMs: number; getSizeMs: number; closeHandleMs: number };
} => {
  if (!syncHandle) {
    return { byteSize: offset, chunkCount, fileName };
  }
  // Granular timing; diag showed close taking ~10s on one user's
  // macOS recording. Without splitting flush vs close we can't tell
  // whether the cost is fsync or the handle release itself.
  const tFlushStart = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    syncHandle.flush();
  } catch {}
  const tFlushEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
  const byteSize = typeof syncHandle.getSize === "function" ? syncHandle.getSize() : offset;
  const tGetSizeEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
  syncHandle.close();
  const tCloseEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
  syncHandle = null;
  closed = true;
  devLog("close", { byteSize, chunkCount, fileName });
  return {
    byteSize,
    chunkCount,
    fileName,
    timings: {
      flushMs: Math.round(tFlushEnd - tFlushStart),
      getSizeMs: Math.round(tGetSizeEnd - tFlushEnd),
      closeHandleMs: Math.round(tCloseEnd - tGetSizeEnd),
    },
  };
};

const abortFile = async (): Promise<void> => {
  if (syncHandle) {
    try {
      syncHandle.close();
    } catch {}
    syncHandle = null;
  }
  if (fileName) {
    try {
      const dir = await navigator.storage.getDirectory();
      await dir.removeEntry(fileName).catch(() => {});
    } catch {}
  }
  fileName = null;
  offset = 0;
  chunkCount = 0;
  closed = true;
};

// Single promise chain: writes apply in post order, open/close/abort
// can't interleave with in-flight writes.
let queue: Promise<void> = Promise.resolve();

const enqueue = (fn: () => Promise<void>): void => {
  const next = queue.then(fn).catch((_err: unknown) => {
    // Error already surfaces via post(); keep chain alive for next msg.
  });
  queue = next;
};

const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; requestId?: unknown };
  return (
    typeof candidate.requestId === "number" &&
    ["open", "write", "close", "abort"].includes(String(candidate.type))
  );
};

workerScope.onmessage = (e: MessageEvent<unknown>): void => {
  const msg = e.data;
  if (!isWorkerRequest(msg)) return;

  // Preserve DOMException name (e.g. "QuotaExceededError") across the
  // structured-clone boundary so main can branch without substring matching.
  const errorPayload = (err: unknown) => ({
    error: errorMessage(err),
    errorName: errorName(err),
  });

  if (msg.type === "open") {
    enqueue(async () => {
      try {
        const { fileName: fn } = await openFile(msg.recordingId, msg.extension);
        post({ type: "ready", requestId: msg.requestId, ok: true, fileName: fn });
      } catch (err) {
        post({
          type: "ready",
          requestId: msg.requestId,
          ok: false,
          ...errorPayload(err),
        });
      }
    });
    return;
  }

  if (msg.type === "write") {
    enqueue(async () => {
      try {
        const { totalSize } = await writeChunk(msg.chunk);
        post({
          type: "written",
          requestId: msg.requestId,
          ok: true,
          totalSize,
        });
      } catch (err) {
        post({
          type: "written",
          requestId: msg.requestId,
          ok: false,
          ...errorPayload(err),
        });
      }
    });
    return;
  }

  if (msg.type === "close") {
    enqueue(async () => {
      try {
        const result = closeFile();
        post({
          type: "closed",
          requestId: msg.requestId,
          ok: true,
          byteSize: result.byteSize,
          chunkCount: result.chunkCount,
          fileName: result.fileName,
          timings: result.timings,
        });
      } catch (err) {
        post({
          type: "closed",
          requestId: msg.requestId,
          ok: false,
          ...errorPayload(err),
        });
      }
    });
    return;
  }

  if (msg.type === "abort") {
    enqueue(async () => {
      try {
        await abortFile();
        post({ type: "aborted", requestId: msg.requestId, ok: true });
      } catch (err) {
        post({
          type: "aborted",
          requestId: msg.requestId,
          ok: false,
          ...errorPayload(err),
        });
      }
    });
    return;
  }
};
