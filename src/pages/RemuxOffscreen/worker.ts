// re-muxes fMP4 from OPFS to a standard MP4 in OPFS. near-zero RAM.
// in/out are passed as OPFS filenames (strings) since sendMessage
// across the SW drops Blob identity ("blob must be a Blob"). OPFS is
// shared with the sandbox (same chrome-extension origin).
// output lingers after success so the sandbox can stream to
// chrome.downloads without a delete-race. next run's sweep removes it.
import {
  Input,
  Output,
  BlobSource,
  StreamTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
} from "mediabunny";
import { createOpfsWritable } from "./opfsTarget";
import { videoConverter } from "../Editor/mediabunny/lib/videoConverter";

interface RemuxRequest {
  type: "remux" | "webm";
  requestId: string;
  inputFileName: string;
  outputFileName: string;
}

interface RemuxSyncAccessHandle {
  truncate(size: number): void;
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  getSize(): number;
  close(): void;
}

interface RemuxFileHandle {
  kind: "file";
  getFile(): Promise<File>;
  createSyncAccessHandle(): Promise<RemuxSyncAccessHandle>;
}

interface RemuxDirectoryHandle {
  entries(): AsyncIterableIterator<
    [string, RemuxFileHandle | FileSystemDirectoryHandle]
  >;
  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<RemuxFileHandle>;
  removeEntry(name: string): Promise<void>;
}

const workerScope = self as unknown as {
  postMessage(message: Record<string, unknown>): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "Error";

const getOpfsDirectory = async (): Promise<RemuxDirectoryHandle> =>
  (await navigator.storage.getDirectory()) as unknown as RemuxDirectoryHandle;

const TEMP_FILE_PREFIX = "remux-";
const STALE_AGE_MS = 5 * 60 * 1000;

const devLog: (label: string, data?: unknown) => void =
  process.env.SAYLESS_DEV_MODE === "true"
    ? (label, data) => console.log("[remux][worker]", label, data || "")
    : () => {};

const postProgress = (requestId: string, progress: number): void => {
  workerScope.postMessage({ type: "progress", requestId, progress });
};

const postDone = (requestId: string, outputFileName: string): void => {
  workerScope.postMessage({ type: "done", requestId, outputFileName });
};

const postError = (requestId: string, error: unknown): void => {
  workerScope.postMessage({
    type: "error",
    requestId,
    error: errorMessage(error),
  });
};

// STALE_AGE_MS gives prior remuxes time to be downloaded by the sandbox.
const sweepOpfsStaleFiles = async (): Promise<void> => {
  try {
    const dir = await getOpfsDirectory();
    const now = Date.now();
    for await (const [name, handle] of dir.entries()) {
      if (!name.startsWith(TEMP_FILE_PREFIX)) continue;
      if (handle.kind !== "file") continue;
      try {
        const file = await handle.getFile();
        if (now - file.lastModified > STALE_AGE_MS) {
          await dir.removeEntry(name).catch(() => {});
        }
      } catch {}
    }
  } catch {}
};

const remuxToOpfs = async ({
  requestId,
  inputFileName,
  outputFileName,
}: RemuxRequest): Promise<void> => {
  const startedAt = Date.now();
  devLog("start", { requestId, inputFileName, outputFileName });
  await sweepOpfsStaleFiles();

  let dir: RemuxDirectoryHandle | null = null;
  let outputHandle: RemuxFileHandle | null = null;
  let syncHandle: RemuxSyncAccessHandle | null = null;
  let handleReleased = false;
  let lastProgressLogged = -1;

  try {
    dir = await getOpfsDirectory();

    // getFile() returns a disk-backed Blob; mediabunny streams reads
    // on demand without pulling all bytes into memory.
    const inputHandle = await dir.getFileHandle(inputFileName);
    const inputFile = await inputHandle.getFile();

    const createdOutputHandle = await dir.getFileHandle(outputFileName, {
      create: true,
    });
    outputHandle = createdOutputHandle;
    // crbug/453704691: brief NoModificationAllowedError after prior
    // handle GC. Retry with backoff before failing the remux.
    syncHandle = await (async () => {
      const delaysMs = [0, 200, 400, 600, 800];
      let lastErr: unknown = new Error("opfs-sync-handle-open-failed");
      for (let i = 0; i < delaysMs.length; i += 1) {
        if (delaysMs[i] > 0) {
          await new Promise((r) => setTimeout(r, delaysMs[i]));
        }
        try {
          return await createdOutputHandle.createSyncAccessHandle();
        } catch (err) {
          lastErr = err;
          if (errorName(err) !== "NoModificationAllowedError") break;
        }
      }
      throw lastErr;
    })();
    syncHandle.truncate(0);

    const writable = createOpfsWritable(syncHandle);

    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(inputFile),
    });

    // Pipe encoded packets through the muxer for bounded memory (~8 MiB
    // cache); the Conversion API buffers a full sample table upfront.
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input
      .getPrimaryAudioTrack()
      .catch(() => null);

    if (!videoTrack) {
      throw new Error("remux-no-video-track");
    }

    const videoCodec = videoTrack.codec;
    if (!videoCodec) throw new Error("remux-video-codec-unavailable");
    const videoDecoderConfig = await videoTrack.getDecoderConfig();
    const videoSource = new EncodedVideoPacketSource(videoCodec);

    let audioCodec = null;
    let audioDecoderConfig = null;
    let audioSource = null;
    if (audioTrack) {
      try {
        audioCodec = audioTrack.codec;
        if (!audioCodec) throw new Error("remux-audio-codec-unavailable");
        audioDecoderConfig = await audioTrack.getDecoderConfig();
        audioSource = new EncodedAudioPacketSource(audioCodec);
      } catch (audioErr) {
        // Unreadable audio: proceed video-only.
        devLog("audio-skip", {
          reason: errorMessage(audioErr).slice(0, 120),
        });
        audioCodec = null;
        audioDecoderConfig = null;
        audioSource = null;
      }
    }

    const output = new Output({
      target: new StreamTarget(writable),
      format: new Mp4OutputFormat({ fastStart: false }),
    });
    output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);

    await output.start();

    // Not all formats expose every field.
    const durationOf = (value: unknown): number | undefined => {
      if (typeof value !== "object" || value === null) return undefined;
      const duration = (value as { duration?: unknown }).duration;
      return typeof duration === "number" ? duration : undefined;
    };
    const totalDuration = (() => {
      const candidates = [
        durationOf(videoTrack),
        durationOf(audioTrack),
        durationOf(input),
      ];
      for (const v of candidates) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      }
      return 0;
    })();

    const pipeVideo = async (): Promise<void> => {
      const sink = new EncodedPacketSink(videoTrack);
      let isFirst = true;
      for await (const packet of sink.packets()) {
        if (isFirst) {
          await videoSource.add(packet, {
            decoderConfig: videoDecoderConfig ?? undefined,
          });
          isFirst = false;
        } else {
          await videoSource.add(packet);
        }
        if (totalDuration > 0) {
          const pct = Math.min(1, packet.timestamp / totalDuration);
          postProgress(requestId, pct);
          const decile = Math.floor(pct * 10);
          if (decile !== lastProgressLogged) {
            lastProgressLogged = decile;
            devLog("progress", { pct: Math.round(pct * 100) });
          }
        }
      }
    };

    const pipeAudio = async (): Promise<void> => {
      if (!audioSource || !audioTrack) return;
      const sink = new EncodedPacketSink(audioTrack);
      let isFirst = true;
      for await (const packet of sink.packets()) {
        if (isFirst) {
          await audioSource.add(packet, {
            decoderConfig: audioDecoderConfig ?? undefined,
          });
          isFirst = false;
        } else {
          await audioSource.add(packet);
        }
      }
    };

    // allSettled so a transient audio decode failure doesn't kill video.
    const pipeResults = await Promise.allSettled([pipeVideo(), pipeAudio()]);
    const videoResult = pipeResults[0];
    if (videoResult.status === "rejected") {
      throw videoResult.reason;
    }
    if (pipeResults[1].status === "rejected") {
      devLog("audio-pipe-failed", {
        err: errorMessage(pipeResults[1].reason).slice(0, 200),
      });
    }

    await output.finalize();

    try {
      await writable.close();
    } catch {}
    syncHandle.flush();
    const finalSize = syncHandle.getSize();
    syncHandle.close();
    handleReleased = true;

    devLog("done", {
      durationMs: Date.now() - startedAt,
      outputBytes: finalSize,
    });
    postDone(requestId, outputFileName);
  } catch (err) {
    devLog("error", {
      err: errorMessage(err).slice(0, 200),
      durationMs: Date.now() - startedAt,
    });
    postError(requestId, err);
    if (syncHandle && !handleReleased) {
      try {
        syncHandle.close();
      } catch {}
    }
    if (dir && outputFileName) {
      try {
        await dir.removeEntry(outputFileName).catch(() => {});
      } catch {}
    }
  }
};

// Re-encodes an MP4 (H.264) to WebM (VP9) from OPFS to OPFS, streaming output
// so memory stays bounded on large files (the in-editor BufferTarget path OOMs
// past ~2 GB). Far slower than the remux (it fully decodes and re-encodes
// every frame), but it can't passthrough since WebM can't hold H.264.
const convertWebmToOpfs = async ({
  requestId,
  inputFileName,
  outputFileName,
}: RemuxRequest): Promise<void> => {
  const startedAt = Date.now();
  devLog("webm-start", { requestId, inputFileName, outputFileName });
  await sweepOpfsStaleFiles();

  let dir: RemuxDirectoryHandle | null = null;
  let outputHandle: RemuxFileHandle | null = null;
  let syncHandle: RemuxSyncAccessHandle | null = null;
  let handleReleased = false;

  try {
    dir = await getOpfsDirectory();
    const inputHandle = await dir.getFileHandle(inputFileName);
    const inputFile = await inputHandle.getFile();

    const createdOutputHandle = await dir.getFileHandle(outputFileName, {
      create: true,
    });
    outputHandle = createdOutputHandle;
    syncHandle = await (async () => {
      const delaysMs = [0, 200, 400, 600, 800];
      let lastErr: unknown = new Error("opfs-sync-handle-open-failed");
      for (let i = 0; i < delaysMs.length; i += 1) {
        if (delaysMs[i] > 0) {
          await new Promise((r) => setTimeout(r, delaysMs[i]));
        }
        try {
          return await createdOutputHandle.createSyncAccessHandle();
        } catch (err) {
          lastErr = err;
          if (errorName(err) !== "NoModificationAllowedError") break;
        }
      }
      throw lastErr;
    })();
    syncHandle.truncate(0);

    const writable = createOpfsWritable(syncHandle);

    await videoConverter.convertToWebM(inputFile, {
      target: new StreamTarget(writable),
      onProgress: (p) => postProgress(requestId, p),
    });

    try {
      await writable.close();
    } catch {}
    syncHandle.flush();
    const finalSize = syncHandle.getSize();
    syncHandle.close();
    handleReleased = true;

    devLog("webm-done", {
      durationMs: Date.now() - startedAt,
      outputBytes: finalSize,
    });
    postDone(requestId, outputFileName);
  } catch (err) {
    devLog("webm-error", {
      err: errorMessage(err).slice(0, 200),
      durationMs: Date.now() - startedAt,
    });
    postError(requestId, err);
    if (syncHandle && !handleReleased) {
      try {
        syncHandle.close();
      } catch {}
    }
    if (dir && outputFileName) {
      try {
        await dir.removeEntry(outputFileName).catch(() => {});
      } catch {}
    }
  }
};

workerScope.onmessage = (e: MessageEvent<unknown>) => {
  const msg = e.data as RemuxRequest | null;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "remux") remuxToOpfs(msg);
  else if (msg.type === "webm") convertWebmToOpfs(msg);
};
