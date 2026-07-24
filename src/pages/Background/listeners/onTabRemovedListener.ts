import { sendMessageTab } from "../tabManagement/sendMessageTab";
import { removeTab } from "../tabManagement/removeTab";
import { sendMessageRecord } from "../recording/sendMessageRecord";
import { isRecordingStartInFlight } from "../recording/startRecording";
import { diagEvent, endDiagSession } from "../../utils/diagnosticLog";

interface TabRemovedChromeApi {
  tabs: {
    get: (tabId: number) => Promise<{ url?: string }>;
    onRemoved: { addListener: (listener: (tabId: number) => void) => void };
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: { sendMessage: (message: unknown) => Promise<unknown> };
  action: { setIcon: (options: { path: string }) => Promise<void> };
}

const chromeApi = (): TabRemovedChromeApi =>
  (globalThis as typeof globalThis & { chrome: TabRemovedChromeApi }).chrome;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export const onTabRemovedListener = (): void => {
  chromeApi().tabs.onRemoved.addListener((tabId) => {
    void handleTabRemoved(tabId);
  });

  const handleTabRemoved = async (tabId: number): Promise<void> => {
    try {
      const flags = await chromeApi().storage.local.get([
        "recording",
        "pendingRecording",
        "restarting",
        "recordingStartingAt",
        "recordingTab",
        "tabRecordedID",
        "recordingUiTabId",
        "activeTab",
        "recorderSession",
        "sandboxTab",
      ]);
      const {
        recording,
        pendingRecording,
        restarting,
        recordingTab,
        tabRecordedID,
        recordingUiTabId,
        activeTab,
        recorderSession,
        sandboxTab,
      } = flags;
      const session = asRecord(recorderSession);
      // `recording` isn't true yet during start, so without this guard
      // the cleanup below tears down the recorder tab being prepared.
      const startInFlight = isRecordingStartInFlight(flags);

      // close orphaned recorder.html when the local sandbox editor closes.
      if (tabId === sandboxTab) {
        void chromeApi().storage.local.set({ sandboxTab: null });
        const isStillRecording = Boolean(recording) || session.status === "recording";
        if (!startInFlight && !isStillRecording && recordingTab && recordingTab !== tabId) {
          try {
            const recTab = await chromeApi().tabs.get(Number(recordingTab));
            const recUrl = recTab?.url || "";
            if (recUrl.includes("recorder.html")) {
              void removeTab(Number(recordingTab));
            }
          } catch {}
          void chromeApi().storage.local.set({ recordingTab: null });
        }
      }

      // tabRecordedID only; non-region tab capture handles close via stream death,
      // and recordingTab fallback would misclassify a recorder.html close.
      const recordedTabId = tabRecordedID || null;

      const isActivelyRecording = Boolean(recording) || session.status === "recording";
      const recorderOwnerTabId = Number(session.recorderTabId || session.tabId) || null;

      if (tabId === recorderOwnerTabId) {
        chromeApi()
          .runtime.sendMessage({
            type: "clear-recording-session-safe",
            reason: "recorder-owner-tab-removed",
          })
          .catch(() => {});

        if (session.status === "recording") {
          diagEvent("crash", { reason: "recorder-owner-tab-removed", tabId });
          // Same multi-preserve guard as below; don't nuke
          // multiProjectId when the user discarded scene N (N>1) of a
          // multi-recording. The already-saved scenes' project must
          // survive so the user's "Done" click reaches it.
          const {
            multiMode: preservedMultiMode,
            multiSceneCount: preservedSceneCount,
            multiProjectId: preservedProjectId,
            multiLastSceneId: preservedLastSceneId,
          } = await chromeApi().storage.local.get([
            "multiMode",
            "multiSceneCount",
            "multiProjectId",
            "multiLastSceneId",
          ]);
          const hasSavedMultiScenes =
            preservedMultiMode && Number(preservedSceneCount) > 0 && preservedProjectId;
          await chromeApi().storage.local.set({
            recorderSession: {
              ...session,
              status: "crashed",
              crashedAt: Date.now(),
            },
            recording: false,
            ...(hasSavedMultiScenes
              ? {
                  multiMode: preservedMultiMode,
                  multiSceneCount: preservedSceneCount,
                  multiProjectId: preservedProjectId,
                  multiLastSceneId: preservedLastSceneId,
                }
              : {
                  multiMode: false,
                  multiSceneCount: 0,
                  multiProjectId: null,
                  multiLastSceneId: null,
                }),
          });
          void endDiagSession("crashed");
        }
      }

      if (!restarting && isActivelyRecording && tabId === recordedTabId) {
        diagEvent("recorded-tab-closed");
        void chromeApi().storage.local.set({ recordingTab: null, tabRecordedID: null });

        // direct to recorder; content script tab may not exist
        try {
          await sendMessageRecord({
            type: "stop-recording-tab",
            reason: "recorded-tab-closed",
          });
        } catch (err) {
          console.warn("Could not message recorder to stop:", err);
        }

        const { activeTab } = await chromeApi().storage.local.get(["activeTab"]);
        if (activeTab && activeTab !== tabId) {
          sendMessageTab(Number(activeTab), { type: "stop-pending" }).catch(() => {});
        }

        void chromeApi().action.setIcon({ path: "assets/icon-34.png" });
      }

      // recorder.html closed mid-recording; nothing else writes recording=false here
      if (!restarting && isActivelyRecording && tabId === recordingTab) {
        diagEvent("crash", { reason: "recorder-tab-closed", tabId });
        void endDiagSession("crashed");
        console.error("Recorder tab was closed during recording!");
        // Preserve multi-project state when scenes are already saved.
        // Without this, discarding scene N (N>1) wiped multiProjectId
        // because recorder tab close races BG's
        // `recording:false` write and we'd see recorderSession.status
        // still "recording". The user would then click "Done" on their
        // scene 1 and hit "No project ID for multi recording".
        const {
          multiMode: preservedMultiMode,
          multiSceneCount: preservedSceneCount,
          multiProjectId: preservedProjectId,
          multiLastSceneId: preservedLastSceneId,
        } = await chromeApi().storage.local.get([
          "multiMode",
          "multiSceneCount",
          "multiProjectId",
          "multiLastSceneId",
        ]);
        const hasSavedMultiScenes =
          preservedMultiMode && Number(preservedSceneCount) > 0 && preservedProjectId;
        void chromeApi().storage.local.set({
          recording: false,
          recordingTab: null,
          recordingUiTabId: null,
          tabRecordedID: null,
          pendingRecording: false,
          recorderSession: Object.keys(session).length
            ? { ...session, status: "crashed", crashedAt: Date.now() }
            : null,
          ...(hasSavedMultiScenes
            ? {
                multiMode: preservedMultiMode,
                multiSceneCount: preservedSceneCount,
                multiProjectId: preservedProjectId,
                multiLastSceneId: preservedLastSceneId,
              }
            : {
                multiMode: false,
                multiSceneCount: 0,
                multiProjectId: null,
                multiLastSceneId: null,
              }),
        });
        void chromeApi().action.setIcon({ path: "assets/icon-34.png" });
      }

      if (tabId === recordingTab && !isActivelyRecording && !pendingRecording) {
        void chromeApi().storage.local.set({ recordingTab: null });
      }

      const pendingOnly = pendingRecording && !isActivelyRecording && !restarting;
      if (tabId === recordingTab && pendingOnly) {
        await chromeApi().storage.local.set({
          pendingRecording: false,
          recording: false,
          recordingTab: null,
          tabRecordedID: null,
          recordingUiTabId: null,
        });
        void chromeApi().action.setIcon({ path: "assets/icon-34.png" });

        const candidateTabs = [activeTab, recordingUiTabId, tabRecordedID]
          .map(Number)
          .filter((id, idx, arr) => Number.isInteger(id) && id > 0 && arr.indexOf(id) === idx);
        candidateTabs.forEach((id) => {
          sendMessageTab(id, { type: "stop-pending" }).catch(() => {});
        });
      }
    } catch (error) {
      console.error(
        "Error handling tab removal:",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
};
