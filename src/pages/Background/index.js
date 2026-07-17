import { initializeListeners } from "./listeners";
import { setupHandlers } from "./messaging/handlers";
import {
  messageRouter,
  messageDispatcher,
} from "../../messaging/messageRouter";
import { hydrateDiagnosticLog, diagEvent } from "../utils/diagnosticLog";
import { initCountdownFallback } from "./recording/countdownFallback";
import { initLifecycleObserver } from "./lifecycleObserver";
import {
  listSessionDirs,
  destroySessionDir,
} from "../Recorder/recorderStorage/opfsKvStore";
import { handleGetStreamingData } from "./recording/recordingHelpers";

// Don't tear down an in-flight start on SW restart: a fresh start is
// mid-setup (recorder tab not loaded yet), not dead. Mirrors the alarm
// watchdog's recordingStartingAt window (handleAlarm.js).
const ENABLE_START_GRACE_ON_INIT = true;
const START_GRACE_MS = 30_000;

// Must run before any message/alarm handler can bail on a stale lock.
const clearStaleLocks = async () => {
  try {
    const {
      sendingChunks,
      postStopEditorOpening,
      postStopEditorOpened,
      recording,
      pendingRecording,
      restarting,
      recordingTab,
      offscreen,
      multiMode,
      region,
      recordingStartingAt,
    } = await chrome.storage.local.get([
      "sendingChunks",
      "postStopEditorOpening",
      "postStopEditorOpened",
      "recording",
      "pendingRecording",
      "restarting",
      "recordingTab",
      "offscreen",
      "multiMode",
      "region",
      "recordingStartingAt",
    ]);

    const stale = {};
    if (sendingChunks) {
      stale.sendingChunks = false;
      console.warn("[SayLess][BG] Stale lock found on startup: sendingChunks, clearing");
    }
    if (postStopEditorOpening) {
      stale.postStopEditorOpening = false;
      console.warn("[SayLess][BG] Stale lock found on startup: postStopEditorOpening, clearing");
    }
    if (postStopEditorOpened) {
      stale.postStopEditorOpened = false;
      console.warn("[SayLess][BG] Stale lock found on startup: postStopEditorOpened, clearing");
    }

    // SW died mid-dispatch or tab closed
    if (recording || pendingRecording || restarting) {
      let recorderAlive = false;
      if (recordingTab) {
        try {
          await new Promise((resolve) => {
            chrome.tabs.get(recordingTab, (tab) => {
              recorderAlive = !chrome.runtime.lastError && Boolean(tab);
              resolve();
            });
          });
        } catch {
          recorderAlive = false;
        }
      }
      // Offscreen recordings have no recordingTab; the recorder lives in the
      // offscreen document. Pause idles the SW, which restarts and would
      // otherwise tear down a perfectly alive (paused) offscreen recording.
      // Treat the offscreen doc's existence as the recorder being alive.
      if (!recorderAlive && offscreen) {
        try {
          const contexts = await chrome.runtime.getContexts({});
          recorderAlive = (contexts || []).some(
            (c) => c.contextType === "OFFSCREEN_DOCUMENT",
          );
        } catch {}
      }
      // A start younger than START_GRACE_MS is mid-setup, not dead: the SW
      // restarted before the recorder tab came up. Wiping it here is what
      // surfaces as REC_START_FAILED under SW instability. Leave it; the
      // alarm watchdog (same window) and the recorder's 12s start gate
      // still catch a genuinely dead start.
      const startIsFresh =
        ENABLE_START_GRACE_ON_INIT &&
        typeof recordingStartingAt === "number" &&
        Date.now() - recordingStartingAt < START_GRACE_MS;
      if (!recorderAlive && startIsFresh) {
        console.warn(
          "[SayLess][BG] Stale-looking start on startup but within start grace, keeping",
          { recordingStartingAt, ageMs: Date.now() - recordingStartingAt },
        );
        diagEvent("sw-init-start-grace-kept", {
          ageMs: Date.now() - recordingStartingAt,
          recordingTab: recordingTab || null,
        });
      }
      if (!recorderAlive && !startIsFresh) {
        stale.recording = false;
        stale.pendingRecording = false;
        stale.restarting = false;
        stale.recordingTab = null;
        // stale stallLevel=1 from a prior crash would skip wake-aggressive next run
        stale.recordingStallLevel = 0;
        stale.firstChunkAt = null;
        stale.lastChunkAt = null;
        stale.customRegion = false;
        stale.offscreen = false;
        stale.memoryError = false;
        // keep editorRecordingError + sandboxTab; the editor reads them on mount
        // and onTabRemovedListener clears sandboxTab when the editor closes.
        stale.paused = false;
        stale.pausedAt = null;
        stale.totalPausedMs = 0;
        stale.tabRecordedID = null;
        stale.recordingUiTabId = null;
        console.warn(
          "[SayLess][BG] Stale recording state on startup (no live recorder tab or offscreen doc) - clearing",
          { recording, pendingRecording, restarting, recordingTab, offscreen },
        );
      }
    }

    if (multiMode && !recording) {
      stale.multiMode = false;
      stale.multiSceneCount = 0;
      stale.multiProjectId = null;
      stale.multiLastSceneId = null;
      console.warn("[SayLess][BG] Stale multi-mode state found on startup, clearing");
    }

    if (region && !recording) {
      stale.region = false;
      console.warn("[SayLess][BG] Stale region state found on startup, clearing");
    }

    if (Object.keys(stale).length > 0) {
      await chrome.storage.local.set(stale);
      console.info(
        "[SayLess][BG] Startup stale locks cleared:",
        Object.keys(stale).join(", "),
      );
    }

    // setIcon persists across SW restarts; reconcile so a stuck red icon clears
    try {
      const { recording: finalRecording } = await chrome.storage.local.get([
        "recording",
      ]);
      chrome.action.setIcon({
        path: finalRecording
          ? "assets/recording-logo.png"
          : "assets/icon-34.png",
      });
    } catch (err) {
      console.warn("[SayLess][BG] icon reconciliation failed:", err);
    }
  } catch (err) {
    console.error("[SayLess][BG] Failed to clear stale startup locks:", err);
  }
};

// SW death between opening the recorder tab and pushing streaming-data
// leaves the recorder stuck at "Starting recording...". Re-deliver
// `loaded` + streaming-data on next SW boot so it can complete the handshake.
const recoverInFlightRecording = async () => {
  try {
    const { pendingRecording, recording, recordingTab } =
      await chrome.storage.local.get([
        "pendingRecording",
        "recording",
        "recordingTab",
      ]);
    // Only the pre-active window needs recovery. Once recording=true the
    // streaming-data handshake already landed.
    if (!pendingRecording || recording || !recordingTab) return;
    let tab = null;
    try {
      tab = await chrome.tabs.get(recordingTab);
    } catch {
      return;
    }
    // Exact pathname match for the bundled recorder page.
    let recoveryTabUrl = null;
    try {
      recoveryTabUrl = tab?.url ? new URL(tab.url) : null;
    } catch {}
    const extOrigin = chrome.runtime.getURL("").replace(/\/$/, "");
    const recoveryPath = recoveryTabUrl?.pathname;
    const isRecoverableRecorder =
      recoveryTabUrl?.origin === extOrigin &&
      recoveryPath === "/recorder.html";
    if (!isRecoverableRecorder) return;
    diagEvent("sw-restart-recovery-redeliver-streaming-data", {
      recordingTab,
      tabUrl: tab?.url,
      status: tab?.status,
    });
    const { region, customRegion, tabRecordedID, recordingType } =
      await chrome.storage.local.get([
        "region",
        "customRegion",
        "tabRecordedID",
        "recordingType",
      ]);
    const isRegion = Boolean(region) && !customRegion;
    try {
      await chrome.tabs.sendMessage(recordingTab, {
        type: "loaded",
        request: { recordingType, region, customRegion },
        tabPreferred: false,
        ...(isRegion && tabRecordedID
          ? { isTab: true, tabID: tabRecordedID }
          : {}),
      });
    } catch (err) {
      console.warn("[SayLess][BG] redeliver loaded failed:", err);
    }
    // Both recorder pages dedup streaming-data via streamingDataReceivedAt,
    // so a duplicate push is safe.
    handleGetStreamingData().catch((err) => {
      console.warn("[SayLess][BG] redeliver streaming-data failed:", err);
    });
  } catch (err) {
    console.warn("[SayLess][BG] recoverInFlightRecording threw:", err);
  }
};

// Reaps OPFS session dirs not referenced by the latest recorderSession.
// without this, an SW kill mid-recording leaks chunks forever.
const cleanupOrphanOpfsSessions = async () => {
  try {
    const dirs = await listSessionDirs();
    if (!dirs.length) return;

    const all = await new Promise((resolve) => {
      try {
        chrome.storage.local.get(null, (snap) => resolve(snap || {}));
      } catch {
        resolve({});
      }
    });

    const liveIds = new Set();
    if (all.recorderSession?.id) liveIds.add(all.recorderSession.id);
    if (all.recorderSession?.opfsSessionId) {
      liveIds.add(all.recorderSession.opfsSessionId);
    }
    const orphans = dirs.filter((id) => !liveIds.has(id));
    if (!orphans.length) return;

    await Promise.allSettled(orphans.map((id) => destroySessionDir(id)));
    console.info(
      "[SayLess][BG] Reaped orphan OPFS recorder sessions:",
      orphans.length,
    );
  } catch (err) {
    console.warn(
      "[SayLess][BG] cleanupOrphanOpfsSessions failed:",
      err,
    );
  }
};

// listeners must register synchronously at module eval so Chrome counts them for SW keep-alive
messageRouter();
initializeListeners();
setupHandlers();
initCountdownFallback();
initLifecycleObserver();

// Recovery must run AFTER clearStaleLocks: if the recorder tab died
// with the SW, clearStaleLocks clears pendingRecording and recovery
// no-ops.
(async () => {
  await clearStaleLocks();
  await recoverInFlightRecording();
})();
cleanupOrphanOpfsSessions();

// 4.3.7 finalize-hang bug sticky-disabled WebCodecs for many users; clear once.
// User's explicit opt-out (useWebCodecsRecorder === false) is preserved by overwrite anyway.
const CURRENT_MIGRATION_VERSION = "4.3.9-clearStickyTransient3";
const runUpgradeMigrations = async () => {
  try {
    const { screenityMigratedForVersion } = await chrome.storage.local.get([
      "screenityMigratedForVersion",
    ]);
    if (screenityMigratedForVersion === CURRENT_MIGRATION_VERSION) return;

    await chrome.storage.local.remove([
      "fastRecorderDisabledForDevice",
      "fastRecorderDisabledReason",
      "fastRecorderDisabledAt",
      "fastRecorderDisabledDetails",
      "fastRecorderValidationFailed",
      "fastRecorderValidation",
      "lastWebCodecsFailureAt",
      "lastWebCodecsFailureCode",
      "lastFailedValidation",
      "useWebCodecsRecorder",
    ]);
    await chrome.storage.local.set({
      screenityMigratedForVersion: CURRENT_MIGRATION_VERSION,
    });
    console.info(
      "[SayLess][BG] Cleared stale 4.3.7 sticky-disable flags on upgrade",
    );
  } catch (err) {
    console.error("[SayLess][BG] Upgrade migration failed:", err);
  }
};
runUpgradeMigrations();

// records whether a recording was active when the previous SW shut down
hydrateDiagnosticLog().then(async () => {
  let priorState = null;
  try {
    const snap = await chrome.storage.local.get([
      "recording",
      "pendingRecording",
      "recordingTab",
      "recordingStartTime",
      "swLastSeenAt",
    ]);
    priorState = {
      recording: !!snap.recording,
      pendingRecording: !!snap.pendingRecording,
      hadRecordingTab: snap.recordingTab != null,
      msSinceLastBeat:
        typeof snap.swLastSeenAt === "number"
          ? Date.now() - snap.swLastSeenAt
          : null,
      msSinceRecordingStart:
        typeof snap.recordingStartTime === "number"
          ? Date.now() - snap.recordingStartTime
          : null,
    };
  } catch {}
  diagEvent("sw-init", { ts: Date.now(), priorState });
});

// alarms (not setInterval) so the SW can idle-evict between ticks
try {
  chrome.storage.local.set({ swLastSeenAt: Date.now() }).catch(() => {});
  chrome.alarms.create("sw-heartbeat", {
    periodInMinutes: 1,
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== "sw-heartbeat") return;
    chrome.storage.local.set({ swLastSeenAt: Date.now() }).catch(() => {});
  });
} catch {}
