/**
 * Ring-buffer diagnostic log stored in chrome.storage.local ("diagnosticLog").
 * Max 5 sessions, 100 events each. Used in the background service worker.
 */

const MAX_SESSIONS = 5;
const MAX_EVENTS = 100;
const FLUSH_EVERY_N = 10;

export interface DiagnosticEvent {
  t: number;
  e: string;
  d?: unknown;
  n?: number;
  lt?: number;
}

export interface DiagnosticSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  outcome: string;
  config: Record<string, unknown>;
  events: DiagnosticEvent[];
}

export interface DiagnosticLog {
  schemaVersion: number;
  sessions: DiagnosticSession[];
}

interface DiagnosticLogChromeApi {
  storage: {
    local: {
      get: (keys: string | readonly string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
}

const chromeApi = (): DiagnosticLogChromeApi =>
  (globalThis as typeof globalThis & { chrome: DiagnosticLogChromeApi }).chrome;

const emptyLog = (): DiagnosticLog => ({ schemaVersion: 1, sessions: [] });

const parseLog = (value: unknown): DiagnosticLog => {
  if (typeof value !== "object" || value === null) return emptyLog();
  const candidate = value as Partial<DiagnosticLog>;
  if (!Array.isArray(candidate.sessions)) return emptyLog();
  return {
    schemaVersion:
      typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1,
    sessions: candidate.sessions as DiagnosticSession[],
  };
};

// Force-flush on lifecycle/error events so they survive SW termination.
const ALWAYS_FLUSH: string[] = [
  "error",
  "crash",
  "start-fail",
  "warning",
  "session-start",
  "stop",
  "stop-tab",
  "editor-open",
  "chunks-sent",
  "chunks-fail",
  "sw-init",
  "countdown-started",
  "countdown-cancelled",
  "countdown-finished",
  "pause",
  "resume",
  "restart-requested",
  "restart-completed",
  "restart-failed",
  "alarm-fired",
  "recorded-tab-closed",
  "recorded-tab-navigated",
  "local-export-start",
  "local-export-ok",
  "local-export-fail",
  "local-save-fail",
  "editor-load-ready",
  // OPFS load + video element handoff: critical for diagnosing
  // editor-stuck-at-90% reports. If any of these is the last event
  // before a hang, that's the step that hung.
  "sandbox-opfs-reader-open-done",
  "sandbox-opfs-readblob-start",
  "sandbox-opfs-readblob-done",
  "sandbox-opfs-readblob-slow-finalize",
  "sandbox-opfs-materialize-start",
  "sandbox-opfs-materialize-done",
  "sandbox-opfs-materialize-fail",
  "sandbox-opfs-arraybuffer-done",
  "sandbox-opfs-materialize-skipped",
  "sandbox-video-src-set",
  "sandbox-video-loadedmetadata",
  "sandbox-video-load-error",
  "sandbox-opfs-wait-finalize-timeout",
  "sandbox-opfs-writer-dead-detected",
  "sandbox-opfs-materialize-deferred",
  "session-deferred-end",
  "editor-route-decision",
];

let _log: DiagnosticLog | null = null;
let _dirty = 0;

const now = (): number => Date.now();

const makeId = (): string =>
  `diag-${now()}-${Math.random().toString(16).slice(2, 7)}`;

const currentSession = (): DiagnosticSession | null => {
  if (!_log || !_log.sessions || _log.sessions.length === 0) return null;
  const last = _log.sessions[_log.sessions.length - 1];
  return last.endedAt == null ? last : null;
};

const flush = async (): Promise<void> => {
  if (!_log) return;
  _dirty = 0;
  try {
    await chromeApi().storage.local.set({ diagnosticLog: _log });
  } catch {}
};

const maybeFlush = (): void => {
  _dirty += 1;
  if (_dirty >= FLUSH_EVERY_N) {
    flush();
  }
};

/** Hydrate the in-memory log from storage. Call once on SW init. */
export const hydrateDiagnosticLog = async (): Promise<void> => {
  try {
    const res = await chromeApi().storage.local.get("diagnosticLog");
    _log = parseLog(res.diagnosticLog);
  } catch {
    _log = emptyLog();
  }
};

/** Start a new session. Call from startRecording(). */
export const initDiagSession = async (
  config: Record<string, unknown> = {},
): Promise<string> => {
  if (!_log) await hydrateDiagnosticLog();

  const session: DiagnosticSession = {
    id: makeId(),
    startedAt: now(),
    endedAt: null,
    outcome: "in-progress",
    config,
    events: [],
  };

  _log!.sessions.push(session);

  while (_log!.sessions.length > MAX_SESSIONS) {
    _log!.sessions.shift();
  }

  await flush();
  return session.id;
};

/** Append an event to the current open session. */
export const diagEvent = (eventType: string, data?: unknown): void => {
  const s = currentSession();
  if (!s) return;

  const t = now() - s.startedAt;

  // Collapse repeats of the same type into one entry with a count, so retry
  // spam can't flood the buffer and evict the event that explains the failure.
  for (let i = s.events.length - 1; i >= 0; i -= 1) {
    if (s.events[i].e === eventType) {
      s.events[i].n = (s.events[i].n || 1) + 1;
      s.events[i].lt = t;
      if (ALWAYS_FLUSH.includes(eventType)) flush();
      else maybeFlush();
      return;
    }
  }

  const entry: DiagnosticEvent = {
    t,
    e: eventType,
  };
  if (data !== undefined && data !== null) {
    entry.d = data;
  }

  s.events.push(entry);

  while (s.events.length > MAX_EVENTS) {
    s.events.shift();
  }

  // Force-flush on lifecycle/error events so they survive SW termination.
  if (ALWAYS_FLUSH.includes(eventType)) {
    flush();
  } else {
    maybeFlush();
  }
};

/** Close the current session with a final outcome. */
export const endDiagSession = async (outcome = "ok"): Promise<void> => {
  const s = currentSession();
  if (!s) return;
  s.endedAt = now();
  s.outcome = outcome;
  await flush();
};

/** Return the full diagnostic log (for export). */
export const getDiagnosticLog = async (): Promise<DiagnosticLog> => {
  if (!_log) await hydrateDiagnosticLog();
  return _log!;
};

/** Collect error-state keys from storage into one object. */
export const getErrorSnapshot = async (): Promise<Record<string, unknown>> => {
  const keys = [
    "lastRecordingError",
    "lastChunkSendFailure",
    "recorderSession",
    "freeRecorderSession",
    "fastRecorderValidation",
    "fastRecorderProbe",
    "fastRecorderDecision",
    "fastRecorderDisabledReason",
    "fastRecorderDisabledDetails",
    "fastRecorderDisabledAt",
    "memoryError",
    "recordingAttemptId",
    // WebCodecs failure/retry diagnostics; the rich payload that turns
    // "my recording failed" into a precise diagnosis (zero-frame vs
    // configure-failed vs flush-timeout vs HW-encoder-quota).
    "lastWebCodecsFailureCode",
    "lastWebCodecsFailureDetail",
    "lastWebCodecsSwRetry",
    "lastWebCodecsFailureAt",
    // Recorder-level stop classification + mid-stream source-end
    // diagnostic. Cover the non-WebCodecs and "encoder ran fine but
    // source disappeared" failure shapes.
    "lastRecorderStopReason",
    "lastRecorderStopAt",
    "lastTrackEndEvent",
    "lastTrackEndedEvent",
    "lastLocalRecorderSourceLoss",
  ];
  try {
    return await chromeApi().storage.local.get(keys);
  } catch {
    return {};
  }
};

/** Read current state flags for export. */
export const getStorageFlags = async (): Promise<Record<string, unknown>> => {
  const keys = [
    "recording",
    "pendingRecording",
    "restarting",
    "paused",
    "offscreen",
    "sendingChunks",
    "postStopEditorOpening",
    "postStopEditorOpened",
    "recordingStartTime",
    "totalPausedMs",
    "recordingDuration",
    "recordingTab",
    "sandboxTab",
    "recordingUiTabId",
    "fastRecorderInUse",
    "memoryError",
    "lowStorageAbortAt",
    "lowStorageAbortChunks",
    "editorLoadTimeoutAt",
    "lastRestartFlow",
    "restartFlowHistory",
    "lastFirstChunkWatchdog",
    // Local recorder lifecycle state machine and message-flow flags used to
    // debug double-prompt / silent-close scenarios.
    "recorderSession",
    "recorderPipelineState",
    "lastStartRecordingTabMessage",
    "lastRecordingBackendRef",
    "screenTrackLog",
    "localRestartPhase",
    "localRestartHistory",
    "tabPreferred",
    "tabStreamIdCache",
    "region",
    "customRegion",
    "multiMode",
    "multiProjectId",
    "multiSceneCount",
    "multiLastSceneId",
    "sceneId",
    "sceneIdStatus",
    "projectId",
  ];
  try {
    return await chromeApi().storage.local.get(keys);
  } catch {
    return {};
  }
};
