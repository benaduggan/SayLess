export const closeOffscreenDocumentWithFlush = async ({
  reason = "unknown",
  timeoutMs = 25000,
  shouldFinalize = true,
} = {}) => {
  let offDoc = null;
  try {
    const existingContexts = await chrome.runtime.getContexts({});
    offDoc =
      existingContexts.find((c) => c.contextType === "OFFSCREEN_DOCUMENT") ||
      null;
  } catch (err) {
    console.warn("closeOffscreenDocumentWithFlush getContexts:", err);
  }

  if (!offDoc) return { ok: true, existed: false };

  // Local recorder docs acknowledge shutdown after flushing recorder state.
  // Keep the wait bounded so a missing ack cannot block the next picker.
  const effectiveTimeoutMs = Math.min(Math.max(timeoutMs, 2000), 5000);

  const ackPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({ ok: false, timedOut: true });
    }, effectiveTimeoutMs);
    const listener = (msg) => {
      if (msg?.type === "offscreen-shutdown-complete") {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ ok: true, timedOut: false });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });

  chrome.runtime
    .sendMessage({
      type: "offscreen-shutdown",
      reason,
      shouldFinalize,
      timeoutMs: Math.max(2000, effectiveTimeoutMs - 2000),
    })
    .catch(() => {});

  const result = await ackPromise;

  try {
    await chrome.offscreen.closeDocument();
  } catch (err) {
    console.warn("closeOffscreenDocumentWithFlush closeDocument:", err);
  }

  return { ok: true, existed: true, ...result };
};
