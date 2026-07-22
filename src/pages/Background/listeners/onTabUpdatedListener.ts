import { sendMessageTab } from "../tabManagement/sendMessageTab";
import { diagEvent } from "../../utils/diagnosticLog";

interface UpdatedTab {
  id: number;
  url?: string;
}

interface TabUpdateChromeApi {
  storage: {
    local: { get: (keys: string[]) => Promise<Record<string, unknown>> };
  };
  commands: { getAll: () => Promise<unknown[]> };
  runtime: { getURL: (path: string) => string };
  tabs: {
    onUpdated: {
      addListener: (
        listener: (
          tabId: number,
          changeInfo: { status?: string },
          tab: UpdatedTab,
        ) => void,
      ) => void;
    };
  };
}

const chromeApi = (): TabUpdateChromeApi =>
  (globalThis as typeof globalThis & { chrome: TabUpdateChromeApi }).chrome;

export const handleTabUpdate = async (
  tabId: number,
  changeInfo: { status?: string },
  tab: UpdatedTab,
): Promise<void> => {
  try {
    if (changeInfo.status === "complete") {
      const {
        recording,
        paused,
        pausedAt,
        totalPausedMs,
        restarting,
        tabRecordedID,
        pendingRecording,
        recordingStartTime,
        recorderSession,
        customRegion,
        recordingType,
      } = await chromeApi().storage.local.get([
        "recording",
        "paused",
        "pausedAt",
        "totalPausedMs",
        "restarting",
        "tabRecordedID",
        "pendingRecording",
        "recordingStartTime",
        "recorderSession",
        "customRegion",
        "recordingType",
      ]);

      // Check both recording flag AND recorderSession to avoid race conditions
      // recorderSession persists even if the SW restarts
      const isActivelyRecording =
        Boolean(recording) ||
        (typeof recorderSession === "object" &&
          recorderSession !== null &&
          (recorderSession as { status?: unknown }).status === "recording");
      const isPendingOrRestarting = restarting || pendingRecording;

      if (!isActivelyRecording && !isPendingOrRestarting) {
        sendMessageTab(tabId, { type: "recording-ended" });
      } else if (isActivelyRecording) {
        if (tabRecordedID && tabRecordedID === tabId) {
          diagEvent("recorded-tab-navigated");
          sendMessageTab(tabId, {
            type: "recording-check",
            force: true,
            recordingStartTime,
          });
        } else if (tabRecordedID && tabRecordedID !== tabId) {
          sendMessageTab(tabId, { type: "hide-popup-recording" });
        }
      }

      if (recordingStartTime) {
        const now = Date.now();
        const startedAt = Number(recordingStartTime);
        const basePaused = Number(totalPausedMs) || 0;
        const pausedTimestamp = Number(pausedAt) || 0;
        const extraPaused =
          paused && pausedTimestamp ? Math.max(0, now - pausedTimestamp) : 0;

        const elapsed = Math.max(
          0,
          Math.floor(
            (now - startedAt - basePaused - extraPaused) / 1000,
          ),
        );

        const { alarm } = await chromeApi().storage.local.get(["alarm"]);
        if (alarm) {
          const { alarmTime } = await chromeApi().storage.local.get(["alarmTime"]);
          const remaining = Math.max(0, Math.floor(Number(alarmTime) - elapsed));
          sendMessageTab(tabId, { type: "time", time: remaining });
        } else {
          sendMessageTab(tabId, { type: "time", time: elapsed });
        }
      }

      const commands = await chromeApi().commands.getAll();

      sendMessageTab(tabId, {
        type: "commands",
        commands: commands,
      });

      // Check if tab is playground.html
      if (
        tab.url?.includes(chromeApi().runtime.getURL("playground.html")) &&
        changeInfo.status === "complete"
      ) {
        sendMessageTab(tab.id, { type: "toggle-popup" });
      }
    }
  } catch (error) {
    console.error(
      "Error in handleTabUpdate:",
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const onTabUpdatedListener = (): void => {
  chromeApi().tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void handleTabUpdate(tabId, changeInfo, tab);
  });
};
