// Start-flow trace for recording diagnostics. One bounded object in
// chrome.storage.local, overwritten each attempt. No URLs, no page content.

const STORAGE_KEY = "startFlowTrace";
const MAX_ERR_LEN = 120;

export interface StartFlowConfig {
  recordingType?: string | null;
  surface?: string | null;
  countdown?: boolean;
}

export interface StartFlowStuckState {
  state: string;
  since?: number;
  durationMs: number;
}

export interface StartFlowTrace {
  attemptId: string | null;
  recordingType: string | null;
  surface: string | null;
  countdown: boolean;
  outcome: string;
  t: Record<string, number | null>;
  routing: Record<string, unknown>;
  error: string | null;
  errorCode: string | null;
  stuck: StartFlowStuckState | null;
  [key: string]: unknown;
}

interface TraceChromeApi {
  storage: {
    local: {
      get: (keys: string) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: { sendMessage: (message: unknown) => unknown };
}

const chromeApi = (): TraceChromeApi =>
  (globalThis as typeof globalThis & { chrome: TraceChromeApi }).chrome;

const readStoredTrace = (value: unknown): StartFlowTrace | null =>
  typeof value === "object" && value !== null ? (value as StartFlowTrace) : null;
// Off in prod by default; set globalThis.SAYLESS_DEBUG_RECORDER for support.
const DEBUG_FLOW =
  process.env.NODE_ENV !== "production" ||
  (typeof globalThis !== "undefined" &&
    !!(globalThis as typeof globalThis & { SAYLESS_DEBUG_RECORDER?: boolean })
      .SAYLESS_DEBUG_RECORDER);

const sanitize = (str: unknown): string | null => {
  if (!str) return null;
  return String(str)
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/chrome-extension:\/\/[^\s)]+/gi, "[ext]")
    .slice(0, MAX_ERR_LEN);
};

/** Create a fresh trace for a new recording attempt. */
export const initStartFlowTrace = async (
  attemptId?: string | null,
  config: StartFlowConfig = {},
): Promise<StartFlowTrace> => {
  const trace: StartFlowTrace = {
    attemptId: attemptId || null,
    recordingType: config.recordingType || null,
    surface: config.surface || null,
    countdown: Boolean(config.countdown),
    outcome: "in-progress",

    t: {
      startStreaming: null,
      desktopCaptureSent: null,
      recorderTabCreated: null,
      streamAcquired: null,
      preparingSent: null,
      preparingReceived: null,
      resetActiveTabSent: null,
      readyToRecordSent: null,
      readyToRecordReceived: null,
      countdownStart: null,
      countdownEnd: null,
      recordingStarted: null,
    },

    routing: {
      targetTabId: null,
      activeTab: null,
      currentTabId: null,
      shouldFocusTab: null,
    },

    error: null,
    errorCode: null,
    stuck: null,
  };

  try {
    await chromeApi().storage.local.set({ [STORAGE_KEY]: trace });
  } catch {
    // best effort
  }
  return trace;
};

/** Write a timestamp checkpoint. Merges extra fields without overwriting others. */
export const traceStep = async (
  stepName: string,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  const now = Date.now();
  try {
    const res = await chromeApi().storage.local.get(STORAGE_KEY);
    const trace = readStoredTrace(res[STORAGE_KEY]);
    if (!trace) return;

    if (trace.t && stepName in trace.t) {
      trace.t[stepName] = now;
    }

    // Merge extra fields (surface, routing, etc.)
    for (const [key, value] of Object.entries(extra)) {
      if (key === "routing" && typeof value === "object" && value !== null) {
        Object.assign(trace.routing, value);
      } else if (key !== "t") {
        trace[key] = value;
      }
    }

    await chromeApi().storage.local.set({ [STORAGE_KEY]: trace });

    // Mirror every tick to BG so the unified timeline is visible on
    // the SW console even when the originating tab is gone. Uses
    // console.warn because Terser strips log/info/debug in prod.
    const base = trace.t?.startStreaming;
    const elapsedMs = base ? now - base : 0;
    if (DEBUG_FLOW) {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          `[start-flow T+${elapsedMs}ms] ${stepName}`,
          Object.keys(extra).length ? extra : "",
        );
      } catch {}
    }
    try {
      chromeApi().runtime.sendMessage({
        type: "start-flow-tick",
        event: stepName,
        data: { ...extra, elapsedMs },
        ts: now,
      });
    } catch {}
  } catch {
    // best effort
  }
};

/** Set the final outcome. Only overwrites "in-progress". */
export const setStartFlowOutcome = async (
  outcome: string,
  extra: {
    error?: unknown;
    errorCode?: string | null;
    stuck?: StartFlowStuckState | null;
  } = {},
): Promise<void> => {
  try {
    const res = await chromeApi().storage.local.get(STORAGE_KEY);
    const trace = readStoredTrace(res[STORAGE_KEY]);
    if (!trace) return;

    const wasInProgress = trace.outcome === "in-progress";
    if (wasInProgress) {
      trace.outcome = outcome;
    }

    if (extra.error) trace.error = sanitize(extra.error);
    if (extra.errorCode) trace.errorCode = extra.errorCode;
    if (extra.stuck) trace.stuck = extra.stuck;

    await chromeApi().storage.local.set({ [STORAGE_KEY]: trace });
  } catch {
    // best effort
  }
};

/** Read the current trace for export. */
export const getStartFlowTrace = async (): Promise<StartFlowTrace | null> => {
  try {
    const res = await chromeApi().storage.local.get(STORAGE_KEY);
    return readStoredTrace(res[STORAGE_KEY]);
  } catch {
    return null;
  }
};

/** Format the trace as a compact human-readable timeline. */
export const formatStartFlowTimeline = (trace?: StartFlowTrace | null): string | null => {
  if (!trace?.t) return null;

  const base = trace.t.startStreaming;
  if (!base) return null;

  const STEP_ORDER = [
    "startStreaming",
    "desktopCaptureSent",
    "recorderTabCreated",
    "streamAcquired",
    "preparingSent",
    "preparingReceived",
    "resetActiveTabSent",
    "readyToRecordSent",
    "readyToRecordReceived",
    "countdownStart",
    "countdownEnd",
    "recordingStarted",
  ];

  const lines: string[] = [];
  for (const step of STEP_ORDER) {
    const ts = trace.t[step];
    if (ts != null) {
      const delta = ts - base;
      lines.push(`  ${step.padEnd(26)} T+${delta}ms`);
    } else {
      lines.push(`  ${step.padEnd(26)} (not reached)`);
    }
  }

  const lastTs = trace.t.recordingStarted;
  const outcomeStr = trace.outcome || "unknown";
  if (lastTs) {
    lines.push(`  Outcome: ${outcomeStr} (${((lastTs - base) / 1000).toFixed(2)}s total)`);
  } else {
    lines.push(`  Outcome: ${outcomeStr}`);
  }

  if (trace.stuck) {
    lines.push(`  Stuck: ${trace.stuck.state} for ${trace.stuck.durationMs}ms`);
  }

  return lines.join("\n");
};
