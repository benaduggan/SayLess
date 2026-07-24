import { sendMessageTab } from "../tabManagement/sendMessageTab";
import { focusTab } from "../tabManagement/focusTab";
import { removeTab } from "../tabManagement/removeTab";
import { discardOffscreenDocuments } from "../offscreen/discardOffscreenDocuments";
import { resetWatchdogState } from "./resetWatchdogState";

interface CancelChromeApi {
  action: { setIcon: (options: { path: string }) => Promise<void> };
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
      remove: (keys: string[]) => Promise<void>;
    };
  };
  tabs: { get: (id: number) => Promise<{ url?: string }> };
}

const chromeApi = (): CancelChromeApi =>
  (globalThis as typeof globalThis & { chrome: CancelChromeApi }).chrome;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const handleDismiss = async (): Promise<void> => {
  try {
    await chromeApi().storage.local.set({ restarting: true });

    const { region, wasRegion } = await chromeApi().storage.local.get(["region", "wasRegion"]);

    if (wasRegion) {
      await chromeApi().storage.local.set({ wasRegion: false, region: true });
    }

    void chromeApi().action.setIcon({ path: "assets/icon-34.png" });
    void chromeApi().runtime.sendMessage({ type: "turn-off-pip" });
    void chromeApi().storage.local.set({ pipForceClose: Date.now() });
    void chromeApi().storage.local.set({
      recordingUiTabId: null,
      multiMode: false,
      multiSceneCount: 0,
      multiProjectId: null,
      multiLastSceneId: null,
    });
    void chromeApi().storage.local.remove(["recordingMeta", "clickEvents"]);
  } catch (error) {
    console.error("Failed to handle dismiss:", error);
  }
};

export const cancelRecording = async (): Promise<void> => {
  try {
    void chromeApi().action.setIcon({ path: "assets/icon-34.png" });

    const { activeTab, recordingUiTabId, tabRecordedID, recordingTab } =
      await chromeApi().storage.local.get([
        "activeTab",
        "recordingUiTabId",
        "tabRecordedID",
        "recordingTab",
      ]);

    await chromeApi().storage.local.set({
      pendingRecording: false,
      recordingUiTabId: null,
      tabRecordedID: null,
      recordingTab: null,
      // mirror stopRecording's cleared fields so cancel can't leak into next attempt
      region: false,
      customRegion: false,
      recording: false,
      restarting: false,
      offscreen: false,
      memoryError: false,
    });

    // URL-guard so we never close a user tab by mistake
    if (recordingTab) {
      try {
        const tabId = Number(recordingTab);
        const tab = await chromeApi().tabs.get(tabId);
        const url = tab?.url || "";
        if (url.includes("recorder.html")) {
          try {
            await removeTab(tabId);
          } catch (removeErr) {
            // distinguish benign "No tab with id" race from real failures
            const msg = errorMessage(removeErr);
            if (!/No tab with id/i.test(msg)) {
              console.warn("[SayLess][BG] cancelRecording: removeTab failed", { tabId, err: msg });
            }
          }
        }
      } catch {}
    }

    const candidateTabs = [activeTab, recordingUiTabId, tabRecordedID]
      .map(Number)
      .filter(
        (id, idx, arr): id is number => Number.isInteger(id) && id > 0 && arr.indexOf(id) === idx,
      );
    candidateTabs.forEach((id) => {
      sendMessageTab(id, { type: "stop-pending" }).catch(() => {});
    });
    void focusTab(activeTab);
    try {
      await discardOffscreenDocuments();
    } catch {}
    await resetWatchdogState();
    void chromeApi().runtime.sendMessage({ type: "turn-off-pip" });
    void chromeApi().storage.local.set({ pipForceClose: Date.now() });
    void chromeApi().storage.local.set({
      recordingUiTabId: null,
      multiMode: false,
      multiSceneCount: 0,
      multiProjectId: null,
      multiLastSceneId: null,
    });
    void chromeApi().storage.local.remove(["recordingMeta", "clickEvents"]);
  } catch (error) {
    console.error("Failed to cancel recording:", errorMessage(error));
  }
};
