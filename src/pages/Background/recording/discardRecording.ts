import { sendMessageRecord } from "./sendMessageRecord";
import { removeTab } from "../tabManagement/removeTab";
import { discardOffscreenDocuments } from "../offscreen/discardOffscreenDocuments";
import { resetWatchdogState } from "./resetWatchdogState";

interface DiscardChromeApi {
  action: { setIcon: (options: { path: string }) => Promise<void> };
  runtime: {
    getURL: (path: string) => string;
    sendMessage: (message: unknown) => Promise<unknown>;
  };
  tabs: {
    get: (tabId: number) => Promise<{ url?: string }>;
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
      remove: (keys: string[]) => Promise<void>;
    };
  };
}

const chromeApi = (): DiscardChromeApi =>
  (globalThis as typeof globalThis & { chrome: DiscardChromeApi }).chrome;

export const discardRecording = async ({
  reason = "discard",
  projectId = null,
}: { reason?: string; projectId?: string | null } = {}): Promise<void> => {
  // Back-to-back cross-talk guard: a discard issued for a previous recording
  // must not tear down the BG state of a newer one. If this discard provably
  // targets a different project than the one currently recording, skip it.
  // Unknown projectId (legacy callers / pre-project dismiss) is honored.
  if (projectId) {
    try {
      const { projectId: currentProjectId } = await chromeApi().storage.local.get([
        "projectId",
      ]);
      if (currentProjectId && currentProjectId !== projectId) {
        console.warn(
          "[SayLess][BG] discardRecording skipped: project mismatch",
          { reason, target: projectId, current: currentProjectId },
        );
        return;
      }
    } catch {}
  }

  // Swallow rejection: if the recorder tab is already dead, the promise
  // rejects and MV3 treats unhandled rejections as SW health signals.
  sendMessageRecord({ type: "dismiss-recording", reason, projectId }).catch(
    () => {},
  );
  void chromeApi().action.setIcon({ path: "assets/icon-34.png" });

  // await teardown before recording:false; otherwise handleAlarm fires against torn-down offscreen
  try {
    await discardOffscreenDocuments();
  } catch {}
  await resetWatchdogState();

  const { multiMode, multiSceneCount, recordingTab } =
    await chromeApi().storage.local.get([
      "multiMode",
      "multiSceneCount",
      "recordingTab",
    ]);

  if (recordingTab) {
    try {
      const tabId = Number(recordingTab);
      const tab = await chromeApi().tabs.get(tabId);
      if (tab?.url?.startsWith(chromeApi().runtime.getURL(""))) {
        void removeTab(tabId);
      }
    } catch {}
  }

  // keep multiMode but reset project state when no scenes saved yet
  const multiState = multiMode
    ? {
        multiMode: true,
        ...(Number(multiSceneCount) > 0 ? {} : {
          multiProjectId: null,
          multiLastSceneId: null,
        }),
      }
    : {
        multiMode: false,
        multiSceneCount: 0,
        multiProjectId: null,
        multiLastSceneId: null,
      };

  void chromeApi().storage.local.set({
    recordingTab: null,
    sandboxTab: null,
    recording: false,
    restarting: false,
    pendingRecording: false,
    offscreen: false,
    postStopEditorOpened: false,
    region: false,
    customRegion: false,
    memoryError: false,
    ...multiState,
  });
  void chromeApi().storage.local.set({ pipForceClose: Date.now() });
  void chromeApi().storage.local.set({ recordingUiTabId: null });
  void chromeApi().storage.local.remove(["recordingMeta", "clickEvents"]);

  void chromeApi().runtime.sendMessage({ type: "turn-off-pip" });
};

export const handleDismissRecordingTab = async (
  message: Record<string, unknown> = {},
): Promise<void> => {
  await discardRecording({
    reason:
      typeof message.reason === "string"
        ? message.reason
        : "dismiss-recording-tab",
    projectId: typeof message.projectId === "string" ? message.projectId : null,
  });
};
