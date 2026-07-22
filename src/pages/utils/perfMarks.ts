// Perf instrumentation; enabled in prod too (300-event-per-context
// cap, 250ms debounced flush) so user diag zips have the full
// stop→editor timing. Labels are hardcoded; payloads are caller ints/
// strings. Console "[perf]" lines stay dev-only.
const DEV = process.env.SAYLESS_DEV_MODE === "true";
const ENABLED = true;

export type PerfMetadata = Record<string, unknown> | null;
export type EndPerfSpan = (metadata?: PerfMetadata) => void;

export interface PerfEntry {
  t: number;
  perfNow: number | null;
  ctx: string;
  label: string;
  sessionId: string | null;
  meta?: PerfMetadata;
}

interface PerfChromeApi {
  storage: {
    local: {
      get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime?: { sendMessage?: (message: unknown) => Promise<unknown> };
}

const chromeApi = (): PerfChromeApi =>
  (globalThis as typeof globalThis & { chrome: PerfChromeApi }).chrome;

const noop = (_value?: unknown): void => {};
const noopSpan = (): EndPerfSpan => () => {};
const noopAsyncArr = async (): Promise<PerfEntry[]> => [];

const buildDevImpl = () => {
  // Per-context storage keys avoid the read-modify-write race that loses
  // marks when contexts share a single key. dumpPerf merges at read time.
  const STORAGE_KEY_BASE = "perfTimeline";
  const MAX_EVENTS = 300;
  const FLUSH_DEBOUNCE_MS = 250;

  const detectContext = (): string => {
    try {
      if (typeof window === "undefined") return "BG";
      const path = (window.location && window.location.pathname) || "";
      if (path.endsWith("/region.html")) return "Region";
      if (path.endsWith("/recorder.html")) return "Recorder";
      if (path.endsWith("/editor.html")) return "Editor";
      if (path.endsWith("/offscreenrecorder.html")) return "OffscreenRecorder";
      if (path.endsWith("/remuxoffscreen.html")) return "RemuxOffscreen";
      if (path.endsWith("/popup.html")) return "Popup";
      return "Content";
    } catch {
      return "unknown";
    }
  };

  const CTX = detectContext();
  const STORAGE_KEY = `${STORAGE_KEY_BASE}.${CTX}`;
  const localBuf: PerfEntry[] = [];
  let lastMarkPerfNow: number | null = null;
  let pendingFlush: ReturnType<typeof setTimeout> | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let cachedSessionId: string | null = null;

  const refreshSessionId = (): void => {
    try {
      chromeApi().storage.local
        .get(["recordingAttemptId"])
        .then((res) => {
          cachedSessionId =
            typeof res.recordingAttemptId === "string"
              ? res.recordingAttemptId
              : cachedSessionId;
        })
        .catch(() => {});
    } catch {}
  };

  const flushNow = (): void => {
    if (!localBuf.length) return;
    const batch = localBuf.splice(0, localBuf.length);
    writeChain = writeChain
      .then(async () => {
        try {
          const res = await chromeApi().storage.local.get([STORAGE_KEY]);
          const cur: PerfEntry[] = Array.isArray(res[STORAGE_KEY])
            ? (res[STORAGE_KEY] as PerfEntry[])
            : [];
          for (const e of batch) cur.push(e);
          while (cur.length > MAX_EVENTS) cur.shift();
          await chromeApi().storage.local.set({ [STORAGE_KEY]: cur });
        } catch {}
      })
      .catch(() => {});
  };

  const scheduleFlush = (): void => {
    if (pendingFlush) return;
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      flushNow();
    }, FLUSH_DEBOUNCE_MS);
  };

  const emit = (label: string, meta: PerfMetadata): void => {
    if (!cachedSessionId) refreshSessionId();
    const now = Date.now();
    const perfNow =
      typeof performance !== "undefined" ? performance.now() : null;
    const delta =
      perfNow !== null && lastMarkPerfNow !== null
        ? Math.round(perfNow - lastMarkPerfNow)
        : null;
    lastMarkPerfNow = perfNow;
    const entry: PerfEntry = {
      t: now,
      perfNow,
      ctx: CTX,
      label,
      sessionId: cachedSessionId || null,
    };
    if (meta && typeof meta === "object") {
      try {
        const json = JSON.stringify(meta);
        entry.meta = json.length > 400 ? { _truncated: true } : meta;
      } catch {
        entry.meta = { _serializeError: true };
      }
    }
    localBuf.push(entry);
    if (DEV) {
      try {
        const tag = delta !== null ? `+${delta}ms` : "";
        if (meta) {
          console.debug("[perf]", CTX, label, tag, meta);
        } else {
          console.debug("[perf]", CTX, label, tag);
        }
      } catch {}
    }
    scheduleFlush();
  };

  const perfMarkImpl = (label: string, meta: PerfMetadata = null): void => {
    try {
      emit(label, meta);
    } catch {}
  };

  const perfSpanImpl = (
    label: string,
    startMeta: PerfMetadata = null,
  ): EndPerfSpan => {
    const startPerf =
      typeof performance !== "undefined" ? performance.now() : null;
    try {
      emit(`${label}.start`, startMeta);
    } catch {}
    return (endMeta: PerfMetadata = null): void => {
      try {
        const dur =
          startPerf !== null && typeof performance !== "undefined"
            ? Math.round(performance.now() - startPerf)
            : null;
        emit(
          `${label}.end`,
          endMeta
            ? { ...endMeta, durMs: dur }
            : dur !== null
            ? { durMs: dur }
            : null,
        );
      } catch {}
    };
  };

  const perfResetImpl = (sessionId: string | null = null): void => {
    try {
      cachedSessionId = sessionId;
      lastMarkPerfNow = null;
      chromeApi().storage.local.get(null).then((all) => {
        const cleared: Record<string, unknown[]> = {};
        for (const k of Object.keys(all || {})) {
          if (k === STORAGE_KEY_BASE || k.startsWith(`${STORAGE_KEY_BASE}.`)) {
            cleared[k] = [];
          }
        }
        if (Object.keys(cleared).length > 0) {
          chromeApi().storage.local.set(cleared).catch(() => {});
        }
      }).catch(() => {});
    } catch {}
  };

  const getPerfTimelineImpl = async (): Promise<PerfEntry[]> => {
    try {
      const all = await chromeApi().storage.local.get(null);
      const merged: PerfEntry[] = [];
      for (const k of Object.keys(all || {})) {
        if (k === STORAGE_KEY_BASE || k.startsWith(`${STORAGE_KEY_BASE}.`)) {
          const arr = all[k];
        if (Array.isArray(arr)) merged.push(...(arr as PerfEntry[]));
        }
      }
      merged.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      return merged;
    } catch {
      return [];
    }
  };

  const formatTimeline = (
    entries: PerfEntry[],
    sessionId: string | null = null,
  ): string => {
    const filtered = sessionId
      ? entries.filter((e) => e.sessionId === sessionId)
      : entries;
    if (!filtered.length) return "[perf] no entries";
    const t0 = filtered[0].t;
    const lines = ["[perf] timeline (relative to first mark):"];
    let prevT = t0;
    for (const e of filtered) {
      const rel = e.t - t0;
      const delta = e.t - prevT;
      prevT = e.t;
      const meta = e.meta ? " " + JSON.stringify(e.meta) : "";
      lines.push(
        `+${String(rel).padStart(6)}ms (Δ${String(delta).padStart(5)}ms) ${e.ctx.padEnd(8)} ${e.label}${meta}`,
      );
    }
    return lines.join("\n");
  };

  try {
    const target =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof self !== "undefined"
        ? self
        : null;
    if (target) {
      const perfTarget = target as typeof globalThis & {
        dumpPerf?: (sessionId?: string | null) => Promise<PerfEntry[]>;
        resetPerf?: (sessionId?: string | null) => void;
      };
      perfTarget.dumpPerf = async (sessionId: string | null = null) => {
        const entries = await getPerfTimelineImpl();
        const out = formatTimeline(entries, sessionId);
        console.log(out);
        return entries;
      };
      perfTarget.resetPerf = perfResetImpl;
    }
  } catch {}

  refreshSessionId();

  // Flush localBuf on pagehide so the last ~250ms of marks survive
  // tab teardown. Also forward to BG since pagehide storage.set is
  // racey; BG outlives the tab and appends to perfTimeline.<ctx>.
  const forwardBatchToBg = (batch: PerfEntry[]): void => {
    if (!batch || !batch.length) return;
    try {
      if (
        chromeApi().runtime &&
        typeof chromeApi().runtime?.sendMessage === "function"
      ) {
        // Fire-and-forget; the SW receives and persists. Wrapped because
        // sendMessage rejects on no-receiver, which we don't care about
        // (BG SW may be momentarily asleep on a perf-only message).
        chromeApi().runtime
          ?.sendMessage?.({ type: "perf-forward", ctx: CTX, entries: batch })
          .catch(() => {});
      }
    } catch {}
  };
  try {
    if (
      typeof self !== "undefined" &&
      typeof self.addEventListener === "function" &&
      CTX !== "BG"
    ) {
      const finalFlush = (): void => {
        if (pendingFlush) {
          clearTimeout(pendingFlush);
          pendingFlush = null;
        }
        // Take a copy of the buffer for BG forwarding *before* flushNow
        // drains it; otherwise the local in-flight write and the BG
        // forward compete and one loses.
        if (localBuf.length) {
          forwardBatchToBg(localBuf.slice());
        }
        flushNow();
      };
      self.addEventListener("pagehide", finalFlush);
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") finalFlush();
        });
      }
    }
  } catch {}

  return {
    perfMark: perfMarkImpl,
    perfSpan: perfSpanImpl,
    perfReset: perfResetImpl,
    getPerfTimeline: getPerfTimelineImpl,
  };
};

const impl = ENABLED ? buildDevImpl() : null;

export const perfMark = ENABLED ? impl!.perfMark : noop;
export const perfSpan = ENABLED ? impl!.perfSpan : noopSpan;
export const perfReset = ENABLED ? impl!.perfReset : noop;
export const getPerfTimeline = ENABLED ? impl!.getPerfTimeline : noopAsyncArr;
