import { offscreenChrome } from "./chromeTypes";

export interface CloseOffscreenResult {
  ok: boolean;
  existed: boolean;
  timedOut?: boolean;
}

export const closeOffscreenDocumentWithFlush = async ({
  reason = "unknown",
  timeoutMs = 25000,
  shouldFinalize = true,
}: {
  reason?: string;
  timeoutMs?: number;
  shouldFinalize?: boolean;
} = {}): Promise<CloseOffscreenResult> => {
  const chromeApi = offscreenChrome();
  let offDoc = null;
  try {
    const existingContexts = await chromeApi.runtime.getContexts({});
    offDoc = existingContexts.find((c) => c.contextType === "OFFSCREEN_DOCUMENT") || null;
  } catch (err) {
    console.warn("closeOffscreenDocumentWithFlush getContexts:", err);
  }

  if (!offDoc) return { ok: true, existed: false };

  // Local recorder docs acknowledge shutdown after flushing recorder state.
  // Keep the wait bounded so a missing ack cannot block the next picker.
  const effectiveTimeoutMs = Math.min(Math.max(timeoutMs, 2000), 5000);

  const ackPromise = new Promise<{ ok: boolean; timedOut: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      chromeApi.runtime.onMessage.removeListener(listener);
      resolve({ ok: false, timedOut: true });
    }, effectiveTimeoutMs);
    const listener = (msg: unknown): void => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: unknown }).type === "offscreen-shutdown-complete"
      ) {
        clearTimeout(timer);
        chromeApi.runtime.onMessage.removeListener(listener);
        resolve({ ok: true, timedOut: false });
      }
    };
    chromeApi.runtime.onMessage.addListener(listener);
  });

  chromeApi.runtime
    .sendMessage({
      type: "offscreen-shutdown",
      reason,
      shouldFinalize,
      timeoutMs: Math.max(2000, effectiveTimeoutMs - 2000),
    })
    .catch(() => {});

  const result = await ackPromise;

  try {
    await chromeApi.offscreen?.closeDocument();
  } catch (err) {
    console.warn("closeOffscreenDocumentWithFlush closeDocument:", err);
  }

  return { existed: true, ...result };
};
