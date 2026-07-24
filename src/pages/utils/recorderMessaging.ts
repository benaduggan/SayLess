// recorder -> background messaging.
// iframe-context reload on error is a no-op for the offscreen Recorder, so it's safe to share.
// sendStopRecording accepts a string or object reason, plus optional extra fields.
import { classifyError } from "./errorCodes";

const sendRuntimeMessage = (message: unknown): void => {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage: (value: unknown) => unknown } };
    }
  ).chrome;
  chromeApi.runtime.sendMessage(message);
};

const urlParams = new URLSearchParams(window.location.search);
const IS_INJECTED_IFRAME = urlParams.has("injected");
const IS_IFRAME_CONTEXT =
  IS_INJECTED_IFRAME ||
  (window.top !== window.self && !document.referrer.startsWith("chrome-extension://"));

export function sendRecordingError(why: unknown, cancel = false): void {
  const errorType = !cancel ? "stream-error" : "cancel-modal";
  const whyStr = typeof why === "string" ? why : JSON.stringify(why);
  const errorCode = classifyError(whyStr, errorType);

  sendRuntimeMessage({
    type: "recording-error",
    error: errorType,
    why: whyStr,
    errorCode,
  });

  if (IS_IFRAME_CONTEXT) {
    window.location.reload();
  }
}

export function sendStopRecording(
  reason: string | Record<string, unknown> | null = "generic",
  extra: Record<string, unknown> = {},
): void {
  const base =
    typeof reason === "string"
      ? { reason }
      : {
          ...reason,
          reason: typeof reason?.reason === "string" ? reason.reason : "generic",
        };

  sendRuntimeMessage({
    type: "stop-recording-tab",
    ...base,
    ...extra,
  });
}
