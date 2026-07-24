import { sendMessageRecord } from "./sendMessageRecord";
import { resetActiveTabRestart } from "../tabManagement/resetActiveTab";
import { diagEvent } from "../../utils/diagnosticLog";
import { lifecycle } from "../../utils/lifecycleLog";
import { resetWatchdogState } from "./resetWatchdogState";

const RESTART_ACK_TIMEOUT_MS = 7000;
const RESTART_HISTORY_MAX = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

interface RestartMessage extends Record<string, unknown> {
  sourceTabId?: number;
}

class RestartError extends Error {
  recorderState: unknown = null;
  stage = "send-error";
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("restart-ack-timeout")), timeoutMs);
    }),
  ]);

const persistRestartFlow = async (
  phase: string,
  details: Record<string, unknown> = {},
): Promise<void> => {
  const entry = { phase, ts: Date.now(), ...details };
  try {
    const { restartFlowHistory } = await chrome.storage.local.get(["restartFlowHistory"]);
    const history = Array.isArray(restartFlowHistory) ? restartFlowHistory : [];
    history.push(entry);
    while (history.length > RESTART_HISTORY_MAX) history.shift();
    await chrome.storage.local.set({
      lastRestartFlow: entry,
      restartFlowHistory: history,
    });
  } catch {}
};

const resolveSourceTabId = (
  message: RestartMessage,
  sender: chrome.runtime.MessageSender | null,
): number | null => message?.sourceTabId || sender?.tab?.id || null;

export const handleRestart = async (
  message: RestartMessage = {},
  sender: chrome.runtime.MessageSender | null = null,
) => {
  const sourceTabId = resolveSourceTabId(message, sender);
  const attemptId = `restart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let preflight: Record<string, unknown> = {};
  try {
    preflight = await chrome.storage.local.get([
      "recordingTab",
      "recording",
      "pendingRecording",
      "offscreen",
      "recorderSession",
    ]);
  } catch {}
  const recorderSession = isRecord(preflight.recorderSession) ? preflight.recorderSession : null;
  const preflightSummary = {
    recordingTab: preflight.recordingTab ?? null,
    recording: Boolean(preflight.recording),
    pendingRecording: Boolean(preflight.pendingRecording),
    offscreen: Boolean(preflight.offscreen),
    recorderSessionTab: recorderSession?.recorderTabId || recorderSession?.tabId || null,
  };

  // reset before round-trip so a mid-flight alarm can't fire tier-3 against stale keys
  await resetWatchdogState();
  // Snapshot multi state before restart, re-pin after. Several
  // paths during restart (offscreen discard cascade, watchdogs)
  // write multiMode:false because they miss the recording-in-progress
  // signals; without re-pin, restarting scene N (N>1) wipes everything.
  const multiSnapshot = await chrome.storage.local.get([
    "multiMode",
    "multiSceneCount",
    "multiProjectId",
    "multiLastSceneId",
  ]);
  await chrome.storage.local.set({
    restarting: true,
    ...(sourceTabId != null ? { activeTab: sourceTabId, recordingUiTabId: sourceTabId } : {}),
    // Re-pin in the same batch so anything reading immediately sees
    // the preserved state.
    ...(multiSnapshot.multiMode
      ? {
          multiMode: multiSnapshot.multiMode,
          multiSceneCount: multiSnapshot.multiSceneCount,
          multiProjectId: multiSnapshot.multiProjectId,
          multiLastSceneId: multiSnapshot.multiLastSceneId,
        }
      : {}),
  });
  await persistRestartFlow("requested", {
    attemptId,
    sourceTabId,
    preflight: preflightSummary,
  });
  lifecycle("BG.restart", "requested", {
    attemptId,
    sourceTabId,
    ...preflightSummary,
  });
  diagEvent("restart-requested", { attemptId, sourceTabId });

  try {
    const rawResponse = await withTimeout(
      sendMessageRecord({
        type: "restart-recording-tab",
        sourceTabId,
        attemptId,
      }),
      RESTART_ACK_TIMEOUT_MS,
    );
    const response = isRecord(rawResponse) ? rawResponse : {};

    lifecycle("BG.restart", "ack-received", {
      attemptId,
      ok: Boolean(response?.ok),
      restarted: Boolean(response?.restarted),
      error: response?.error || null,
      recorderState: response?.recorderState || null,
    });

    if (!response?.ok || response?.restarted !== true) {
      const err = new RestartError(String(response.error || "restart-ack-failed"));
      err.recorderState = response.recorderState || null;
      err.stage = "ack-rejected";
      throw err;
    }

    await persistRestartFlow("ack", {
      attemptId,
      sourceTabId,
      restarted: Boolean(response?.restarted),
      recorderState: response?.recorderState || null,
    });
    await resetActiveTabRestart({ sourceTabId: sourceTabId ?? undefined });
    // Second re-pin after the round-trip. If any handler reachable
    // during dismissRecording -> discardOffscreen
    // path cleared the multi keys, restore them so the upcoming
    // stop's preserveMultiProject check sees the correct count.
    if (multiSnapshot.multiMode) {
      try {
        const afterRoundTrip = await chrome.storage.local.get([
          "multiMode",
          "multiSceneCount",
          "multiProjectId",
        ]);
        const lostMulti =
          !afterRoundTrip.multiMode ||
          (Number(multiSnapshot.multiSceneCount) > 0 &&
            !(Number(afterRoundTrip.multiSceneCount) > 0)) ||
          (multiSnapshot.multiProjectId && !afterRoundTrip.multiProjectId);
        if (lostMulti) {
          await chrome.storage.local.set({
            multiMode: multiSnapshot.multiMode,
            multiSceneCount: multiSnapshot.multiSceneCount,
            multiProjectId: multiSnapshot.multiProjectId,
            multiLastSceneId: multiSnapshot.multiLastSceneId,
          });
          lifecycle("BG.restart", "multi-state-restored", {
            attemptId,
            before: multiSnapshot,
            afterRoundTrip,
          });
        }
      } catch {}
    }
    await persistRestartFlow("countdown-dispatched", { attemptId, sourceTabId });
    lifecycle("BG.restart", "completed", { attemptId, sourceTabId });
    diagEvent("restart-completed", { attemptId });
    return { ok: true, restarted: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const restartError = error instanceof RestartError ? error : null;
    const stage =
      restartError?.stage ||
      (reason.includes("Receiving end does not exist") ||
      reason.includes("No tab with id") ||
      reason.includes("No recording tab available")
        ? "send-no-tab"
        : reason.includes("restart-ack-timeout")
          ? "ack-timeout"
          : "send-error");
    await chrome.storage.local.set({ restarting: false });
    await persistRestartFlow("failed", {
      attemptId,
      sourceTabId,
      stage,
      reason,
      recorderState: restartError?.recorderState || null,
    });
    lifecycle("BG.restart", "failed", {
      attemptId,
      sourceTabId,
      stage,
      reason,
      recorderState: restartError?.recorderState || null,
    });
    diagEvent("restart-failed", { attemptId, stage, reason });
    // Content caller is fire-and-forget; toast the user directly
    try {
      const targetTabId =
        sourceTabId || (await chrome.storage.local.get(["activeTab"])).activeTab || null;
      if (Number.isInteger(targetTabId)) {
        chrome.tabs
          .sendMessage(targetTabId as number, {
            type: "show-toast",
            message: chrome.i18n.getMessage("restartFailedToast"),
            timeout: 6000,
          })
          .catch(() => {});
      }
    } catch {}
    return { ok: false, error: reason, stage };
  }
};

export const handleRestartRecordingTab = async (
  message: RestartMessage,
  sender: chrome.runtime.MessageSender,
) => handleRestart(message, sender);
