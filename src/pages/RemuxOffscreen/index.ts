/*
 * Offscreen document entry. Acts as a message router between the service
 * worker and a dedicated worker that runs the OPFS-backed remux. The
 * offscreen doc itself does no CPU work: it only spawns the worker and
 * proxies messages in both directions.
 *
 * Lifecycle:
 *   - Created by the SW on first remux-request.
 *   - Worker is lazily spawned on first remux-start message.
 *   - Stays alive as long as the SW keeps it open (SW tears down after
 *     idle timeout, which terminates this page and the worker with it).
 */

const devLog: (label: string, data?: unknown) => void =
  process.env.SAYLESS_DEV_MODE === "true"
    ? (label, data) => console.log("[remux][offscreen]", label, data || "")
    : () => {};

type SendResponse = (response?: unknown) => void;

interface PendingRemux {
  sendResponse: SendResponse;
}

interface RemuxWorkerMessage {
  type?: string;
  requestId?: string;
  progress?: number;
  outputFileName?: string;
  error?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || "unknown-error");

let worker: Worker | null = null;
// Pending remuxes keyed by requestId. Each entry holds the sendResponse
// callback from chrome.runtime.onMessage, so we can reply once the worker
// finishes or fails. Progress events don't use these; they broadcast to
// the sandbox directly via chrome.runtime.sendMessage.
const pending = new Map<string, PendingRemux>();

const ensureWorker = (): Worker => {
  if (worker) return worker;
  devLog("spawn-worker");
  worker = new Worker(chrome.runtime.getURL("remuxworker.bundle.js"));
  worker.onmessage = (e: MessageEvent<RemuxWorkerMessage>) => {
    const msg = e.data;
    if (!msg || !msg.requestId) return;
    const entry = pending.get(msg.requestId);
    if (msg.type === "progress") {
      // Forward progress to the sandbox. Swallow errors; progress is
      // best-effort UI state.
      chrome.runtime
        .sendMessage({
          type: "remux-progress",
          requestId: msg.requestId,
          progress: msg.progress,
        })
        .catch(() => {});
      return;
    }
    if (msg.type === "done") {
      devLog("worker-done", {
        requestId: msg.requestId,
        outputFileName: msg.outputFileName,
      });
      pending.delete(msg.requestId);
      entry?.sendResponse?.({ ok: true, outputFileName: msg.outputFileName });
      return;
    }
    if (msg.type === "error") {
      devLog("worker-error", { requestId: msg.requestId, err: msg.error });
      pending.delete(msg.requestId);
      entry?.sendResponse?.({ ok: false, error: msg.error });
      return;
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    // Worker-level error (module load failure, uncaught throw). Fail all
    // pending remuxes so callers can fall back.
    const errText = String(e?.message || e || "worker-error");
    for (const [id, entry] of pending) {
      entry?.sendResponse?.({ ok: false, error: errText });
    }
    pending.clear();
    try {
      worker?.terminate();
    } catch {
      // already terminated
    }
    worker = null;
  };
  return worker;
};

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (asRecord(message).type !== "cancel-remux") return undefined;
  // Editor cancelled the download: kill the worker so it stops encoding.
  if (worker) {
    try {
      worker.terminate();
    } catch {
      // already gone
    }
    worker = null;
  }
  for (const [, entry] of pending) {
    entry?.sendResponse?.({ ok: false, error: "cancelled" });
  }
  pending.clear();
  return false;
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const messageRecord = asRecord(message);
  if (messageRecord.type !== "remux-start" && messageRecord.type !== "webm-start") {
    return undefined;
  }
  const requestId = typeof messageRecord.requestId === "string" ? messageRecord.requestId : "";
  const inputFileName =
    typeof messageRecord.inputFileName === "string" ? messageRecord.inputFileName : "";
  const outputFileName =
    typeof messageRecord.outputFileName === "string" ? messageRecord.outputFileName : "";
  if (!requestId || !inputFileName || !outputFileName) {
    sendResponse({ ok: false, error: "invalid-remux-start-payload" });
    return false;
  }
  const workerType = messageRecord.type === "webm-start" ? "webm" : "remux";
  try {
    const w = ensureWorker();
    devLog("remux-start-received", {
      requestId,
      inputFileName,
      outputFileName,
      kind: workerType,
    });
    pending.set(requestId, { sendResponse });
    w.postMessage({
      type: workerType,
      requestId,
      inputFileName,
      outputFileName,
    });
  } catch (err) {
    pending.delete(requestId);
    sendResponse({
      ok: false,
      error: errorMessage(err || "remux-start-failed"),
    });
    return false;
  }
  return true;
});
