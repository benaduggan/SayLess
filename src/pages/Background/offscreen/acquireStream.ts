// SW-side stream acquisition for the offscreen recorder. Offscreen docs
// can't call getDisplayMedia / tabCapture; SW acquires a streamId and hands
// it over. Picker anchors to initiatingTabId so it appears on the user's tab.

import {
  offscreenChrome,
  type ExtensionTab,
} from "./chromeTypes";

const DEFAULT_SCREEN_SOURCES = ["screen", "window", "tab", "audio"];

export interface AcquiredStream {
  streamId: string | null;
  source: "camera" | "tab" | "desktop" | "cancelled";
  canRequestAudioTrack?: boolean;
}

export interface AcquireStreamRequest {
  mode: "camera" | "tab" | "screen" | string;
  initiatingTabId?: number | null;
  targetTabId?: number | null;
  sources?: string[];
}

const getInitiatingTab = async (
  tabId?: number | null,
): Promise<ExtensionTab | null> => {
  if (!tabId) return null;
  try {
    return await offscreenChrome().tabs.get(tabId);
  } catch {
    return null;
  }
};

const acquireScreenStream = ({
  sources,
  anchorTab,
}: {
  sources?: string[];
  anchorTab: ExtensionTab | null;
}): Promise<AcquiredStream> =>
  new Promise<AcquiredStream>((resolve, reject) => {
    const requested =
      Array.isArray(sources) && sources.length ? sources : DEFAULT_SCREEN_SOURCES;
    try {
      console.log("[SayLess][acquireStream] chooseDesktopMedia invoked", {
        requested,
        anchorTabId: anchorTab?.id,
      });
      const chromeApi = offscreenChrome();
      chromeApi.desktopCapture.chooseDesktopMedia(
        requested,
        anchorTab || undefined,
        (streamId, opts) => {
          console.log("[SayLess][acquireStream] chooseDesktopMedia callback", {
            streamIdPresent: !!streamId,
            streamIdPrefix: streamId ? streamId.slice(0, 16) + "..." : null,
            opts,
            lastError: chromeApi.runtime.lastError?.message || null,
          });
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message));
            return;
          }
          if (!streamId) {
            resolve({ streamId: "", source: "cancelled" });
            return;
          }
          resolve({
            streamId,
            source: "desktop",
            canRequestAudioTrack: !!opts?.canRequestAudioTrack,
          });
        }
      );
    } catch (err) {
      reject(err);
    }
  });

const acquireTabStream = ({
  targetTabId,
}: {
  targetTabId?: number | null;
}): Promise<AcquiredStream> =>
  new Promise<AcquiredStream>((resolve, reject) => {
    if (!targetTabId) {
      reject(new Error("tab capture requires targetTabId"));
      return;
    }
    try {
      const chromeApi = offscreenChrome();
      chromeApi.tabCapture.getMediaStreamId(
        { targetTabId },
        (streamId) => {
          if (chromeApi.runtime.lastError) {
            reject(new Error(chromeApi.runtime.lastError.message));
            return;
          }
          if (!streamId) {
            resolve({ streamId: "", source: "cancelled" });
            return;
          }
          resolve({ streamId, source: "tab" });
        }
      );
    } catch (err) {
      reject(err);
    }
  });

export const acquireStreamForOffscreen = async ({
  mode,
  initiatingTabId,
  targetTabId,
  sources,
}: AcquireStreamRequest): Promise<AcquiredStream> => {
  if (mode === "camera") {
    return { streamId: null, source: "camera" };
  }

  if (mode === "tab") {
    return acquireTabStream({ targetTabId: targetTabId || initiatingTabId });
  }

  const anchorTab = await getInitiatingTab(initiatingTabId);
  return acquireScreenStream({ sources, anchorTab });
};
