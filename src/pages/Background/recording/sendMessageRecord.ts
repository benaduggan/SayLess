import { sendMessageTab } from "../tabManagement/sendMessageTab";

type ResponseCallback = (response: unknown) => void;

interface RecordChromeApi {
  runtime: {
    lastError?: { message?: string };
    sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
  };
  storage: {
    local: {
      get: (
        keys: string[],
        callback: (result: Record<string, unknown>) => void,
      ) => void;
    };
  };
}

const chromeApi = (): RecordChromeApi =>
  (globalThis as typeof globalThis & { chrome: RecordChromeApi }).chrome;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const sendMessageRecord = (
  message: Record<string, unknown>,
  responseCallback: ResponseCallback | null = null,
): Promise<unknown> => {
  return new Promise<unknown>((resolve, reject) => {
    chromeApi().storage.local.get(["recordingTab", "offscreen"], (result) => {
      if (chromeApi().runtime.lastError) {
        console.warn(
          "sendMessageRecord: storage error",
          chromeApi().runtime.lastError?.message,
        );
        return reject(chromeApi().runtime.lastError?.message);
      }

      if (result.offscreen) {
        chromeApi().runtime.sendMessage(message, (response) => {
          if (chromeApi().runtime.lastError) {
            reject(chromeApi().runtime.lastError?.message);
          } else {
            responseCallback ? responseCallback(response) : resolve(response);
          }
        });
      } else if (result.recordingTab) {
        sendMessageTab(Number(result.recordingTab), message, responseCallback)
          .then(resolve)
          .catch((err) => {
            const errStr = String(err);
            const isDeadTab =
              errStr.includes("Receiving end does not exist") ||
              errStr.includes("No tab with id");
            console.warn(
              `sendMessageRecord: failed to message recordingTab ${result.recordingTab}${isDeadTab ? " (stale/dead tab)" : ""}`,
              err
            );
            reject(err);
          });
      } else {
        // SW restart can lose recordingTab, fall back to recorderSession
        // but only if it's still live. completed/crashed/stopped sessions
        // point at a dead tab and would surface a misleading "No tab with
        // id" error instead of the real "no recorder tab" one.
        chromeApi().storage.local.get(["recorderSession"], (sessionResult) => {
          const sessionValue = sessionResult.recorderSession;
          const session = asRecord(sessionValue);
          const recorderTabId =
            Number(session.recorderTabId || session.tabId) || null;
          const sessionLive =
            session.status === "recording" || session.status === "starting";
          if (sessionLive && recorderTabId) {
            sendMessageTab(recorderTabId, message, responseCallback)
              .then(resolve)
              .catch(reject);
          } else {
            console.warn(
              "sendMessageRecord: no recording tab available",
              sessionValue
                ? { sessionStatus: session.status, recorderTabId }
                : { session: null }
            );
            reject(new Error("No recording tab available"));
          }
        });
      }
    });
  });
};
