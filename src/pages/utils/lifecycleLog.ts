// cross-session ring buffer of lifecycle events for state-bleed bugs
// (recordingTab left set, region stuck, etc). per-session detail lives
// in diagnosticLog. ~500 entries in chrome.storage.local, dumped in the
// diag zip. writes serialized through a per-context promise chain.
// entry: { ts, src, ev, data? }

const STORAGE_KEY = "lifecycleLog";
const MAX_EVENTS = 500;

export interface LifecycleEntry {
  ts: number;
  src: string;
  ev: string;
  data?: unknown;
}

export interface CompressedLifecycleLog {
  encoding: "gzip+base64";
  payload: string;
  rawBytes: number;
}

interface LifecycleChromeApi {
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
}

const chromeApi = (): LifecycleChromeApi =>
  (globalThis as typeof globalThis & { chrome: LifecycleChromeApi }).chrome;

// Serialized so back-to-back lifecycle() calls don't race the read-modify-write.
let _writeChain: Promise<void> = Promise.resolve();

const summarize = (data: unknown): unknown => {
  if (data === null || data === undefined) return undefined;
  if (typeof data !== "object") return data;
  try {
    const json = JSON.stringify(data);
    if (json.length > 500) {
      return { _truncated: true, preview: json.slice(0, 480) };
    }
    return data;
  } catch {
    return { _serializeError: true };
  }
};

/** Append a lifecycle event. Returns a promise resolved after persist. */
export const lifecycleEvent = async (
  src: unknown,
  ev: unknown,
  data: unknown = null,
): Promise<void> => {
  const entry: LifecycleEntry = {
    ts: Date.now(),
    src: String(src || "unknown"),
    ev: String(ev || "unknown"),
  };
  const summarized = summarize(data);
  if (summarized !== undefined) entry.data = summarized;

  _writeChain = _writeChain.then(async () => {
    try {
      const result = await chromeApi().storage.local.get([STORAGE_KEY]);
      const current: LifecycleEntry[] = Array.isArray(result[STORAGE_KEY])
        ? (result[STORAGE_KEY] as LifecycleEntry[])
        : [];
      current.push(entry);
      while (current.length > MAX_EVENTS) current.shift();
      await chromeApi().storage.local.set({ [STORAGE_KEY]: current });
    } catch {}
  });
  return _writeChain;
};

/** Fire-and-forget convenience. */
export const lifecycle = (src: unknown, ev: unknown, data: unknown = null): void => {
  lifecycleEvent(src, ev, data).catch(() => {});
};

/** For diag zip / inspection. Returns the current buffer. */
export const getLifecycleLog = async (): Promise<LifecycleEntry[]> => {
  try {
    const result = await chromeApi().storage.local.get([STORAGE_KEY]);
    return Array.isArray(result[STORAGE_KEY]) ? (result[STORAGE_KEY] as LifecycleEntry[]) : [];
  } catch {
    return [];
  }
};

/** Wait for any pending writes to flush. */
export const flushLifecycleLog = async (): Promise<void> => {
  await _writeChain;
};

// Allow-list for diagnostic bundling. Lifecycle `data` can hold
// arbitrary storage values (e.g. stringified error JSON), so a deny
// list isn't safe: one callsite stuffing a URL into an unexpected key
// would leak it. Only numeric/boolean counters and short strings get
// through, and new keys have to be added here on purpose.
const SAFE_DATA_KEYS = new Set([
  // countdown
  "runId",
  "countdownTimeS",
  "count",
  "elapsedMs",
  "endHoldMs",
  "endedAt",
  "startDispatchedAt",
  "postHideDelayMs",
  "ageMs",
  // start flow
  "attemptId",
  "caller",
  "tabId",
  // encoder selection
  "kind",
  "reason",
  "container",
  // recorder lifecycle
  "frame",
  "audioQ",
  "videoQ",
  "frameCount",
  "h",
  "w",
  "framerate",
  "height",
  "width",
  "chunks",
  "durMs",
  "ok",
  "codec",
  // status / flag transitions
  "isRecording",
  "isTargetTab",
  "recordingType",
  "isTarget",
  "cancelled",
  "filename",
  "beep",
  "wasPreloaded",
  // back-to-back / restart context
  "memoryError",
  "offscreen",
  "pendingRecording",
  "recording",
  "restarting",
  "region",
  "sandboxTab",
]);
const MAX_SAFE_STRING_LEN = 32;

type ScrubbedScalar = string | number | boolean | null;
type ScrubbedData = ScrubbedScalar | ScrubbedScalar[] | Record<string, ScrubbedScalar>;

const scrubValue = (v: unknown): ScrubbedScalar | undefined => {
  if (v == null) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    return v.length > MAX_SAFE_STRING_LEN ? undefined : v;
  }
  return undefined;
};

const scrubData = (data: unknown): ScrubbedData | undefined => {
  if (data == null || typeof data !== "object") return scrubValue(data);
  if (Array.isArray(data)) {
    return data
      .slice(0, 16)
      .map(scrubValue)
      .filter((v) => v !== undefined);
  }
  const out: Record<string, ScrubbedScalar> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!SAFE_DATA_KEYS.has(k)) continue;
    const scrubbed = scrubValue(v);
    if (scrubbed !== undefined) out[k] = scrubbed;
  }
  return out;
};

interface ScrubbedLifecycleEntry {
  ts: number | null;
  src: string;
  ev: string;
  data?: ScrubbedData;
}

const scrubEntry = (e: unknown): ScrubbedLifecycleEntry | null => {
  if (!e || typeof e !== "object") return null;
  const entry = e as Partial<LifecycleEntry>;
  const out: ScrubbedLifecycleEntry = {
    ts: typeof entry.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : null,
    src: typeof entry.src === "string" ? entry.src.slice(0, 64) : "?",
    ev: typeof entry.ev === "string" ? entry.ev.slice(0, 64) : "?",
  };
  const data = scrubData(entry.data);
  if (data !== undefined) out.data = data;
  return out;
};

/**
 * gzip+base64 snapshot of the scrubbed lifecycle log, capped at ~96KB
 * compressed. For failed-recording bundles only; returns null on failure.
 */
export const getCompressedLifecycleLog = async (): Promise<CompressedLifecycleLog | null> => {
  try {
    const { default: pako } = await import("pako");
    const log = await getLifecycleLog();
    let scrubbed = log
      .map(scrubEntry)
      .filter((entry): entry is ScrubbedLifecycleEntry => entry !== null);
    // Enforce the cap after gzip; if over, drop oldest entries since the
    // newest matter most for an end-of-recording bundle.
    let payload: string | null = null;
    let rawBytes = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const json = JSON.stringify(scrubbed);
      const gz = pako.gzip(json);
      rawBytes = gz.length;
      let bin = "";
      for (let i = 0; i < gz.length; i += 1) bin += String.fromCharCode(gz[i]);
      const b64 = btoa(bin);
      if (b64.length <= 96 * 1024) {
        payload = b64;
        break;
      }
      if (scrubbed.length <= 4) break;
      scrubbed = scrubbed.slice(Math.ceil(scrubbed.length / 2));
    }
    if (!payload) return null;
    return { encoding: "gzip+base64", payload, rawBytes };
  } catch {
    return null;
  }
};
