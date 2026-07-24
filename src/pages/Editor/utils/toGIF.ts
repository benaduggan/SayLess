import GIF from "gif.js";

export interface GifExportOptions {
  fps?: number;
  startSeconds?: number;
  durationSeconds?: number;
  width?: number;
}

type CancellableGif = GIF & {
  running?: boolean;
  abort?: () => void;
  freeWorkers?: Array<{ terminate: () => void }>;
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

async function toGIF(
  _ffmpeg: unknown,
  videoBlob: Blob,
  onProgress: (progress: number) => void = () => {},
  options: GifExportOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let gif: CancellableGif | null = null;
    let objectUrl = "";
    let settled = false;

    const disposeGif = (abort: boolean) => {
      if (!gif) return;
      if (abort && gif.running) gif.abort?.();
      for (const worker of gif.freeWorkers || []) worker.terminate();
      if (gif.freeWorkers) gif.freeWorkers = [];
    };
    const cleanup = (abortGif = false) => {
      signal?.removeEventListener("abort", handleAbort);
      disposeGif(abortGif);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }
      video.remove();
    };
    const rejectOnce = (error: unknown, abortGif = false) => {
      if (settled) return;
      settled = true;
      cleanup(abortGif);
      reject(error);
    };
    const handleAbort = () => rejectOnce(abortReason(signal), true);
    const resolveOnce = (blob: Blob) => {
      if (settled) return;
      settled = true;
      cleanup();
      onProgress(1);
      resolve(blob);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    video.addEventListener("loadedmetadata", async () => {
      try {
        throwIfAborted(signal);
        const duration = video.duration;
        const fps = Math.round(clampNumber(options.fps, 12, 4, 30));
        const startSeconds = clampNumber(options.startSeconds, 0, 0, duration);
        const clipDuration = clampNumber(
          options.durationSeconds,
          duration - startSeconds,
          0.1,
          Math.max(0.1, duration - startSeconds),
        );
        const width = Math.round(clampNumber(options.width, 540, 320, 1920));
        const height = Math.round((video.videoHeight / video.videoWidth) * width);
        const quality = 5;

        canvas.width = width;
        canvas.height = height;

        gif = new GIF({
          workers: Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2)),
          quality,
          width,
          height,
          workerScript: chrome.runtime.getURL("assets/vendor/gif.js/gif.worker.js"),
        });

        const frameInterval = 1 / fps;
        const totalFrames = Math.max(1, Math.floor(clipDuration * fps));
        let frameCount = 0;

        if (!ctx) throw new Error("Canvas 2D context unavailable");

        const captureFrame = (time: number): Promise<void> =>
          new Promise<void>((resolveFrame, rejectFrame) => {
            let frameSettled = false;
            const finishFrame = (error?: unknown) => {
              if (frameSettled) return;
              frameSettled = true;
              signal?.removeEventListener("abort", abortFrame);
              video.removeEventListener("seeked", seekHandler);
              if (error) rejectFrame(error);
              else resolveFrame();
            };
            const abortFrame = () => finishFrame(abortReason(signal));
            const seekHandler = () => {
              if (signal?.aborted) {
                finishFrame(abortReason(signal));
                return;
              }
              ctx.drawImage(video, 0, 0, width, height);
              gif!.addFrame(canvas, {
                copy: true,
                delay: Math.round(1000 / fps),
              });
              frameCount++;
              onProgress((frameCount / totalFrames) * 0.5);
              finishFrame();
            };
            video.addEventListener("seeked", seekHandler);
            signal?.addEventListener("abort", abortFrame, { once: true });
            if (signal?.aborted) {
              abortFrame();
              return;
            }
            video.currentTime = time;
          });

        for (let i = 0; i < totalFrames; i++) {
          throwIfAborted(signal);
          const time = Math.min(startSeconds + i * frameInterval, duration - 0.001);
          await captureFrame(time);
        }
        throwIfAborted(signal);

        gif.on("finished", resolveOnce);

        gif.on("progress", (progress: number) => onProgress(0.5 + progress * 0.5));

        gif.render();
      } catch (error) {
        rejectOnce(error, signal?.aborted === true);
      }
    });

    video.addEventListener("error", () => {
      rejectOnce(new Error(`Video error: ${video.error?.message || "Unknown error"}`), true);
    });

    objectUrl = URL.createObjectURL(videoBlob);
    video.src = objectUrl;
    video.load();
  });
}

function abortReason(signal?: AbortSignal): unknown {
  if (signal?.reason instanceof Error) return signal.reason;
  try {
    return new DOMException("Export cancelled.", "AbortError");
  } catch {
    const error = new Error("Export cancelled.");
    error.name = "AbortError";
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

export default toGIF;
