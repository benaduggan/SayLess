import { registerMessage, messageRouter } from "../../../../messaging/messageRouter";
import {
  LOCAL_PLAYBACK_MAX_BYTES,
  parseLocalPlaybackChunk,
  parseStoredLocalPlaybackOffer,
  type ActiveLocalPlaybackSource,
  type LocalPlaybackOffer,
} from "../../../../messaging/localPlaybackProtocol";
import { setContentState, contentStateRef, setTimer } from "../ContentState";
import { updateFromStorage } from "../utils/updateFromStorage";

import { traceStep, setStartFlowOutcome } from "../../../utils/startFlowTrace";
import { perfMark } from "../../../utils/perfMarks";
import { triggerSupportDownload } from "../../../utils/triggerSupportDownload";

const getState = () => contentStateRef.current;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const senderId = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface LocalPlaybackSummary {
  available: boolean;
  trackType: "screen";
  offerId: string;
  projectId: string | null;
  sceneId: string | null;
  chunkCount: number;
  estimatedBytes: number;
  expiresAt: number | null;
  source: string;
}

interface LocalPlaybackLookup {
  offerId: string;
  projectId: string | null;
  sceneId: string | null;
}

interface PendingSceneCreate {
  respond: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const finiteNumber = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const parseLocalPlaybackSummary = (value: unknown): LocalPlaybackSummary | null => {
  if (!isRecord(value)) return null;
  const offerId = nonEmptyString(value.offerId);
  if (value.available !== true || value.trackType !== "screen" || !offerId) {
    return null;
  }
  return {
    available: true,
    trackType: "screen",
    offerId,
    projectId: nonEmptyString(value.projectId),
    sceneId: nonEmptyString(value.sceneId),
    chunkCount: Math.max(0, finiteNumber(value.chunkCount)),
    estimatedBytes: Math.max(0, finiteNumber(value.estimatedBytes)),
    expiresAt: finiteNumber(value.expiresAt) || null,
    source: nonEmptyString(value.source) || "indexeddb-screen-chunks",
  };
};

export const setupHandlers = () => {
  if (window.__screenitySetupHandlersRan) return;
  window.__screenitySetupHandlersRan = true;
  let lastToggleDrawingAt = 0;
  const TOGGLE_DRAWING_COOLDOWN_MS = 400;
  let projectReadySeq = 0;
  let latestLocalPlaybackOffer: LocalPlaybackSummary | null = null;
  let latestLocalPlaybackProjectId: string | null = null;
  let latestLocalPlaybackSceneId: string | null = null;
  let localPlaybackBuildPromise: Promise<ActiveLocalPlaybackSource> | null = null;
  let localPlaybackBuildOfferId: string | null = null;
  let activeLocalPlaybackSource: ActiveLocalPlaybackSource | null = null;
  const TRUSTED_APP_ORIGIN = null;

  const getProjectMessageTargetOrigin = () => {
    if (!TRUSTED_APP_ORIGIN) return null;
    return window.location.origin === TRUSTED_APP_ORIGIN ? TRUSTED_APP_ORIGIN : null;
  };

  const postProjectHandoff = (payload: UnknownRecord) => {
    const targetOrigin = getProjectMessageTargetOrigin();
    if (!targetOrigin) {
      console.warn("[SayLess][Content] Ignoring project handoff on untrusted origin", {
        source: nonEmptyString(payload.source) || "unknown",
        pageOrigin: window.location.origin,
        trustedOrigin: TRUSTED_APP_ORIGIN,
        projectId: nonEmptyString(payload.projectId),
      });
      return false;
    }

    window.postMessage(payload, targetOrigin);
    // Replay shortly after to reduce races with late listeners.
    setTimeout(() => {
      window.postMessage(
        {
          ...payload,
          replay: true,
          replayAt: Date.now(),
        },
        targetOrigin,
      );
    }, 250);
    return true;
  };

  const revokeActiveLocalPlaybackSource = (reason = "unknown") => {
    if (activeLocalPlaybackSource?.url) {
      URL.revokeObjectURL(activeLocalPlaybackSource.url);
      console.info("[SayLess][Content] Revoked local screen playback URL", {
        reason,
        offerId: activeLocalPlaybackSource.offerId || null,
      });
    }
    activeLocalPlaybackSource = null;
  };

  const markLocalPlaybackFallback = async ({
    offerId,
    projectId,
    sceneId,
    reason,
  }: LocalPlaybackLookup & { reason: string }) => {
    if (!offerId) return;
    try {
      await chrome.runtime.sendMessage({
        type: "local-playback-mark-fallback",
        offerId,
        projectId: projectId || null,
        sceneId: sceneId || null,
        reason: reason || "unknown",
      });
    } catch {}
  };

  const fetchLocalPlaybackSourceFromExtension = async ({
    offerId,
    projectId,
    sceneId,
  }: LocalPlaybackLookup): Promise<{
    offer: LocalPlaybackOffer;
    url: string;
    size: number;
    mimeType: string;
    chunkCount: number;
  }> => {
    const rawOfferResponse: unknown = await chrome.runtime.sendMessage({
      type: "local-playback-get-offer",
      offerId,
      projectId,
      sceneId,
    });
    if (!isRecord(rawOfferResponse) || rawOfferResponse.ok !== true) {
      throw new Error("local-playback-offer-unavailable");
    }
    const offer = parseStoredLocalPlaybackOffer(rawOfferResponse.offer);
    if (
      !offer ||
      !offer.chunkCount ||
      !offer.estimatedBytes ||
      offer.estimatedBytes > LOCAL_PLAYBACK_MAX_BYTES
    ) {
      throw new Error("local-playback-offer-too-large-or-empty");
    }

    const parts = [];
    for (let i = 0; i < offer.chunkCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rawChunkResponse: unknown = await chrome.runtime.sendMessage({
        type: "local-playback-read-chunk",
        offerId: offer.offerId,
        projectId: offer.projectId,
        sceneId: offer.sceneId,
        index: i,
      });
      const chunk =
        isRecord(rawChunkResponse) && rawChunkResponse.ok === true
          ? parseLocalPlaybackChunk(rawChunkResponse.chunk)
          : null;
      if (!chunk) {
        throw new Error(`local-playback-chunk-read-failed:${i}`);
      }
      const binary = atob(chunk.base64);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j += 1) {
        bytes[j] = binary.charCodeAt(j);
      }
      const mimeType = chunk.mimeType;
      parts.push(new Blob([bytes], { type: mimeType }));
    }

    const blob = new Blob(parts, {
      type: parts[0]?.type || "video/webm",
    });
    const url = URL.createObjectURL(blob);
    return {
      offer,
      url,
      size: blob.size || 0,
      mimeType: blob.type || "video/webm",
      chunkCount: parts.length,
    };
  };

  const ensureLocalPlaybackReady = async ({
    projectId,
    sceneId,
    offer,
  }: {
    projectId: string;
    sceneId: string | null;
    offer: LocalPlaybackSummary;
  }) => {
    if (!offer?.offerId) {
      throw new Error("local-playback-offer-missing");
    }

    if (activeLocalPlaybackSource?.offerId === offer.offerId && activeLocalPlaybackSource?.url) {
      return activeLocalPlaybackSource;
    }

    if (localPlaybackBuildPromise && localPlaybackBuildOfferId === offer.offerId) {
      return localPlaybackBuildPromise;
    }

    localPlaybackBuildOfferId = offer.offerId;
    localPlaybackBuildPromise = (async () => {
      const source = await fetchLocalPlaybackSourceFromExtension({
        offerId: offer.offerId,
        projectId,
        sceneId,
      });

      revokeActiveLocalPlaybackSource("new-offer");
      activeLocalPlaybackSource = {
        offerId: source.offer.offerId,
        projectId: source.offer.projectId || projectId || null,
        sceneId: source.offer.sceneId || sceneId || null,
        url: source.url,
        mimeType: source.mimeType,
        size: source.size,
        chunkCount: source.chunkCount,
        expiresAt: source.offer.expiresAt || null,
      };

      try {
        await chrome.runtime.sendMessage({
          type: "local-playback-mark-used",
          offerId: source.offer.offerId,
          projectId: source.offer.projectId || null,
          sceneId: source.offer.sceneId || null,
          usedBy: "app-editor",
        });
      } catch {}

      return activeLocalPlaybackSource;
    })();

    try {
      const ready = await localPlaybackBuildPromise;
      return ready;
    } finally {
      localPlaybackBuildPromise = null;
      localPlaybackBuildOfferId = null;
    }
  };

  const postLocalPlaybackHandoff = ({
    projectId,
    sceneId,
    offer,
    readySource = null,
    fallbackReason = null,
    forceRefresh = true,
  }: {
    projectId: string | null;
    sceneId: string | null;
    offer: LocalPlaybackSummary | LocalPlaybackOffer | null;
    readySource?: ActiveLocalPlaybackSource | null;
    fallbackReason?: string | null;
    forceRefresh?: boolean;
  }) =>
    postProjectHandoff({
      source: "update-project-ready-local-playback",
      projectId: projectId || null,
      sceneId: sceneId || null,
      forceRefresh,
      handoffAt: Date.now(),
      localPlayback: {
        available: Boolean(offer?.offerId),
        trackType: "screen",
        offerId: offer?.offerId || null,
        chunkCount: offer?.chunkCount || 0,
        estimatedBytes: offer?.estimatedBytes || 0,
        expiresAt: offer?.expiresAt || null,
        source: offer?.source || "indexeddb-screen-chunks",
        ready: Boolean(readySource?.url),
        url: readySource?.url || null,
        mimeType: readySource?.mimeType || null,
        localBytes: readySource?.size || null,
        fallbackReason: fallbackReason || null,
      },
    });

  // Pending scene-create handoffs awaiting reply from the editor page.
  // Keyed by requestId so concurrent multi-scene flows don't collide.
  const pendingSceneCreates = new Map<string, PendingSceneCreate>();

  const onWindowProjectMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (event.origin !== TRUSTED_APP_ORIGIN) return;
    const data = isRecord(event.data) ? event.data : {};

    if (data?.source === "create-scene-from-recording-result") {
      const requestId = nonEmptyString(data.requestId);
      if (requestId) {
        const pending = pendingSceneCreates.get(requestId);
        if (!pending) return;
        pendingSceneCreates.delete(requestId);
        clearTimeout(pending.timeout);
        pending.respond({
          ok: !!data.ok,
          status: data.status ?? 0,
          body: data.body ?? null,
          error: data.error || null,
        });
      }
      return;
    }

    if (data?.type !== "sayless-local-playback-request") return;

    const requestedProjectId = nonEmptyString(data.projectId);
    const requestedSceneId = nonEmptyString(data.sceneId);
    const requestId = nonEmptyString(data.requestId);
    const offer = latestLocalPlaybackOffer;

    if (
      !offer?.offerId ||
      !offer.available ||
      !requestedProjectId ||
      requestedProjectId !== latestLocalPlaybackProjectId ||
      (requestedSceneId &&
        latestLocalPlaybackSceneId &&
        requestedSceneId !== latestLocalPlaybackSceneId)
    ) {
      postProjectHandoff({
        source: "sayless-local-playback-response",
        requestId,
        projectId: requestedProjectId,
        sceneId: requestedSceneId,
        localPlayback: {
          available: false,
          trackType: "screen",
          fallbackReason: "offer-unavailable",
        },
      });
      return;
    }

    void ensureLocalPlaybackReady({
      projectId: requestedProjectId,
      sceneId: requestedSceneId || latestLocalPlaybackSceneId,
      offer,
    })
      .then((readySource) => {
        console.info("[SayLess][Content] Local screen playback used", {
          projectId: requestedProjectId,
          sceneId: requestedSceneId || latestLocalPlaybackSceneId || null,
          offerId: offer.offerId,
          bytes: readySource?.size || 0,
        });
        postProjectHandoff({
          source: "sayless-local-playback-response",
          requestId,
          projectId: requestedProjectId,
          sceneId: requestedSceneId || latestLocalPlaybackSceneId || null,
          forceRefresh: true,
          localPlayback: {
            available: true,
            ready: true,
            trackType: "screen",
            offerId: offer.offerId,
            url: readySource?.url || null,
            mimeType: readySource?.mimeType || null,
            localBytes: readySource?.size || null,
            chunkCount: offer.chunkCount || 0,
            estimatedBytes: offer.estimatedBytes || 0,
            expiresAt: offer.expiresAt || null,
            source: offer.source || "indexeddb-screen-chunks",
          },
        });
      })
      .catch((err) => {
        const reason = err?.message || "local-playback-build-failed";
        console.warn("[SayLess][Content] Local screen playback fallback", {
          projectId: requestedProjectId,
          sceneId: requestedSceneId || latestLocalPlaybackSceneId || null,
          offerId: offer.offerId,
          reason,
        });
        void markLocalPlaybackFallback({
          offerId: offer.offerId,
          projectId: requestedProjectId,
          sceneId: requestedSceneId || latestLocalPlaybackSceneId || null,
          reason,
        });
        postProjectHandoff({
          source: "sayless-local-playback-response",
          requestId,
          projectId: requestedProjectId,
          sceneId: requestedSceneId || latestLocalPlaybackSceneId || null,
          forceRefresh: true,
          localPlayback: {
            available: true,
            ready: false,
            trackType: "screen",
            offerId: offer.offerId,
            fallbackReason: reason,
          },
        });
      });
  };

  window.addEventListener("message", onWindowProjectMessage);
  window.addEventListener("beforeunload", () => {
    revokeActiveLocalPlaybackSource("content-beforeunload");
  });

  if (!window.__screenityHandlersInitialized) {
    messageRouter();
    window.__screenityHandlersInitialized = true;
  }

  // Bridge from BG to the editor page: BG forwards a scene-create payload
  // here; we postMessage it into the page (same-origin) so the editor's own
  // app code does the API call (cookie auth, no CORS, no SW lifecycle).
  registerMessage("proxy-create-scene", (message, sender) => {
    if (window.location.origin !== TRUSTED_APP_ORIGIN) {
      return { ok: false, error: "untrusted-origin" };
    }
    const projectId = nonEmptyString(message.projectId);
    const requestId = nonEmptyString(message.requestId);
    const payload = message.payload;
    if (!projectId || !requestId || !isRecord(payload)) {
      return { ok: false, error: "invalid-proxy-create-scene" };
    }
    return new Promise((resolve) => {
      const post = () => {
        window.postMessage(
          {
            source: "create-scene-from-recording",
            projectId,
            requestId,
            payload,
          },
          TRUSTED_APP_ORIGIN,
        );
      };
      // Repost on a 500ms cadence in case the editor app's listener
      // isn't mounted yet (?load=true loading shell, async route swap).
      // The pending entry gates against duplicate replies.
      post();
      const repost = setInterval(post, 500);
      const timeout = setTimeout(() => {
        if (pendingSceneCreates.has(requestId)) {
          pendingSceneCreates.delete(requestId);
          clearInterval(repost);
          resolve({ ok: false, error: "editor-no-reply-timeout" });
        }
      }, 15_000);
      pendingSceneCreates.set(requestId, {
        respond: (val: unknown) => {
          clearInterval(repost);
          resolve(val);
        },
        timeout,
      });
    });
  });

  registerMessage("time", () => {
    // Timer is driven by ContentState's storage tick;
    // ignore external pushes to avoid jitter/skips.
  });

  registerMessage("toggle-popup", async () => {
    // Reconcile from storage: a suspended tab may have missed the events
    // that clear finalizing/pending or sync multi-mode across tabs.
    let storageReconcile = null;
    let multiReconcile = null;
    try {
      const snap = await chrome.storage.local.get([
        "recording",
        "restarting",
        "multiMode",
        "multiSceneCount",
        "multiProjectId",
        "multiLastSceneId",
        "projectId",
      ]);
      if (!snap.recording && !snap.restarting) {
        storageReconcile = {
          finalizingRecording: false,
          preparingRecording: false,
          pendingRecording: false,
          restartingRecording: false,
          recording: false,
        };
        chrome.storage.local.set({ pendingRecording: false }).catch(() => {});
      }
      multiReconcile = {
        multiMode: Boolean(snap.multiMode),
        multiSceneCount: Number(snap.multiSceneCount) || 0,
        multiProjectId: snap.multiProjectId || null,
        multiLastSceneId: snap.multiLastSceneId || null,
      };
    } catch {}
    setContentState((prev) => ({
      ...prev,
      showExtension: !prev.showExtension,
      hasOpenedBefore: true,
      showPopup: true,
      ...storageReconcile,
      ...multiReconcile,
    }));
    setTimer(0);
    updateFromStorage();
  });

  registerMessage("ready-to-record", async () => {
    perfMark("Content ready-to-record.received");
    traceStep("readyToRecordReceived");

    setContentState((prev) => ({
      ...prev,
      showPopup: false,
      showExtension: true,
      preparingRecording: false,
      pendingRecording: true,
    }));

    // BG is source of truth; reading React default would race the user
    // setting and produce double beeps.
    const { countdown: storedCountdown } = await chrome.storage.local.get(["countdown"]);
    const state = getState();

    if (storedCountdown) {
      perfMark("Content countdown.start");
      traceStep("countdownStart");
      setContentState((prev) => ({
        ...prev,
        countdownActive: true,
        isCountdownVisible: true,
        countdownCancelled: false,
        // Latch: the pre-countdown loader must never re-show, or it bleeds
        // into the captured frame for region/desktop (stream already live).
        countdownEverShown: true,
      }));
      chrome.runtime.sendMessage({ type: "diag-countdown-started" }).catch(() => {});
    } else {
      // countdownCancelled is cleared in startStreaming, so not stale here.
      state.startRecordingAfterCountdown();
    }
  });

  registerMessage("stop-recording-tab", () => {
    const state = getState();
    if (!state.recording) return;
    state.stopRecording();
  });

  // Used to nest a second registerMessage call inside the handler,
  // which added a listener per fire and made the toggle fire N+1 times.
  registerMessage("toggle-drawing-mode", () => {
    const now = Date.now();
    if (now - lastToggleDrawingAt < TOGGLE_DRAWING_COOLDOWN_MS) {
      return;
    }
    lastToggleDrawingAt = now;
    if (document.hidden || !document.hasFocus()) {
      return;
    }
    if (contentStateRef.current.recordingType === "camera") return;
    const nextDrawingMode = !contentStateRef.current.drawingMode;
    setContentState((prev) => ({
      ...prev,
      drawingMode: nextDrawingMode,
      blurMode: nextDrawingMode ? false : prev.blurMode,
    }));
    chrome.storage.local.set({
      drawingMode: nextDrawingMode,
      ...(nextDrawingMode ? { blurMode: false } : {}),
    });
  });

  registerMessage("toggle-blur-mode", () => {
    if (contentStateRef.current.recordingType === "camera") return;
    const nextBlurMode = !contentStateRef.current.blurMode;
    setContentState((prev) => ({
      ...prev,
      blurMode: nextBlurMode,
      drawingMode: nextBlurMode ? false : prev.drawingMode,
    }));
    chrome.storage.local.set({
      blurMode: nextBlurMode,
      drawingMode: nextBlurMode ? false : contentStateRef.current.drawingMode,
    });
  });

  registerMessage("toggle-hide-ui", () => {
    const nextHideUI = !contentStateRef.current.hideUI;
    setContentState((prev) => ({
      ...prev,
      hideUI: nextHideUI,
      hideToolbar: nextHideUI ? true : prev.hideToolbar,
      hideUIAlerts: nextHideUI ? true : prev.hideUIAlerts,
    }));
    chrome.storage.local.set({
      hideUI: nextHideUI,
      ...(nextHideUI ? { hideToolbar: true, hideUIAlerts: true } : {}),
    });
  });

  registerMessage("toggle-cursor-mode", () => {
    if (contentStateRef.current.recordingType === "camera") return;
    const state = getState();
    const nextMode = contentStateRef.current.cursorMode === "none" ? "cursor" : "";
    if (state?.setToolbarMode) {
      state.setToolbarMode(nextMode);
    } else {
      setContentState((prev) => ({
        ...prev,
        toolbarMode: nextMode,
      }));
    }
  });

  registerMessage("recording-ended", async () => {
    const state = getState();

    // SW restart can leave stale state; double-check storage before reset.
    const { recording, recorderSession, pendingRecording } = await chrome.storage.local.get([
      "recording",
      "recorderSession",
      "pendingRecording",
    ]);

    const isActuallyRecording =
      recording || (isRecord(recorderSession) && recorderSession.status === "recording");

    if (isActuallyRecording || pendingRecording) {
      console.warn("Ignoring stale recording-ended message - recording still active");
      return;
    }

    if (!state.showPopup) {
      setContentState((prev) => ({
        ...prev,
        showExtension: false,
        recording: false,
        paused: false,
        pipEnded: false,
        time: 0,
        timer: 0,
      }));
    }
  });

  registerMessage("finalize-failure", () => {
    const state = getState();
    if (state && typeof state.openModal === "function") {
      state.openModal(
        "Recording couldn't finish",
        "Your recording is safe. Retry finalizing it, or export diagnostics to help us figure out what went wrong.",
        "Retry finalize",
        "Dismiss",
        () => {
          chrome.runtime.sendMessage({ type: "retry-finalize" });
          if (typeof state.openToast === "function") {
            state.openToast("Retrying finalize...", () => {}, 5000);
          }
        },
        () => {},
        null,
        null,
        null,
        true,
        "Export diagnostics",
        () => {
          chrome.runtime.sendMessage({ type: "export-finalize-diagnostics" });
        },
      );
    }
  });
  registerMessage("finalize-recovered", () => {
    const state = getState();
    if (state && typeof state.openToast === "function") {
      state.openToast("Upload complete.", () => {}, 4000);
    }
  });
  registerMessage("recording-error", () => {
    setStartFlowOutcome("error");
    setContentState((prev) => ({
      ...prev,
      pendingRecording: false,
      preparingRecording: false,
      recording: false,
      paused: false,
      time: 0,
      timer: 0,
      pipEnded: false,
    }));
    const state = getState();
    if (state && typeof state.openModal === "function") {
      state.openModal(
        chrome.i18n.getMessage("recordingFailedModalTitle"),
        chrome.i18n.getMessage("recordingFailedModalDescription"),
        chrome.i18n.getMessage("permissionsModalDismiss"),
        null,
        () => {},
        () => {},
        null,
        null,
        null,
        false,
        chrome.i18n.getMessage("getHelpButton"),
        () => {
          triggerSupportDownload({ source: "recording-failed" });
          chrome.runtime.sendMessage({
            type: "report-error",
            source: "recording-failed",
            errorCode: "REC_START_FAILED",
            zipBundled: true,
          });
        },
      );
    }
  });

  registerMessage("start-stream", () => {
    const state = getState();
    if (state.preparingRecording || state.pendingRecording || state.recording || state.pipEnded) {
      console.warn("[SayLess][Content] start-stream BLOCKED by guard state:", {
        preparingRecording: state.preparingRecording,
        pendingRecording: state.pendingRecording,
        recording: state.recording,
        pipEnded: state.pipEnded,
      });
      return;
    }

    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
    }));

    if (state.recordingType !== "camera") {
      state.startStreaming();
    } else if (state.defaultVideoInput !== "none" && state.cameraActive) {
      state.startStreaming();
    }
  });

  registerMessage("commands", (message) => {
    const commands = Array.isArray(message.commands) ? message.commands.filter(isRecord) : [];
    const findCommand = (name: string) => commands.find((command) => command.name === name);
    const shortcut = (command: UnknownRecord | undefined): string =>
      typeof command?.shortcut === "string" ? command.shortcut : "";

    const startRecordingCommand = findCommand("start-recording");
    const cancelRecordingCommand = findCommand("cancel-recording");
    const toggleDrawingModeCommand = findCommand("toggle-drawing-mode");
    const toggleBlurModeCommand = findCommand("toggle-blur-mode");
    const toggleCursorModeCommand = findCommand("toggle-cursor-mode");

    setContentState((prev) => ({
      ...prev,
      recordingShortcut: shortcut(startRecordingCommand),
      dismissRecordingShortcut: shortcut(cancelRecordingCommand),
      toggleDrawingModeShortcut: shortcut(toggleDrawingModeCommand),
      toggleBlurModeShortcut: shortcut(toggleBlurModeCommand),
      toggleCursorModeShortcut: shortcut(toggleCursorModeCommand),
    }));
  });

  registerMessage("cancel-recording", () => {
    const state = getState();
    state.dismissRecording("cancel-recording-cmd");
  });

  registerMessage("pause-recording", () => {
    const state = getState();
    if (state.paused) {
      state.resumeRecording();
    } else {
      state.pauseRecording();
    }
  });

  registerMessage("set-surface", (message) => {
    setContentState((prev) => ({
      ...prev,
      surface: message.surface,
    }));
  });

  registerMessage("pip-ended", () => {
    const state = getState();
    if (state.recording || state.pendingRecording) {
      setContentState((prev) => ({
        ...prev,
        pipEnded: true,
      }));
    }
  });

  registerMessage("pip-started", () => {
    const state = getState();
    if (state.recording || state.pendingRecording) {
      setContentState((prev) => ({
        ...prev,
        pipEnded: false,
      }));
    }
  });

  registerMessage("setup-complete", () => {
    setContentState((prev) => ({
      ...prev,
      showOnboardingArrow: true,
    }));
  });

  registerMessage("hide-popup-recording", () => {
    setContentState((prev) => ({
      ...prev,
      showPopup: false,
      showExtension: false,
      recording: false,
    }));
  });

  registerMessage("stream-error", (message) => {
    const state = getState();
    const errorCode = message?.errorCode || null;
    const errorWhy = message?.why || message?.error || null;

    state.openModal(
      chrome.i18n.getMessage("streamErrorModalTitle"),
      chrome.i18n.getMessage("streamErrorModalDescription"),
      chrome.i18n.getMessage("permissionsModalDismiss"),
      null,
      () => {
        state.dismissRecording("stream-error");
      },
      () => {
        state.dismissRecording("stream-error");
      },
      null,
      null,
      null,
      false,
      chrome.i18n.getMessage("getHelpButton"),
      () => {
        triggerSupportDownload({ source: "stream-error" });
        chrome.runtime.sendMessage({
          type: "report-error",
          errorCode,
          errorWhy,
          source: "stream-error",
          zipBundled: true,
        });
      },
    );
  });

  registerMessage("stream-ended-warning", (message) => {
    const state = getState();
    if (state.openToast) {
      state.openToast(
        message.message || chrome.i18n.getMessage("streamEndedWarningToast"),
        () => {},
        10000,
      );
    }
  });

  registerMessage("show-toast", (message) => {
    const state = getState();
    if (typeof state.openToast !== "function") return;
    state.openToast(message?.message || "", () => {}, message?.timeout || 5000);
  });
  // Offscreen recordings relay the system-audio guidance here so it shows in the
  // dedicated Warning component (dark pill + audio icon), matching the in-page
  // recorder, instead of a generic toast. i18n resolves natively in content.
  registerMessage("show-audio-warning", (message) => {
    const state = getState();
    const isMac = message?.variant === "mac";
    const title = chrome.i18n.getMessage(
      isMac ? "recordAudioWarningMacTitle" : "recordAudioWarningOtherTitle",
    );
    const description = chrome.i18n.getMessage(
      isMac ? "recordAudioWarningMacDescription" : "recordAudioWarningOtherDescription",
    );
    if (!description) return;
    const timeout = message?.timeout || 10000;
    if (typeof state.openWarning === "function") {
      state.openWarning(title, description, "AudioIcon", timeout);
    } else if (typeof state.openToast === "function") {
      state.openToast(description, () => {}, timeout);
    }
  });

  registerMessage("fast-recorder-hard-fail", async () => {
    const state = getState();
    if (typeof state.openModal !== "function") return;

    const downloadBundle = async () => {
      const userAgent = navigator.userAgent;
      let platformInfo = {};
      try {
        platformInfo = await chrome.runtime.sendMessage({
          type: "get-platform-info",
        });
      } catch {}

      const manifestInfo = chrome.runtime.getManifest().version;
      const fastRecorderData = await chrome.storage.local.get([
        "fastRecorderBeta",
        "fastRecorderDecision",
        "fastRecorderDisabledForDevice",
        "fastRecorderDisabledReason",
        "fastRecorderDisabledDetails",
        "fastRecorderDisabledAt",
        "fastRecorderProbe",
        "fastRecorderValidation",
        "fastRecorderValidationFailed",
        "fastRecorderInUse",
        "fastRecorderActiveRecordingId",
      ]);

      const data = {
        userAgent: userAgent,
        platformInfo: platformInfo,
        manifestInfo: manifestInfo,
        defaultAudioInput: state.defaultAudioInput,
        defaultAudioOutput: state.defaultAudioOutput,
        defaultVideoInput: state.defaultVideoInput,
        quality: state.quality,
        systemAudio: state.systemAudio,
        audioInput: state.audioInput,
        audioOutput: state.audioOutput,
        backgroundEffectsActive: state.backgroundEffectsActive,
        recording: state.recording,
        recordingType: state.recordingType,
        askForPermissions: state.askForPermissions,
        cameraPermission: state.cameraPermission,
        microphonePermission: state.microphonePermission,
        askMicrophone: state.askMicrophone,
        cursorMode: state.cursorMode,
        zoomEnabled: state.zoomEnabled,
        offscreenRecording: state.offscreenRecording,
        updateChrome: state.updateChrome,
        permissionsChecked: state.permissionsChecked,
        permissionsLoaded: state.permissionsLoaded,
        hideUI: state.hideUI,
        alarm: state.alarm,
        alarmTime: state.alarmTime,
        surface: state.surface,
        blurMode: state.blurMode,
        fastRecorder: fastRecorderData,
      };

      // Hand the zip step off to BG (see Background `make-zip` handler).
      // No JSZip in content; content collects fields, BG runs JSZip,
      // content downloads the resulting ArrayBuffer.
      const filename = "sayless-troubleshooting.zip";
      const resp = await chrome.runtime.sendMessage({
        type: "make-zip",
        files: { "troubleshooting.json": JSON.stringify(data) },
        filename,
      });
      if (!resp?.ok || typeof resp.base64 !== "string") {
        console.warn("[SayLess] troubleshooting zip failed:", resp?.error);
        return;
      }
      const bin = atob(resp.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);

      chrome.runtime.sendMessage({ type: "indexed-db-download" });
    };

    state.openModal(
      chrome.i18n.getMessage("fastRecorderFailedTitle"),
      chrome.i18n.getMessage("fastRecorderFailedDescription"),
      chrome.i18n.getMessage("downloadAnywayButton"),
      chrome.i18n.getMessage("cancelButton"),
      () => {
        chrome.runtime.sendMessage({ type: "open-download-mp4" });
      },
      () => {},
      null,
      null,
      null,
      true,
      chrome.i18n.getMessage("getHelpButton"),
      () => {
        triggerSupportDownload({ source: "fast-recorder-hard-fail" });
        chrome.runtime.sendMessage({
          type: "report-error",
          source: "fast-recorder-hard-fail",
          errorCode: "FAST_RECORDER_HARD_FAIL",
          zipBundled: true,
        });
      },
    );
  });

  registerMessage("recording-check", (message, sender) => {
    const state = getState();

    if (!message.force) {
      if (!state.showExtension && !state.recording) {
        updateFromStorage(true, sender.id);
      }
    } else {
      // Post-navigation, PiP is destroyed with the old iframe. Set pipEnded
      // so the inline camera overlay shows immediately; "pip-started" will
      // flip it back if the new iframe re-enters PiP.
      setContentState((prev) => ({
        ...prev,
        showExtension: true,
        recording: true,
        pipEnded: true,
      }));
      updateFromStorage(false, sender.id);
    }
  });

  registerMessage("stop-pending", () => {
    setStartFlowOutcome("error");
    setContentState((prev) => ({
      ...prev,
      pendingRecording: false,
      preparingRecording: false,
      pipEnded: false,
    }));
  });

  registerMessage("reopen-popup-multi", async (message) => {
    // Read multi-state from storage before setContentState so the popup's
    // first paint is correct (a fire-and-forget read would race the render).
    let storedMulti: UnknownRecord = {};
    try {
      storedMulti = await chrome.storage.local.get([
        "multiMode",
        "multiSceneCount",
        "multiProjectId",
        "multiLastSceneId",
        "projectId",
      ]);
    } catch {}
    // Order: clear all recording state (incl. finalizingRecording, or the
    // loader sticks for 30s), toast, then popup ~700ms later so toast settles.
    const isMulti = Boolean(storedMulti.multiMode);
    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
      finalizingRecording: false,
      preparingRecording: false,
      pendingRecording: false,
      recording: false,
      paused: false,
      time: 0,
      timer: 0,
      timeWarning: false,
      tabCaptureFrame: false,
      pipEnded: false,
      // Seed multi-mode + scene count + project id from storage. This
      // is the field set that gates the popup's "Done" button (uses
      // multiMode + multiSceneCount > 0); if either is stale, the
      // user sees the "Multi recording" switch instead of "Done".
      multiMode: isMulti,
      multiSceneCount: storedMulti.multiSceneCount || 0,
      multiProjectId: storedMulti.multiProjectId || null,
      multiLastSceneId: storedMulti.multiLastSceneId || null,
      projectId: storedMulti.projectId || prev.projectId,
      drawingMode: isMulti ? prev.drawingMode : false,
      blurMode: isMulti ? prev.blurMode : false,
      toolbarMode: isMulti ? prev.toolbarMode : "",
      cursorMode: isMulti ? prev.cursorMode : "none",
      cursorEffects: isMulti ? prev.cursorEffects : [],
      cameraActive: false,
    }));
    setTimer(0);
    try {
      const elements = document.querySelectorAll(".screenity-blur");
      elements.forEach((el) => el.classList.remove("screenity-blur"));
    } catch {}
    updateFromStorage(false, senderId(message.senderId));

    // Toast on top; auto-dismisses in 5s.
    const state = getState();
    if (state.openToast) {
      state.openToast(chrome.i18n.getMessage("addedToMultiToast"), () => {}, 5000);
    }
  });

  registerMessage("open-popup-project", (message) => {
    setContentState((prev) => ({
      ...prev,
      showExtension: true,
      showPopup: true,
      recordingProjectTitle: message.projectTitle,
      projectId: message.projectId,
      recordingToScene: message.recordingToScene,
      activeSceneId: message.activeSceneId,
    }));

    updateFromStorage(false, senderId(message.senderId));

    setTimeout(() => {
      const state = getState();
      if (state.openToast) {
        // Explicit 5s lifetime; see addedToMultiToast above.
        state.openToast(chrome.i18n.getMessage("readyRecordSceneToast"), () => {}, 5000);
      }
    }, 1000);
  });

  registerMessage("time-warning", () => {
    const state = getState();

    if (state.recording && !state.paused) {
      setContentState((prev) => ({
        ...prev,
        timeWarning: true,
      }));

      if (state.openToast) {
        state.openToast(chrome.i18n.getMessage("reachingRecordingLimitToast"), () => {}, 5000);
      }
    }
  });
  registerMessage("time-stopped", () => {
    const state = getState();
    if (state.recording && !state.paused) {
      setContentState((prev) => ({
        ...prev,
        timeWarning: false,
      }));

      if (state.openToast) {
        state.openToast(chrome.i18n.getMessage("recordingLimitReachedToast"), () => {}, 5000);
      }
    }
  });

  registerMessage("get-project-info", (message) => {
    const payload: UnknownRecord = {
      source: "get-project-info",
      requestedAt: Date.now(),
    };
    if (activeLocalPlaybackSource?.url && latestLocalPlaybackOffer?.offerId) {
      payload.localPlayback = {
        available: true,
        ready: true,
        trackType: "screen",
        offerId: latestLocalPlaybackOffer.offerId,
        url: activeLocalPlaybackSource.url,
        mimeType: activeLocalPlaybackSource.mimeType || "video/webm",
        localBytes: activeLocalPlaybackSource.size || null,
        chunkCount: latestLocalPlaybackOffer.chunkCount || 0,
        estimatedBytes: latestLocalPlaybackOffer.estimatedBytes || 0,
        expiresAt: latestLocalPlaybackOffer.expiresAt || null,
      };
    }
    postProjectHandoff(payload);
  });
  registerMessage("update-project-loading", (message, sender) => {
    // Editor listeners gate on projectId; drop it and the handoff
    // loader never surfaces.
    window.postMessage(
      {
        source: "update-project-loading",
        multiMode: message.multiMode,
        projectId: message.projectId || null,
      },
      "*",
    );

    if (!message.multiMode) {
      setContentState((prev) => ({
        ...prev,
        showExtension: false,
        showPopup: false,
      }));
    }

    updateFromStorage(true, sender.id);
  });
  registerMessage("update-project-ready", (message, sender) => {
    const projectId = nonEmptyString(message.projectId);
    if (!projectId) {
      console.warn("[SayLess][Content] Ignoring update-project-ready without projectId");
      return;
    }

    projectReadySeq += 1;
    const handoffAt = Date.now();
    const handoffId = `${projectId}:${handoffAt}:${projectReadySeq}`;
    const localPlayback = parseLocalPlaybackSummary(message.localPlayback);
    latestLocalPlaybackOffer = localPlayback;
    latestLocalPlaybackProjectId = latestLocalPlaybackOffer ? projectId : null;
    latestLocalPlaybackSceneId = latestLocalPlaybackOffer ? nonEmptyString(message.sceneId) : null;

    const posted = postProjectHandoff({
      source: "update-project-ready",
      share: message.share,
      newProject: message.newProject,
      sceneId: message.sceneId,
      projectId,
      localPlayback: localPlayback
        ? {
            ...localPlayback,
            ready:
              activeLocalPlaybackSource?.offerId === localPlayback.offerId &&
              Boolean(activeLocalPlaybackSource?.url),
            url:
              activeLocalPlaybackSource?.offerId === localPlayback.offerId
                ? activeLocalPlaybackSource.url
                : null,
            mimeType:
              activeLocalPlaybackSource?.offerId === localPlayback.offerId
                ? activeLocalPlaybackSource.mimeType || "video/webm"
                : null,
            localBytes:
              activeLocalPlaybackSource?.offerId === localPlayback.offerId
                ? activeLocalPlaybackSource.size || null
                : null,
          }
        : {
            available: false,
            trackType: "screen",
          },
      handoffAt,
      handoffId,
      handoffSeq: projectReadySeq,
      forceRefresh: true,
    });

    if (posted) {
      window.__screenityLastProjectReady = {
        projectId,
        sceneId: nonEmptyString(message.sceneId),
        handoffAt,
        handoffId,
        localPlaybackOfferId: localPlayback?.offerId || null,
      };
      updateFromStorage(false, sender?.id);
    }

    const capturedOffer = latestLocalPlaybackOffer;
    if (posted && capturedOffer?.offerId) {
      const capturedSceneId = nonEmptyString(message.sceneId);
      console.info("[SayLess][Content] Local screen playback offered", {
        projectId,
        sceneId: capturedSceneId,
        offerId: capturedOffer.offerId,
        chunkCount: capturedOffer.chunkCount || 0,
        estimatedBytes: capturedOffer.estimatedBytes || 0,
      });
      void ensureLocalPlaybackReady({
        projectId,
        sceneId: capturedSceneId,
        offer: capturedOffer,
      })
        .then((readySource) => {
          console.info("[SayLess][Content] Local screen playback ready", {
            projectId,
            sceneId: capturedSceneId,
            offerId: capturedOffer.offerId,
            bytes: readySource?.size || 0,
          });
          postLocalPlaybackHandoff({
            projectId,
            sceneId: capturedSceneId,
            offer: capturedOffer,
            readySource,
          });
        })
        .catch((err) => {
          const reason = errorMessage(err) || "local-playback-build-failed";
          console.warn("[SayLess][Content] Local screen playback fallback", {
            projectId,
            sceneId: capturedSceneId,
            offerId: capturedOffer.offerId,
            reason,
          });
          void markLocalPlaybackFallback({
            offerId: capturedOffer.offerId,
            projectId,
            sceneId: capturedSceneId,
            reason,
          });
          postLocalPlaybackHandoff({
            projectId,
            sceneId: capturedSceneId,
            offer: capturedOffer,
            fallbackReason: reason,
          });
        });
    }
  });
  registerMessage("clear-project-recording", (message) => {
    updateFromStorage(false, senderId(message.senderId));
  });
  registerMessage("preparing-recording", () => {
    traceStep("preparingReceived");
    setContentState((prev) => ({
      ...prev,
      preparingRecording: true,
      showExtension: true,
      showPopup: false,
    }));
  });
};
