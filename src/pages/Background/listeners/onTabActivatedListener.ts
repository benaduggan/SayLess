import { sendMessageTab } from "../tabManagement/sendMessageTab";
import { listenerChrome, listenerErrorMessage } from "./chromeTypes";

export const handleTabActivation = async (activeInfo: {
  tabId: number;
  windowId?: number;
}): Promise<void> => {
  try {
    const chromeApi = listenerChrome();
    const {
      recordingStartTime,
      recording,
      paused,
      pausedAt,
      totalPausedMs,
      restarting,
      pendingRecording,
      recorderSession,
    } = await chromeApi.storage.local.get([
      "recordingStartTime",
      "recording",
      "paused",
      "pausedAt",
      "totalPausedMs",
      "restarting",
      "pendingRecording",
      "recorderSession",
    ]);

    // Get the activated tab
    await chromeApi.tabs.get(activeInfo.tabId);

    // Check both recording flag AND recorderSession to avoid race conditions
    // recorderSession persists even if the SW restarts
    const isActivelyRecording =
      Boolean(recording) ||
      (typeof recorderSession === "object" &&
        recorderSession !== null &&
        (recorderSession as { status?: unknown }).status === "recording");

    if (isActivelyRecording) {
      // Check if region recording and if the current tab is the recording tab
      const { tabRecordedID, region, customRegion, recordingType } =
        await chromeApi.storage.local.get([
          "tabRecordedID",
          "region",
          "customRegion",
          "recordingType",
        ]);
      if (tabRecordedID && tabRecordedID !== activeInfo.tabId) {
        sendMessageTab(activeInfo.tabId, { type: "hide-popup-recording" });
      } else {
        // Update the active tab reference
        void chromeApi.storage.local.set({ activeTab: activeInfo.tabId });
      }

      // Check if it's region or customRegion recording
      if (!region && !customRegion && recordingType !== "region") {
        sendMessageTab(activeInfo.tabId, {
          type: "recording-check",
          recordingStartTime,
        });
      }
    } else if (!isActivelyRecording && !restarting && !pendingRecording) {
      sendMessageTab(activeInfo.tabId, { type: "recording-ended" });
    }

    // If there's a recording start time, update the UI with time
    if (recordingStartTime) {
      const now = Date.now();
      const startedAt = Number(recordingStartTime);
      const basePaused = Number(totalPausedMs) || 0;
      const pausedTimestamp = Number(pausedAt) || 0;
      const extraPaused = paused && pausedTimestamp
        ? Math.max(0, now - pausedTimestamp)
        : 0;

      const elapsed = Math.max(
        0,
        Math.floor((now - startedAt - basePaused - extraPaused) / 1000),
      );

      const { alarm } = await chromeApi.storage.local.get(["alarm"]);
      if (alarm) {
        const { alarmTime } = await chromeApi.storage.local.get(["alarmTime"]);
        const remaining = Math.max(0, Math.floor(Number(alarmTime) - elapsed));
        sendMessageTab(activeInfo.tabId, { type: "time", time: remaining });
      } else {
        sendMessageTab(activeInfo.tabId, { type: "time", time: elapsed });
      }
    }
  } catch (error) {
    console.error("Error in handleTabActivation:", listenerErrorMessage(error));
  }
};

export const onTabActivatedListener = (): void => {
  listenerChrome().tabs.onActivated.addListener((info) => {
    void handleTabActivation(info);
  });
};
