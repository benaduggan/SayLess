import React, {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { useEffect } from "react";

import fixWebmDuration from "fix-webm-duration";
import { default as fixWebmDurationFallback } from "webm-duration-fix";

import localforage from "localforage";
import DevHUD from "../DevHUD";
import {
  formatLocalTimestamp,
  getHostnameFromUrl,
  sanitizeFilenameBase,
} from "../../utils/filenameHelpers";
import {
  debugRecordingEventWithSession,
  isRecordingDebugEnabled,
} from "../../utils/recordingDebug";
import type { RecordingDebugSession } from "../../utils/recordingDebug";
import { diagForward } from "../../utils/diagForward";
import { perfMark, perfSpan } from "../../utils/perfMarks";
import { triggerSupportDownload } from "../../utils/triggerSupportDownload";
import { saveBlobWithPicker } from "../../utils/localFileExport";
import { chooseReader } from "../recorderStorage/chooseReader";
import { runEditorOp } from "../editorOps";
import type { EditorOpMessage, Reply } from "../editorOps";
import {
  beginExportJobState,
  cancelExportJobState,
  dismissExportJobState,
  finishExportJobState,
  updateExportJobProgressState,
} from "./exportJobState";
import type {
  CreateExportJobOptions,
  ExportJobStatus,
} from "./exportJobState";
import {
  checkpointEditedLocalRecording,
  localRecordingIdFromBackendRef,
  readLocalRecordingBlob,
  registerLocalRecording,
  saveLocalRecordingEntry,
  getLocalRecordingIndex,
} from "../../localRecordings/localRecordingLibrary";
import type { LocalRecordingBackendRef } from "../../localRecordings/localRecordingLibrary";
import type {
  EditorContentContextValue,
  EditorContentState,
} from "./contentStateTypes";
import type { RecordingBackendRef } from "../recorderStorage/chunkReaderInterface";
import type { GifExportOptions } from "../../Editor/utils/toGIF";
// mediabunny is ~630KB, only used by export/remux/conversion on user action.
// Lazy-load to keep parse cost off editor mount. Cached promise.
let _mbPromise: Promise<typeof import("mediabunny")> | null = null;
const loadMb = (): Promise<typeof import("mediabunny")> => {
  if (!_mbPromise) _mbPromise = import("mediabunny");
  return _mbPromise;
};

// Pre-finalize the downloadable standard MP4 in the background on editor-ready
// so the MP4 download is an instant file-save instead of an on-click remux that
// can stall on large recordings. Flag-gated; download falls back to the on-
// demand remux and the fragmented file if disabled or if the finalize fails.
const ENABLE_EAGER_MP4_FINALIZE = true;

// Route the MP4 -> WebM re-encode through the offscreen worker (OPFS-streamed,
// bounded memory) instead of the in-editor BufferTarget path that OOMs on large
// files. On failure (incl. a 60s no-progress stall) the download falls back to
// delivering the source file, so it's safe to leave on.
const ENABLE_OFFSCREEN_WEBM = true;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const asRecordingBackendRef = (
  value: unknown,
): RecordingBackendRef | null => {
  if (!isRecord(value)) return null;
  if (value.backend !== "idb" && value.backend !== "opfs") return null;
  return {
    ...value,
    backend: value.backend,
    fileName: typeof value.fileName === "string" ? value.fileName : null,
  };
};

const asLocalRecordingBackendRef = (
  value: RecordingBackendRef | null,
): LocalRecordingBackendRef | null =>
  value?.backend === "opfs" && typeof value.fileName === "string"
    ? { backend: "opfs", fileName: value.fileName }
    : null;

interface FinalizeStatus {
  stage?: string;
  percent?: number;
  updatedAt?: unknown;
  error?: string;
}

interface FinalizeReadyResult {
  ok: boolean;
  error?: string;
}

interface EditorRuntimeMessage {
  type?: string;
  _targetTabId?: number;
  count?: number;
  override?: boolean;
  error?: unknown;
  errorCode?: unknown;
  why?: unknown;
  [key: string]: unknown;
}

interface StandardMp4Result {
  blob: Blob | null;
  path: string | null;
}

interface StandardMp4Cache extends StandardMp4Result {
  status: "pending" | "ready" | "failed";
  promise: Promise<StandardMp4Result>;
  forBlob: Blob;
}

type RuntimeSendResponse = (response?: unknown) => void;

const assertLocalExportObjectUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url.startsWith("blob:")) {
    throw new Error("Expected local blob export URL.");
  }
  return url;
};

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

const chunksStore = localforage.createInstance({
  name: "chunks",
  storeName: "keyvaluepairs",
});

export const ContentStateContext = createContext<EditorContentContextValue>(
  undefined as unknown as EditorContentContextValue,
);

const DEBUG_RECORDER =
  typeof window !== "undefined" ? !!window.SAYLESS_DEBUG_RECORDER : false;
const DEBUG_POSTSTOP = DEBUG_RECORDER;

const ContentState = ({
  children,
  viewer = false,
}: PropsWithChildren<{ viewer?: boolean }>) => {
  // Viewer mode (editor.html?view=1): playback only. Derived synchronously (not
  // in an effect) so it's set before the child's mount-time loadFFmpeg().
  const isViewer =
    viewer === true ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("view") === "1");

  const makeVideoCheck = useRef(false);
  const chunkCount = useRef(0);
  const recdbgSessionRef = useRef<RecordingDebugSession | null>(null);
  const tabIdRef = useRef<number | null>(null);
  const opIdRef = useRef(0);
  const editWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!DEBUG_RECORDER && !isRecordingDebugEnabled()) return;
    chrome.storage.local.get(
      ["recordingDebugSessionId", "recordingDebugStartMs"],
      (res) => {
        if (!res?.recordingDebugSessionId) return;
        recdbgSessionRef.current = {
          sessionId: String(res.recordingDebugSessionId),
          startTimeMs: Number(res.recordingDebugStartMs) || Date.now(),
          startPerfMs: null,
        };
      },
    );
  }, []);

  useEffect(() => {
    try {
      chrome.tabs.getCurrent((tab) => {
        tabIdRef.current = tab?.id || null;
      });
    } catch {}
  }, []);

  useEffect(() => {
    diagMountAtRef.current = Date.now();
    try {
      chrome.tabs.getCurrent((tab) => {
        diagForward("sandbox-open", {
          tabId: tab?.id ?? null,
          timestamp: diagMountAtRef.current,
        });
      });
    } catch {
      diagForward("sandbox-open", {
        tabId: null,
        timestamp: diagMountAtRef.current,
      });
    }

    const MAX_HEARTBEATS = 6;
    const HEARTBEAT_MS = 30000;
    const interval = setInterval(() => {
      const s = contentStateRef.current;
      if (s?.ready) {
        clearInterval(interval);
        return;
      }
      if (diagHeartbeatCountRef.current >= MAX_HEARTBEATS) {
        clearInterval(interval);
        // Stuck with no data after ~3 min. Show the same "couldn't load" error
        // the load-failure paths use instead of spinning forever.
        if (
          !s?.ready &&
          !editorErrorShownRef.current &&
          typeof s?.openModal === "function"
        ) {
          editorErrorShownRef.current = true;
          diagForward("sandbox-stuck-timeout-error", {});
          s.openModal(
            chrome.i18n.getMessage("opfsLoadErrorTitle"),
            chrome.i18n.getMessage("opfsLoadErrorDescription"),
            null,
            chrome.i18n.getMessage("permissionsModalDismiss"),
            () => {},
            () => {},
            null,
            null,
            null,
            true,
            chrome.i18n.getMessage("getHelpButton"),
            () => {
              triggerSupportDownload({ source: "editor-stuck-timeout" });
              chrome.runtime.sendMessage({
                type: "report-error",
                source: "editor-stuck-timeout",
                errorCode: "EDITOR_STUCK_TIMEOUT",
                zipBundled: true,
              });
            },
          );
          setContentState((prev) => ({
            ...prev,
            ready: true,
            recordingFailed: true,
          }));
        }
        return;
      }
      diagHeartbeatCountRef.current += 1;
      diagForward("sandbox-stuck-heartbeat", {
        chunkCount: s?.chunkCount ?? 0,
        chunkIndex: s?.chunkIndex ?? 0,
        hasRawBlob: Boolean(s?.rawBlob),
        hasBlob: Boolean(s?.blob),
        secondsSinceMount: Math.round(
          (Date.now() - (diagMountAtRef.current || Date.now())) / 1000,
        ),
      });
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!DEBUG_RECORDER && !isRecordingDebugEnabled()) return;
    window.__saylessExportRecordingDebug = async () => {
      const { recordingDebugSessionId } = await chrome.storage.local.get([
        "recordingDebugSessionId",
      ]);
      if (!recordingDebugSessionId) {
        // eslint-disable-next-line no-console
        console.warn("[Sandbox] No recording debug session id found.");
        return;
      }
      chrome.runtime.sendMessage({
        type: "export-recording-debug",
        sessionId: recordingDebugSessionId,
      });
    };
    window.__saylessPingRecdbg = () =>
      chrome.runtime.sendMessage({ type: "recdbg-ping" });
  }, []);

  // mediabunny streams the edit (no whole-blob RAM cap like ffmpeg), so one flat limit
  const MAX_EDIT_LIMIT_S = 3600;

  const defaultState = {
    time: 0,
    editLimit: 420,
    playerLoading: false,
    finalizingRecording: false,
    lastDownloadInfo: null,
    lastRecordingBackend: null,
    blob: null,
    webm: null,
    originalBlob: null,
    updatePlayerTime: false,
    start: 0,
    end: 1,
    trimming: false,
    cutting: false,
    muting: false,
    editErrorType: null, // null | "too-long" | "timeout" | "failed" | "audio-too-large"
    history: [{}],
    redoHistory: [],
    undoDisabled: true,
    redoDisabled: true,
    duration: 0,
    mode: "player",
    ffmpegLoaded: false,
    frame: null,
    pendingCropEntry: false,
    getFrame: null,
    openToast: null,
    isFfmpegRunning: false,
    reencoding: false,
    prevWidth: 0,
    width: 0,
    prevHeight: 0,
    height: 0,
    top: 0,
    left: 0,
    fromCropper: false,
    base64: null,
    downloading: false,
    downloadingWEBM: false,
    downloadingGIF: false,
    exportJob: null,
    lastExportDownloadId: null,
    preferFilePicker: false,
    volume: 1,
    cropPreset: "none",
    replaceAudio: false,
    title: null,
    ready: false,
    mp4ready: false,
    saved: false,
    offline: false,
    updateChrome: false,
    hasBeenEdited: false,
    dragInteracted: false,
    noffmpeg: false,
    processingProgress: 0,
    openModal: null,
    rawBlob: null,
    override: false,
    fallback: false,
    chunkCount: 0,
    chunkIndex: 0,
    bannerSupport: false,
    reviewPrompt: false,
    reviewEligible: false,
    backupBlob: null,
    recordingMeta: null,
    localRecordingId: null,
  } as unknown as EditorContentState;

  const [contentState, _setContentState] =
    useState<EditorContentState>(defaultState);
  const contentStateRef = useRef(contentState);
  const launchModeRef = useRef("normal");
  const launchRecordingIdRef = useRef<string | null>(null);
  const launchLocalRecordingIdRef = useRef<string | null>(null);
  const pseudoProgressTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const pseudoProgressStartRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const pseudoProgressStartAtRef = useRef<number | null>(null);
  const diagMountAtRef = useRef<number | null>(null);
  const diagMakeVideoAtRef = useRef<number | null>(null);
  const editorReadyDiagSentRef = useRef(false);
  const editorErrorShownRef = useRef(false);
  // true while makeVideoTab is mid-OPFS read. a late post-finalize teardown
  // error can race it; suppress in-flight and let the read decide (real failure
  // surfaces via OPFS_LOAD_FAILED).
  const opfsReadInFlightRef = useRef(false);
  const diagHeartbeatCountRef = useRef(0);

  const setContentState = useCallback<
    Dispatch<SetStateAction<EditorContentState>>
  >((updater) => {
    _setContentState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      contentStateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      launchModeRef.current = params.get("mode") || "normal";
      launchRecordingIdRef.current = params.get("recordingId") || null;
      launchLocalRecordingIdRef.current = params.get("localRecordingId") || null;
    } catch {}
  }, []);

  const registerLoadedLocalRecording = useCallback(
    async (blob: Blob, backendRef: RecordingBackendRef | null = null) => {
      if (!blob) return null;
      try {
        const current = contentStateRef.current || {};
        const { recordingAttemptId, recordingDuration, recordingMeta } =
          await chrome.storage.local.get([
            "recordingAttemptId",
            "recordingDuration",
            "recordingMeta",
          ]);
        const localBackendRef = asLocalRecordingBackendRef(backendRef);
        const id =
          current.localRecordingId ||
          launchLocalRecordingIdRef.current ||
          localRecordingIdFromBackendRef(
            localBackendRef,
            typeof recordingAttemptId === "string" ? recordingAttemptId : null,
          );
        const storedRecordingMeta = isRecord(recordingMeta)
          ? recordingMeta
          : null;
        const entry = await registerLocalRecording({
          id,
          title: current.title || undefined,
          blob,
          backendRef: localBackendRef,
          durationMs:
            Number(current.duration) > 0
              ? Math.round(Number(current.duration) * 1000)
              : Number(recordingDuration) || 0,
          recordingMeta: current.recordingMeta || storedRecordingMeta,
        });
        setContentState((prev) => ({
          ...prev,
          localRecordingId: entry.id,
          title: prev.title || entry.title,
        }));
        return entry;
      } catch (error) {
        console.warn("[SayLess] Failed to register local recording", error);
        return null;
      }
    },
    [setContentState],
  );

  const checkpointCurrentLocalEdit = useCallback(
    async (blob: Blob) => {
      const id = contentStateRef.current?.localRecordingId;
      if (!id || !blob) return;
      try {
        await checkpointEditedLocalRecording(id, blob);
        setContentState((prev) => ({ ...prev, saved: true }));
      } catch (error) {
        console.warn("[SayLess] Failed to checkpoint local edit", error);
      }
    },
    [setContentState],
  );

  useEffect(() => {
    // emit diag-editor-ready once; WebM has many "ready:true" branches
    if (!contentState.ready) return;
    if (editorReadyDiagSentRef.current) return;
    editorReadyDiagSentRef.current = true;
    const blobType = contentStateRef.current?.blob?.type
      || contentStateRef.current?.rawBlob?.type
      || null;
    const path = blobType?.includes("mp4") ? "mp4-fast" : "webm";
    chrome.runtime
      .sendMessage({ type: "diag-editor-ready", path })
      .catch(() => {});
    // mirror to storage so BG's deferred endDiagSession watcher sees ready
    // without the diag session being open
    try {
      chrome.storage.local.set({
        editorReadyAt: Date.now(),
        editorReadyPath: path,
        // clear so a bundle grabbed after recovery doesn't report a resolved
        // attempt's errCode as the live failure
        lastRecordingError: null,
        editorRecordingError: null,
      });
    } catch {}
  }, [contentState.ready]);

  useEffect(() => {
    if (launchModeRef.current !== "postStop") return;
    if (contentState.ready) {
      if (pseudoProgressTimerRef.current) {
        clearInterval(pseudoProgressTimerRef.current);
        pseudoProgressTimerRef.current = null;
      }
      return;
    }

    if (pseudoProgressTimerRef.current || pseudoProgressStartRef.current)
      return;
    pseudoProgressStartRef.current = setTimeout(() => {
      pseudoProgressStartRef.current = null;
      if (contentStateRef.current?.ready) return;
      if ((contentStateRef.current?.processingProgress || 0) > 0) return;
      pseudoProgressStartAtRef.current = Date.now();
      pseudoProgressTimerRef.current = setInterval(() => {
        setContentState((prev) => {
          if (prev.ready) return prev;
          const current = Number(prev.processingProgress || 0);
          const elapsedMs = Math.max(
            0,
            Date.now() - (pseudoProgressStartAtRef.current || Date.now()),
          );
          const target = Math.min(90, Math.round((elapsedMs / 6000) * 90));
          const next = Math.max(current, target);
          if (next <= current) return prev;
          return { ...prev, processingProgress: next };
        });
      }, 200);
    }, 800);

    return () => {
      if (pseudoProgressStartRef.current) {
        clearTimeout(pseudoProgressStartRef.current);
        pseudoProgressStartRef.current = null;
      }
      pseudoProgressStartAtRef.current = null;
      if (pseudoProgressTimerRef.current) {
        clearInterval(pseudoProgressTimerRef.current);
        pseudoProgressTimerRef.current = null;
      }
    };
  }, [contentState.ready]);

  const waitForFinalizeReady = async (
    recordingId: string | null | undefined,
  ): Promise<FinalizeReadyResult> => {
    if (!recordingId) return { ok: true };
    const key = `freeFinalizeStatus:${recordingId}`;
    const timeoutMs = 60_000;
    const pollMs = 200;
    const start = Date.now();
    debugRecordingEventWithSession(recdbgSessionRef.current, "poststop-wait", {
      recordingId,
      key,
      timeoutMs,
      pollMs,
    });

    // A finalized OPFS recording is download-ready once the OPFS writer stamps
    // lastRecordingFinalizedFileName (a reliable write). The freeFinalizeStatus
    // "ready" below is fire-and-forget and often never lands, so use the marker.
    // The marker is a single write a SW restart mid-finalize can wipe, so when
    // it's missing we fall back to the OPFS file itself: if the session
    // completed and the file exists with content, it's finalized regardless.
    // This avoids the 60s freeFinalizeStatus timeout + the premature "stuck"
    // error when the marker is lost.
    const isOpfsFinalized = async () => {
      try {
        const {
          lastRecordingBackendRef,
          lastRecordingFinalizedFileName,
          freeRecorderSession,
        } = await chrome.storage.local.get([
          "lastRecordingBackendRef",
          "lastRecordingFinalizedFileName",
          "freeRecorderSession",
        ]);
        const backendRef = asRecordingBackendRef(lastRecordingBackendRef);
        const fileName = backendRef?.fileName;
        if (
          backendRef?.backend !== "opfs" ||
          !fileName ||
          !String(fileName).includes(recordingId)
        ) {
          return false;
        }
        if (lastRecordingFinalizedFileName === fileName) return true;
        // Marker missing: trust a completed session + the on-disk file.
        const status = isRecord(freeRecorderSession)
          ? freeRecorderSession.status
          : null;
        if (status !== "completed" && status !== "complete") return false;
        const dir = await navigator.storage.getDirectory();
        const handle = await dir.getFileHandle(fileName);
        const file = await handle.getFile();
        return file.size > 0;
      } catch {
        return false;
      }
    };

    if (await isOpfsFinalized()) {
      debugRecordingEventWithSession(recdbgSessionRef.current, "poststop-ready", {
        recordingId,
        stage: "opfs-finalized",
      });
      return { ok: true };
    }

    const getStatus = async (): Promise<FinalizeStatus | null> => {
      const res = await chrome.storage.local.get([key]);
      return isRecord(res[key]) ? (res[key] as FinalizeStatus) : null;
    };

    return new Promise<FinalizeReadyResult>(async (resolve) => {
      let done = false;
      const cleanup = () => {
        done = true;
        chrome.storage.onChanged.removeListener(onChanged);
        clearInterval(pollTimer);
      };

      const handleStatus = (status: FinalizeStatus | null) => {
        if (!status || done) return;
        if (DEBUG_POSTSTOP)
          console.debug("[SayLess][Sandbox] waitForFinalizeReady status", {
            status,
          });
        const rawPct = typeof status.percent === "number" ? status.percent : 0;
        const prePct = Math.min(90, Math.max(0, Math.round(rawPct * 0.9)));
        debugRecordingEventWithSession(
          recdbgSessionRef.current,
          "poststop-status",
          {
            recordingId,
            stage: status.stage,
            percent: status.percent,
            updatedAt: status.updatedAt,
          },
        );
        setContentState((prev) => ({
          ...prev,
          isFfmpegRunning: true,
          processingProgress: Math.max(prev.processingProgress || 0, prePct),
        }));
        if (status.stage === "chunks_ready" || status.stage === "ready") {
          cleanup();
          debugRecordingEventWithSession(
            recdbgSessionRef.current,
            "poststop-ready",
            { recordingId, stage: status.stage },
          );
          resolve({ ok: true });
        } else if (status.stage === "failed") {
          cleanup();
          debugRecordingEventWithSession(
            recdbgSessionRef.current,
            "poststop-failed",
            { recordingId, error: status.error || "failed" },
          );
          resolve({ ok: false, error: status.error || "failed" });
        }
      };

      const onChanged = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => {
        if (area !== "local") return;
        if (!changes[key]) return;
        const nextValue = changes[key].newValue;
        handleStatus(isRecord(nextValue) ? (nextValue as FinalizeStatus) : null);
      };

      chrome.storage.onChanged.addListener(onChanged);

      const pollTimer = setInterval(async () => {
        if (done) return;
        if (Date.now() - start > timeoutMs) {
          cleanup();
          debugRecordingEventWithSession(
            recdbgSessionRef.current,
            "poststop-timeout",
            { recordingId, timeoutMs },
          );
          resolve({ ok: false, error: "timeout" });
          return;
        }
        // The finalized marker can land mid-wait (the recorder finishes after
        // the editor opened); resolve as soon as it does instead of waiting on
        // the throttled freeFinalizeStatus write.
        if (await isOpfsFinalized()) {
          cleanup();
          debugRecordingEventWithSession(
            recdbgSessionRef.current,
            "poststop-ready",
            { recordingId, stage: "opfs-finalized" },
          );
          resolve({ ok: true });
          return;
        }
        const status = await getStatus();
        handleStatus(status);
      }, pollMs);

      const initial = await getStatus();
      handleStatus(initial);
    });
  };

  useEffect(() => {
    if (launchModeRef.current !== "postStop") return;
    if (!contentState.chunkCount) return;
    const ratio =
      contentState.chunkCount > 0
        ? contentState.chunkIndex / contentState.chunkCount
        : 0;
    const pct = Math.min(100, Math.max(20, Math.round(ratio * 80 + 20)));
    setContentState((prev) => ({
      ...prev,
      processingProgress: pct,
    }));
  }, [contentState.chunkIndex, contentState.chunkCount]);

  const buildBlobFromChunks = async () => {
    const { lastRecordingBackendRef } = await chrome.storage.local.get([
      "lastRecordingBackendRef",
    ]);
    const backendRef = asRecordingBackendRef(lastRecordingBackendRef);
    if (!backendRef) return null;
    const reader = chooseReader(backendRef);
    await reader.open(backendRef);
    let readResult;
    try {
      readResult = await reader.readBlob();
    } finally {
      await reader.close().catch(() => {});
    }
    if (!readResult?.blob || readResult.chunkCount === 0) {
      if (DEBUG_POSTSTOP)
        console.warn(
          "[SayLess][Sandbox] buildBlobFromChunks: no parts found",
        );
      debugRecordingEventWithSession(recdbgSessionRef.current, "blob-empty", {
        chunkCount: 0,
      });
      return null;
    }
    const blob = readResult.blob;
    if (DEBUG_POSTSTOP)
      console.debug(
        "[SayLess][Sandbox] buildBlobFromChunks: reconstructed blob",
        {
          size: blob.size,
          type: blob.type,
          chunkCount: readResult.chunkCount,
        },
      );
    registerLoadedLocalRecording(blob, backendRef).catch(() => {});
    reconstructVideo(blob);
    return blob;
  };

  useEffect(() => {
    const loadInitialTitle = async () => {
      const date = new Date();
      const formattedDate = date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const fallbackTitle = `SayLess video - ${formattedDate}`;

      try {
        const { recordingMeta } = await chrome.storage.local.get([
          "recordingMeta",
        ]);
        if (isRecord(recordingMeta) && recordingMeta.type === "tab") {
          const baseTitle = sanitizeFilenameBase(
            (typeof recordingMeta.title === "string"
              ? recordingMeta.title.trim()
              : "") ||
              getHostnameFromUrl(
                typeof recordingMeta.url === "string"
                  ? recordingMeta.url
                  : null,
              ) ||
              fallbackTitle,
          );
          const timestamp = formatLocalTimestamp(
            recordingMeta.startedAt as string | number | Date | null | undefined,
          );
          setContentState((prevState) => ({
            ...prevState,
            title: `${baseTitle}; ${timestamp}`,
            recordingMeta,
          }));
          const localId =
            contentStateRef.current?.localRecordingId ||
            launchLocalRecordingIdRef.current;
          if (localId) {
            saveLocalRecordingEntry({
              id: localId,
              title: `${baseTitle}; ${timestamp}`,
              recordingMeta,
            }).catch(() => {});
          }
          chrome.storage.local.remove(["recordingMeta"]);
          return;
        }
      } catch (error) {
        console.warn("Failed to load recording meta:", error);
      }

      setContentState((prevState) => ({
        ...prevState,
        title: fallbackTitle,
        recordingMeta: null,
      }));
      const localId =
        contentStateRef.current?.localRecordingId ||
        launchLocalRecordingIdRef.current;
      if (localId) {
        saveLocalRecordingEntry({
          id: localId,
          title: fallbackTitle,
        }).catch(() => {});
      }
    };

    loadInitialTitle();
  }, []);

  useEffect(() => {
    if (!contentState.saved) {
      window.onbeforeunload = function () {
        return true;
      };
    } else {
      window.onbeforeunload = null;
    }
  }, [contentState.saved]);

  const createBackup = () => {
    setContentState((prev) => ({
      ...prev,
      backupBlob: prev.blob,
    }));
  };

  const restoreBackup = () => {
    setContentState((prev) => ({
      ...prev,
      blob: prev.backupBlob || prev.blob,
      mode: "player",
      start: 0,
      end: 1,
      backupBlob: null,
    }));
  };

  const clearBackup = () => {
    setContentState((prev) => ({
      ...prev,
      backupBlob: null,
    }));
  };

  // each entry pins a blob (multi-GB on long recordings); cap to bound memory
  const MAX_HISTORY_DEPTH = 20;
  const addToHistory = useCallback(() => {
    setContentState((prevState) => {
      const next = [...prevState.history, prevState];
      if (next.length > MAX_HISTORY_DEPTH) {
        next.splice(0, next.length - MAX_HISTORY_DEPTH);
      }
      return {
        ...prevState,
        history: next,
        redoHistory: [],
      };
    });
  }, [contentState]);

  // mid-edit snapshots can carry isFfmpegRunning/edit flags; restoring one
  // leaves redo and edit buttons disabled. nothing's in flight by undo/redo
  // time, so reset on every restore.
  const RESET_RUNTIME_FLAGS = {
    isFfmpegRunning: false,
    trimming: false,
    cutting: false,
    muting: false,
    cropping: false,
    reencoding: false,
  };

  const undo = useCallback(() => {
    if (contentState.history.length > 1) {
      const previousState =
        contentState.history[contentState.history.length - 2];
      const newHistory = contentState.history.slice(0, -1);
      setContentState((prevState) => ({
        ...prevState,
        ...previousState,
        history: newHistory,
        redoHistory: [contentState, ...contentState.redoHistory],
        ...RESET_RUNTIME_FLAGS,
      }));
    }
  }, [contentState]);

  const redo = useCallback(() => {
    if (contentState.redoHistory.length > 0) {
      const nextState = contentState.redoHistory[0];
      const newRedoHistory = contentState.redoHistory.slice(1);
      setContentState((prevState) => ({
        ...prevState,
        ...nextState,
        history: [...contentState.history, contentState],
        redoHistory: newRedoHistory,
        ...RESET_RUNTIME_FLAGS,
      }));
    }
  }, [contentState]);

  const base64ToUint8Array = (base64: unknown): Blob => {
    if (typeof base64 !== "string") {
      throw new TypeError("Expected a base64-encoded string");
    }
    const dataUrlRegex = /^data:(.*?);base64,/;
    const matches = base64.match(dataUrlRegex);
    if (matches !== null) {
      const mimeType = matches[1];
      const binaryString = atob(base64.slice(matches[0].length));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    } else {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: "video/webm" });
    }
  };

  useEffect(() => {
    if (!contentState.blob) return;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = async () => {
      // fMP4 mvhd can be wrong; cross-check storage, but only on the original
      // (edited blobs are shorter than recordingDuration)
      const isOriginalBlob =
        !contentState.originalBlob ||
        contentState.blob === contentState.originalBlob;
      let durationSec = video.duration;
      if (isOriginalBlob) {
        try {
          const { recordingDuration } = await chrome.storage.local.get([
            "recordingDuration",
          ]);
          const recSec = Number(recordingDuration) > 0
            ? Number(recordingDuration) / 1000
            : 0;
          const probedSec = Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : 0;
          if (recSec > probedSec + 0.3) {
            durationSec = recSec;
          } else if (probedSec > 0) {
            durationSec = probedSec;
          } else if (recSec > 0) {
            durationSec = recSec;
          }
        } catch {}
      }
      setContentState((prevState) => ({
        ...prevState,
        duration: durationSec,
        width: video.videoWidth,
        height: video.videoHeight,
        prevWidth: video.videoWidth,
        prevHeight: video.videoHeight,
      }));

      URL.revokeObjectURL(video.src);
      video.remove();
    };
    video.src = URL.createObjectURL(contentState.blob);
  }, [contentState.blob]);

  useEffect(() => {
    if (!contentState.localRecordingId) return;
    if (!contentState.hasBeenEdited) return;
    if (!contentState.blob) return;
    const recordingId = contentState.localRecordingId;
    const blob = contentState.blob;
    const timer = setTimeout(() => {
      checkpointEditedLocalRecording(
        recordingId,
        blob,
      )
        .then(() => setContentState((prev) => ({ ...prev, saved: true })))
        .catch((error) =>
          console.warn("[SayLess] Failed to autosave local edit", error),
        );
    }, 500);
    return () => clearTimeout(timer);
  }, [contentState.localRecordingId, contentState.hasBeenEdited, contentState.blob]);

  const reconstructVideo = async (withBlob: Blob | null): Promise<void> => {
    // callers always pass a reconstructed blob; bail on null (caller surfaces
    // the load-failed modal, and blob.type below would throw)
    if (!withBlob) {
      diagForward("sandbox-reconstruct-no-blob", {});
      return;
    }
    const reconstructStartedAt = Date.now();
    const totalBytesIn = withBlob?.size || 0;
    diagForward("sandbox-reconstruct-start", {
      chunkIndex: contentStateRef.current?.chunkIndex ?? 0,
      chunkCount: contentStateRef.current?.chunkCount ?? 0,
      totalBytes: totalBytesIn,
      withBlob: Boolean(withBlob),
    });

    let blob;
    try {
      blob = withBlob;
      perfMark("Sandbox blob-built", {
        bytes: blob?.size ?? 0,
      });
    } catch (err) {
      diagForward("sandbox-reconstruct-error", {
        error: errorMessage(err).slice(0, 200),
        phase: "blob",
        chunkIndex: contentStateRef.current?.chunkIndex ?? 0,
        totalBytes: totalBytesIn,
      });
      throw err;
    }
    diagForward("sandbox-reconstruct-done", {
      blobBytes: blob?.size ?? 0,
      elapsedMs: Date.now() - reconstructStartedAt,
      type: blob?.type || null,
    });
    let isFastWebm = false;
    if (blob.type === "video/webm") {
      try {
        const { lastRecordingBackendRef } = await chrome.storage.local.get([
          "lastRecordingBackendRef",
        ]);
        const backendRef = asRecordingBackendRef(lastRecordingBackendRef);
        isFastWebm =
          backendRef?.backend === "opfs" &&
          /\.webm$/i.test(backendRef.fileName || "");
      } catch {}
    }
    if (blob.type === "video/mp4" || isFastWebm) {
      if (DEBUG_RECORDER)
        console.log("[SayLess][Sandbox] reconstructVideo: fast path taken", {
          size: blob.size,
          type: blob.type,
          isFastWebm,
        });
      setContentState((prev) => ({
        ...prev,
        blob: blob,
        webm: isFastWebm ? blob : null,
        mp4ready: true,
        ready: true,
        rawBlob: blob,
        originalBlob: prev.originalBlob || blob,
        isFfmpegRunning: false,
        noffmpeg: false,
        editLimit: Math.max(prev.editLimit || 0, MAX_EDIT_LIMIT_S),
      }));

      const video = document.createElement("video");
      video.preload = "metadata";
      const videoLoadStart = Date.now();
      video.onloadedmetadata = () => {
        perfMark("Sandbox video-loadedmetadata", {
          duration: video.duration,
          w: video.videoWidth,
          h: video.videoHeight,
        });
        diagForward("sandbox-video-loadedmetadata", {
          elapsedMs: Date.now() - videoLoadStart,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth,
          height: video.videoHeight,
          blobBytes: blob?.size ?? 0,
        });
        setContentState((prev) => ({
          ...prev,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        }));

        URL.revokeObjectURL(video.src);
      };
      video.onerror = () => {
        const errCode = video.error?.code ?? null;
        const errMessage = video.error?.message ?? null;
        diagForward("sandbox-video-load-error", {
          elapsedMs: Date.now() - videoLoadStart,
          code: errCode,
          message: errMessage ? String(errMessage).slice(0, 200) : null,
          blobBytes: blob?.size ?? 0,
        });
        diagForward("sandbox-reconstruct-error", {
          error: "video-element-error",
          phase: "video-load",
          chunkIndex: contentStateRef.current?.chunkIndex ?? 0,
          totalBytes: blob?.size ?? 0,
        });
      };
      try {
        video.src = URL.createObjectURL(blob);
        diagForward("sandbox-video-src-set", {
          blobBytes: blob?.size ?? 0,
        });
      } catch (err) {
        diagForward("sandbox-reconstruct-error", {
          error: errorMessage(err).slice(0, 200),
          phase: "url",
          chunkIndex: contentStateRef.current?.chunkIndex ?? 0,
          totalBytes: blob?.size ?? 0,
        });
      }

      chrome.runtime.sendMessage({ type: "recording-complete" });
      chrome.runtime.sendMessage({ type: "diag-editor-ready", path: "mp4-fast" }).catch(() => {});
      return;
    }

    const storedDuration = await chrome.storage.local.get(
      "recordingDuration",
    );
    let recordingDuration = Number(storedDuration.recordingDuration) || 0;

    // If recordingDuration is missing or 0, try to probe it from the blob
    if (!recordingDuration || recordingDuration <= 0) {
      console.warn(
        "[SayLess][WebM] recordingDuration missing or 0, probing from blob",
      );
      try {
        const probeDuration = await new Promise<number>((resolve) => {
          const probe = document.createElement("video");
          probe.preload = "metadata";
          const timeout = setTimeout(() => {
            URL.revokeObjectURL(probe.src);
            resolve(0);
          }, 5000);
          probe.onloadedmetadata = () => {
            clearTimeout(timeout);
            const dur = probe.duration;
            URL.revokeObjectURL(probe.src);
            if (Number.isFinite(dur) && dur > 0) {
              resolve(Math.round(dur * 1000));
            } else {
              resolve(0);
            }
          };
          probe.onerror = () => {
            clearTimeout(timeout);
            URL.revokeObjectURL(probe.src);
            resolve(0);
          };
          probe.src = URL.createObjectURL(blob);
        });
        if (probeDuration > 0) {
          recordingDuration = probeDuration;
        }
      } catch (err) {
        console.warn("[SayLess][WebM] blob duration probe failed:", err);
      }
    }

    const safeDuration = Number(recordingDuration) || 0;
    setContentState((prevState) => ({
      ...prevState,
      rawBlob: blob,
      duration: safeDuration / 1000,
    }));

    const isWindows10 = navigator.userAgent.match(/Windows NT 10.0/);

    try {
      if (safeDuration > 0) {
        if (!isWindows10) {
          requestParentFixWebmDuration(
            blob,
            safeDuration,
            async (fixedWebm: Blob) => {
              if (
                contentStateRef.current.updateChrome ||
                contentStateRef.current.noffmpeg ||
                (contentStateRef.current.duration >
                  contentStateRef.current.editLimit &&
                  !contentStateRef.current.override)
              ) {
                setContentState((prevState) => ({
                  ...prevState,
                  webm: fixedWebm,
                  ready: true,
                  isFfmpegRunning: false,
                }));
                chrome.runtime.sendMessage({ type: "recording-complete" });
                return;
              }

              const reader = new FileReader();
              reader.onloadend = function () {
                const base64data = reader.result;
                setContentState((prevContentState) => ({
                  ...prevContentState,
                  base64: base64data,
                }));
              };
              reader.readAsDataURL(fixedWebm);
            },
          );
        } else {
          const fixedWebm = await fixWebmDurationFallback(blob);
          if (
            contentStateRef.current.updateChrome ||
            contentStateRef.current.noffmpeg ||
            (contentStateRef.current.duration >
              contentStateRef.current.editLimit &&
              !contentStateRef.current.override)
          ) {
            setContentState((prevState) => ({
              ...prevState,
              webm: fixedWebm,
              ready: true,
              isFfmpegRunning: false,
            }));
            chrome.runtime.sendMessage({ type: "recording-complete" });
            return;
          }

          const reader = new FileReader();
          reader.onloadend = function () {
            const base64data = reader.result;
            setContentState((prevContentState) => ({
              ...prevContentState,
              base64: base64data,
            }));
          };
          reader.readAsDataURL(fixedWebm);
        }
      } else {
        console.warn(
          "[SayLess][WebM] skipping duration fix: safeDuration=0, blob will have broken seek metadata",
        );
        if (
          contentStateRef.current.updateChrome ||
          contentStateRef.current.noffmpeg ||
          (contentStateRef.current.duration >
            contentStateRef.current.editLimit &&
            !contentStateRef.current.override)
        ) {
          setContentState((prevState) => ({
            ...prevState,
            webm: blob,
            ready: true,
            isFfmpegRunning: false,
          }));
          chrome.runtime.sendMessage({ type: "recording-complete" });
          return;
        }

        const reader = new FileReader();
        reader.onloadend = function () {
          const base64data = reader.result;
          setContentState((prevContentState) => ({
            ...prevContentState,
            base64: base64data,
          }));
        };
        reader.readAsDataURL(blob);
      }
    } catch (error) {
      console.error(
        "[SayLess][WebM] duration fix failed, using unfixed blob:",
        error,
      );
      setContentState((prevState) => ({
        ...prevState,
        webm: blob,
        ready: true,
        isFfmpegRunning: false,
      }));
      chrome.runtime.sendMessage({ type: "recording-complete" });
    }

    // 45s safety timeout for direct-blob path; fixWebmDuration/readAsDataURL can hang
    if (withBlob) {
      setTimeout(() => {
        const s = contentStateRef.current;
        if (s?.ready) return;
        console.warn(
          "[SayLess][WebM] reconstructVideo(blob) safety timeout: forcing ready with raw blob",
        );
        setContentState((prev) => {
          if (prev.ready) return prev;
          return {
            ...prev,
            webm: prev.webm || prev.rawBlob || withBlob,
            ready: true,
            noffmpeg: true,
            isFfmpegRunning: false,
          };
        });
        chrome.runtime.sendMessage({ type: "recording-complete" });
      }, 45000);
    }
  };

  const checkMemory = () => {
    if (typeof contentStateRef.current.openModal === "function") {
      chrome.storage.local.get("memoryError", (result) => {
        if (result.memoryError && result.memoryError !== null) {
          chrome.storage.local.set({ memoryError: false });
          contentStateRef.current.openModal?.(
            chrome.i18n.getMessage("memoryLimitTitle"),
            chrome.i18n.getMessage("memoryLimitDescription"),
            chrome.i18n.getMessage("understoodButton"),
            null,
            () => {},
            () => {},
            null,
            chrome.i18n.getMessage("learnMoreDot"),
            () => {
              chrome.runtime.sendMessage({ type: "memory-limit-help" });
            },
            false, // colorSafe
            chrome.i18n.getMessage("getHelpButton"),
            () => {
              triggerSupportDownload({ source: "memory-limit" });
              chrome.runtime.sendMessage({
                type: "report-error",
                errorCode: "REC_RUN_MEMORY",
                source: "memory-limit",
                zipBundled: true,
              });
            },
          );
        }
      });
    }
  };

  useEffect(() => {
    chunkCount.current = contentState.chunkCount;
  }, [contentState.chunkCount]);

  useEffect(() => {
    const version = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);

    const MIN_CHROME_VERSION = 109;

    if (version && parseInt(version[2], 10) < MIN_CHROME_VERSION) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        updateChrome: true,
        noffmpeg: true,
      }));
    }
  }, []);

  const makeVideoTab = async (
    sendResponse: ((response?: unknown) => void) | null = null,
    message: Record<string, unknown> = {},
  ): Promise<void> => {
    if (makeVideoCheck.current) return;
    makeVideoCheck.current = true;
    perfMark("Sandbox makeVideoTab.enter", { override: message?.override });
    if (DEBUG_POSTSTOP)
      console.debug("[SayLess][Sandbox] makeVideoTab invoked", {
        override: message?.override,
      });
    setContentState((prevState) => ({
      ...prevState,
      override: Boolean(message.override),
    }));
    // clear leftover memoryError without surfacing modal; recording-time toast already fired
    try {
      chrome.storage.local.set({ memoryError: false });
    } catch {}
    let directBlob: Blob | null = null;
    let opfsReadFailed = false;
    let backendRefForThisLoad: RecordingBackendRef | null = null;
    try {
      const { lastRecordingBackendRef } = await chrome.storage.local.get([
        "lastRecordingBackendRef",
      ]);
      const backendRef = asRecordingBackendRef(lastRecordingBackendRef);
      backendRefForThisLoad = backendRef;
      if (process.env.SAYLESS_DEV_MODE === "true") {
        console.log(
          "[recorder-opfs][sandbox] makeVideoTab backend",
          backendRef || { backend: "idb" },
        );
      }
      setContentState((prev) => ({
        ...prev,
        lastRecordingBackend: backendRef?.backend || "idb",
      }));
      if (backendRef?.backend === "opfs") {
        // retry truncated/transient reads so a recoverable first open doesn't hit the modal
        const MAX_OPFS_READ_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_OPFS_READ_ATTEMPTS; attempt += 1) {
          try {
            const reader = chooseReader(backendRef);
            const readerOpenStart = Date.now();
            await reader.open(backendRef);
            diagForward("sandbox-opfs-reader-open-done", {
              elapsedMs: Date.now() - readerOpenStart,
              fileName: backendRef.fileName || null,
              attempt,
            });
            const readBlobStart = Date.now();
            diagForward("sandbox-opfs-readblob-start", { attempt });
            opfsReadInFlightRef.current = true;
            const { blob: rawBlob } = await reader.readBlob({
              // recorder still flushing; show a labeled loading state
              onSlowFinalize: () => {
                diagForward("sandbox-opfs-readblob-slow-finalize", {
                  elapsedMs: Date.now() - readBlobStart,
                });
                setContentState((prev) =>
                  prev.finalizingRecording ? prev : { ...prev, finalizingRecording: true },
                );
              },
            });
            opfsReadInFlightRef.current = false;
            diagForward("sandbox-opfs-readblob-done", {
              elapsedMs: Date.now() - readBlobStart,
              rawBlobBytes: rawBlob?.size ?? 0,
              attempt,
            });
            await reader.close().catch(() => {});
            if (!rawBlob) throw new Error("opfs-readblob-empty");
            // Use the disk-backed OPFS blob directly: <video> streams it from
            // disk and mediabunny reads it lazily (~8MB cache), so the editor
            // loads at O(1) memory regardless of size.
            const blob = rawBlob;
            diagForward("sandbox-opfs-materialize-deferred", {
              bytes: rawBlob.size,
            });
            // Only small recordings get an in-memory copy. Its only benefit is
            // surviving a later "new recording" sweep of the OPFS file; above
            // ~100MB the arrayBuffer copy itself spikes memory and janks the tab
            // (the 873MB "can't load the recording" reports), so large files
            // stay disk-backed and load instantly.
            const MATERIALIZE_MAX_BYTES = 100_000_000;
            if (rawBlob.size <= MATERIALIZE_MAX_BYTES) {
              const materializeStart = Date.now();
              (async () => {
                try {
                  const buf = await rawBlob.arrayBuffer();
                  const materialized = new Blob([buf], {
                    type: rawBlob.type || "video/mp4",
                  });
                  diagForward("sandbox-opfs-materialize-done", {
                    elapsedMs: Date.now() - materializeStart,
                    outputBytes: materialized.size,
                  });
                  setContentState((prev) => ({
                    ...prev,
                    blob: materialized,
                    rawBlob: prev.rawBlob || materialized,
                  }));
                } catch (err) {
                  diagForward("sandbox-opfs-materialize-fail", {
                    elapsedMs: Date.now() - materializeStart,
                    err: errorMessage(err).slice(0, 200),
                  });
                }
              })();
            }
            directBlob = blob;
            diagForward("sandbox-opfs-direct-read", {
              outputBytes: blob.size,
              attempt,
            });
            if (process.env.SAYLESS_DEV_MODE === "true") {
              console.log("[recorder-opfs][sandbox] opfs-direct-read-ok", {
                bytes: blob.size,
              });
            }
            break;
          } catch (err) {
            opfsReadInFlightRef.current = false;
            diagForward("sandbox-opfs-direct-read-fail", {
              attempt,
              err: errorMessage(err).slice(0, 200),
            });
            console.warn(
              "[SayLess][Sandbox] OPFS direct read failed",
              { attempt, err },
            );
            if (attempt < MAX_OPFS_READ_ATTEMPTS) {
              setContentState((prev) =>
                prev.finalizingRecording ? prev : { ...prev, finalizingRecording: true },
              );
              await new Promise((r) => setTimeout(r, attempt * 750));
              continue;
            }
            opfsReadFailed = true;
          }
        }
        setContentState((prev) =>
          prev.finalizingRecording ? { ...prev, finalizingRecording: false } : prev,
        );
      }
    } catch (err) {
      opfsReadFailed = true;
      diagForward("sandbox-opfs-direct-read-fail", {
        err: errorMessage(err).slice(0, 200),
      });
      console.warn(
        "[SayLess][Sandbox] OPFS direct read failed",
        err,
      );
    }

    // read IDB directly when the recording is IDB-backed, not just on OPFS
    // failure. editor is a top-level page with IDB access, no chunk relay (the
    // legacy relay raced the editor open and delivered 0 chunks = black video).
    const needsIdbDirectRead =
      !directBlob &&
      (opfsReadFailed || backendRefForThisLoad?.backend !== "opfs");
    if (needsIdbDirectRead) {
      try {
        const idbReader = chooseReader({ backend: "idb" });
        await idbReader.open({ backend: "idb" });
        const { blob, chunkCount } = await idbReader.readBlob();
        await idbReader.close().catch(() => {});
        if (blob && chunkCount > 0) {
          directBlob = blob;
          diagForward("sandbox-idb-direct-read", {
            bytes: blob.size,
            chunkCount,
          });
          if (process.env.SAYLESS_DEV_MODE === "true") {
            console.log(
              "[recorder-opfs][sandbox] IDB direct read succeeded",
              { bytes: blob.size, chunkCount },
            );
          }
        }
      } catch {}
      if (!directBlob) {
        // release the once-only guard so a later make-video-tab can retry.
        makeVideoCheck.current = false;
        if (typeof contentStateRef.current?.openModal === "function") {
          contentStateRef.current.openModal(
            chrome.i18n.getMessage("opfsLoadErrorTitle"),
            chrome.i18n.getMessage("opfsLoadErrorDescription"),
            null,
            chrome.i18n.getMessage("permissionsModalDismiss"),
            () => {},
            () => {},
            null,
            null,
            null,
            true,
            chrome.i18n.getMessage("getHelpButton"),
            () => {
              triggerSupportDownload({ source: "opfs-load-failed" });
              chrome.runtime.sendMessage({
                type: "report-error",
                source: "opfs-load-failed",
                errorCode: "OPFS_LOAD_FAILED",
                zipBundled: true,
              });
            },
          );
        }
        diagForward("sandbox-recording-load-failed", {
          backend: backendRefForThisLoad?.backend || "unknown",
        });
      }
    }
    // null directBlob means the read failed and the modal already fired
    if (directBlob) {
      registerLoadedLocalRecording(directBlob, backendRefForThisLoad).catch(
        () => {},
      );
      reconstructVideo(directBlob);
    }

    // mark ready if duration-fix hangs; don't overwrite an already-fixed webm
    const safetyCheck = () => {
      const s = contentStateRef.current;
      if (DEBUG_POSTSTOP)
        console.debug("[SayLess][Sandbox] makeVideoTab: safety-check", {
          chunkCount: s?.chunkCount,
          chunkIndex: s?.chunkIndex,
          rawBlob: Boolean(s?.rawBlob),
          webm: Boolean(s?.webm),
          ready: s?.ready,
        });
      diagForward("sandbox-safety-fired", {
        chunkCount: s?.chunkCount ?? 0,
        chunkIndex: s?.chunkIndex ?? 0,
        hasRawBlob: Boolean(s?.rawBlob),
        hasBlob: Boolean(s?.blob),
        hasWebm: Boolean(s?.webm),
        ready: Boolean(s?.ready),
        elapsedSinceMakeVideoMs: diagMakeVideoAtRef.current
          ? Date.now() - diagMakeVideoAtRef.current
          : null,
      });
      if (s?.ready) return;

      const complete = s?.chunkCount > 0 && s?.chunkIndex >= s?.chunkCount;
      if (complete && s?.rawBlob) {
        if (s?.webm) {
          if (DEBUG_RECORDER)
            console.log(
              "[SayLess][WebM] safety timeout: webm already set by fix, marking ready",
            );
          setContentState((prev) => ({
            ...prev,
            ready: true,
            noffmpeg: true,
            isFfmpegRunning: false,
          }));
        } else {
          console.warn(
            "[SayLess][WebM] safety timeout: duration fix did not complete in time, using unfixed rawBlob",
          );
          setContentState((prev) => ({
            ...prev,
            webm: prev.rawBlob,
            ready: true,
            noffmpeg: true,
            isFfmpegRunning: false,
          }));
        }
        chrome.runtime.sendMessage({ type: "recording-complete" });
      }
    };
    setTimeout(() => {
      if (!contentStateRef.current?.ready) {
        safetyCheck();
      }
    }, 30000);
    setTimeout(() => {
      if (!contentStateRef.current?.ready) {
        console.warn(
          "[SayLess][WebM] 60s safety timeout: force-marking ready",
        );
        safetyCheck();
      }
    }, 60000);

    if (sendResponse) sendResponse({ status: "ok" });
  };

  const toBase64 = (blob: Blob): Promise<string | ArrayBuffer | null> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.onerror = reject;
    });
  };

  const onChromeMessage = useCallback(
    (
      request: EditorRuntimeMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: RuntimeSendResponse,
    ): boolean | void => {
      const message = request;
      if (DEBUG_POSTSTOP)
        console.debug("[SayLess][Sandbox] onChromeMessage", {
          type: message?.type,
          senderTab: sender?.tab?.id,
        });
      if (
        message?._targetTabId &&
        tabIdRef.current &&
        message._targetTabId !== tabIdRef.current
      ) {
        return false;
      }
      if (message.type === "chunk-count") {
        if (DEBUG_POSTSTOP)
          console.debug("[SayLess][Sandbox] received chunk-count", {
            count: message.count,
          });
        diagForward("sandbox-chunk-count-received", {
          count: message?.count ?? 0,
        });
        setContentState((prevState) => ({
          ...prevState,
          chunkCount: Number(message.count) || 0,
          override: message.override ?? prevState.override,
        }));
      } else if (message.type === "ping") {
        sendResponse({ status: "ready" });
      } else if (message.type === "editor-force-close") {
        // BG closes this tab on a new recording; the backing OPFS file is about
        // to be deleted, so skip the unsaved-changes prompt
        try {
          window.onbeforeunload = null;
        } catch {}
        sendResponse?.({ ok: true });
      } else if (message.type === "recording-error") {
        // suppress when this editor already loaded; error belongs to a later attempt
        const editorAlreadyLoaded =
          Boolean(contentStateRef.current?.ready) ||
          Boolean(contentStateRef.current?.blob);
        if (editorAlreadyLoaded) return;
        // drop teardown errors landing mid-read; if the read truly fails the
        // OPFS_LOAD_FAILED path surfaces the real cause
        if (opfsReadInFlightRef.current) {
          diagForward("sandbox-recording-error-suppressed-mid-read", {
            error: String(message?.error || "").slice(0, 120),
            errorCode: message?.errorCode || null,
          });
          return;
        }
        diagForward("sandbox-recording-error-received", {
          error: String(message?.error || "").slice(0, 120),
          why: String(message?.why || "").slice(0, 240),
          errorCode: message?.errorCode || null,
        });
        if (
          !editorErrorShownRef.current &&
          typeof contentStateRef.current?.openModal === "function"
        ) {
          editorErrorShownRef.current = true;
          const errCode = message?.errorCode || "OPFS_LOAD_FAILED";
          contentStateRef.current.openModal(
            chrome.i18n.getMessage("opfsLoadErrorTitle"),
            // Never surface the raw internal `why` (e.g. "WebCodecs produced
            // no encoded video within 12000ms") — it's engineer-facing. The
            // raw string still rides along in the diag bundle via diagForward.
            chrome.i18n.getMessage("opfsLoadErrorDescription"),
            null,
            chrome.i18n.getMessage("permissionsModalDismiss"),
            () => {},
            () => {},
            null,
            null,
            null,
            true,
            chrome.i18n.getMessage("getHelpButton"),
            () => {
              triggerSupportDownload({ source: "opfs-load-failed" });
              chrome.runtime.sendMessage({
                type: "report-error",
                source: "opfs-load-failed",
                errorCode: errCode,
                zipBundled: true,
              });
            },
          );
        }
        setContentState((prev) => ({
          ...prev,
          ready: true,
          recordingFailed: true,
        }));
      } else if (message.type === "make-video-tab") {
        if (DEBUG_POSTSTOP)
          console.debug("[SayLess][Sandbox] received make-video-tab");
        diagMakeVideoAtRef.current = Date.now();
        diagForward("sandbox-make-video-tab", null);
        makeVideoTab(sendResponse, message);

        return true;
      } else if (message.type === "restore-recording") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          fallback: true,
          noffmpeg: false, // mediabunny stands in for FFmpeg here
          isFfmpegRunning: false,
          editLimit: MAX_EDIT_LIMIT_S,
        }));

        buildBlobFromChunks()
          .then((blob) => {
            if (!blob) {
              sendResponse({ status: "deferred" });
              return;
            }
            sendResponse({ status: "ok" });
          })
          .catch((error) => {
            sendResponse({ status: "error", error: errorMessage(error) });
          });

        return true;
      } else if (message.type === "large-recording") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          noffmpeg: false,
          isFfmpegRunning: true,
          editLimit: 0,
        }));
        const shouldGate =
          launchModeRef.current === "postStop" &&
          Boolean(launchRecordingIdRef.current);
        if (shouldGate) {
          waitForFinalizeReady(launchRecordingIdRef.current).then((result) => {
            if (!result.ok) {
              setContentState((prev) => ({
                ...prev,
                isFfmpegRunning: false,
                noffmpeg: true,
                ffmpegLoaded: true,
                processingProgress: 0,
              }));
              buildBlobFromChunks().catch(() => {});
              sendResponse({ status: "error", error: result.error });
              return;
            }
            buildBlobFromChunks()
              .then((blob) => {
                if (!blob) {
                  sendResponse({ status: "deferred" });
                  return;
                }
                sendResponse({ status: "ok" });
              })
              .catch((error) =>
                sendResponse({ status: "error", error: error.message }),
              );
          });
          return true;
        }

        buildBlobFromChunks()
          .then((blob) => {
            if (!blob) {
              sendResponse({ status: "deferred" });
              return;
            }
            sendResponse({ status: "ok" });
          })
          .catch((error) => {
            sendResponse({ status: "error", error: error.message });
          });

        return true;
      } else if (message.type === "fallback-recording") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          fallback: true,
          noffmpeg: false,
          isFfmpegRunning: true,
          editLimit: MAX_EDIT_LIMIT_S,
        }));
        const shouldGate =
          launchModeRef.current === "postStop" &&
          Boolean(launchRecordingIdRef.current);
        if (shouldGate) {
          waitForFinalizeReady(launchRecordingIdRef.current).then((result) => {
            if (!result.ok) {
              setContentState((prev) => ({
                ...prev,
                isFfmpegRunning: false,
                noffmpeg: true,
                ffmpegLoaded: true,
                processingProgress: 0,
              }));
              buildBlobFromChunks().catch(() => {});
              sendResponse({ status: "error", error: result.error });
              return;
            }
            buildBlobFromChunks()
              .then((blob) => {
                if (!blob) {
                  sendResponse({ status: "deferred" });
                  return;
                }
                sendResponse({ status: "ok" });
              })
              .catch((error) =>
                sendResponse({ status: "error", error: error.message }),
              );
          });
          return true;
        }

        buildBlobFromChunks()
          .then((blob) => {
            if (!blob) {
              sendResponse({ status: "deferred" });
              return;
            }
            sendResponse({ status: "ok" });
          })
          .catch((error) => {
            sendResponse({ status: "error", error: error.message });
          });

        return true;
      } else if (message.type === "viewer-recording") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          fallback: true,
          noffmpeg: true,
          isFfmpegRunning: true,
          editLimit: 0,
        }));
        const shouldGate =
          launchModeRef.current === "postStop" &&
          Boolean(launchRecordingIdRef.current);
        if (shouldGate) {
          waitForFinalizeReady(launchRecordingIdRef.current).then((result) => {
            if (!result.ok) {
              setContentState((prev) => ({
                ...prev,
                isFfmpegRunning: false,
                noffmpeg: true,
                ffmpegLoaded: true,
                processingProgress: 0,
              }));
              buildBlobFromChunks().catch(() => {});
              sendResponse({ status: "error", error: result.error });
              return;
            }
            buildBlobFromChunks()
              .then(() => sendResponse({ status: "ok" }))
              .catch((error) =>
                sendResponse({ status: "error", error: error.message }),
              );
          });
          return true;
        }

        buildBlobFromChunks()
          .then(() => {
            sendResponse({ status: "ok" });
          })
          .catch((error) => {
            sendResponse({ status: "error", error: error.message });
          });

        return true;
      } else if (message.type === "banner-support") {
        setContentState((prevContentState) => ({
          ...prevContentState,
          // Keep the support banner out of the review prompt slot.
          bannerSupport:
            prevContentState.reviewPrompt || prevContentState.reviewEligible
              ? prevContentState.bannerSupport
              : true,
        }));
      }
    },
    [makeVideoCheck.current, contentState, contentStateRef.current],
  );

  // sandbox self-triggers reconstruct on OPFS; recovery mode is driven by restore-recording
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search || "");
    const isRecoveryMode = params.get("mode") === "recover";
    const localRecordingId = params.get("localRecordingId");
    if (isRecoveryMode || localRecordingId) return;

    // 500ms retry in case backendRef hasn't propagated yet
    const attemptSelfTrigger = async (isRetry = false) => {
      try {
        const { lastRecordingBackendRef } = await chrome.storage.local.get([
          "lastRecordingBackendRef",
        ]);
        const backendRef = asRecordingBackendRef(lastRecordingBackendRef);
        if (cancelled) return true;
        if (backendRef?.backend === "opfs") {
          if (process.env.SAYLESS_DEV_MODE === "true") {
            console.log(
              "[recorder-opfs][sandbox] self-trigger makeVideoTab for OPFS backend",
              isRetry ? "(retry)" : "",
            );
          }
          makeVideoTab(null, { override: false });
          return true;
        }
        return false;
      } catch (err) {
        if (process.env.SAYLESS_DEV_MODE === "true") {
          console.warn(
            "[recorder-opfs][sandbox] self-trigger failed",
            err,
          );
        }
        return false;
      }
    };

    (async () => {
      const hit = await attemptSelfTrigger(false);
      if (!hit && !cancelled) {
        setTimeout(() => {
          if (!cancelled) attemptSelfTrigger(true);
        }, 500);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadLocalRecording = async () => {
      const params = new URLSearchParams(window.location.search || "");
      const localRecordingId = params.get("localRecordingId");
      if (!localRecordingId) return;
      try {
        const index = await getLocalRecordingIndex();
        const entry = index[localRecordingId];
        if (!entry) throw new Error("local-recording-index-miss");
        const blob = await readLocalRecordingBlob(entry);
        if (cancelled) return;
        setContentState((prev) => ({
          ...prev,
          localRecordingId: entry.id,
          title: entry.title || prev.title,
          recordingMeta: entry.recordingMeta || null,
          isFfmpegRunning: false,
          noffmpeg: false,
          editLimit: MAX_EDIT_LIMIT_S,
          lastRecordingBackend: entry.backendRef?.backend || "local",
        }));
        reconstructVideo(blob);
      } catch (error) {
        console.warn("[SayLess] Failed to load local recording", error);
        if (
          !cancelled &&
          typeof contentStateRef.current?.openModal === "function"
        ) {
          contentStateRef.current.openModal(
            chrome.i18n.getMessage("opfsLoadErrorTitle"),
            chrome.i18n.getMessage("opfsLoadErrorDescription"),
            null,
            chrome.i18n.getMessage("permissionsModalDismiss"),
            () => {},
            () => {},
            null,
            null,
            null,
            true,
          );
        }
        setContentState((prev) => ({
          ...prev,
          ready: true,
          recordingFailed: true,
        }));
      }
    };
    loadLocalRecording();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const messageListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: RuntimeSendResponse,
    ) => {
      const shouldKeepPortOpen = onChromeMessage(
        isRecord(message) ? message : {},
        sender,
        sendResponse,
      );
      return shouldKeepPortOpen === true;
    };

    chrome.runtime.onMessage.addListener(messageListener);

    const storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      try {
        const tabId = tabIdRef.current;
        // BG writes editorRecordingError; sandboxed context can't use runtime.onMessage
        if (changes.editorRecordingError && changes.editorRecordingError.newValue) {
          const rawPayload = changes.editorRecordingError.newValue;
          const payload = isRecord(rawPayload) ? rawPayload : {};
          // suppress when THIS editor already loaded; error belongs to a later attempt
          const editorAlreadyLoaded =
            Boolean(contentStateRef.current?.ready) ||
            Boolean(contentStateRef.current?.blob);
          if (
            !editorAlreadyLoaded &&
            (tabId == null ||
              payload?.sandboxTab == null ||
              payload.sandboxTab === tabId)
          ) {
            // same in-flight-read suppression as the runtime listener above
            if (opfsReadInFlightRef.current) {
              diagForward("sandbox-recording-error-suppressed-mid-read", {
                error: String(payload?.error || "").slice(0, 120),
                errorCode: payload?.errorCode || null,
                source: "storage",
              });
              return;
            }
            diagForward("sandbox-recording-error-received", {
              error: String(payload?.error || "").slice(0, 120),
              why: String(payload?.why || "").slice(0, 240),
              errorCode: payload?.errorCode || null,
            });
            if (
              !editorErrorShownRef.current &&
              typeof contentStateRef.current?.openModal === "function"
            ) {
              editorErrorShownRef.current = true;
              // pipeline failures get copy that says the recording may still be on-device
              const pipelineFailureCodes = new Set([
                "EDITOR_TAB_LOAD_TIMEOUT",
                "EDITOR_CONTENT_SCRIPT_TIMEOUT",
                "EDITOR_MESSAGE_DELIVERY_FAILED",
              ]);
              const isPipelineFailure = pipelineFailureCodes.has(
                String(payload?.errorCode || ""),
              );
              const isStuckTimeout =
                payload?.errorCode === "EDITOR_STUCK_TIMEOUT";
              let title;
              let description;
              if (isStuckTimeout) {
                title = chrome.i18n.getMessage("editorStuckTitle");
                description = chrome.i18n.getMessage("editorStuckDescription");
              } else if (isPipelineFailure) {
                title = chrome.i18n.getMessage("editorRecoveryFailedTitle");
                description = chrome.i18n.getMessage(
                  "editorRecoveryFailedDescription",
                );
              } else {
                title = chrome.i18n.getMessage("opfsLoadErrorTitle");
                // Never surface the raw internal `why` to users (see above).
                description = chrome.i18n.getMessage("opfsLoadErrorDescription");
              }
              contentStateRef.current.openModal(
                title,
                description,
                chrome.i18n.getMessage("editorStuckTryRecover"),
                chrome.i18n.getMessage("permissionsModalDismiss"),
                () => {
                  try {
                    chrome.runtime.sendMessage({ type: "restore-recording" });
                  } catch {}
                },
                () => {},
                null,
                null,
                null,
                false,
                chrome.i18n.getMessage("editorStuckGetHelp"),
                () => {
                  try {
                    triggerSupportDownload({ source: "editor-recovery-failed" });
                    chrome.runtime.sendMessage({
                      type: "report-error",
                      source: "editor-recovery-failed",
                      errorCode: payload?.errorCode || null,
                      zipBundled: true,
                    });
                  } catch {}
                },
              );
              setContentState((prev) => ({
                ...prev,
                ready: true,
                recordingFailed: true,
              }));
            }
          }
        }
        if (!tabId) return;
        // legacy top-frame guard (editor is always top-level now); harmless
        if (window.top !== window.self) return;
        const key = `chunks_ready_for:${tabId}`;
        if (changes[key]) {
          if (DEBUG_POSTSTOP)
            console.debug("[SayLess][Sandbox] storage fallback triggered", {
              key,
            });
          // guard against localforage throwing where IndexedDB is unavailable
          if (!window.indexedDB) {
            if (DEBUG_POSTSTOP)
              console.warn(
                "[SayLess][Sandbox] storage fallback: no indexedDB in this context, skipping",
              );
            return;
          }

          buildBlobFromChunks()
            .then((blob) => {
              if (!blob) {
                if (DEBUG_POSTSTOP)
                  console.warn(
                    "[SayLess][Sandbox] storage fallback: no blob built",
                  );
                return;
              }
              if (DEBUG_POSTSTOP)
                console.debug(
                  "[SayLess][Sandbox] storage fallback: blob built",
                  {
                    size: blob.size,
                  },
                );
            })
            .catch((err) => {
              if (DEBUG_POSTSTOP)
                console.warn(
                  "[SayLess][Sandbox] storage fallback build error",
                  err,
                );
            });
        }
      } catch (err) {
        if (DEBUG_POSTSTOP)
          console.warn("[SayLess][Sandbox] storageListener error", err);
      }
    };

    let storageListenerAttached = false;
    chrome.storage.onChanged.addListener(storageListener);
    storageListenerAttached = true;

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      if (storageListenerAttached) {
        chrome.storage.onChanged.removeListener(storageListener);
      }
    };
  }, []);

  const onMessage = async (event: MessageEvent): Promise<void> => {
    // legacy window-message path; editor-force-close now arrives via
    // chrome.runtime.onMessage. harmless no-op clearing beforeunload.
    if (event.data?.type === "editor-force-close") {
      try {
        window.onbeforeunload = null;
      } catch {}
      return;
    }
    if (event.data.type === "recording-error-from-parent") {
      const payload = event.data.payload || {};
      // suppress when this editor already loaded; parent forwards every error
      const editorAlreadyLoaded =
        Boolean(contentStateRef.current?.ready) ||
        Boolean(contentStateRef.current?.blob);
      if (editorAlreadyLoaded) return;
      diagForward("sandbox-recording-error-received-via-parent", {
        error: String(payload?.error || "").slice(0, 120),
        why: String(payload?.why || "").slice(0, 240),
        errorCode: payload?.errorCode || null,
      });
      if (
        !editorErrorShownRef.current &&
        typeof contentStateRef.current?.openModal === "function"
      ) {
        editorErrorShownRef.current = true;
        const errCode = payload?.errorCode || "OPFS_LOAD_FAILED";
        contentStateRef.current.openModal(
          chrome.i18n.getMessage("opfsLoadErrorTitle"),
          // Never surface the raw internal `why` to users (see above).
          chrome.i18n.getMessage("opfsLoadErrorDescription"),
          null,
          chrome.i18n.getMessage("permissionsModalDismiss"),
          () => {},
          () => {},
          null,
          null,
          null,
          true,
          chrome.i18n.getMessage("getHelpButton"),
          () => {
            triggerSupportDownload({ source: "opfs-load-failed" });
            chrome.runtime.sendMessage({
              type: "report-error",
              source: "opfs-load-failed",
              errorCode: errCode,
              zipBundled: true,
            });
          },
        );
        setContentState((prev) => ({
          ...prev,
          ready: true,
          recordingFailed: true,
        }));
      }
      return;
    }
    if (event.data.type === "updated-blob") {
      // discard timed-out/superseded ops
      const msgOpId = event.data._opId;
      if (msgOpId != null && msgOpId !== opIdRef.current) return;

      const base64 = event.data.base64;

      const blob = base64ToUint8Array(base64);

      const wasCropping = contentState.cropping;
      const isTopLevel = event.data.topLevel === true;
      const isFromAudio = event.data.fromAudio === true;

      if (isFromAudio && !event.data.skipReencode) {
        // legacy ffmpeg path needs a follow-up reencode; webcodecs skips
        sendMessage({
          type: "reencode-video",
          blob,
          duration: contentState.duration,
          topLevel: isTopLevel,
          _opId: event.data._opId,
        });
        return;
      }

      clearEditOp();
      checkpointCurrentLocalEdit(blob);

      setContentState((prev) => {
        const wasFirstReady = !prev.mp4ready && isTopLevel;
        if (wasFirstReady) {
          chrome.runtime.sendMessage({ type: "diag-editor-ready", path: "updated-blob" }).catch(() => {});
        }
        return {
          ...prev,
          blob: blob,
          mp4ready: true,
          hasBeenEdited: event.data.edited === false ? prev.hasBeenEdited : true,
          isFfmpegRunning: false,
          reencoding: false,
          trimming: false,
          cutting: false,
          muting: false,
          cropping: false,
          processingProgress: 0,
          editErrorType: null,
          hasTempChanges: !isTopLevel,

          ...(prev.fromCropper && { mode: "player", fromCropper: false }),
          ...(prev.fromAudio ? { mode: "player", fromAudio: false } : {}),
        };
      });

      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = async () => {
        if (process.env.SAYLESS_DEV_MODE === "true") {
          console.log("[SayLess][cut-debug] updated-blob received", {
            blobSize: blob.size,
            blobIsBlob: blob instanceof Blob,
            measuredDuration: video.duration,
            previousDuration: contentState.duration,
            isFromAudio,
            wasCropping,
            wasCutting: contentState.cutting,
            wasMuting: contentState.muting,
            wasTrimming: contentState.trimming,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
          });
        }
        setContentState((prev) => ({
          ...prev,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          start: 0,
          end: 1,
          ...(wasCropping ? { top: 0, left: 0 } : {}),
        }));

        if (event.data.addToHistory) {
          contentState.addToHistory();
        }

        URL.revokeObjectURL(video.src);
        video.remove();
      };

      video.src = URL.createObjectURL(blob);

      if (!contentState.originalBlob && isTopLevel) {
        setContentState((prev) => ({
          ...prev,
          originalBlob: blob,
        }));
      }
    } else if (event.data.type === "download-mp4") {
      const base64 = event.data.base64;

      const blob = base64ToUint8Array(base64);
      const url = URL.createObjectURL(blob);
      await requestDownload(url, ".mp4");
      setContentState((prevContentState) => ({
        ...prevContentState,
        saved: true,
        isFfmpegRunning: false,
        downloading: false,
      }));
      finishExportJob({ status: "completed" });
    } else if (event.data.type === "download-gif") {
      const base64 = event.data.base64;
      const blob = base64ToUint8Array(base64);
      const url = URL.createObjectURL(blob);
      await requestDownload(url, ".gif");
      setContentState((prevContentState) => ({
        ...prevContentState,
        saved: true,
        isFfmpegRunning: false,
        downloadingGIF: false,
        processingProgress: 0,
      }));
      finishExportJob({ status: "completed" });
    } else if (event.data.type === "new-frame") {
      // crop entries leak blob URLs otherwise
      const prevFrame = contentStateRef.current?.frame;
      if (typeof prevFrame === "string" && prevFrame.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prevFrame);
        } catch {}
      }
      const url = URL.createObjectURL(event.data.frame);
      setContentState((prevContentState) => ({
        ...prevContentState,
        frame: url,
        isFfmpegRunning: false,
        // defer the mode flip until the frame's in hand, else the cropper
        // mounts over an empty stage (black flash)
        ...(prevContentState.pendingCropEntry
          ? { mode: "crop", pendingCropEntry: false }
          : {}),
      }));
    } else if (event.data.type === "ffmpeg-loaded") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        ffmpeg: true,
        ffmpegLoaded: true,
        isFfmpegRunning: false,
      }));
    } else if (event.data.type === "ffmpeg-load-error") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        ffmpeg: true,
        noffmpeg: true,
        ffmpegLoaded: true,
        isFfmpegRunning: false,
      }));
      console.log("[SayLess][Editor] recording-complete sent from ffmpeg-load-error fallback");
      chrome.runtime.sendMessage({ type: "recording-complete" });
    } else if (event.data.type === "ffmpeg-error") {
      console.warn("FFmpeg error:", {
        error: event.data.error,
        errorMessage: event.data.errorMessage,
        opType: event.data.opType,
        errorStack: event.data.errorStack,
      });
      clearEditOp();

      const latest = contentStateRef.current;
      const wasExporting =
        latest?.downloading ||
        latest?.downloadingWEBM ||
        latest?.downloadingGIF ||
        latest?.exportJob?.status === "running";
      if (wasExporting) {
        finishExportJob({
          status: "failed",
          error: String(
            event.data.errorMessage ||
              event.data.error ||
              "Media export failed.",
          ),
        });
      }

      // fall back to webm/rawBlob even if conversion fails
      setContentState((prev) => {
        const wasEditing = prev.isFfmpegRunning && (prev.cutting || prev.trimming || prev.muting || prev.cropping || prev.reencoding);
        return {
          ...prev,
          noffmpeg: true,
          ffmpegLoaded: true,
          isFfmpegRunning: false,
          downloading: false,
          downloadingWEBM: false,
          downloadingGIF: false,
          muting: false,
          cutting: false,
          trimming: false,
          reencoding: false,
          cropping: false,
          processingProgress: 0,
          editErrorType: wasEditing ? "failed" : prev.editErrorType,
          ...(prev.rawBlob || prev.webm
            ? { ready: true, webm: prev.webm || prev.rawBlob }
            : {}),
        };
      });

      chrome.runtime.sendMessage({ type: "recording-complete" });
    } else if (event.data.type === "audio-too-large") {
      clearEditOp();
      setContentState((prev) => ({
        ...prev,
        isFfmpegRunning: false,
        muting: false,
        cutting: false,
        trimming: false,
        reencoding: false,
        cropping: false,
        processingProgress: 0,
        editErrorType: "audio-too-large",
      }));
    } else if (event.data.type === "edit-too-long") {
      // Too long for in-browser processing, reset so user can retry or trim.
      clearEditOp();
      setContentState((prev) => ({
        ...prev,
        isFfmpegRunning: false,
        muting: false,
        cutting: false,
        trimming: false,
        reencoding: false,
        cropping: false,
        processingProgress: 0,
        editErrorType: "too-long",
      }));
    } else if (event.data.type === "crop-update") {
      setContentState((prevContentState) => ({
        ...prevContentState,
        mode: "crop",
        cropping: false,
        isFfmpegRunning: false,
        processingProgress: 0,
        start: 0,
        end: 1,
        fromCropper: false,
      }));

      setTimeout(() => {
        if (contentState.getFrame) {
          contentState.getFrame();
        }
      }, 100);
    } else if (event.data.type === "ffmpeg-progress") {
      const pct = Math.min(100, Math.max(0, Math.round(event.data.progress)));

      updateExportJobProgress(pct);
      setContentState((prevContentState) => ({
        ...prevContentState,
        processingProgress: pct,
      }));
    } else if (event.data.type === "download-webm") {
      const base64 = event.data.base64;
      const blob = base64ToUint8Array(base64);

      const url = URL.createObjectURL(blob);
      await requestDownload(url, ".webm");

      setContentState((prevState) => ({
        ...prevState,
        saved: true,
        isFfmpegRunning: false,
        downloadingWEBM: false,
        processingProgress: 0,
      }));
      finishExportJob({ status: "completed" });
    }
  };

  useEffect(() => {
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onMessage]);

  // ask the bridge for any editorRecordingError set before this editor loaded
  useEffect(() => {
    try {
      window.postMessage({ type: "request-recording-error-state" }, "*");
    } catch {}
  }, []);

  // run editor ops in-process; `reply` re-emits the result as a window 'message'
  // so existing onMessage listeners fire unchanged. deferred to a microtask so
  // results land async (avoids re-entrant setState).
  const sendMessage = (message: EditorOpMessage): void => {
    const reply: Reply = (resultMsg) => {
      try {
        window.dispatchEvent(new MessageEvent("message", { data: resultMsg }));
      } catch {}
    };
    Promise.resolve().then(() =>
      runEditorOp(message, reply, { viewer: isViewer }),
    );
  };

  // off-thread the WebM duration fix via editor.html (CSP allows blob workers);
  // same shape as fix-webm-duration, sync fallback
  const requestParentFixWebmDuration = (
    blob: Blob,
    durationMs: number,
    callback: (fixed: Blob) => void,
  ): void => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const id = "wdf-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    function finish(fixed: Blob | null) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onResult);
      if (fixed) {
        callback(fixed);
      } else {
        try {
          fixWebmDuration(blob, durationMs, (fixedBlob) => callback(fixedBlob), {
            logger: false,
          });
        } catch (err) {
          callback(blob);
        }
      }
    }
    function onResult(e: MessageEvent) {
      const d = e && e.data;
      if (!d || d.type !== "fix-webm-duration-result" || d.id !== id) return;
      finish(d.blob || null);
    }
    window.addEventListener("message", onResult);
    timer = setTimeout(function () {
      finish(null);
    }, 90000);
    try {
      sendMessage({ type: "fix-webm-duration", id, blob, durationMs });
    } catch (err) {
      finish(null);
    }
  };


  const getBlob = async () => {
    if (
      contentState.noffmpeg ||
      (contentState.duration > contentState.editLimit && !contentState.override)
    ) {
      return;
    }

    const webmVideo = base64ToUint8Array(contentState.base64);

    setContentState((prevState) => ({
      ...prevState,
      webm: webmVideo,
      ready: true,
    }));

    if (contentState.offline && contentState.ffmpeg === true) {
    } else if (
      !contentState.updateChrome &&
      (contentState.duration <= contentState.editLimit || contentState.override)
    ) {
      setContentState((prevState) => ({
        ...prevState,
        isFfmpegRunning: true,
      }));
      if (typeof contentState.base64 !== "string") return;
      sendMessage({
        type: "base64-to-blob",
        base64: contentState.base64,
        topLevel: true,
      });
    }

    chrome.runtime.sendMessage({ type: "recording-complete" });
  };

  useEffect(() => {
    if (!contentState.base64) return;
    if (!contentState.ffmpeg) return;
    if (!contentState.ffmpegLoaded) return;

    getBlob();
  }, [contentState.base64, contentState.ffmpeg, contentState.ffmpegLoaded]);

  // 30s fallback for blocked CDN / worker crash; force recovery mode
  useEffect(() => {
    if (!contentState.base64) return;
    if (!contentState.ffmpeg) return;
    if (contentState.ffmpegLoaded) return;
    if (contentState.noffmpeg) return;

    const timer = setTimeout(() => {
      const current = contentStateRef.current;
      if (current.ffmpegLoaded || current.noffmpeg) return;
      chrome.storage.local.set({ editorLoadTimeoutAt: Date.now() });
      setContentState((prev) => {
        if (prev.ffmpegLoaded || prev.noffmpeg) return prev;
        // also set ready: getBlob early-returns on noffmpeg so ready wouldn't fire
        const fallbackWebm = prev.webm || prev.rawBlob;
        return {
          ...prev,
          noffmpeg: true,
          ffmpegLoaded: true,
          fallback: true,
          ...(fallbackWebm && !prev.ready
            ? { webm: fallbackWebm, ready: true }
            : {}),
        };
      });
      console.log("[SayLess][Editor] recording-complete sent from ffmpeg-load-timeout fallback");
      chrome.runtime.sendMessage({ type: "recording-complete" });
    }, 30000);

    return () => clearTimeout(timer);
  }, [contentState.base64, contentState.ffmpeg, contentState.ffmpegLoaded, contentState.noffmpeg]);

  const getImage = useCallback(async () => {
    if (!contentState.blob) return;
    if (!contentState.ffmpeg) return;
    if (contentState.isFfmpegRunning) return;

    setContentState((prevState) => ({
      ...prevState,
      isFfmpegRunning: true,
    }));

    sendMessage({ type: "get-frame", time: 0, blob: contentState.blob });
  }, [contentState.blob, contentState.ffmpeg, contentState.isFfmpegRunning]);

  const beginEditOp = () => {
    if (editWatchdogRef.current) {
      clearTimeout(editWatchdogRef.current);
    }
    opIdRef.current += 1;
    const id = opIdRef.current;
    editWatchdogRef.current = setTimeout(() => {
      editWatchdogRef.current = null;
      opIdRef.current += 1;
      setContentState((prev) => ({
        ...prev,
        isFfmpegRunning: false,
        muting: false,
        cutting: false,
        trimming: false,
        reencoding: false,
        cropping: false,
        processingProgress: 0,
        editErrorType: "timeout",
      }));
    }, 5 * 60 * 1000);
    return id;
  };

  const clearEditOp = () => {
    if (editWatchdogRef.current) {
      clearTimeout(editWatchdogRef.current);
      editWatchdogRef.current = null;
    }
  };

  const cancelEditOp = () => {
    opIdRef.current += 1;
    clearEditOp();
    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: false,
      muting: false,
      cutting: false,
      trimming: false,
      reencoding: false,
      cropping: false,
      processingProgress: 0,
    }));
  };

  const addAudio = async (
    videoBlob: Blob | null,
    audioBlob: Blob,
    volume: number,
  ): Promise<void> => {
    if (contentState.isFfmpegRunning) return;
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;

    const sourceBlob = videoBlob || contentState.blob || contentState.webm;
    const opId = beginEditOp();

    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: true,
      processingProgress: 0,
      editErrorType: null,
    }));

    sendMessage({
      type: "add-audio-to-video",
      blob: sourceBlob,
      audio: audioBlob,
      duration: contentState.duration,
      volume: volume,
      replaceAudio: contentState.replaceAudio,
      topLevel: false,
      _opId: opId,
    });
  };

  const handleTrim = async (cut: boolean): Promise<void> => {
    if (contentState.isFfmpegRunning) return;
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;
    // undo/redo/keyboard/programmatic restore can leave start>=end; bail clearly
    if (
      !Number.isFinite(contentState.start) ||
      !Number.isFinite(contentState.end) ||
      contentState.start >= contentState.end
    ) {
      setContentState((prev) => ({
        ...prev,
        editErrorType: "invalid-trim-range",
      }));
      return;
    }

    const sourceBlob = contentState.blob;
    if (!sourceBlob) return;
    const opId = beginEditOp();

    if (process.env.SAYLESS_DEV_MODE === "true") {
      console.log("[SayLess][cut-debug] handleTrim dispatch", {
        cut,
        opId,
        sourceBlobSize: sourceBlob?.size,
        sourceBlobType: sourceBlob?.type,
        duration: contentState.duration,
        start: contentState.start,
        end: contentState.end,
        startTime: contentState.start * contentState.duration,
        endTime: contentState.end * contentState.duration,
        expectedOutputDuration: cut
          ? contentState.duration -
            (contentState.end * contentState.duration -
              contentState.start * contentState.duration)
          : contentState.end * contentState.duration -
            contentState.start * contentState.duration,
      });
    }

    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: true,
      processingProgress: 0,
      editErrorType: null,
      [cut ? "cutting" : "trimming"]: true,
    }));

    sendMessage({
      type: "cut-video",
      blob: sourceBlob,
      startTime: contentState.start * contentState.duration,
      endTime: contentState.end * contentState.duration,
      cut,
      duration: contentState.duration,
      encode: false,
      topLevel: false,
      _opId: opId,
    });
  };

  const handleMute = async () => {
    if (contentState.isFfmpegRunning) return;
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;
    if (
      !Number.isFinite(contentState.start) ||
      !Number.isFinite(contentState.end) ||
      contentState.start >= contentState.end
    ) {
      setContentState((prev) => ({
        ...prev,
        editErrorType: "invalid-trim-range",
      }));
      return;
    }

    const sourceBlob = contentState.blob;
    if (!sourceBlob) return;
    const opId = beginEditOp();

    setContentState((prev) => ({
      ...prev,
      muting: true,
      isFfmpegRunning: true,
      processingProgress: 0,
      editErrorType: null,
    }));

    sendMessage({
      type: "mute-video",
      blob: sourceBlob,
      startTime: contentState.start * contentState.duration,
      endTime: contentState.end * contentState.duration,
      duration: contentState.duration,
      topLevel: false,
      _opId: opId,
    });
  };

  const handleCrop = async (
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<true | undefined> => {
    if (contentState.isFfmpegRunning || contentState.cropping) return;
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;

    const opId = beginEditOp();

    setContentState((prevState) => ({
      ...prevState,
      cropping: true,
      isFfmpegRunning: true,
      processingProgress: 0,
      editErrorType: null,
    }));

    const sourceBlob = contentState.blob;
    if (!sourceBlob) return;

    sendMessage({
      type: "crop-video",
      blob: sourceBlob,
      x,
      y,
      width,
      height,
      topLevel: false,
      _opId: opId,
    });

    return true;
  };

  const handleReencode = async (topLevel = false) => {
    if (contentState.isFfmpegRunning) return;

    const sourceBlob = contentState.blob;
    if (!sourceBlob) return;
    const opId = beginEditOp();

    setContentState((prevState) => ({
      ...prevState,
      isFfmpegRunning: true,
      reencoding: true,
      processingProgress: 0,
      editErrorType: null,
    }));

    sendMessage({
      type: "reencode-video",
      blob: sourceBlob,
      duration: contentState.duration,
      topLevel,
      _opId: opId,
    });

    return true;
  };

  const sanitizeDownloadFilename = (
    name: unknown,
    { maxLen = 180 }: { maxLen?: number } = {},
  ): string => {
    let out = String(name ?? "");
    out = out.replace(/[\\/:*?"<>|]/g, " ");
    out = out.replace(/[\u0000-\u001F\u007F]/g, " ");
    out = out.replace(/\s+/g, " ").trim();
    out = out.replace(/[. ]+$/g, "");

    if (!out) out = "SayLess recording";
    if (out.length > maxLen) out = out.slice(0, maxLen).trim();

    return out;
  };

  const requestDownload = async (
    url: string,
    ext: string,
  ): Promise<number | null | undefined> => {
    const exportUrl = assertLocalExportObjectUrl(url);
    // rapid double-click would otherwise create two downloads + double-revoke
    if (contentStateRef.current?.downloadInProgress) {
      console.warn("[SayLess] download already in progress, ignoring");
      return;
    }
    setContentState((prev) => ({
      ...prev,
      downloadInProgress: true,
      downloadError: null,
    }));

    const rawTitle = contentStateRef.current.title || "SayLess recording";

    const base = sanitizeDownloadFilename(rawTitle);
    const filename = `${base}${ext}`;

    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      try {
        URL.revokeObjectURL(exportUrl);
      } catch {}
      try {
        setContentState((prev) => ({ ...prev, downloadInProgress: false }));
      } catch {}
    };

    if (contentStateRef.current?.preferFilePicker) {
      const resp = await fetch(assertLocalExportObjectUrl(exportUrl));
      const blob = await resp.blob();
      try {
        const pickerResult = await saveBlobWithPicker(blob, filename);
        if (pickerResult.saved || pickerResult.reason === "cancelled") {
          revoke();
          return null;
        }
      } catch (err) {
        console.warn(
          "[SayLess] Save picker failed, falling back to Chrome download.",
          err,
        );
      }
    }

    // Brave: route via background for download
    if (
      typeof navigator.brave?.isBrave === "function" &&
      (await navigator.brave.isBrave())
    ) {
      const resp = await fetch(assertLocalExportObjectUrl(exportUrl));
      const blob = await resp.blob();
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          chrome.runtime.sendMessage({
            type: "request-download",
            base64: reader.result,
            title: filename,
          });
          revoke();
          resolve();
        };
        reader.readAsDataURL(blob);
      });
      return;
    }

    const downloadId = await new Promise<number | null>((resolve, reject) => {
      chrome.downloads.download(
        { url: assertLocalExportObjectUrl(exportUrl), filename, saveAs: true },
        (id) => {
          const lastErr = chrome.runtime.lastError;
          // user cancelled Save-As; don't show "Download failed"
          const errMsg = String(lastErr?.message || "");
          if (errMsg.includes("USER_CANCELED") || errMsg.includes("canceled")) {
            revoke();
            resolve(null);
            return;
          }
          if (lastErr || !id) {
            reject(lastErr || new Error("Download failed"));
          } else {
            resolve(id);
          }
        },
      );
    });
    if (downloadId == null) return null;
    setContentState((prev) => ({
      ...prev,
      lastExportDownloadId: downloadId,
    }));

    await new Promise<void>((resolve) => {
      let settled = false;
      const timeoutMs = 10 * 60 * 1000;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          chrome.downloads.onChanged.removeListener(handler);
        } catch {}
        revoke();
        console.warn(
          "[SayLess] download status listener timed out, releasing handle",
          { downloadId, filename, timeoutMs },
        );
        // surface error so editor toasts fire; silent resolve would mask as success
        try {
          setContentState((prev) => ({
            ...prev,
            downloadError: "timeout",
            downloadInProgress: false,
          }));
        } catch {}
        resolve();
      }, timeoutMs);

      const handler = async (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId || !delta.state) return;

        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          chrome.downloads.onChanged.removeListener(handler);
          revoke();
          resolve();
        };

        if (
          delta.state.current === "interrupted" &&
          delta.error?.current !== "USER_CANCELED"
        ) {
          try {
            const resp = await fetch(assertLocalExportObjectUrl(exportUrl));
            const blob = await resp.blob();
            // sendMessage caps at ~64MB; base64 inflates 4/3, so cap at 30MB
            const BASE64_FALLBACK_MAX_BYTES = 30 * 1024 * 1024;
            if (blob.size > BASE64_FALLBACK_MAX_BYTES) {
              try {
                setContentState((prev) => ({
                  ...prev,
                  downloadError: "interrupted-too-large",
                  downloadInProgress: false,
                }));
              } catch {}
              try {
                chrome.runtime.sendMessage({
                  type: "show-toast",
                  message: chrome.i18n.getMessage(
                    "downloadInterruptedLargeToast",
                  ),
                  timeout: 8000,
                });
              } catch {}
            } else {
              await new Promise<void>((res) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  chrome.runtime.sendMessage({
                    type: "request-download",
                    base64: reader.result,
                    title: filename,
                  });
                  res();
                };
                reader.readAsDataURL(blob);
              });
            }
          } finally {
            done();
          }
        } else if (
          delta.state.current === "complete" ||
          delta.state.current === "interrupted"
        ) {
          done();
        }
      };

      chrome.downloads.onChanged.addListener(handler);
    });
    return downloadId;
  };

  // fMP4 -> standard MP4 container copy (QuickTime/editors need fastStart).
  // BufferTarget required: fastStart:false patches the mdat size with a trailing
  // positioned write that a stream-to-blob pipe would drop.
  const remuxFragmentedToStandardMp4 = async (
    fragmentedBlob: Blob,
    onProgress?: (progress: number) => void,
  ): Promise<Blob> => {
    const {
      Input,
      Output,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
      ALL_FORMATS,
      Conversion,
    } = await loadMb();
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(fragmentedBlob),
    });
    const target = new BufferTarget();
    const output = new Output({
      target,
      format: new Mp4OutputFormat({ fastStart: false }),
    });
    const conversion = await Conversion.init({
      input,
      output,
      video: { forceTranscode: false },
      audio: { forceTranscode: false },
    });
    if (typeof onProgress === "function") {
      conversion.onProgress = (p) => onProgress(p);
    }
    await conversion.execute();
    if (!target.buffer) throw new Error("MP4 remux produced no output buffer");
    return new Blob([target.buffer], { type: "video/mp4" });
  };

  // OPFS sync access handle in an offscreen worker; bypasses BufferTarget's 2 GB cap
  const remuxViaOffscreenOpfs = async (
    fragmentedBlob: Blob,
    onProgress?: (progress: number) => void,
    kind = "remux",
  ): Promise<Blob> => {
    const requestId =
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const devLog =
      process.env.SAYLESS_DEV_MODE === "true"
        ? (label: string, data?: unknown) =>
            console.log("[remux][sandbox]", label, data || "")
        : (_label: string, _data?: unknown) => {};
    devLog("offscreen-remux-start", {
      requestId,
      inputBytes: fragmentedBlob?.size,
    });

    const progressListener = (msg: unknown) => {
      if (!isRecord(msg)) return;
      if (
        msg?.type === "remux-progress" &&
        msg.requestId === requestId &&
        typeof onProgress === "function"
      ) {
        onProgress(Number(msg.progress) || 0);
      }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    // sendMessage's structured clone is lossy for Blobs across the SW
    // (BlobSource rejects with "blob must be a Blob"); transport via OPFS+filename
    const outputFileName = `remux-${requestId}.${
      kind === "webm" ? "webm" : "mp4"
    }`;
    let opfsDir;
    try {
      opfsDir = await navigator.storage.getDirectory();
    } catch (err) {
      chrome.runtime.onMessage.removeListener(progressListener);
      throw new Error(
        `opfs-unavailable: ${errorMessage(err).slice(0, 120)}`,
      );
    }

    // reuse OPFS input when size matches; edits diverge so fall back to staging
    let stagedInputFileName = null;
    let inputFileName;
    try {
      const { lastRecordingBackendRef: rawBackendRef } = await chrome.storage.local.get([
        "lastRecordingBackendRef",
      ]);
      const lastRecordingBackendRef = asRecordingBackendRef(rawBackendRef);
      if (
        lastRecordingBackendRef?.backend === "opfs" &&
        typeof lastRecordingBackendRef.fileName === "string" &&
        lastRecordingBackendRef.fileName.length > 0
      ) {
        try {
          const handle = await opfsDir.getFileHandle(
            lastRecordingBackendRef.fileName,
          );
          const opfsFile = await handle.getFile();
          if (
            fragmentedBlob &&
            typeof fragmentedBlob.size === "number" &&
            opfsFile.size === fragmentedBlob.size
          ) {
            inputFileName = lastRecordingBackendRef.fileName;
            devLog("reused-opfs-input", { inputFileName });
          } else {
            devLog("opfs-input-size-mismatch-skipping-reuse", {
              opfsBytes: opfsFile.size,
              blobBytes: fragmentedBlob?.size,
            });
          }
        } catch {}
      }
    } catch {}

    try {
      if (!inputFileName) {
        stagedInputFileName = `remux-in-${requestId}.mp4`;
        const inputHandle = await opfsDir.getFileHandle(stagedInputFileName, {
          create: true,
        });
        const writable = await inputHandle.createWritable();
        await writable.write(fragmentedBlob);
        await writable.close();
        inputFileName = stagedInputFileName;
        devLog("staged-input-in-opfs", { inputFileName });
      }

      const rawResponse: unknown = await chrome.runtime.sendMessage({
        type: "remux-request",
        kind,
        requestId,
        inputFileName,
        outputFileName,
      });
      const response = isRecord(rawResponse) ? rawResponse : {};
      if (response.ok !== true) {
        devLog("offscreen-remux-response-bad", rawResponse);
        throw new Error(String(response.error || "offscreen-remux-failed"));
      }

      const outputHandle = await opfsDir.getFileHandle(outputFileName);
      const file = await outputHandle.getFile();
      const outputBlob = new Blob([file], {
        type: kind === "webm" ? "video/webm" : "video/mp4",
      });
      devLog("offscreen-remux-ok", { outputBytes: outputBlob.size });
      return outputBlob;
    } finally {
      chrome.runtime.onMessage.removeListener(progressListener);
      // never delete the recording itself
      if (stagedInputFileName) {
        try {
          await opfsDir.removeEntry(stagedInputFileName).catch(() => {});
        } catch {}
      }
      // output left in place; worker's age-based sweep cleans next remux
    }
  };

  // A remux can stall indefinitely on a huge file (offscreen worker wedged,
  // slow disk): reject if no progress lands within the window so download()
  // falls through to the next tier or the raw-fMP4 fallback instead of hanging.
  // Resets on every progress tick, so a slow-but-advancing remux is never cut.
  const REMUX_STALL_MS = 60000;
  const runRemuxWithStallGuard = <T,>(
    startFn: (onProgress: (progress: number) => void) => Promise<T> | T,
    baseProgress?: (progress: number) => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`remux-stalled-${REMUX_STALL_MS}ms`));
        }, REMUX_STALL_MS);
      };
      const onProgress = (p: number) => {
        arm();
        if (typeof baseProgress === "function") baseProgress(p);
      };
      arm();
      Promise.resolve(startFn(onProgress)).then(
        (v) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          reject(e);
        },
      );
    });

  const standardMp4Ref = useRef<StandardMp4Cache | null>(null);
  const downloadCancelledRef = useRef(false);
  const exportAbortControllerRef = useRef<AbortController | null>(null);

  const beginExportJob = ({
    kind,
    label,
    canCancel = true,
  }: CreateExportJobOptions = {}): string => {
    const now = Date.now();
    const job = { kind, label, canCancel };
    setContentState((prev) => beginExportJobState(prev, job, now));
    return `${kind || "export"}-${now}`;
  };

  const updateExportJobProgress = (progress: number): void => {
    setContentState((prev) => updateExportJobProgressState(prev, progress));
  };

  const finishExportJob = ({
    status,
    error = null,
  }: {
    status: Exclude<ExportJobStatus, "running">;
    error?: string | null;
    downloadId?: unknown;
  }): void => {
    const now = Date.now();
    setContentState((prev) =>
      finishExportJobState(prev, { status, error }, now),
    );
  };

  const dismissExportJob = () => {
    setContentState(dismissExportJobState);
  };

  // Cancel an in-progress download/conversion so the user isn't stuck waiting on
  // a slow WebM re-encode. Resets the UI immediately and best-effort aborts the
  // offscreen worker; the pending conversion's deliver step is skipped below.
  const cancelDownload = () => {
    downloadCancelledRef.current = true;
    exportAbortControllerRef.current?.abort?.();
    exportAbortControllerRef.current = null;
    chrome.runtime.sendMessage({ type: "cancel-remux" }).catch(() => {});
    const now = Date.now();
    setContentState((prev) => cancelExportJobState(prev, now));
  };

  // Only surface finalize progress while a download is actually in flight, so
  // the background pre-warm doesn't flash a progress bar during editing.
  const sharedFinalizeProgress = (p: number): void => {
    if (!contentStateRef.current?.downloading) return;
    updateExportJobProgress(Math.round(p * 100));
    setContentState((prev) => ({
      ...prev,
      processingProgress: Math.round(p * 100),
    }));
  };

  // Remux the fragmented recording MP4 to a standard (moov-at-end) MP4 the way
  // QuickTime/Premiere/upload widgets expect. Two tiers: offscreen OPFS
  // streaming (bounded memory, any size), then in-editor BufferTarget. Returns
  // { blob, path }; blob is null if both tiers fail (caller serves fragmented).
  const produceStandardMp4 = async (
    blob: Blob,
  ): Promise<StandardMp4Result> => {
    const inputSize = blob?.size || 0;
    let remuxedBlob = null;
    let remuxPath = null;
    try {
      diagForward("remux-offscreen-start", { inputBytes: inputSize });
      remuxedBlob = await runRemuxWithStallGuard(
        (pg) => remuxViaOffscreenOpfs(blob, pg),
        sharedFinalizeProgress,
      );
      remuxPath = "offscreen-opfs";
      diagForward("remux-offscreen-ok", { inputBytes: inputSize });
    } catch (err) {
      console.warn("[SayLess] offscreen remux failed, falling back", err);
      diagForward("remux-offscreen-fail", {
        inputBytes: inputSize,
        err: errorMessage(err).slice(0, 200),
      });
    }
    // tier 2 is an in-editor BufferTarget remux the offscreen cancel-remux
    // can't reach, so skip it if the user already cancelled; otherwise a
    // cancel during tier 1 still kicks off a full in-editor remux. download()
    // resets the flag and re-runs this if the cache shows failed.
    if (!remuxedBlob && !downloadCancelledRef.current) {
      try {
        remuxedBlob = await runRemuxWithStallGuard(
          (pg) => remuxFragmentedToStandardMp4(blob, pg),
          sharedFinalizeProgress,
        );
        remuxPath = "buffer-target";
        diagForward("remux-buffer-target-ok", { inputBytes: inputSize });
      } catch (err) {
        console.warn(
          "[SayLess] buffer-target remux failed, falling back",
          err,
        );
        diagForward("remux-buffer-target-fail", {
          inputBytes: inputSize,
          err: errorMessage(err).slice(0, 200),
        });
      }
    }
    return { blob: remuxedBlob, path: remuxPath };
  };

  // Cache + dedupe the standard-MP4 finalize, keyed on the exact source blob so
  // an edit (which produces a new blob) re-finalizes. Lets the result be pre-
  // warmed in the background on editor-ready and reused instantly on download.
  const ensureStandardMp4 = () => {
    const blob = contentStateRef.current?.blob;
    if (!blob || blob.type !== "video/mp4") {
      return Promise.resolve({ blob: null, path: null });
    }
    const cur = standardMp4Ref.current;
    if (
      cur &&
      cur.forBlob === blob &&
      (cur.status === "ready" || cur.status === "pending")
    ) {
      return cur.promise;
    }
    const promise = produceStandardMp4(blob).then((res) => {
      standardMp4Ref.current = {
        status: res.blob ? "ready" : "failed",
        promise,
        forBlob: blob,
        blob: res.blob,
        path: res.path,
      };
      return res;
    });
    standardMp4Ref.current = {
      status: "pending",
      promise,
      forBlob: blob,
      blob: null,
      path: null,
    };
    return promise;
  };

  // Pre-warm the standard MP4 in the background once the editor is ready so the
  // download is an instant file-save. Failures are cached; download() falls
  // back to the fragmented file. Skipped when the flag is off.
  useEffect(() => {
    if (!ENABLE_EAGER_MP4_FINALIZE) return;
    if (!contentState.ready) return;
    if (contentState.blob?.type !== "video/mp4") return;
    if (standardMp4Ref.current?.forBlob === contentState.blob) return;
    ensureStandardMp4().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentState.ready, contentState.blob]);

  const isAbortError = (err: unknown): boolean =>
    (err instanceof DOMException && err.name === "AbortError") ||
    /abort|cancel/i.test(errorMessage(err));

  const renderPendingTimelineForDownload = async (
    latest: EditorContentState,
  ): Promise<{
    blob: Blob | null | undefined;
    timelineExport: boolean;
    cancelled?: boolean;
  }> => {
    const sourceBlob = latest.blob || latest.webm;
    if (typeof latest.getTimelineExportBlob !== "function") {
      return { blob: sourceBlob, timelineExport: false };
    }
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    exportAbortControllerRef.current = controller;
    let rendered: Blob | null = null;
    try {
      rendered = await latest.getTimelineExportBlob(
        (progress) => {
          const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
          updateExportJobProgress(pct);
          setContentState((prev) => ({
            ...prev,
            processingProgress: pct,
          }));
          if (downloadCancelledRef.current) {
            controller?.abort?.();
          }
        },
        { signal: controller?.signal },
      );
    } catch (err) {
      if (downloadCancelledRef.current || isAbortError(err)) {
        return { blob: sourceBlob, timelineExport: false, cancelled: true };
      }
      throw err;
    } finally {
      if (exportAbortControllerRef.current === controller) {
        exportAbortControllerRef.current = null;
      }
    }
    if (downloadCancelledRef.current) {
      return { blob: sourceBlob, timelineExport: false, cancelled: true };
    }
    return {
      blob: rendered || sourceBlob,
      timelineExport: Boolean(rendered),
    };
  };

  const getExportDuration = (latest: EditorContentState): number => {
    const timelineDuration = Number(latest.timelineExportDuration);
    return Number.isFinite(timelineDuration) && timelineDuration > 0
      ? timelineDuration
      : latest.duration;
  };

  const download = async () => {
    // ref: rapid clicks fire before state propagates
    const latest = contentStateRef.current || contentState;
    // isFfmpegRunning leaks from bg poll handlers and swallows real clicks;
    // downloading is the real lock
    if (latest.downloading) return;
    downloadCancelledRef.current = false;
    beginExportJob({ kind: "mp4", label: "MP4 export" });

    setContentState((prev) => ({
      ...prev,
      downloading: true,
      isFfmpegRunning: true,
      processingProgress: 0,
    }));

    let exportBlob = latest.blob;
    let exportedFromTimeline = false;
    try {
      const prepared = await renderPendingTimelineForDownload(latest);
      if (prepared.cancelled) return;
      exportBlob = prepared.blob || latest.blob;
      exportedFromTimeline = prepared.timelineExport;
    } catch (err) {
      console.error("[SayLess] timeline export failed before download", err);
      setContentState((prev) => ({
        ...prev,
        downloading: false,
        isFfmpegRunning: false,
        processingProgress: 0,
        editErrorType: "failed",
      }));
      finishExportJob({
        status: "failed",
        error: "Timeline render failed before MP4 export.",
      });
      return;
    }

    if (!exportBlob) {
      setContentState((prev) => ({
        ...prev,
        downloading: false,
        isFfmpegRunning: false,
        processingProgress: 0,
      }));
      finishExportJob({
        status: "failed",
        error: "No recording blob available.",
      });
      return;
    }

    const inputSize = exportBlob?.size || 0;
    const remuxStartedAt = Date.now();
    let remuxedBlob = null;
    let remuxPath = null;

    // Reuse the background pre-warm if it finished (instant) or is in flight
    // (await it); otherwise this runs the finalize now. Keyed on the blob, so
    // an edited recording re-finalizes before download.
    try {
      const res = exportedFromTimeline
        ? await produceStandardMp4(exportBlob)
        : await ensureStandardMp4();
      remuxedBlob = res.blob;
      remuxPath = res.path;
    } catch (err) {
      console.warn("[SayLess] standard mp4 finalize failed", err);
    }

    const remuxDurationMs = Date.now() - remuxStartedAt;
    const finalPath = remuxPath || "fmp4-fallback";
    if (process.env.SAYLESS_DEV_MODE === "true") {
      console.log("[remux][sandbox] summary", {
        path: finalPath,
        durationMs: remuxDurationMs,
        inputBytes: inputSize,
        outputBytes: remuxedBlob?.size || 0,
      });
    }
    setContentState((prev) => ({
      ...prev,
      lastDownloadInfo: {
        path: finalPath,
        durationMs: remuxDurationMs,
        inputBytes: inputSize,
        outputBytes: remuxedBlob?.size || 0,
        timelineExport: exportedFromTimeline,
        at: Date.now(),
      },
    }));

    if (downloadCancelledRef.current) {
      setContentState((prev) => ({
        ...prev,
        downloading: false,
        isFfmpegRunning: false,
        processingProgress: 0,
      }));
      return;
    }
    try {
      if (remuxedBlob) {
        const url = URL.createObjectURL(remuxedBlob);
        await requestDownload(url, ".mp4");
        URL.revokeObjectURL(url);
        setContentState((prev) => ({ ...prev, saved: true }));
        finishExportJob({ status: "completed" });
        diagForward("remux-delivered", {
          inputBytes: inputSize,
          outputBytes: remuxedBlob.size || 0,
          path: remuxPath,
        });
      } else {
        throw new Error("both-remux-paths-failed");
      }
    } catch (err) {
      console.error("MP4 download failed:", err);
      // tier 3: serve fMP4 as-is so the user doesn't lose the recording
      try {
        const url = URL.createObjectURL(exportBlob);
        await requestDownload(url, ".mp4");
        URL.revokeObjectURL(url);
        setContentState((prev) => ({ ...prev, saved: true }));
        finishExportJob({ status: "completed" });
      } catch (fallbackErr) {
        console.error("MP4 fallback download failed:", fallbackErr);
        finishExportJob({
          status: "failed",
          error: errorMessage(fallbackErr || "MP4 export failed."),
        });
      }
    } finally {
      setContentState((prev) => ({
        ...prev,
        downloading: false,
        isFfmpegRunning: false,
        processingProgress: 0,
      }));
    }
  };

  const downloadWEBM = async () => {
    const latest = contentStateRef.current || contentState;
    if (latest.downloadingWEBM) return;
    downloadCancelledRef.current = false;
    beginExportJob({ kind: "webm", label: "WebM export" });

    const sourceBlob = latest.blob || latest.webm;
    const hasTimelineExport = typeof latest.getTimelineExportBlob === "function";

    if (!sourceBlob) {
      finishExportJob({ status: "failed", error: "No recording blob available." });
      return;
    }

    const hasFFmpeg = latest.ffmpegLoaded && !latest.noffmpeg;
    const isAlreadyWebm = sourceBlob.type === "video/webm";

    if (!hasTimelineExport && (!hasFFmpeg || isAlreadyWebm)) {
      const url = URL.createObjectURL(sourceBlob);
      await requestDownload(url, ".webm");

      setContentState((prevState) => ({
        ...prevState,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        saved: true,
      }));
      finishExportJob({ status: "completed" });
      return;
    }

    if (!hasTimelineExport && !latest.hasBeenEdited && latest.webm) {
      const url = URL.createObjectURL(latest.webm);
      await requestDownload(url, ".webm");

      setContentState((prev) => ({
        ...prev,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        saved: true,
      }));
      finishExportJob({ status: "completed" });
      return;
    }

    // MP4 -> WebM here is a software VP9 re-encode (no hardware encoder on most
    // setups), so it can take minutes on a long recording. Warn first and offer
    // the instant MP4 instead.
    const webmChoice = await new Promise((resolve) => {
      const open = contentStateRef.current?.openModal;
      if (typeof open !== "function") {
        resolve("webm");
        return;
      }
      open(
        chrome.i18n.getMessage("webmSlowTitle"),
        chrome.i18n.getMessage("webmSlowDescription"),
        chrome.i18n.getMessage("webmSlowMp4"),
        chrome.i18n.getMessage("webmSlowContinue"),
        () => resolve("mp4"),
        () => resolve("webm"),
      );
    });
    if (webmChoice === "mp4") {
      download();
      return;
    }

    setContentState((prevState) => ({
      ...prevState,
      downloadingWEBM: true,
      isFfmpegRunning: true,
      processingProgress: 0,
    }));

    let exportBlob = sourceBlob;
    let exportedFromTimeline = false;
    try {
      const prepared = await renderPendingTimelineForDownload(latest);
      if (prepared.cancelled) return;
      exportBlob = prepared.blob || sourceBlob;
      exportedFromTimeline = prepared.timelineExport;
    } catch (err) {
      console.error("[SayLess] timeline export failed before WebM download", err);
      setContentState((prev) => ({
        ...prev,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        processingProgress: 0,
        editErrorType: "failed",
      }));
      finishExportJob({
        status: "failed",
        error: "Timeline render failed before WebM export.",
      });
      return;
    }

    if (!hasFFmpeg && exportBlob.type === "video/mp4") {
      try {
        const url = URL.createObjectURL(exportBlob);
        await requestDownload(url, ".mp4");
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[SayLess] webm fallback download failed", err);
      }
      setContentState((prevState) => ({
        ...prevState,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        saved: true,
      }));
      finishExportJob({ status: "completed" });
      return;
    }

    // Offscreen re-encode (OPFS-streamed, bounded memory) so large MP4s don't
    // OOM the in-editor BufferTarget path. On any failure (incl. a 60s no-
    // progress stall) we deliver the source so the user is never stuck.
    if (ENABLE_OFFSCREEN_WEBM) {
      let webmBlob = null;
      try {
        webmBlob = await runRemuxWithStallGuard(
          (pg) => remuxViaOffscreenOpfs(exportBlob, pg, "webm"),
          (p) => {
            updateExportJobProgress(Math.round(p * 100));
            setContentState((prev) => ({
              ...prev,
              processingProgress: Math.round(p * 100),
            }));
          },
        );
      } catch (err) {
        console.warn(
          "[SayLess] offscreen webm convert failed, falling back",
          err,
        );
      }
      if (downloadCancelledRef.current) {
        setContentState((prevState) => ({
          ...prevState,
          downloadingWEBM: false,
          isFfmpegRunning: false,
          processingProgress: 0,
        }));
        return;
      }
      const blobToSave = webmBlob || exportBlob;
      const ext = blobToSave.type === "video/webm" ? ".webm" : ".mp4";
      try {
        const url = URL.createObjectURL(blobToSave);
        await requestDownload(url, ext);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[SayLess] webm download failed", err);
      }
      setContentState((prevState) => ({
        ...prevState,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        saved: true,
        lastDownloadInfo: {
          ...(prevState.lastDownloadInfo || {}),
          timelineExport: exportedFromTimeline,
          at: Date.now(),
        },
      }));
      finishExportJob({ status: "completed" });
      return;
    }

    sendMessage({
      type: "to-webm",
      blob: exportBlob,
      duration: getExportDuration(latest),
    });

    // The transcode delivers the file via the "download-webm" message handler
    // and progress via "ffmpeg-progress". Guard against a stalled or failed
    // transcode (large MP4s can exhaust ffmpeg): if no progress or completion
    // lands within the window, deliver the source as-is so the user isn't stuck
    // on an endless "processing". Resets on every progress tick.
    const WEBM_STALL_MS = 60000;
    const completed = await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener("message", handler);
      };
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, WEBM_STALL_MS);
      };
      function handler(event: MessageEvent) {
        const t = event.data?.type;
        if (t === "ffmpeg-progress") {
          arm();
        } else if (t === "download-webm") {
          cleanup();
          resolve(true);
        } else if (t === "ffmpeg-error") {
          cleanup();
          resolve(false);
        }
      }
      window.addEventListener("message", handler);
      arm();
    });

    if (!completed) {
      // Stalled or failed: deliver the source as-is so the user isn't stuck.
      // It's already a finalized, playable file; use its real extension.
      const ext = exportBlob.type === "video/webm" ? ".webm" : ".mp4";
      try {
        const url = URL.createObjectURL(exportBlob);
        await requestDownload(url, ext);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[SayLess] webm fallback download failed", err);
      }
      setContentState((prevState) => ({
        ...prevState,
        downloadingWEBM: false,
        isFfmpegRunning: false,
        saved: true,
      }));
      finishExportJob({ status: "completed" });
    }
    // On success the "download-webm" handler delivered the file and cleared the
    // downloading flags, so there is nothing more to do here.
  };

  const downloadGIF = async (options: GifExportOptions = {}) => {
    // ref: rapid clicks fire before state propagates
    const latest = contentStateRef.current || contentState;
    // don't gate on isFfmpegRunning (leaks from bg poll); downloadingGIF is the lock
    if (latest.downloadingGIF || latest.downloading) {
      return;
    }
    beginExportJob({ kind: "gif", label: "GIF export" });
    const gifDuration = Number(options.durationSeconds);
    const durationForLimit =
      Number.isFinite(gifDuration) && gifDuration > 0
        ? gifDuration
        : getExportDuration(latest);
    if (durationForLimit > 30) {
      try {
        chrome.runtime.sendMessage({
          type: "show-toast",
          message: chrome.i18n.getMessage("downloadGIFTooLongToast"),
          timeout: 6000,
        });
      } catch {}
      finishExportJob({
        status: "failed",
        error: "GIF export is limited to 30 seconds.",
      });
      return;
    }

    setContentState((prevState) => ({
      ...prevState,
      downloadingGIF: true,
      isFfmpegRunning: true,
      processingProgress: 0,
    }));

    let exportBlob = latest.blob;
    try {
      const prepared = await renderPendingTimelineForDownload(latest);
      if (prepared.cancelled) return;
      exportBlob = prepared.blob || latest.blob;
    } catch (err) {
      console.error("[SayLess] timeline export failed before GIF download", err);
      setContentState((prev) => ({
        ...prev,
        downloadingGIF: false,
        isFfmpegRunning: false,
        processingProgress: 0,
        editErrorType: "failed",
      }));
      finishExportJob({
        status: "failed",
        error: "Timeline render failed before GIF export.",
      });
      return;
    }

    if (!exportBlob) {
      finishExportJob({ status: "failed", error: "No recording blob available." });
      return;
    }
    sendMessage({
      type: "to-gif",
      blob: exportBlob,
      options,
    });
  };

  const loadFFmpeg = async () => {
    sendMessage({ type: "load-ffmpeg" });
  };

  const waitForUpdatedBlob = (): Promise<void> => {
    return new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "updated-blob") {
          window.removeEventListener("message", handler);
          resolve();
        }
      };
      window.addEventListener("message", handler);
    });
  };

  contentState.undo = undo;
  contentState.redo = redo;
  contentState.addToHistory = addToHistory;
  contentState.handleTrim = handleTrim;
  contentState.handleMute = handleMute;
  contentState.download = download;
  contentState.cancelDownload = cancelDownload;
  contentState.beginExportJob = beginExportJob;
  contentState.updateExportJobProgress = updateExportJobProgress;
  contentState.finishExportJob = finishExportJob;
  contentState.dismissExportJob = dismissExportJob;
  contentState.handleCrop = handleCrop;
  contentState.handleReencode = handleReencode;
  contentState.getFrame = getImage;
  contentState.downloadGIF = downloadGIF;
  contentState.downloadWEBM = downloadWEBM;
  contentState.addAudio = addAudio;
  contentState.loadFFmpeg = loadFFmpeg;
  contentState.waitForUpdatedBlob = waitForUpdatedBlob;
  contentState.createBackup = createBackup;
  contentState.restoreBackup = restoreBackup;
  contentState.clearBackup = clearBackup;
  contentState.cancelEditOp = cancelEditOp;

  return (
    <ContentStateContext.Provider value={[contentState, setContentState]}>
      {children}
      {process.env.SAYLESS_DEV_MODE === "true" && (
        <DevHUD
          setContentState={setContentState}
          contentStateRef={contentStateRef}
          lastDownloadInfo={contentState.lastDownloadInfo}
          lastRecordingBackend={contentState.lastRecordingBackend}
        />
      )}
    </ContentStateContext.Provider>
  );
};

export default ContentState;
