import { sendMessageTab } from "../tabManagement/sendMessageTab";
import { getCurrentTab } from "../tabManagement/getCurrentTab";
import { sendMessageRecord } from "../recording/sendMessageRecord.ts";

type CommandTabUpdateListener = (
  tabId: number,
  changeInfo: { status?: string },
) => void;

interface CommandChromeApi {
  commands: {
    onCommand: { addListener: (listener: (command: string) => void) => void };
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  tabs: {
    create: (options: { url: string; active: boolean }) => Promise<{ id?: number }>;
    onUpdated: {
      addListener: (listener: CommandTabUpdateListener) => void;
      removeListener: (listener: CommandTabUpdateListener) => void;
    };
  };
}

const chromeApi = (): CommandChromeApi =>
  (globalThis as typeof globalThis & { chrome: CommandChromeApi }).chrome;

export const onCommandListener = (): void => {
  let lastToggleDrawingAt = 0;
  const TOGGLE_DRAWING_COOLDOWN_MS = 400;

  chromeApi().commands.onCommand.addListener((command) => {
    void handleCommand(command);
  });

  const handleCommand = async (command: string): Promise<void> => {
    const activeTab = await getCurrentTab();
    if (!activeTab || !activeTab.id) return;

    if (command === "start-recording") {
      // shortcut pressed from another window must not start a second recording
      try {
        const { recording, pendingRecording, restarting } =
          await chromeApi().storage.local.get([
            "recording",
            "pendingRecording",
            "restarting",
          ]);
        if (recording || pendingRecording || restarting) {
          return;
        }
      } catch {}
      const tabUrl = String(activeTab.url || "");
      if (
        !(
          tabUrl.startsWith("chrome://") ||
          (tabUrl.startsWith("chrome-extension://") &&
            !tabUrl.includes("/playground.html") &&
            !tabUrl.includes("/setup.html"))
        ) &&
        !tabUrl.includes("stackoverflow.com/") &&
        !tabUrl.includes("chrome.google.com/webstore") &&
        !tabUrl.includes("chromewebstore.google.com")
      ) {
        sendMessageTab(activeTab.id, { type: "start-stream" });
      } else {
        chromeApi().tabs
          .create({
            url: "playground.html",
            active: true,
          })
          .then((tab) => {
            void chromeApi().storage.local.set({ activeTab: tab.id });

            if (tab.id == null) return;
            const listener: CommandTabUpdateListener = (tabId, changeInfo) => {
              if (tabId === tab.id && changeInfo.status === "complete") {
                setTimeout(() => {
                  void sendMessageTab(tab.id!, { type: "start-stream" });
                }, 500);
                chromeApi().tabs.onUpdated.removeListener(listener);
              }
            };
            chromeApi().tabs.onUpdated.addListener(listener);
          });
      }
    } else if (
      command === "cancel-recording" ||
      command === "pause-recording" ||
      command === "stop-recording"
    ) {
      // Recording controls must reach the recording UI tab (the pill + its
      // content-script handlers), not the focused tab. With offscreen
      // recording (default in 4.5.0) the focused tab is often unrelated to the
      // recording and may be unscriptable (chrome://, web store), which
      // silently dropped the shortcut. recordingUiTabId mirrors the toolbar's
      // targeting; it equals the active tab in the normal case.
      const { recordingUiTabId } = await chromeApi().storage.local.get([
        "recordingUiTabId",
      ]);
      const targetTabId = Number(recordingUiTabId) || activeTab.id;
      const msg =
        command === "cancel-recording"
          ? { type: "cancel-recording" }
          : command === "pause-recording"
            ? { type: "pause-recording" }
            : { type: "stop-recording-tab" };
      try {
        await sendMessageTab(targetTabId, msg);
      } catch (err) {
        // Recording UI tab gone (closed/navigated). The offscreen recorder
        // accepts stop-recording-tab directly, so stop can still end the
        // recording; pause/cancel need the content-script pill UI, so they
        // have no direct fallback here (the user can stop via the toolbar).
        if (command === "stop-recording") {
          await sendMessageRecord({ type: "stop-recording-tab" }).catch(
            () => {},
          );
        }
      }
    } else if (command === "toggle-drawing-mode") {
      const now = Date.now();
      if (now - lastToggleDrawingAt < TOGGLE_DRAWING_COOLDOWN_MS) {
        return;
      }
      lastToggleDrawingAt = now;
      sendMessageTab(activeTab.id, { type: "toggle-drawing-mode" });
    } else if (command === "toggle-blur-mode") {
      sendMessageTab(activeTab.id, { type: "toggle-blur-mode" });
    } else if (command === "toggle-hide-ui") {
      sendMessageTab(activeTab.id, { type: "toggle-hide-ui" });
    } else if (command === "toggle-cursor-mode") {
      sendMessageTab(activeTab.id, { type: "toggle-cursor-mode" });
    }
  };
};
