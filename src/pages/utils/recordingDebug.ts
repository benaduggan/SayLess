let recordingDebugEnabled = false;
let recordingDebugSession: RecordingDebugSession | null = null;

declare global {
  interface Window {
    SAYLESS_DEBUG_RECORDER?: boolean;
  }
}

export interface RecordingDebugSession {
  sessionId: string;
  startTimeMs: number;
  startPerfMs: number | null;
}

type SessionRef = { current?: RecordingDebugSession | null };

const isSessionRef = (value: RecordingDebugSession | SessionRef): value is SessionRef =>
  "current" in value;

interface DebugChromeApi {
  storage?: {
    local?: {
      get?: (keys: string[]) => Promise<Record<string, unknown>>;
      set?: (values: Record<string, unknown>) => Promise<void>;
      remove?: (keys: string[]) => Promise<void>;
    };
  };
  runtime?: { sendMessage?: (message: unknown) => unknown };
}

const chromeApi = (): DebugChromeApi | undefined =>
  (globalThis as typeof globalThis & { chrome?: DebugChromeApi }).chrome;

const hasWindowDebugFlag = (): boolean => {
  if (typeof window === "undefined") return false;
  return !!window.SAYLESS_DEBUG_RECORDER;
};

const ensureSession = (sessionOverride?: RecordingDebugSession | null): RecordingDebugSession => {
  if (sessionOverride?.sessionId) return sessionOverride;
  if (recordingDebugSession?.sessionId) return recordingDebugSession;

  const sessionId = `recdbg-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const startTimeMs = Date.now();
  recordingDebugSession = {
    sessionId,
    startTimeMs,
    startPerfMs: null,
  };

  try {
    chromeApi()?.storage?.local?.set?.({
      recordingDebugEnabled: true,
      recordingDebugSessionId: sessionId,
      recordingDebugStartMs: startTimeMs,
    });
  } catch {}

  return recordingDebugSession;
};

export const hydrateRecordingDebugFlag = async (): Promise<void> => {
  try {
    const res = await chromeApi()?.storage?.local?.get?.([
      "recordingDebugEnabled",
      "recordingDebugSessionId",
      "recordingDebugStartMs",
    ]);
    recordingDebugEnabled = Boolean(res?.recordingDebugEnabled || res?.recordingDebugSessionId);
    if (res?.recordingDebugSessionId) {
      recordingDebugSession = {
        sessionId: String(res.recordingDebugSessionId),
        startTimeMs: Number(res.recordingDebugStartMs) || Date.now(),
        startPerfMs: null,
      };
    }
  } catch {}
};

export const resetRecordingDebugSession = async (): Promise<void> => {
  recordingDebugEnabled = false;
  recordingDebugSession = null;
  try {
    await chromeApi()?.storage?.local?.remove?.([
      "recordingDebugEnabled",
      "recordingDebugSessionId",
      "recordingDebugStartMs",
    ]);
  } catch {}
};

export const isRecordingDebugEnabled = (): boolean => recordingDebugEnabled || hasWindowDebugFlag();

export const debugRecordingEventWithSession = (
  session: RecordingDebugSession | null | undefined,
  eventType: string,
  payload: unknown,
): void => {
  if (!isRecordingDebugEnabled()) return;
  const activeSession = ensureSession(session);
  const now = Date.now();
  const tSinceStartMs = activeSession?.startTimeMs != null ? now - activeSession.startTimeMs : null;

  try {
    chromeApi()?.runtime?.sendMessage?.({
      type: "recdbg",
      eventType,
      payload,
      sessionId: activeSession?.sessionId || null,
      tSinceStartMs,
      ts: now,
    });
  } catch {}
};

export const debugRecordingEvent = (
  sessionRef: RecordingDebugSession | SessionRef | null | undefined,
  eventType: string,
  payload: unknown,
): void => {
  const session =
    sessionRef && isSessionRef(sessionRef) ? sessionRef.current || null : sessionRef || null;
  debugRecordingEventWithSession(session, eventType, payload);
};
