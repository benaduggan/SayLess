import { shouldUseDisplayMediaForScreen } from "./screenCaptureMode";

let sent = false;

// Offscreen screen recordings can't show the "record computer audio" warning
// directly, so trigger the same component in the content script (via the SW),
// passing the variant. Fires once per recorder document.
interface GuidanceChromeApi {
  storage: {
    local: {
      get: (
        keys: string[],
        callback: (settings: {
          forceDisplayMediaScreen?: boolean;
          macSystemAudioCapture?: boolean;
        }) => void,
      ) => void;
    };
  };
  runtime: { sendMessage: (message: unknown) => unknown };
}

export const sendSystemAudioGuidanceToast = (): void => {
  if (sent) return;
  sent = true;
  const isMac = navigator.userAgent.indexOf("Mac") !== -1;
  const chromeApi = (globalThis as typeof globalThis & { chrome: GuidanceChromeApi }).chrome;
  chromeApi.storage.local.get(
    ["forceDisplayMediaScreen", "macSystemAudioCapture"],
    ({ forceDisplayMediaScreen, macSystemAudioCapture }) => {
      const useDisplayMedia = shouldUseDisplayMediaForScreen({
        forceDisplayMediaScreen:
          typeof forceDisplayMediaScreen === "boolean"
            ? forceDisplayMediaScreen
            : undefined,
        macSystemAudioCapture:
          typeof macSystemAudioCapture === "boolean"
            ? macSystemAudioCapture
            : undefined,
      });
      const variant = isMac && !useDisplayMedia ? "mac" : "other";
      try {
        chromeApi.runtime.sendMessage({
          type: "show-audio-warning",
          variant,
          timeout: 10000,
        });
      } catch {}
    },
  );
};
