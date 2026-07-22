// Builds a diagnostic ZIP. Returns { blob, filename }. JSZip lives in
// the BG (make-zip handler) so the ~100 KB dep doesn't ship into every
// content script.
import { getStartFlowTrace } from "./startFlowTrace.ts";
import {
  AUDIO_DIAGNOSTIC_KEYS,
  buildAudioDiagnosticsSnapshot,
} from "./audioDiagnostics.ts";

// Strip user-home paths and URL query/fragments (recording IDs,
// signed-URL tokens) before the zip leaves the machine.
const PII_REPLACEMENTS: Array<readonly [RegExp, string]> = [
  [/\/Users\/[^/\s"]+/g, "/Users/[redacted]"],
  [/\/home\/[^/\s"]+/g, "/home/[redacted]"],
  [/[A-Z]:\\Users\\[^\\\s"]+/g, "C:\\Users\\[redacted]"],
  [/(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g, "$1?[query-redacted]"],
  [/(https?:\/\/[^\s#"'<>]+)#[^\s"'<>]*/g, "$1#[fragment-redacted]"],
  [/(chrome-extension:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g, "$1?[query-redacted]"],
  [/(chrome-extension:\/\/[^\s#"'<>]+)#[^\s"'<>]*/g, "$1#[fragment-redacted]"],
];

const redactString = (s: string): string => {
  let out = s;
  for (const [pat, repl] of PII_REPLACEMENTS) {
    out = out.replace(pat, repl);
  }
  return out;
};

const redactPii = (value: unknown, depth = 0): unknown => {
  if (depth > 12) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactPii(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactPii(v, depth + 1);
    }
    return out;
  }
  return value;
};

const FAST_RECORDER_KEYS = [
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
  "fastRecorderSelectedEncoder",
  "useWebCodecsRecorder",
  "lastWebCodecsFailureAt",
  "lastWebCodecsFailureCode",
  // Detailed WebCodecs failure payload (framesEncoded, firstChunkSeen,
  // queue/flush stats). Key for diagnosing zero-frame / 28-byte-ftyp bugs.
  "lastWebCodecsFailureDetail",
  // HW→SW retry succeeded mid-session (Teams/Zoom/NVIDIA contention).
  "lastWebCodecsSwRetry",
  // Stop classification: separates low-storage from generic chunk-save-failed.
  "lastRecorderStopReason",
  "lastRecorderStopAt",
  // Mid-stream track-end (monitor unplug, tab close, "Stop sharing").
  // Includes savedChunks/duration/label/readyState to reconstruct from zip.
  "lastTrackEndEvent",
  "lastFailedValidation",
  "webcodecsConstructSnapshot",
  "recorderStartTimings",
  "countdownFinishedAt",
  "lastStartRecordingCaller",
  "lastCountdownFinishedDecision",
  "lastStartAfterCountdown",
  "lastLocalRecorderSourceLoss",
];

export interface DiagnosticZipOptions {
  extraConfig?: Record<string, unknown>;
  source?: string;
}

export interface DiagnosticZipResult {
  blob: Blob;
  filename: string;
}

interface DiagnosticChromeApi {
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
    getManifest: () => { version: string };
  };
  storage: {
    local: {
      get: (
        keys: readonly string[] | null,
        callback: (values: Record<string, unknown>) => void,
      ) => void;
    };
  };
}

const chromeApi = (): DiagnosticChromeApi =>
  (globalThis as typeof globalThis & { chrome: DiagnosticChromeApi }).chrome;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const buildDiagnosticZip = async ({
  extraConfig = {},
  source = "unknown",
}: DiagnosticZipOptions = {}): Promise<DiagnosticZipResult> => {
  const userAgent = navigator.userAgent;

  const [
    platformInfo,
    diagData,
    fastRecorderData,
    audioDiagnosticData,
    lifecycleData,
    perfTimeline,
    localRecordingEvents,
  ] = await Promise.all([
      chromeApi().runtime.sendMessage({ type: "get-platform-info" }),
      chromeApi().runtime.sendMessage({ type: "get-diagnostic-log" }),
      new Promise<Record<string, unknown>>((resolve) =>
        chromeApi().storage.local.get(FAST_RECORDER_KEYS, resolve),
      ),
      new Promise<Record<string, unknown>>((resolve) =>
        chromeApi().storage.local.get(AUDIO_DIAGNOSTIC_KEYS, resolve),
      ),
      new Promise<unknown[]>((resolve) =>
        chromeApi().storage.local.get(["lifecycleLog"], (r) =>
          resolve(Array.isArray(r.lifecycleLog) ? r.lifecycleLog : []),
        ),
      ),
      new Promise<Array<Record<string, unknown>>>((resolve) =>
        // Merge per-context perfTimeline.* keys by timestamp.
        chromeApi().storage.local.get(null, (all) => {
          const merged: Array<Record<string, unknown>> = [];
          for (const k of Object.keys(all || {})) {
            if (k === "perfTimeline" || k.startsWith("perfTimeline.")) {
              const arr = all[k];
            if (Array.isArray(arr)) {
              merged.push(...arr.map(asRecord));
            }
            }
          }
          merged.sort((a, b) => Number(a.t ?? 0) - Number(b.t ?? 0));
          resolve(merged);
        }),
      ),
      new Promise<unknown[]>((resolve) =>
        chromeApi().storage.local.get(["localRecordingEvents"], (r) =>
          resolve(
            Array.isArray(r?.localRecordingEvents)
              ? r.localRecordingEvents
              : [],
          ),
        ),
      ),
    ]);

  const manifestVersion = chromeApi().runtime.getManifest().version;
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const files: Record<string, string> = {};

  files["manifest.json"] = JSON.stringify({
    extensionVersion: manifestVersion,
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    chromeVersion: /Chrome\/([\d.]+)/.exec(userAgent)?.[1] || null,
    source,
  });

  files["environment.json"] = JSON.stringify({
    userAgent,
    platformInfo,
    screen: {
      width: window.screen.availWidth,
      height: window.screen.availHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    deviceMemory:
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory || null,
  });

  files["config.json"] = JSON.stringify({
    fastRecorder: fastRecorderData,
    audioDiagnostics: buildAudioDiagnosticsSnapshot(audioDiagnosticData),
    ...extraConfig,
  });

  const diagnosticData = asRecord(diagData);
  if (diagnosticData.log) {
    const annotated =
      typeof structuredClone === "function"
        ? asRecord(structuredClone(diagnosticData.log))
        : asRecord(JSON.parse(JSON.stringify(diagnosticData.log)));
    if (Array.isArray(annotated.sessions)) {
      for (const sessionValue of annotated.sessions) {
        const session = asRecord(sessionValue);
        if (!Array.isArray(session.events) || !session.events.length) continue;
        const hints: string[] = [];
        const hasEditorOpen = session.events.some(
          (value) => {
            const ev = asRecord(value);
            return ev.e === "editor-open" && asRecord(ev.d).type === "editor";
          },
        );
        const hasEditorReady = session.events.some(
          (value) => asRecord(value).e === "editor-load-ready",
        );
        if (hasEditorOpen && !hasEditorReady) {
          hints.push("Editor handoff incomplete: editor opened but never finished loading");
        }
        if (hints.length > 0) session.hints = hints;
      }
    }
    files["sessions.json"] = JSON.stringify(redactPii(annotated));
  }

  if (diagnosticData.errors) {
    files["errors.json"] = JSON.stringify(redactPii(diagnosticData.errors));
  }

  if (diagnosticData.flags) {
    files["storage-flags.json"] = JSON.stringify(redactPii(diagnosticData.flags));
  }

  try {
    const trace = await getStartFlowTrace();
    if (trace) {
      files["start-flow-trace.json"] = JSON.stringify(trace);
    }
  } catch {}

  if (Array.isArray(lifecycleData) && lifecycleData.length > 0) {
    files["lifecycle-log.json"] = JSON.stringify(lifecycleData);
  }

  if (Array.isArray(perfTimeline) && perfTimeline.length > 0) {
    files["perf-timeline.json"] = JSON.stringify(perfTimeline);
  }

  if (Array.isArray(localRecordingEvents) && localRecordingEvents.length > 0) {
    files["local-recording-events.json"] = JSON.stringify(
      redactPii(localRecordingEvents),
    );
  }

  const filename = `sayless-diagnostics-${ts}.zip`;

  const response = await chromeApi().runtime.sendMessage({
    type: "make-zip",
    files,
    filename,
  });
  const resp = asRecord(response);
  if (!resp.ok || typeof resp.base64 !== "string") {
    throw new Error(
      `make-zip failed: ${resp?.error || "no response from background"}`,
    );
  }
  // base64 over the message channel; structured-clone of ArrayBuffer
  // is unreliable across MV3 contexts.
  const bin = atob(resp.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/zip" });
  return {
    blob,
    filename: typeof resp.filename === "string" ? resp.filename : filename,
  };
};
