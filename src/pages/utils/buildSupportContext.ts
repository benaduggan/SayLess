/**
 * Builds a compact support-context object for local diagnostic exports.
 * No URLs, tokens, page content, or blobs, only sanitized technical metadata.
 */

import {
  AUDIO_DIAGNOSTIC_KEYS,
  buildAudioDiagnosticsContext,
} from "./audioDiagnostics.ts";

const MAX_ERR_LEN = 120;

export interface SupportContextOptions {
  source?: string;
  includeRecordingState?: boolean;
  errorCode?: string;
  errorWhy?: unknown;
  user?: { name?: string; email?: string };
}

interface ContextChromeApi {
  runtime: {
    getManifest: () => { version: string };
    getPlatformInfo: () => Promise<{ os: string }>;
  };
  i18n: { getMessage: (name: string) => string };
  storage: {
    local: {
      get: (keys: readonly string[]) => Promise<Record<string, unknown>>;
    };
  };
}

const chromeApi = (): ContextChromeApi =>
  (globalThis as typeof globalThis & { chrome: ContextChromeApi }).chrome;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const sanitizeError = (err: unknown): string => {
  if (!err) return "";
  const str =
    typeof err === "string"
      ? err
      : asRecord(err).message ||
        asRecord(err).errorCode ||
        JSON.stringify(err);
  return String(str)
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/chrome-extension:\/\/[^\s)]+/gi, "[ext]")
    // strip user-home paths from stack traces so support payloads don't
    // leak the OS account name
    .replace(/\/Users\/[^/\s)]+/g, "/Users/[redacted]")
    .replace(/\/home\/[^/\s)]+/g, "/home/[redacted]")
    .replace(/[A-Z]:\\Users\\[^\\\s)]+/g, "C:\\Users\\[redacted]")
    .slice(0, MAX_ERR_LEN);
};

const shortBrowser = (): string => {
  const ua = navigator.userAgent || "";
  const edg = ua.match(/Edg\/(\d+)/);
  if (edg) return `Edge/${edg[1]}`;
  const ch = ua.match(/Chrome\/(\d+)/);
  if (ch) return `Chrome/${ch[1]}`;
  return "Unknown";
};

/** Build support context. Returns flat key-value pairs for URLSearchParams. */
export const buildSupportContext = async (
  opts: SupportContextOptions = {},
): Promise<Record<string, string>> => {
  const ctx: Record<string, string> = {};

  ctx.v = chromeApi().runtime.getManifest().version;
  ctx.lang = chromeApi().i18n.getMessage("@@ui_locale") || "unknown";
  ctx.br = shortBrowser();

  // Coarse device class, to see if stuck-recording reports cluster on low-RAM
  // or low-core devices. Both are already exposed to every page, no PII.
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (typeof deviceMemory === "number") {
    ctx.mem = String(deviceMemory);
  }
  if (typeof navigator.hardwareConcurrency === "number") {
    ctx.cores = String(navigator.hardwareConcurrency);
  }

  try {
    const info = await chromeApi().runtime.getPlatformInfo();
    ctx.os = info.os;
  } catch {
    ctx.os = "unknown";
  }

  const platformMap: Record<string, string> = { mac: "macOS", win: "Windows", linux: "Linux", cros: "ChromeOS" };
  ctx.platform = platformMap[ctx.os] || "Other";

  ctx.localOnly = "1";

  if (opts.source) {
    ctx.src = opts.source;
  }

  if (opts.includeRecordingState) {
    try {
      const keys = [
        "lastRecordingError",
        "lastRecordingType",
        "recordingType",
        "fastRecorderInUse",
        "fastRecorderDisabledReason",
        "diagnosticLog",
        "recordingAttemptId",
        "lastRecordingBackendRef",
        "lastRecordingFinalizedFileName",
        "freeRecorderSession",
        "fastRecorderValidation",
        "editorReadyAt",
        "lastTrackEndEvent",
        "editorRecordingError",
        "lastTabStreamMintMs",
        "lastTabStreamMintOk",
        "lastTabStreamMintOffscreen",
        ...AUDIO_DIAGNOSTIC_KEYS,
      ];
      const store = await chromeApi().storage.local.get(keys);

      const recType = store.lastRecordingType || store.recordingType;
      if (recType) ctx.recType = String(recType);
      if (store.fastRecorderInUse != null)
        ctx.fast = store.fastRecorderInUse ? "1" : "0";
      if (store.fastRecorderDisabledReason)
        ctx.fastOff = String(store.fastRecorderDisabledReason).slice(0, 60);
      ctx.localOnly = "1";
      if (store.lastRecordingError) {
        ctx.lastErr = sanitizeError(
          asRecord(store.lastRecordingError).why ||
            asRecord(store.lastRecordingError).error,
        );
        const storedErrorCode = asRecord(store.lastRecordingError).errorCode;
        if (storedErrorCode) ctx.errCode = String(storedErrorCode);
      }
      if (store.recordingAttemptId) ctx.attemptId = String(store.recordingAttemptId);

      // Distinguishes writer-hung from writer-ok-editor-failed for
      // triaging stuck-at-90% reports.
      const backendRef = asRecord(store.lastRecordingBackendRef);
      if (backendRef.backend) {
        ctx.backend = String(backendRef.backend);
      }
      if (backendRef.fileName) {
        ctx.finalized =
          store.lastRecordingFinalizedFileName ===
          backendRef.fileName
            ? "1"
            : "0";
      }

      // Tab streamId mint latency, for tabStreamUnavailableError reports. High
      // mintMs with mintOk=0 means slow not hung; mintOff=1 means via the SW.
      if (store.lastTabStreamMintMs != null) {
        ctx.mintMs = String(store.lastTabStreamMintMs);
        ctx.mintOk = store.lastTabStreamMintOk ? "1" : "0";
        ctx.mintOff = store.lastTabStreamMintOffscreen ? "1" : "0";
      }

      Object.assign(ctx, buildAudioDiagnosticsContext(store));

      if (store.freeRecorderSession) {
        const session = asRecord(store.freeRecorderSession);
        if (session.chunkCount != null)
          ctx.chunks = String(session.chunkCount);
        if (session.status)
          ctx.recSessStatus = String(session.status).slice(
            0,
            30,
          );
      }

      if (store.fastRecorderValidation) {
        const validation = asRecord(store.fastRecorderValidation);
        ctx.validationOk = validation.ok ? "1" : "0";
        if (validation.hardFail) ctx.validationHardFail = "1";
        if (
          !validation.ok &&
          Array.isArray(validation.reasons)
        ) {
          ctx.validationReason = String(
            validation.reasons[0] || "",
          ).slice(0, 60);
        }
        const validationSize = asRecord(validation.details).size;
        if (typeof validationSize === "number") {
          // MB rounded; keeps the URL short.
          ctx.fileMb = String(
            Math.round(validationSize / (1024 * 1024)),
          );
        }
      }

      // Editor reached ready (new instrumentation; storage mirror of
      // contentState.ready). Absence means the editor never loaded.
      if (store.editorReadyAt) ctx.editorReady = "1";

      // Track-end reason: distinguishes graceful stop from stream-end
      // teardown (display sleep, Chrome native Stop sharing, source-tab
      // close). Both bug-reporters had REC_RUN_STREAM_END so this is
      // critical for matching.
      const trackEndReason = asRecord(store.lastTrackEndEvent).reason;
      if (trackEndReason) {
        ctx.trackEndReason = String(trackEndReason).slice(
          0,
          60,
        );
      }

      // Editor-side error if surfaced. Differentiates types of stuck.
      const editorErrorCode = asRecord(store.editorRecordingError).errorCode;
      if (editorErrorCode) {
        ctx.editorErr = String(editorErrorCode).slice(
          0,
          60,
        );
      }

      const sessions = asRecord(store.diagnosticLog).sessions;
      if (Array.isArray(sessions) && sessions.length) {
        const last = asRecord(sessions[sessions.length - 1]);
        if (last.outcome) ctx.lastOutcome = String(last.outcome);
        const events = last.events;
        if (Array.isArray(events) && events.length) {
          const hasEditorOpen = events.some(
            (value) => {
              const ev = asRecord(value);
              return ev.e === "editor-open" && asRecord(ev.d).type === "editor";
            },
          );
          const hasEditorReady = events.some(
            (value) => asRecord(value).e === "editor-load-ready",
          );
          if (hasEditorOpen && !hasEditorReady) ctx.editorHandoff = "incomplete";

          // Last 30 events as "name@msFromSessionStart". Just the
          // sequence, no payloads.
          const recent = events.slice(-30);
          const compact = recent
            // xN is how many times a collapsed event repeated (sw-init@1234x4
            // means the SW restarted 4 times).
            .map((value) => {
              const ev = asRecord(value);
              return `${ev.e}@${ev.t}${typeof ev.n === "number" && ev.n > 1 ? `x${ev.n}` : ""}`;
            })
            .join(",");
          // Cap so a runaway log does not bloat the local diagnostic payload.
          if (compact && compact.length <= 3000) {
            ctx.diagEvents = compact;
          } else if (compact) {
            // Keep the most recent.
            ctx.diagEvents = compact.slice(-3000);
          }
        }
      }

      // One-line failure summary from the fields above, readable at a glance.
      const summaryBits: string[] = [];
      if (ctx.finalized === "0") summaryBits.push("not-finalized");
      if (ctx.chunks === "0") summaryBits.push("0-chunks");
      if (
        ctx.recSessStatus &&
        ctx.recSessStatus !== "complete" &&
        ctx.recSessStatus !== "completed"
      )
        summaryBits.push(`sess:${ctx.recSessStatus}`);
      if (ctx.editorHandoff === "incomplete") summaryBits.push("editor-stuck");
      if (ctx.editorErr) summaryBits.push(`editorErr:${ctx.editorErr}`);
      if (ctx.trackEndReason) summaryBits.push("track-ended");
      if (summaryBits.length) {
        ctx.summary = summaryBits.join("+").slice(0, 80);
      }
    } catch {}
  }

  if (opts.errorCode) ctx.errCode = opts.errorCode;
  if (opts.errorWhy) ctx.lastErr = sanitizeError(opts.errorWhy);

  if (ctx.attemptId) {
    const hash = ctx.attemptId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    ctx.supportCode = `SLS-${hash}-${date}`;
  }

  if (opts.user) {
    if (opts.user.name) ctx.name = opts.user.name;
    if (opts.user.email) ctx.email = opts.user.email;
  }

  return ctx;
};

/** Build context and return as a query string. */
export const supportContextQuery = async (
  opts: SupportContextOptions = {},
): Promise<string> => {
  const ctx = await buildSupportContext(opts);
  const params = new URLSearchParams();
  for (const [k, val] of Object.entries(ctx)) {
    if (val !== undefined && val !== null && val !== "") {
      params.set(k, val);
    }
  }
  return params.toString();
};
