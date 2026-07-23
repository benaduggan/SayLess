// In-process editor ops, replacing the old editor.html <-> sandbox.html
// postMessage protocol. `reply` re-emits the same result message shapes the host
// used to post, so ContentState's result handlers fire unchanged.
// Each video op is lazy-loaded to keep the ~630KB mediabunny chunk off mount.
import { fixWebmDurationOffThread } from "../Editor/utils/fixWebmDurationOffThread";
import type { GifExportOptions } from "../Editor/utils/toGIF";

export type Reply = (message: Record<string, unknown>) => void;
type OpId = string | number;
export type EditorOpMessage =
  | { type: "load-ffmpeg"; _opId?: OpId }
  | {
      type: "fix-webm-duration";
      blob: Blob;
      durationMs: number;
      id?: unknown;
      _opId?: OpId;
    }
  | { type: "base64-to-blob"; base64: string; topLevel?: boolean; _opId?: OpId }
  | { type: "get-frame"; blob: Blob; time: number; _opId?: OpId }
  | {
      type: "reencode-video";
      blob: Blob;
      duration: number;
      topLevel?: boolean;
      _opId?: OpId;
    }
  | { type: "to-gif"; blob: Blob; options?: GifExportOptions; _opId?: OpId }
  | { type: "to-webm"; blob: Blob; duration?: number; _opId?: OpId };

const lazyUtil =
  <Args extends unknown[], Result>(
    importFn: () => Promise<{
      default: (...args: Args) => Promise<Result>;
    }>
  ) =>
  (...args: Args): Promise<Result> =>
    importFn().then((m) => m.default(...args));
const convertWebmToMp4 = lazyUtil(
  () => import("../Editor/utils/convertWebmToMp4")
);
const reencodeVideo = lazyUtil(() => import("../Editor/utils/reencodeVideo"));
const toGIF = lazyUtil(() => import("../Editor/utils/toGIF"));
const getFrame = lazyUtil(() => import("../Editor/utils/getFrame"));
const convertMp4ToWebm = lazyUtil(
  () => import("../Editor/utils/convertMp4ToWebm")
);
const activeExportControllers = new Set<AbortController>();

const runCancellableExport = async <T>(
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  activeExportControllers.add(controller);
  try {
    return await run(controller.signal);
  } finally {
    activeExportControllers.delete(controller);
  }
};

export const cancelEditorExports = (): void => {
  for (const controller of activeExportControllers) controller.abort();
  activeExportControllers.clear();
};

const toBase64 = (blob: Blob, signal?: AbortSignal): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      try {
        reader.abort();
      } catch {}
      cleanup();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      cleanup();
      if (signal?.aborted) reject(createAbortError());
      else if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to encode blob as a data URL"));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error || new Error("Failed to encode blob as a data URL"));
    };
  });

// Viewer mode (editor.html?view=1): playback only, edit ops rejected. WebM
// duration fix still runs (metadata repair, not an edit) for seekability.
const VIEWER_REJECTED_OPS = new Set<EditorOpMessage["type"]>([
  "base64-to-blob",
  "reencode-video",
  "to-gif",
]);

const runViewerOp = async (
  message: EditorOpMessage,
  reply: Reply
): Promise<void> => {
  if (message.type === "load-ffmpeg") {
    reply({ type: "ffmpeg-load-error", fallback: true });
    return;
  }
  if (message.type === "fix-webm-duration") {
    try {
      const fixed = await fixWebmDurationOffThread(
        message.blob,
        message.durationMs
      );
      reply({ type: "fix-webm-duration-result", id: message.id, blob: fixed });
    } catch (error) {
      reply({
        type: "fix-webm-duration-result",
        id: message.id,
        error: String(error),
      });
    }
    return;
  }
  if (message.type === "get-frame") {
    // read-only poster grab, safe in viewer; otherwise isFfmpegRunning sticks
    try {
      const blob = await getFrame(null, message.blob, message.time);
      reply({ type: "new-frame", frame: blob });
    } catch (error) {
      reply({
        type: "ffmpeg-error",
        error: String(error),
        _opId: message._opId,
      });
    }
    return;
  }
  if (VIEWER_REJECTED_OPS.has(message.type)) {
    reply({
      type: "ffmpeg-error",
      error:
        "Processing not available in viewer mode. Please use a modern browser (Chrome 94+) for editing features.",
      _opId: message._opId,
    });
  }
};

// Runs an editor op and emits its result(s) via `reply`. The leading ffmpeg
// instance arg to each op util is vestigial (mediabunny ignores it), always null.
export async function runEditorOp(
  message: EditorOpMessage,
  reply: Reply,
  { viewer = false }: { viewer?: boolean } = {}
): Promise<void> {
  if (viewer) return runViewerOp(message, reply);
  try {
    switch (message.type) {
      case "load-ffmpeg":
        reply({ type: "ffmpeg-loaded" });
        break;

      case "fix-webm-duration": {
        try {
          const fixed = await fixWebmDurationOffThread(
            message.blob,
            message.durationMs
          );
          reply({
            type: "fix-webm-duration-result",
            id: message.id,
            blob: fixed,
          });
        } catch (error) {
          reply({
            type: "fix-webm-duration-result",
            id: message.id,
            error: String(error),
          });
        }
        break;
      }

      case "base64-to-blob": {
        if (
          typeof message.base64 !== "string" ||
          !message.base64.startsWith("data:")
        ) {
          throw new Error("base64-to-blob: expected data: URL");
        }
        const rawBlob = await fetch(message.base64).then((r) => r.blob());

        const header = await rawBlob.slice(4, 8).text();
        const looksMp4 = header === "ftyp";

        if (looksMp4) {
          reply({
            type: "updated-blob",
            base64: message.base64,
            topLevel: true,
          });
          break;
        }

        // reuse the already-decoded rawBlob; mediabunny sniffs the container
        // from bytes, so no second base64 decode is needed
        const mp4Blob = await convertWebmToMp4(rawBlob, (progress) =>
          reply({
            type: "ffmpeg-progress",
            progress: Math.round(progress * 100),
          })
        );

        const base64 = await toBase64(mp4Blob);
        reply({ type: "updated-blob", base64, topLevel: true });
        break;
      }

      case "get-frame": {
        const blob = await getFrame(null, message.blob, message.time);
        reply({ type: "new-frame", frame: blob });
        break;
      }

      case "reencode-video": {
        const blob = await reencodeVideo(
          null,
          message.blob,
          message.duration,
          (progress) =>
            reply({
              type: "ffmpeg-progress",
              progress: Math.round(progress * 100),
            })
        );
        const base64 = await toBase64(blob);
        reply({
          type: "updated-blob",
          base64,
          topLevel: true,
          _opId: message._opId,
        });
        break;
      }

      case "to-gif": {
        await runCancellableExport(async (signal) => {
          const blob = await toGIF(
            null,
            message.blob,
            (progress) =>
              reply({
                type: "ffmpeg-progress",
                progress: Math.round(progress * 100),
                _opId: message._opId,
              }),
            message.options,
            signal
          );
          const base64 = await toBase64(blob, signal);
          if (signal.aborted) return;
          reply({ type: "download-gif", base64, _opId: message._opId });
        });
        break;
      }

      case "to-webm": {
        await runCancellableExport(async (signal) => {
          const result =
            message.blob?.type === "video/webm"
              ? message.blob
              : await convertMp4ToWebm(
                  message.blob,
                  (progress) =>
                    reply({
                      type: "ffmpeg-progress",
                      progress: Math.round(progress * 100),
                      _opId: message._opId,
                    }),
                  signal
                );

          const base64 = await toBase64(result, signal);
          if (signal.aborted) return;
          reply({ type: "download-webm", base64, _opId: message._opId });
        });
        break;
      }

      default:
        break;
    }
  } catch (error) {
    if (
      (message.type === "to-gif" || message.type === "to-webm") &&
      isAbortError(error)
    ) {
      return;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : null;
    // Error props are non-enumerable; JSON.stringify drops them.
    console.error("[SayLess][Editor] op failed", {
      type: message.type,
      message: errMsg,
      stack: errStack,
      opId: message._opId,
    });
    if (errMsg.includes("too long")) {
      reply({ type: "edit-too-long", _opId: message._opId });
    } else {
      reply({
        type: "ffmpeg-error",
        error: errMsg || "unknown",
        errorStack: errStack,
        errorMessage: errMsg,
        opType: message.type,
        _opId: message._opId,
      });
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError") ||
    /abort|cancel/i.test(String(error))
  );
}

function createAbortError(): Error {
  try {
    return new DOMException("Export cancelled.", "AbortError");
  } catch {
    const error = new Error("Export cancelled.");
    error.name = "AbortError";
    return error;
  }
}
