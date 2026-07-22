import JSZip from "jszip";
import { registerMessage } from "../../../messaging/messageRouter";
import {
  LOCAL_PLAYBACK_MAX_BYTES,
  normalizeLocalPlaybackOffer,
  parseStoredLocalPlaybackOffer,
  type LocalPlaybackOffer,
} from "../../../messaging/localPlaybackProtocol";
import { perfMark, perfSpan } from "../../utils/perfMarks";
import {
  focusTab,
  createTab,
  resetActiveTab,
  resetActiveTabRestart,
  setSurface,
} from "../tabManagement";

import { startAfterCountdown, startRecording } from "../recording/startRecording";
import { noteCountdownStarted } from "../recording/countdownFallback";
import {
  handleStopRecordingTab,
  clearInMemoryEditorLock,
} from "../recording/stopRecording";
import { chunksStore } from "../recording/chunkHandler";
import { openExistingChunksStore } from "../../Recorder/recorderStorage/chooseChunksStore";
import { destroySessionDir } from "../../Recorder/recorderStorage/opfsKvStore";
import { addAlarmListener } from "../alarms/addAlarmListener";
import { cancelRecording, handleDismiss } from "../recording/cancelRecording";
import { handleDismissRecordingTab } from "../recording/discardRecording";
import { sendMessageRecord } from "../recording/sendMessageRecord";
import { acquireStreamForOffscreen } from "../offscreen/acquireStream";
import { registerProxyStorageHandlers } from "../offscreen/proxyStorageHandlers";
import { ensureRemuxOffscreen } from "../offscreen/ensureRemuxOffscreen";
import { forceProcessing } from "../recording/forceProcessing";
import {
  restartActiveTab,
  getCurrentTab,
  sendMessageTab,
} from "../tabManagement";
import {
  handleRestart,
} from "../recording/restartRecording";
import { checkRecording } from "../recording/checkRecording";
import {
  isPinned,
  getPlatformInfo,
  resizeWindow,
  checkAvailableMemory,
} from "../utils/browserHelpers";
import { requestDownload, downloadIndexedDB } from "../utils/downloadHelpers";
import { restoreRecording, checkRestore } from "../recording/restoreRecording";
import {
  LOCAL_PLAYBACK_KEY,
  LOCAL_PLAYBACK_EVENT_KEY,
  LOCAL_PLAYBACK_ALARM,
} from "../recording/localPlaybackConstants";
import { FIRST_CHUNK_WATCHDOG_ALARM, RECORDER_KEEPALIVE_ALARM } from "../alarms/alarmConstants";
import { desktopCapture } from "../recording/desktopCapture";
import {
  videoReady,
  handleGetStreamingData,
  handleRecordingError,
  handleRecordingComplete,
  handleOnGetPermissions,
  handlePip,
  checkCapturePermissions,
} from "../recording/recordingHelpers";
import { clearAllRecordings } from "../recording/chunkHandler";
import { setMicActiveTab } from "../tabManagement/tabHelpers";
import {
  getDiagnosticLog,
  getErrorSnapshot,
  getStorageFlags,
  diagEvent,
} from "../../utils/diagnosticLog";

const DEBUG_POSTSTOP = false;
// Gate for the start-flow / stop-flow / offscreen-diag console mirrors.
// Off in prod by default; set globalThis.SAYLESS_DEBUG_RECORDER for support.
const DEBUG_FLOW =
  process.env.NODE_ENV !== "production" ||
  (typeof globalThis !== "undefined" &&
    !!(globalThis as typeof globalThis & { SAYLESS_DEBUG_RECORDER?: boolean })
      .SAYLESS_DEBUG_RECORDER);
const DAY_MS = 86400000;

// Gating for the editor review prompt: only ask established users right after
// a smooth recording, stay quiet otherwise.
const REVIEW_GATE = {
  minInstallDays: 7, // installed at least this long (never reset by updates)
  minSuccessfulRecordingsNew: 2, // fresh installs: a small track record
  minSuccessfulRecordingsExisting: 1, // backfilled/existing users: one clean one
  recentFailureWindowDays: 7, // backstop; failure keys also reset each attempt
  reshowCooldownDays: [1, 7], // escalating gap (days) after the 1st, 2nd reveal
  maxShows: 3, // stop asking after this many un-acted reveals
  snoozeDays: 120, // "maybe later" pushes it out this far
};

const MAX_CAPTURED_CLICK_EVENTS = 500;

type LooseRecord = Record<string, unknown>;
const isLooseRecord = (value: unknown): value is LooseRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const asLooseRecord = (value: unknown): LooseRecord =>
  isLooseRecord(value) ? value : {};
const asNullableLooseRecord = (value: unknown): LooseRecord | null =>
  isLooseRecord(value) ? value : null;
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const asTabId = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value ? value : fallback;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const optionalStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;

function finiteNumber(value: unknown): number | null;
function finiteNumber(value: unknown, fallback: number): number;
function finiteNumber(
  value: unknown,
  fallback: number | null = null,
): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeClickActivityEvent = ({
  payload = {} as LooseRecord,
  recordingStartTime = 0,
  totalPausedMs = 0,
  paused = false,
  pausedAt = 0,
}: {
  payload?: LooseRecord;
  recordingStartTime?: unknown;
  totalPausedMs?: unknown;
  paused?: boolean;
  pausedAt?: unknown;
} = {}) => {
  const timestamp = finiteNumber(payload.timestamp, Date.now());
  const startTime = finiteNumber(recordingStartTime, 0);
  const basePaused = finiteNumber(totalPausedMs, 0) || 0;
  const pausedAtMs = finiteNumber(pausedAt, 0) || 0;
  const extraPaused =
    paused && pausedAtMs > 0 ? Math.max(0, timestamp - pausedAtMs) : 0;
  const elapsedSeconds =
    startTime > 0
      ? Math.max(0, (timestamp - startTime - basePaused - extraPaused) / 1000)
      : null;
  const x = finiteNumber(payload.x);
  const y = finiteNumber(payload.y);
  const viewportWidth = finiteNumber(payload.viewportWidth);
  const viewportHeight = finiteNumber(payload.viewportHeight);
  if (x == null || y == null) return null;

  return {
    type: "click",
    time: elapsedSeconds,
    timestamp,
    x,
    y,
    xRatio:
      viewportWidth !== null && viewportWidth > 0
        ? clamp01(x / viewportWidth)
        : null,
    yRatio:
      viewportHeight !== null && viewportHeight > 0
        ? clamp01(y / viewportHeight)
        : null,
    viewportWidth: viewportWidth || null,
    viewportHeight: viewportHeight || null,
    relativeToRegion: Boolean(payload.relativeToRegion),
    region: Boolean(payload.region),
    surface: typeof payload.surface === "string" ? payload.surface : "unknown",
    recordingWindowId: finiteNumber(payload.recordingWindowId),
    isTab: Boolean(payload.isTab),
  };
};

// Whether the user is eligible for the review prompt (the editor adds a final
// "used the result" gate). Any uncertain signal returns false; the failure keys
// below reset each attempt, so only the most recent recording counts.
const shouldShowReviewPrompt = async () => {
  try {
    const s = await chrome.storage.local.get([
      "reviewPromptState",
      "extensionInstalledAt",
      "successfulRecordingCount",
      "startFlowTrace",
      "lastRecordingError",
      "editorRecordingError",
      "lastChunkSendFailure",
      "recordingDegradedMode",
      "lastRecordingSalvaged",
    ]);
    const state = asLooseRecord(s.reviewPromptState);
    const now = Date.now();

    // Already reviewed, opted out, or routed to feedback: never ask again.
    if (state.done) return false;
    // Snoozed after a "maybe later".
    const snoozedUntil = finiteNumber(state.snoozedUntil, 0);
    if (snoozedUntil && now < snoozedUntil) return false;
    // Stop asking after maxShows un-acted reveals, widening the gap each time
    // (24h, then 7d), so a user who ignores it isn't asked repeatedly.
    const shownCount = finiteNumber(state.shownCount, 0);
    if (shownCount >= REVIEW_GATE.maxShows) return false;
    const lastShownAt = finiteNumber(state.lastShownAt, 0);
    if (lastShownAt) {
      const cooldownDays =
        REVIEW_GATE.reshowCooldownDays[
          Math.min(shownCount, REVIEW_GATE.reshowCooldownDays.length) - 1
        ] || 0;
      if (now - lastShownAt < cooldownDays * DAY_MS) return false;
    }

    // Established install. Existing users were backfilled to 0 so they pass
    // immediately; updates never reset this.
    const installedAt =
      typeof s.extensionInstalledAt === "number" ? s.extensionInstalledAt : now;
    const isExisting = installedAt === 0;
    if (now - installedAt < REVIEW_GATE.minInstallDays * DAY_MS) return false;

    // Track record. Install age already proves an existing user isn't a
    // newcomer, so they only need one clean recording; fresh installs need a
    // couple.
    const minRecordings = isExisting
      ? REVIEW_GATE.minSuccessfulRecordingsExisting
      : REVIEW_GATE.minSuccessfulRecordingsNew;
    if (Number(s.successfulRecordingCount || 0) < minRecordings) return false;

    // The last recording must not have explicitly failed. Region/other types
    // leave outcome "in-progress" (only tab/desktop set "ok"), so block on known
    // FAILURE outcomes rather than requiring "ok".
    const FAILURE_OUTCOMES = ["error", "stuck", "cancelled"];
    const startFlowTrace = asNullableLooseRecord(s.startFlowTrace);
    if (
      startFlowTrace &&
      typeof startFlowTrace.outcome === "string" &&
      FAILURE_OUTCOMES.includes(startFlowTrace.outcome)
    )
      return false;

    // No hard failure or degraded-output marker on the most recent recording.
    // (recordingDegradedMode stamps `.at`, the error keys stamp `.ts`.)
    const win = REVIEW_GATE.recentFailureWindowDays * DAY_MS;
    const recent = (e: LooseRecord | null | undefined): boolean => {
      if (!e) return false;
      const ts = typeof e.ts === "number" ? e.ts : e.at;
      return typeof ts === "number" && now - ts < win;
    };
    if (
      recent((s.lastRecordingError || null) as LooseRecord | null) ||
      recent((s.editorRecordingError || null) as LooseRecord | null) ||
      recent((s.lastChunkSendFailure || null) as LooseRecord | null) ||
      recent((s.recordingDegradedMode || null) as LooseRecord | null) ||
      recent((s.lastRecordingSalvaged || null) as LooseRecord | null)
    )
      return false;

    return true;
  } catch {
    return false;
  }
};

const STOP_RECORDING_TAB_DEBOUNCE_MS = 1200;
let stopRecordingTabInFlight = false;
let stopRecordingTabLastAt = 0;

const offerScreenStore = (offer: LocalPlaybackOffer | null) => {
  if (offer?.storageBackend === "opfs" && offer.opfsSessionId) {
    return openExistingChunksStore({
      sessionId: offer.opfsSessionId,
      track: "screen",
      backend: "opfs",
    }).store;
  }
  // Pre-migration default: this screen track used a localforage instance
  // sharing the regular Recorder's IDB DB / "chunks" store name. The
  // imported chunksStore matches that exactly.
  return chunksStore;
};

const isLocalPlaybackOfferExpired = (offer: LocalPlaybackOffer | null): boolean =>
  !offer || Number(offer.expiresAt || 0) <= Date.now();

const scheduleLocalPlaybackAlarm = async (
  offer: LocalPlaybackOffer,
): Promise<void> => {
  if (!offer?.expiresAt || !chrome.alarms?.create) return;
  try {
    await chrome.alarms.clear(LOCAL_PLAYBACK_ALARM);
    await chrome.alarms.create(LOCAL_PLAYBACK_ALARM, {
      when: Number(offer.expiresAt),
    });
  } catch (err) {
    console.warn("[SayLess][BG] Failed to schedule local playback alarm", err);
  }
};

const getStoredLocalPlaybackOffer = async (): Promise<LocalPlaybackOffer | null> => {
  const result = await chrome.storage.local.get([LOCAL_PLAYBACK_KEY]);
  return parseStoredLocalPlaybackOffer(result?.[LOCAL_PLAYBACK_KEY]);
};

const clearStoredLocalPlaybackOffer = async ({
  reason = "unknown",
  clearChunks = true,
  onlyIfOfferId = null,
}: {
  reason?: string;
  clearChunks?: boolean;
  onlyIfOfferId?: string | null;
} = {}) => {
  const existing = await getStoredLocalPlaybackOffer();
  if (onlyIfOfferId && existing?.offerId && existing.offerId !== onlyIfOfferId) {
    return { ok: true, skipped: true, reason: "offer-id-mismatch" };
  }

  await chrome.storage.local.remove([LOCAL_PLAYBACK_KEY]);
  if (chrome.alarms?.clear) {
    await chrome.alarms.clear(LOCAL_PLAYBACK_ALARM).catch(() => {});
  }

  if (clearChunks) {
    const targetStore = offerScreenStore(existing);
    await targetStore.clear().catch((err) => {
      console.warn(
        "[SayLess][BG] Failed to clear screen chunks while clearing local playback offer",
        err,
      );
    });
    if (
      existing?.storageBackend === "opfs" &&
      existing?.opfsSessionId
    ) {
      await destroySessionDir(existing.opfsSessionId).catch(() => {});
    }
  }

  await chrome.storage.local.set({
    [LOCAL_PLAYBACK_EVENT_KEY]: {
      event: "offer-cleared",
      reason,
      clearedAt: Date.now(),
      clearedOfferId: existing?.offerId || null,
      clearChunks: Boolean(clearChunks),
    },
  });

  if (existing?.offerId) {
    console.info("[SayLess][BG] Cleared local screen playback offer", {
      reason,
      offerId: existing.offerId,
      clearChunks: Boolean(clearChunks),
    });
  }

  return { ok: true, clearedOfferId: existing?.offerId || null };
};

const getValidLocalPlaybackOffer = async ({
  offerId = null,
  projectId = null,
  sceneId = null,
}: {
  offerId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
} = {}): Promise<LocalPlaybackOffer | null> => {
  const offer = await getStoredLocalPlaybackOffer();
  if (!offer) return null;

  if (isLocalPlaybackOfferExpired(offer)) {
    await clearStoredLocalPlaybackOffer({
      reason: "offer-expired",
      clearChunks: true,
      onlyIfOfferId: offer.offerId || null,
    });
    return null;
  }

  if (offerId && offer.offerId !== offerId) return null;
  if (projectId && offer.projectId !== projectId) return null;
  if (sceneId && offer.sceneId && offer.sceneId !== sceneId) return null;
  if (offer.trackType !== "screen") return null;
  if (!offer.chunkCount || !offer.estimatedBytes) return null;

  return offer;
};

const logStopRecordingTabEvent = (
  message: LooseRecord,
  sender: chrome.runtime.MessageSender,
): void => {
  try {
    const reason = message?.reason || "unknown";
    const senderTabId = message?.tabId || sender?.tab?.id || null;
    const senderUrl = sender?.url || null;
    const stack = new Error().stack;
    console.warn("[SayLess][BG] stop-recording-tab received", {
      reason,
      senderTabId,
      senderUrl,
    });
    chrome.storage.local.set({
      lastStopRecordingEvent: {
        reason,
        senderTabId,
        senderUrl,
        stack,
        ts: Date.now(),
      },
    });
  } catch (err) {
    console.warn("[SayLess][BG] stop-recording-tab logging failed", err);
  }
};

const setTabAutoDiscardableSafe = async (
  message: LooseRecord,
  sender: chrome.runtime.MessageSender,
): Promise<void> => {
  try {
    const tabId = sender?.tab?.id;
    const discardable = message?.discardable;

    if (!tabId || typeof discardable !== "boolean") return;

    await chrome.tabs.update(tabId, { autoDiscardable: discardable });
  } catch (err) {
    console.warn("Failed to set tab autoDiscardable:", err);
  }
};

let activeRecordingSession: LooseRecord | null = null;
let recordingTabListener: ((tabId: number) => void) | null = null;
let desktopCaptureInFlight = false;
let lastDesktopCaptureAt = 0;

const clearRecordingSession = (): void => {
  activeRecordingSession = null;
  if (recordingTabListener) {
    chrome.tabs.onRemoved.removeListener(recordingTabListener);
    recordingTabListener = null;
  }
};

const clearRecordingSessionSafe = async (
  reason = "unknown",
  details: LooseRecord = {},
): Promise<void> => {
  const prev = activeRecordingSession;
  clearRecordingSession();
  try {
    await chrome.storage.local.set({
      lastRecordingSessionClear: {
        ts: Date.now(),
        reason,
        previousSessionId: prev?.id || null,
        previousRecorderTabId: prev?.recorderTabId || prev?.tabId || null,
        ...details,
      },
    });
  } catch {}
};

const registerRecordingTabListener = (ownerTabId: number | null): void => {
  if (!ownerTabId) return;
  if (recordingTabListener) {
    chrome.tabs.onRemoved.removeListener(recordingTabListener);
    recordingTabListener = null;
  }
  recordingTabListener = (closedTabId: number) => {
    if (closedTabId === ownerTabId) {
      // chrome.runtime.sendMessage from the SW doesn't fire BG's own listeners,
      // so call the stop handler directly
      Promise.resolve(
        handleStopRecordingTab({
          reason: "recorder-owner-tab-closed",
          tabId: closedTabId,
        }),
      ).catch((err) => {
        console.error(
          "[SayLess][BG] handleStopRecordingTab failed in tab-removed",
          err,
        );
      });
      clearRecordingSessionSafe("owner-tab-removed", { closedTabId });
    }
  };
  chrome.tabs.onRemoved.addListener(recordingTabListener);
};

const isSessionRecording = (session: LooseRecord | null): boolean =>
  session?.status === "recording";

const doesTabExist = async (tabId: unknown): Promise<boolean> => {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.tabs.get(tabId as number);
    return true;
  } catch {
    return false;
  }
};

const normalizeIncomingSession = (
  incoming: LooseRecord = {},
  sender: chrome.runtime.MessageSender,
): LooseRecord => {
  const ownerTabId = incoming.recorderTabId || sender?.tab?.id || null;
  const capturedTabId = incoming.capturedTabId || incoming.tabId || null;
  return {
    ...incoming,
    recorderTabId: ownerTabId,
    capturedTabId,
    tabId: capturedTabId,
  };
};

const isActiveSessionAlive = async (session: LooseRecord): Promise<boolean> => {
  if (!session?.id) return false;
  const ownerTabId = session.recorderTabId || session.tabId || null;
  const ownerTabAlive = await doesTabExist(ownerTabId);
  const {
    recording,
    pendingRecording,
    restarting,
    recorderSession: storedSession,
  } = await chrome.storage.local.get([
    "recording",
    "pendingRecording",
    "restarting",
    "recorderSession",
  ]);
  const flagsActive = Boolean(recording || pendingRecording || restarting);
  const storedRecord = asNullableLooseRecord(storedSession);
  const storedMatches =
    storedRecord?.id === session.id && isSessionRecording(storedRecord);
  return ownerTabAlive && (storedMatches || flagsActive);
};

const resolveActiveSessionConflict = async (incomingSession: LooseRecord) => {
  if (!incomingSession?.id) {
    return { allow: true, staleRecovered: false };
  }

  if (!activeRecordingSession?.id) {
    const { recorderSession: storedSession } = await chrome.storage.local.get([
      "recorderSession",
    ]);
    const storedRecord = asNullableLooseRecord(storedSession);
    if (storedRecord?.id && isSessionRecording(storedRecord)) {
      activeRecordingSession = {
        ...storedRecord,
        recorderTabId: storedRecord.recorderTabId || storedRecord.tabId || null,
        capturedTabId:
          storedRecord.capturedTabId || storedRecord.tabId || null,
        tabId: storedRecord.capturedTabId || storedRecord.tabId || null,
      };
    }
  }

  if (!activeRecordingSession?.id) return { allow: true, staleRecovered: false };
  if (activeRecordingSession.id === incomingSession.id) {
    return { allow: true, staleRecovered: false };
  }

  if (!isSessionRecording(activeRecordingSession)) {
    await clearRecordingSessionSafe("non-recording-session-conflict");
    return { allow: true, staleRecovered: true };
  }

  const alive = await isActiveSessionAlive(activeRecordingSession);
  if (alive) {
    console.warn("[SayLess][BG] session_conflict_rejected", {
      activeId: activeRecordingSession.id,
      incomingId: incomingSession.id,
      activeRecorderTabId:
        activeRecordingSession.recorderTabId || activeRecordingSession.tabId,
    });
    return { allow: false, staleRecovered: false };
  }

  await clearRecordingSessionSafe("stale-conflict-recovered", {
    incomingId: incomingSession.id,
  });
  console.warn("[SayLess][BG] session_conflict_stale_recovered", {
    incomingId: incomingSession.id,
  });
  return { allow: true, staleRecovered: true };
};

export const copyToClipboard = (text: string): void => {
  if (!text) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    const tabId = tabs[0].id;
    if (tabId == null) return;
    chrome.scripting.executeScript({
      target: { tabId },
      func: (content) => {
        navigator.clipboard.writeText(content).catch((err) => {
          console.warn(
            "❌ Failed to copy to clipboard in content script:",
            err,
          );
        });
      },
      args: [text],
    });
  });
};

export const setupHandlers = () => {
  registerProxyStorageHandlers();
  registerMessage("desktop-capture", async (message, sender) => {
    const now = Date.now();
    if (desktopCaptureInFlight || now - lastDesktopCaptureAt < 1200) {
      return { ok: true, deduped: true };
    }

    desktopCaptureInFlight = true;
    lastDesktopCaptureAt = now;

    try {
      await desktopCapture({
        ...message,
        ...(sender?.tab?.id != null ? { initiatingTabId: sender.tab.id } : {}),
      });
      return { ok: true };
    } finally {
      setTimeout(() => {
        desktopCaptureInFlight = false;
      }, 1000);
    }
  });
  registerMessage("start-recorder-keepalive-alarm", async () => {
    try {
      await chrome.alarms.create(RECORDER_KEEPALIVE_ALARM, {
        periodInMinutes: 0.5, // fires every 30s
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  registerMessage("stop-recorder-keepalive-alarm", async () => {
    try {
      await chrome.alarms.clear(RECORDER_KEEPALIVE_ALARM);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  // Offscreen doc pings this to keep the SW alive during recording; just
  // receiving it resets the idle timer, so the body is a no-op.
  registerMessage("sw-keepalive", () => ({ ok: true }));

  registerMessage("click-event", async (message) => {
    const {
      recording,
      recordingStartTime,
      totalPausedMs,
      paused,
      pausedAt,
      clickEvents,
      recordingMeta,
    } = await chrome.storage.local.get([
      "recording",
      "recordingStartTime",
      "totalPausedMs",
      "paused",
      "pausedAt",
      "clickEvents",
      "recordingMeta",
    ]);
    if (!recording) return { ok: true, ignored: true };
    const event = normalizeClickActivityEvent({
      payload: asLooseRecord(message.payload),
      recordingStartTime,
      totalPausedMs,
      paused: Boolean(paused),
      pausedAt,
    });
    if (!event || event.time == null) return { ok: false, ignored: true };
    const nextEvents = Array.isArray(clickEvents) ? [...clickEvents, event] : [event];
    while (nextEvents.length > MAX_CAPTURED_CLICK_EVENTS) nextEvents.shift();
    const nextMeta =
      recordingMeta && typeof recordingMeta === "object"
        ? {
            ...recordingMeta,
            activityEvents: nextEvents,
          }
        : {
            type: "local",
            startedAt: Number(recordingStartTime) || Date.now(),
            activityEvents: nextEvents,
          };
    await chrome.storage.local.set({
      clickEvents: nextEvents,
      recordingMeta: nextMeta,
    });
    return { ok: true, count: nextEvents.length };
  });

  // Recorder contexts mirror each step of stop -> finalize -> close
  // sequence here so the timeline survives the tab's window.close().
  // Read the BG service worker console (chrome://extensions → service
  // worker → inspect) to see the full sequence end-to-end.
  registerMessage("stop-flow-tick", (message) => {
    if (!DEBUG_FLOW) return { ok: true };
    const t = message?.t ?? "?";
    const label = message?.label || "?";
    const extra = message?.extra || {};
    console.warn(`[stop-flow T+${t}ms] ${label}`, extra);
    return { ok: true };
  });

  // Mirror of start-flow events from recorder contexts. Same
  // rationale as stop-flow-tick: visible in BG console even when the
  // recorder tab closed before the user could read it.
  registerMessage("start-flow-tick", (message) => {
    if (!DEBUG_FLOW) return { ok: true };
    const event = message?.event || "?";
    const data = message?.data || {};
    const rawTimestamp = message.ts;
    const ts =
      typeof rawTimestamp === "string" || typeof rawTimestamp === "number"
        ? new Date(rawTimestamp).toISOString().slice(11, 23)
        : "??:??:??";
    console.warn(`[start-flow ${ts}] ${event}`, data);
    return { ok: true };
  });

  registerMessage("offscreen-diag", async (message) => {
    if (!DEBUG_FLOW) return { ok: true };
    let payloadStr;
    try {
      payloadStr = JSON.stringify(message.payload);
    } catch {
      payloadStr = String(message.payload);
    }
    console.warn("[SayLess][OffscreenDiag]", message.source, payloadStr);
    return { ok: true };
  });
  registerMessage("offscreen-ready", async () => {
    const { pendingOffscreenLoad } = await chrome.storage.local.get([
      "pendingOffscreenLoad",
    ]);
    if (!pendingOffscreenLoad) return { ok: true, delivered: false };
    await chrome.storage.local.set({ pendingOffscreenLoad: null });
    chrome.runtime.sendMessage(pendingOffscreenLoad).catch(() => {});
    return { ok: true, delivered: true };
  });
  // Offscreen recorder can't call chrome.scripting; SW proxies the viewport
  // probe so the recorder can size tab-capture constraints to the tab's
  // actual aspect ratio (avoiding the default 1920x1080 pillarbox).
  registerMessage("get-tab-viewport", async (message) => {
    const tabId = Number(message?.tabId);
    if (!Number.isFinite(tabId) || tabId < 0) {
      return { ok: false, error: "invalid-tab-id" };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          w: Math.round(window.innerWidth * (window.devicePixelRatio || 1)),
          h: Math.round(window.innerHeight * (window.devicePixelRatio || 1)),
        }),
      });
      const r = results?.[0]?.result;
      if (r && r.w > 0 && r.h > 0) {
        return { ok: true, width: r.w, height: r.h };
      }
      return { ok: false, error: "no-result" };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  registerMessage("offscreen-request-stream", async (message, sender) => {
    try {
      // anchor picker to user's tab, not the offscreen doc
      let initiatingTabId = asTabId(message.initiatingTabId);
      if (!initiatingTabId) {
        const { recordingUiTabId } = await chrome.storage.local.get([
          "recordingUiTabId",
        ]);
        initiatingTabId = asTabId(recordingUiTabId);
      }
      const result = await acquireStreamForOffscreen({
        mode: stringOr(message.mode, "screen"),
        sources: optionalStringArray(message.sources),
        initiatingTabId,
        targetTabId: asTabId(message.targetTabId),
      });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
  registerMessage("handle-restart", (message, sender) =>
    handleRestart(message, sender),
  );
  registerMessage("handle-dismiss", () => handleDismiss());
  registerMessage("reset-active-tab", () => resetActiveTab(false));
  registerMessage("reset-active-tab-restart", (message) =>
    resetActiveTabRestart(message),
  );
  registerMessage("video-ready", async (message) => {
    perfMark("BG.handlers video-ready.received");
    await videoReady();
    await clearRecordingSessionSafe("video-ready");
    // video-ready fires for every recorder type once finalized and playable, so
    // count successful recordings here instead of the tab-only start-flow "ok"
    // branch (which missed region recordings). Best-effort.
    try {
      const { successfulRecordingCount } = await chrome.storage.local.get(
        "successfulRecordingCount",
      );
      const prev =
        typeof successfulRecordingCount === "number"
          ? successfulRecordingCount
          : 0;
      await chrome.storage.local.set({
        successfulRecordingCount: prev + 1,
        lastSuccessfulRecordingAt: Date.now(),
      });
    } catch {}
  });

  // download-path remux request from sandbox; falls back to in-sandbox BufferTarget on failure
  registerMessage("remux-request", async (message) => {
    if (
      !message?.requestId ||
      !message?.inputFileName ||
      !message?.outputFileName
    ) {
      return { ok: false, error: "invalid-remux-request-payload" };
    }
    try {
      await ensureRemuxOffscreen();
    } catch (err) {
      return {
        ok: false,
        error: errorMessage(err || "ensure-offscreen-failed"),
      };
    }
    try {
      // deterministic timeout so a wedged offscreen can't hang the caller
      // forever. WebM is a full re-encode (minutes on large files), so it gets
      // a far longer ceiling than the packet-copy remux; the editor's
      // progress-reset stall guard catches a genuinely wedged conversion first.
      const isWebm = message.kind === "webm";
      const TIMEOUT_MS = isWebm ? 30 * 60_000 : 60_000;
      let timeoutId = null;
      try {
        const response = await Promise.race([
          chrome.runtime.sendMessage({
            type: isWebm ? "webm-start" : "remux-start",
            requestId: message.requestId,
            inputFileName: message.inputFileName,
            outputFileName: message.outputFileName,
          }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("remux-offscreen-timeout")),
              TIMEOUT_MS,
            );
          }),
        ]);
        return response || { ok: false, error: "no-offscreen-response" };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      return {
        ok: false,
        error: errorMessage(err || "forward-to-offscreen-failed"),
      };
    }
  });

  // pagehide from Region/Recorder.jsx; user navigated away from the recorded tab
  registerMessage("region-iframe-destroyed", async () => {
    const { recording, recorderSession, customRegion } =
      await chrome.storage.local.get([
        "recording",
        "recorderSession",
        "customRegion",
      ]);
    const recorderSessionRecord: LooseRecord | null =
      (recorderSession || null) as LooseRecord | null;
    const isActivelyRecording =
      recording || recorderSessionRecord?.status === "recording";
    if (!isActivelyRecording) return;
    // only customRegion hosts MediaRecorder in the iframe; plain tab capture lives
    // in the pinned recorder tab and must not be torn down by recorded-page navigation
    if (!customRegion) return;

    diagEvent("region-iframe-destroyed");
    clearInMemoryEditorLock();
    await chrome.storage.local.set({
      recording: false,
      customRegion: false,
      // recordingTab points to pinned recorder.html which didn't open the editor;
      // clear it so stopRecording() doesn't skip editor open

      recordingTab: null,
      postStopEditorOpening: false,
      postStopEditorOpened: false,
      recorderSession: recorderSession
        ? { ...recorderSession, status: "stopped" }
        : null,
    });

    // user navigated before any chunks persisted; toast instead of empty editor
    const chunkCount = await chunksStore.length().catch(() => 0);
    if (chunkCount === 0) {
      diagEvent("region-nav-no-chunks");
      const { activeTab, sandboxTab } = await chrome.storage.local.get([
        "activeTab",
        "sandboxTab",
      ]);
      const activeTabId = asTabId(activeTab);
      if (activeTabId !== null) {
        sendMessageTab(activeTabId, {
          type: "show-toast",
          message: chrome.i18n.getMessage("recordingTooShortToast"),
          timeout: 5000,
        }).catch(() => {});
      }
      // editor opened pre-unload would otherwise hang at "Preparing recording..."
      if (Number.isInteger(sandboxTab)) {
        try {
          await chrome.storage.local.set({
            editorRecordingError: {
              ts: Date.now(),
              sandboxTab,
              error: "stream-error",
              why: "Recording stopped before any data was captured",
              errorCode: "REC_REGION_NAV_NO_CHUNKS",
              source: "region-iframe-destroyed",
            },
          });
        } catch {}
      }
      return;
    }

    await videoReady();
  });

  registerMessage("start-recording", (message) => startRecording("start-recording-message"));
  registerMessage("countdown-finished", async (message) => {
    const { recording, restarting, pendingRecording } =
      await chrome.storage.local.get([
      "recording",
      "restarting",
      "pendingRecording",
    ]);
    const writeDecision = (
      reason: string,
      started: boolean,
      extra: LooseRecord = {},
    ) => {
      const decisionAt = Date.now();
      return chrome.storage.local.set({
        lastCountdownFinishedDecision: {
          ts: decisionAt,
          startedAt: started ? decisionAt : null,
          endedAt: message?.endedAt || null,
          acceptedCountdownFinishedAt: started,
          recording: Boolean(recording),
          restarting: Boolean(restarting),
          pendingRecording: Boolean(pendingRecording),
          started,
          reason,
          ...extra,
        },
      });
    };
    // restart leaves `recording: true` briefly from the previous session, so block
    // only when recording is active AND not restarting
    if (recording && !restarting) {
      diagEvent("countdown-finished", { skipped: true, reason: "already-recording" });
      await writeDecision("already-recording", false);
      return { ok: true, skipped: true };
    }
    // a delayed countdown-finished can fire long after stop; accepting it
    // starts a phantom recording that orphans the finished editor handoff.
    const endedAt = Number(message?.endedAt) || 0;
    const ageMs = endedAt > 0 ? Date.now() - endedAt : null;
    if (ageMs !== null && ageMs > 10000) {
      diagEvent("countdown-finished", {
        skipped: true,
        reason: "stale-dispatch",
        ageMs,
      });
      await writeDecision("stale-dispatch", false, { ageMs });
      return { ok: true, skipped: true };
    }
    diagEvent("countdown-finished", { skipped: false });
    const decisionAt = Date.now();
    // Don't block startAfterCountdown on the diagnostic write; the
    // Recorder doesn't read countdownFinishedAt until well after stream
    // setup (~hundreds of ms later), so fire-and-forget shaves a
    // storage IPC off the countdown→record critical path.
    chrome.storage.local.set({
      countdownFinishedAt: message?.endedAt || decisionAt,
      lastCountdownFinishedDecision: {
        ts: decisionAt,
        startedAt: decisionAt,
        endedAt: message?.endedAt || null,
        acceptedCountdownFinishedAt: true,
        recording: Boolean(recording),
        restarting: Boolean(restarting),
        pendingRecording: Boolean(pendingRecording),
        started: true,
      },
    });
    startAfterCountdown("countdown-finished");
    return { ok: true };
  });
  registerMessage("restarted", (message) => restartActiveTab(message));

  registerMessage(
    "get-streaming-data",
    async () => await handleGetStreamingData(),
  );
  registerMessage("cancel-recording", () => cancelRecording());
  registerMessage("stop-recording-tab", (message, sender, sendResponse) => {
    perfMark("BG.handlers stop-recording-tab.received", {
      reason: message?.reason || null,
      senderTabId: sender?.tab?.id || null,
    });
    logStopRecordingTabEvent(message, sender);
    const now = Date.now();
    if (
      stopRecordingTabInFlight ||
      now - stopRecordingTabLastAt < STOP_RECORDING_TAB_DEBOUNCE_MS
    ) {
      if (DEBUG_POSTSTOP) {
        console.warn(
          "[SayLess][BG] Suppressed duplicate stop-recording-tab message",
          {
            inFlight: stopRecordingTabInFlight,
            deltaMs: now - stopRecordingTabLastAt,
            reason: message?.reason || null,
          },
        );
      }
      sendResponse({ ok: true, deduped: true });
      return true;
    }

    stopRecordingTabInFlight = true;
    stopRecordingTabLastAt = now;
    Promise.resolve(handleStopRecordingTab(message))
      .catch((err) => {
        console.error("Failed to handle stop-recording-tab", err);
      })
      .finally(() => {
        stopRecordingTabInFlight = false;
        stopRecordingTabLastAt = Date.now();
      });
    sendResponse({ ok: true });
    return true;
  });
  registerMessage("dismiss-recording-tab", (message) =>
    handleDismissRecordingTab(message),
  );
  registerMessage("pause-recording-tab", () => {
    diagEvent("pause");
    return sendMessageRecord({ type: "pause-recording-tab" });
  });
  registerMessage("resume-recording-tab", () => {
    diagEvent("resume");
    return sendMessageRecord({ type: "resume-recording-tab" });
  });
  registerMessage("retry-finalize", () => {
    return sendMessageRecord({ type: "retry-finalize" });
  });
  registerMessage("export-finalize-diagnostics", () => {
    return sendMessageRecord({ type: "export-finalize-diagnostics" });
  });
  registerMessage("set-mic-active-tab", (message) =>
    setMicActiveTab({
      active: Boolean(message.active),
      defaultAudioInput:
        typeof message.defaultAudioInput === "string"
          ? message.defaultAudioInput
          : null,
    }),
  );

  registerMessage("diag-countdown-started", () => {
    diagEvent("countdown-started");
    // countdown started means stream setup is done; extend the fallback window
    // so it doesn't fire during countdown (and start the recording too early)
    noteCountdownStarted();
  });
  registerMessage("diag-countdown-cancelled", () => diagEvent("countdown-cancelled"));
  registerMessage("diag-editor-ready", (message) =>
    diagEvent("editor-load-ready", { path: message?.path || null }),
  );
  // prefix allowlist so a compromised context can't spoof lifecycle events
  registerMessage("diag-forward", (message) => {
    const ev = typeof message?.event === "string" ? message.event : null;
    if (!ev) return;
    const allowedPrefixes = [
      "sandbox-",
      "sw-",
      "opfs-",
      "recorder-",
      "camera-",
      "editor-",
      // AudioContext interrupt/resume from attachAudioContextWatchdog (page realm).
      "audiocontext-",
    ];
    if (!allowedPrefixes.some((p) => ev.startsWith(p))) return;
    diagEvent(ev, message?.data ?? null);
  });
  registerMessage("open-editor-recovery", async () => {
    const { editorRecoveryUrl } = await chrome.storage.local.get(["editorRecoveryUrl"]);
    if (!editorRecoveryUrl) return;
    chrome.storage.local.remove(["editorRecoveryUrl", "editorRecoveryAt"]);
    chrome.tabs.create({ url: String(editorRecoveryUrl), active: true });
  });
  registerMessage("recording-error", async (message) => {
    await handleRecordingError(message);
    await clearRecordingSessionSafe("recording-error", {
      error: message?.error || null,
    });
  });
  // camera bubble failed but recording is live; surface as toast, never tear down
  registerMessage("camera-bubble-unavailable", async (message) => {
    try {
      const { tabRecordedID, recordingUiTabId } = await chrome.storage.local.get([
        "tabRecordedID",
        "recordingUiTabId",
      ]);
      const target = tabRecordedID || recordingUiTabId;
      const targetTabId = asTabId(target);
      if (targetTabId !== null) {
        sendMessageTab(targetTabId, {
          type: "show-toast",
          message:
            chrome.i18n.getMessage("cameraUnavailableToast") ||
            "Camera disconnected. Still recording your screen.",
          timeout: 6000,
        }).catch((err) => {
          diagEvent("warning", {
            note: "camera-unavailable-toast undelivered",
            err: String(err).slice(0, 80),
          });
        });
      }
    } catch {}
  });
  registerMessage("on-get-permissions", (message) =>
    handleOnGetPermissions(message),
  );
  registerMessage(
    "recording-complete",
    async (message, sender) => {
      perfMark("BG.handlers recording-complete.received");
      return await handleRecordingComplete();
    },
  );
  registerMessage("check-recording", () => checkRecording());
  registerMessage("open-download-mp4", async () => {
    const tab = await createTab("download.html", true);
    if (!tab?.id) return;
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (info.status === "complete" && tabId === tab.id) {
        chrome.tabs.onUpdated.removeListener(listener);
        sendMessageTab(tab.id, { type: "recover-indexed-db-mp4" });
      }
    });
  });

  const openLocalHelp = () => createTab("setup.html", true);
  const openLocalDiagnostics = async (
    message: LooseRecord = {},
    source = "support",
  ) => {
    const request = {
      source,
      errorCode: message?.errorCode || null,
      errorWhy: message?.errorWhy || null,
      zipBundled: Boolean(message?.zipBundled),
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ lastLocalSupportRequest: request });
    try {
      const { activeTab, tabRecordedID, recordingUiTabId } =
        await chrome.storage.local.get([
          "activeTab",
          "tabRecordedID",
          "recordingUiTabId",
        ]);
      const target = tabRecordedID || recordingUiTabId || activeTab;
      const targetTabId = asTabId(target);
      if (targetTabId !== null) {
        sendMessageTab(targetTabId, {
          type: "show-toast",
          message: message?.zipBundled
            ? "Diagnostic ZIP saved locally."
            : "Support is local-only. Use Download troubleshooting data to save a diagnostic ZIP.",
          timeout: 7000,
        }).catch(() => {});
      }
    } catch {}
    return { ok: true, localOnly: true };
  };

  registerMessage("review-screenity", openLocalHelp);
  registerMessage("follow-twitter", openLocalHelp);
  registerMessage("open-processing-info", openLocalHelp);
  registerMessage("trim-info", openLocalHelp);
  registerMessage("chrome-update-info", openLocalHelp);
  registerMessage("set-surface", (message) =>
    setSurface({ surface: String(message.surface || "") }),
  );
  registerMessage("pip-ended", () => handlePip(false));
  registerMessage("pip-started", () => handlePip(true));
  registerMessage("open-help", openLocalHelp);
  registerMessage("memory-limit-help", openLocalHelp);
  registerMessage("open-home", () => createTab("playground.html", true));
  registerMessage("report-bug", (message) =>
    openLocalDiagnostics(message, stringOr(message.source, "settings")),
  );
  registerMessage("report-error", (message) =>
    openLocalDiagnostics(message, stringOr(message.source, "error-modal")),
  );
  registerMessage("clear-recordings", () => clearAllRecordings());
  registerMessage("force-processing", () => forceProcessing());
  registerMessage("focus-this-tab", (message, sender) =>
    focusTab(sender.tab?.id ?? null),
  );
  registerMessage("indexed-db-download", () => downloadIndexedDB());
  registerMessage("get-platform-info", async () => {
    // Include the manifest version so contexts that ask BG for platform info
    // (e.g. the offscreen recorder runtime) get an authoritative
    // version even if their own getManifest read comes back empty.
    const info = (await getPlatformInfo()) || {};
    let extVersion = null;
    try {
      extVersion = chrome.runtime.getManifest().version || null;
    } catch {}
    return { ...info, extVersion };
  });
  registerMessage(
    "get-diagnostic-log",
    async (_message, _sender, sendResponse) => {
      const log = await getDiagnosticLog();
      const errors = await getErrorSnapshot();
      const flags = await getStorageFlags();
      sendResponse({ log, errors, flags });
      return true;
    },
  );
  registerMessage("restore-recording", () => restoreRecording());
  registerMessage("check-restore", async (message, sender, sendResponse) => {
    const response = await checkRestore();
    sendResponse(response);
    return true;
  });
  registerMessage(
    "check-capture-permissions",
    async (message, sender, sendResponse) => {
      const response = await checkCapturePermissions();

      sendResponse(response);
      return true;
    },
  );
  registerMessage("is-pinned", async () => await isPinned());

  // prevent Chrome from discarding the recorder tab while recording
  registerMessage("set-tab-auto-discardable", (message, sender) =>
    setTabAutoDiscardableSafe(message, sender),
  );

  registerMessage("request-download", (message) =>
    requestDownload(stringOr(message.base64, ""), optionalString(message.title)),
  );
  registerMessage("resize-window", (message) =>
    resizeWindow(finiteNumber(message.width, 0), finiteNumber(message.height, 0)),
  );
  registerMessage("available-memory", async () => {
    return await checkAvailableMemory();
  });
  registerMessage("extension-media-permissions", () =>
    createTab(
      `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`,
      true,
    ),
  );
  registerMessage("add-alarm-listener", () => addAlarmListener());
  function getMonitorForWindow(
    _message: LooseRecord,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): true {
    chrome.system.display.getInfo((displays) => {
      chrome.windows.getCurrent((win) => {
        if (!win || chrome.runtime.lastError) {
          console.warn(
            "[get-monitor-for-window] No window found",
            chrome.runtime.lastError,
          );
          sendResponse({ error: "No window found" });
          return;
        }

        const left = win.left ?? 0;
        const top = win.top ?? 0;
        const monitor = displays.find(
          (d) =>
            left >= d.bounds.left &&
            left < d.bounds.left + d.bounds.width &&
            top >= d.bounds.top &&
            top < d.bounds.top + d.bounds.height,
        );

        if (!monitor) {
          console.warn("[get-monitor-for-window] No matching monitor");
          sendResponse({ error: "No matching monitor" });
        } else {
          chrome.storage.local.set(
            {
              displays,
              recordedMonitorId: monitor.id,
              monitorBounds: monitor.bounds,
            },
            () => {
              sendResponse({
                monitorId: monitor.id,
                monitorBounds: monitor.bounds,
                displays,
              });
            },
          );
        }
      });
    });

    return true;
  }

  registerMessage("get-monitor-for-window", getMonitorForWindow);

  registerMessage("time-warning", async (message) => {
    const tab = await getCurrentTab();
    if (tab?.id) {
      await sendMessageTab(tab.id, {
        type: "time-warning",
      }).catch((e) => console.warn("Failed to send time-warning to tab:", e));
    }
  });
  registerMessage("time-stopped", async (message) => {
    const tab = await getCurrentTab();
    if (tab?.id) {
      await sendMessageTab(tab.id, {
        type: "time-stopped",
      }).catch((e) => console.warn("Failed to send time-stopped to tab:", e));
    }
  });
  registerMessage("preparing-recording", async () => {
    // getCurrentTab can return the pinned recorder tab; prefer stored activeTab
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);
    const tabId = asTabId(activeTab) || (await getCurrentTab())?.id || null;
    if (tabId !== null) {
      await sendMessageTab(tabId, {
        type: "preparing-recording",
      }).catch((e) =>
        console.warn("Failed to send preparing-recording to tab:", e),
      );
    }
  });
  registerMessage("local-playback-register", async (message) => {
    const normalizedOffer = normalizeLocalPlaybackOffer(message?.offer || {});
    if (!normalizedOffer.projectId || !normalizedOffer.sceneId) {
      return { ok: false, error: "missing-project-or-scene" };
    }
    if (!normalizedOffer.chunkCount || !normalizedOffer.estimatedBytes) {
      return { ok: false, error: "missing-local-screen-bytes" };
    }
    if (normalizedOffer.estimatedBytes > LOCAL_PLAYBACK_MAX_BYTES) {
      return {
        ok: false,
        error: "offer-too-large",
        maxBytes: LOCAL_PLAYBACK_MAX_BYTES,
      };
    }

    await chrome.storage.local.set({
      [LOCAL_PLAYBACK_KEY]: normalizedOffer,
      [LOCAL_PLAYBACK_EVENT_KEY]: {
        event: "offer-registered",
        at: Date.now(),
        offerId: normalizedOffer.offerId,
        projectId: normalizedOffer.projectId,
        sceneId: normalizedOffer.sceneId,
        chunkCount: normalizedOffer.chunkCount,
        estimatedBytes: normalizedOffer.estimatedBytes,
        expiresAt: normalizedOffer.expiresAt,
      },
    });
    await scheduleLocalPlaybackAlarm(normalizedOffer);

    console.info("[SayLess][BG] Registered local screen playback offer", {
      offerId: normalizedOffer.offerId,
      projectId: normalizedOffer.projectId,
      sceneId: normalizedOffer.sceneId,
      chunkCount: normalizedOffer.chunkCount,
      estimatedBytes: normalizedOffer.estimatedBytes,
      expiresAt: normalizedOffer.expiresAt,
    });

    return { ok: true, offer: normalizedOffer };
  });
  registerMessage("local-playback-clear", async (message) => {
    const result = await clearStoredLocalPlaybackOffer({
      reason: stringOr(message.reason, "explicit-clear"),
      clearChunks: message?.clearChunks !== false,
      onlyIfOfferId: nullableString(message.offerId),
    });
    return result;
  });
  registerMessage("local-playback-get-offer", async (message) => {
    const offer = await getValidLocalPlaybackOffer({
      offerId: nullableString(message.offerId),
      projectId: nullableString(message.projectId),
      sceneId: nullableString(message.sceneId),
    });
    if (!offer) {
      return { ok: false, error: "offer-unavailable" };
    }
    return { ok: true, offer };
  });
  registerMessage("local-playback-read-chunk", async (message) => {
    const offer = await getValidLocalPlaybackOffer({
      offerId: nullableString(message.offerId),
      projectId: nullableString(message.projectId),
      sceneId: nullableString(message.sceneId),
    });
    if (!offer) {
      return { ok: false, error: "offer-unavailable" };
    }

    const index = Number(message?.index);
    if (!Number.isInteger(index) || index < 0 || index >= offer.chunkCount) {
      return { ok: false, error: "chunk-index-out-of-range", index };
    }

    const targetStore = offerScreenStore(offer);
    const item = (await targetStore
      .getItem(`chunk_${index}`)
      .catch(() => null)) as LooseRecord | null;
    if (!item?.chunk) {
      return { ok: false, error: "chunk-missing", index };
    }

    // OPFS-stored Blobs come back with type "" (raw bytes); reconstruct
    // the mimeType from the offer's recorded container so the editor's
    // <video> element knows whether it's MP4 or WebM.
    const containerMime = offer.container || "video/webm";
    const rawChunk = item.chunk;
    let blob: Blob;
    if (rawChunk instanceof Blob && rawChunk.type) {
      blob = rawChunk;
    } else if (rawChunk instanceof Blob || rawChunk instanceof ArrayBuffer) {
      blob = new Blob([rawChunk], { type: containerMime });
    } else if (ArrayBuffer.isView(rawChunk)) {
      const copy = new Uint8Array(rawChunk.byteLength);
      copy.set(
        new Uint8Array(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength),
      );
      blob = new Blob([copy.buffer], { type: containerMime });
    } else {
      return { ok: false, error: "chunk-invalid", index };
    }
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        "",
      ),
    );

    return {
      ok: true,
      chunk: {
        index,
        size: blob.size,
        mimeType: blob.type || containerMime,
        base64,
      },
      offer: {
        offerId: offer.offerId,
        expiresAt: offer.expiresAt,
      },
    };
  });
  registerMessage("local-playback-mark-used", async (message) => {
    const offer = await getValidLocalPlaybackOffer({
      offerId: nullableString(message.offerId),
      projectId: nullableString(message.projectId),
      sceneId: nullableString(message.sceneId),
    });
    if (!offer) {
      return { ok: false, error: "offer-unavailable" };
    }
    const updated: LooseRecord = {
      ...offer,
      status: "used",
      usedAt: Date.now(),
      usedBy: message?.usedBy || "editor",
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({
      [LOCAL_PLAYBACK_KEY]: updated,
      [LOCAL_PLAYBACK_EVENT_KEY]: {
        event: "offer-used",
        at: Date.now(),
        offerId: updated.offerId,
        projectId: updated.projectId,
        sceneId: updated.sceneId,
      },
    });
    console.info("[SayLess][BG] Local screen playback offer marked used", {
      offerId: updated.offerId,
      projectId: updated.projectId,
      sceneId: updated.sceneId,
    });
    return { ok: true, offer: updated };
  });
  registerMessage("local-playback-mark-fallback", async (message) => {
    const offer = await getValidLocalPlaybackOffer({
      offerId: nullableString(message.offerId),
      projectId: nullableString(message.projectId),
      sceneId: nullableString(message.sceneId),
    });
    if (!offer) {
      return { ok: false, error: "offer-unavailable" };
    }
    const updated: LooseRecord = {
      ...offer,
      status: "fallback",
      fallbackReason: message?.reason || "unknown",
      fallbackAt: Date.now(),
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({
      [LOCAL_PLAYBACK_KEY]: updated,
      [LOCAL_PLAYBACK_EVENT_KEY]: {
        event: "offer-fallback",
        at: Date.now(),
        offerId: updated.offerId,
        reason: updated.fallbackReason,
      },
    });
    console.info("[SayLess][BG] Local screen playback offer fallback", {
      offerId: updated.offerId,
      reason: updated.fallbackReason,
    });
    return { ok: true, offer: updated };
  });
  registerMessage("check-banner-support", async (_message, _sender, sendResponse) => {
    const { bannerSupport } = await chrome.storage.local.get(["bannerSupport"]);
    sendResponse({ bannerSupport: Boolean(bannerSupport) });
    return true;
  });
  registerMessage("hide-banner", async () => {
    await chrome.storage.local.set({ bannerSupport: false });
    chrome.runtime.sendMessage({ type: "hide-banner" });
  });
  registerMessage("check-review-prompt", async () => {
    // This router uses the handler's RETURN value as the response (it calls
    // handler(message, sender, sendResponse), so the 2nd arg is `sender`, not a
    // response callback). So return the object; do not call sendResponse.
    return { showReview: await shouldShowReviewPrompt() };
  });
  registerMessage("review-prompt-action", async (message) => {
    const action = message?.action;
    const { reviewPromptState } = await chrome.storage.local.get([
      "reviewPromptState",
    ]);
    const next: LooseRecord = { ...((reviewPromptState || {}) as LooseRecord) };
    if (action === "shown") {
      next.lastShownAt = Date.now();
      next.shownCount = finiteNumber(next.shownCount, 0) + 1;
    } else if (action === "later") {
      // Thumbs-up but not now, so snooze for a long while.
      next.snoozedUntil = Date.now() + REVIEW_GATE.snoozeDays * DAY_MS;
    } else if (
      action === "reviewed" ||
      action === "dismiss" ||
      action === "feedback"
    ) {
      // Reviewed, opted out, or routed to feedback (unhappy): don't ask again.
      next.done = true;
    }
    await chrome.storage.local.set({ reviewPromptState: next });
  });
  registerMessage("review-feedback", () =>
    openLocalDiagnostics({ source: "review-prompt" }, "review-prompt"),
  );
  registerMessage("clear-recording-alarm", async () => {
    await chrome.alarms.clear("recording-alarm");
  });
  // extension pages can't message content scripts directly
  registerMessage("show-toast", async (message) => {
    try {
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      const activeTabId = asTabId(activeTab);
      if (activeTabId !== null) {
        sendMessageTab(activeTabId, {
          type: "show-toast",
          message: message.message,
          timeout: message.timeout,
        }).catch(() => {});
      }
    } catch {}
  });
  // Offscreen recorder can't mount the styled "record computer audio" Warning,
  // so it relays here and we forward to the content script's Warning component.
  registerMessage("show-audio-warning", async (message) => {
    try {
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      const activeTabId = asTabId(activeTab);
      if (activeTabId !== null) {
        sendMessageTab(activeTabId, {
          type: "show-audio-warning",
          variant: message.variant,
          timeout: message.timeout,
        }).catch(() => {});
      }
    } catch {}
  });
  registerMessage("finalize-failure", async (message) => {
    try {
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      const activeTabId = asTabId(activeTab);
      if (activeTabId !== null) {
        sendMessageTab(activeTabId, {
          type: "finalize-failure",
          reason: message.reason,
        }).catch(() => {});
      }
    } catch {}
  });
  registerMessage("finalize-recovered", async () => {
    try {
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      const activeTabId = asTabId(activeTab);
      if (activeTabId !== null) {
        sendMessageTab(activeTabId, { type: "finalize-recovered" }).catch(() => {});
      }
    } catch {}
  });
  registerMessage("get-tab-id", (message, sender, sendResponse) => {
    sendResponse({ tabId: sender?.tab?.id ?? null });
    return true;
  });
  registerMessage("sync-recording-state", async (_message, _sender, sendResponse) => {
    const {
      recording,
      paused,
      recordingStartTime,
      pausedAt,
      totalPausedMs,
      pendingRecording,
    } = await chrome.storage.local.get([
      "recording",
      "paused",
      "recordingStartTime",
      "pausedAt",
      "totalPausedMs",
      "pendingRecording",
    ]);
    sendResponse({
      recording: Boolean(recording),
      paused: Boolean(paused),
      recordingStartTime: recordingStartTime || null,
      pausedAt: pausedAt || null,
      totalPausedMs: totalPausedMs || 0,
      pendingRecording: Boolean(pendingRecording),
    });
    return true;
  });
  registerMessage(
    "register-recording-session",
    async (message, sender, sendResponse) => {
      const incoming = normalizeIncomingSession(
        asLooseRecord(message.session),
        sender,
      );
      const resolution = await resolveActiveSessionConflict(incoming);
      if (!resolution.allow) {
        sendResponse({
          ok: false,
          error: "Another recording session is already active",
          activeRecordingSession,
        });
        return true;
      }

      activeRecordingSession = incoming;
      registerRecordingTabListener(asTabId(incoming.recorderTabId));
      sendResponse({
        ok: true,
        session: activeRecordingSession,
        staleRecovered: resolution.staleRecovered,
      });
      return true;
    },
  );

  registerMessage(
    "clear-recording-session",
    async (message, sender, sendResponse) => {
      await clearRecordingSessionSafe(
        stringOr(message.reason, "clear-recording-session"),
      );
      sendResponse({ ok: true });
      return true;
    },
  );

  registerMessage(
    "clear-recording-session-safe",
    async (message, sender, sendResponse) => {
      await clearRecordingSessionSafe(
        stringOr(message.reason, "clear-recording-session-safe"),
        {
          sourceTabId: sender?.tab?.id || null,
        },
      );
      sendResponse({ ok: true });
      return true;
    },
  );

  registerMessage(
    "restore-recording-session",
    async (message, sender, sendResponse) => {
      const { recorderSession } = await chrome.storage.local.get([
        "recorderSession",
      ]);
      sendResponse({ recorderSession: recorderSession || null });
      return true;
    },
  );

  registerMessage("activate-recorder-tab", async (message, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId) {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch (err) {
        console.warn("[SayLess] activate-recorder-tab failed:", String(err));
      }
    }
  });

  registerMessage("start-first-chunk-watchdog", async () => {
    await chrome.alarms.clear(FIRST_CHUNK_WATCHDOG_ALARM).catch(() => {});
    await chrome.alarms.create(FIRST_CHUNK_WATCHDOG_ALARM, {
      delayInMinutes: 8 / 60,
    });
  });

  registerMessage("cancel-first-chunk-watchdog", async () => {
    await chrome.alarms.clear(FIRST_CHUNK_WATCHDOG_ALARM).catch(() => {});
  });

  // Zip in BG so jszip stays out of contentScript.bundle.js (~100KB).
  registerMessage("make-zip", async (message) => {
    try {
      const files = (message && message.files) || {};
      const filename =
        (message && typeof message.filename === "string"
          ? message.filename
          : null) || "sayless-bundle.zip";
      const zip = new JSZip();
      for (const [name, content] of Object.entries(files)) {
        if (typeof content === "string") {
          zip.file(name, content);
        } else if (content instanceof Uint8Array) {
          zip.file(name, content);
        } else if (content && typeof content === "object") {
          // Convenience: stringify plain objects so callers can pass
          // structured payloads directly.
          zip.file(name, JSON.stringify(content));
        }
      }
      // base64 because ArrayBuffer/Uint8Array structured-clone is
      // unreliable across MV3 SW → content (lands as empty {}).
      const base64 = await zip.generateAsync({ type: "base64" });
      return { ok: true, base64, filename };
    } catch (err) {
      console.warn("[make-zip] failed", err);
      return {
        ok: false,
        error: errorMessage(err).slice(0, 200),
      };
    }
  });

  // Receive perf entries from page contexts at pagehide; routed via
  // BG so the storage IPC completes (a dying page racing storage.set
  // drops the last few marks).
  registerMessage("perf-forward", async (message) => {
    try {
      const ctx = typeof message?.ctx === "string" ? message.ctx : "unknown";
      const entries = Array.isArray(message?.entries) ? message.entries : [];
      if (!entries.length) return;
      const key = `perfTimeline.${ctx}`;
      const r = await chrome.storage.local.get([key]);
      const cur = Array.isArray(r[key]) ? r[key] : [];
      for (const e of entries) cur.push(e);
      while (cur.length > 300) cur.shift();
      await chrome.storage.local.set({ [key]: cur });
    } catch {
      // Best-effort; perf data isn't user-facing functionality.
    }
  });
};
