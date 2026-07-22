/**
 * Clipboard-friendly debug summary for support.
 * Same privacy rules as buildSupportContext, no URLs, tokens, or user content.
 */

import { makeSupportCode } from "./errorCodes.ts";
import { getStartFlowTrace, formatStartFlowTimeline } from "./startFlowTrace.ts";
import {
  AUDIO_DIAGNOSTIC_KEYS,
  formatAudioDiagnosticsLines,
} from "./audioDiagnostics.ts";

const MAX_ERR_LEN = 120;

interface SupportDebugOptions {
  errorCode?: string | null;
  errorWhy?: unknown;
}

interface SupportChromeApi {
  runtime: {
    getPlatformInfo: () => Promise<{ os?: string }>;
    getManifest: () => { version: string };
  };
  storage: {
    local: {
      get: (keys: readonly string[]) => Promise<Record<string, unknown>>;
    };
  };
}

const chromeApi = (): SupportChromeApi =>
  (globalThis as typeof globalThis & { chrome: SupportChromeApi }).chrome;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const sanitizeError = (err: unknown): string => {
  if (!err) return "";
  const str = typeof err === "string" ? err : String(err);
  return str
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/chrome-extension:\/\/[^\s)]+/gi, "[ext]")
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

const shortOS = async (): Promise<string> => {
  try {
    const info = await chromeApi().runtime.getPlatformInfo();
    return info.os || "unknown";
  } catch {
    return "unknown";
  }
};

/** Build a plain-text debug info block for clipboard. */
export const buildSupportDebugInfo = async (
  opts: SupportDebugOptions = {},
): Promise<string> => {
  const version = chromeApi().runtime.getManifest().version;
  const browser = shortBrowser();
  const os = await shortOS();
  const ts = new Date().toISOString();

  let store: Record<string, unknown> = {};
  try {
    store = await chromeApi().storage.local.get([
      "recordingAttemptId",
      "recordingType",
      "fastRecorderInUse",
      "fastRecorderDisabledReason",
      "lastRecordingError",
      "lastStreamCheckFail",
      "lastAutoDiscardableError",
      "streamLifecycleLog",
      "diagnosticLog",
      ...AUDIO_DIAGNOSTIC_KEYS,
    ]);
  } catch {}

  const attemptId =
    typeof store.recordingAttemptId === "string"
      ? store.recordingAttemptId
      : null;
  const supportCode = makeSupportCode(attemptId);

  const errorCode =
    opts.errorCode ||
    asRecord(store.lastRecordingError).errorCode ||
    null;

  const errorWhy = sanitizeError(
    opts.errorWhy || asRecord(store.lastRecordingError).why || ""
  );

  const recType = store.recordingType || "unknown";
  const fastRec = store.fastRecorderInUse ? "active" : "off";
  const fastOff = store.fastRecorderDisabledReason || null;

  let lastOutcome: string | null = null;
  let editorHandoffIncomplete = false;
  const sessions = asRecord(store.diagnosticLog).sessions;
  if (Array.isArray(sessions) && sessions.length) {
    const last = asRecord(sessions[sessions.length - 1]);
    lastOutcome = typeof last.outcome === "string" ? last.outcome : null;
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
      editorHandoffIncomplete = hasEditorOpen && !hasEditorReady;
    }
  }

  const lines = [
    `SayLess Debug Info`,
    `====================`,
    `Code:      ${supportCode}`,
  ];
  if (errorCode) lines.push(`Error:     ${errorCode}`);
  if (errorWhy) lines.push(`Detail:    ${errorWhy}`);
  lines.push(`Version:   ${version}`);
  lines.push(`Browser:   ${browser}`);
  lines.push(`OS:        ${os}`);
  lines.push(`Mode:      ${recType}`);
  lines.push(`Fast MP4:  ${fastRec}${fastOff ? ` (${fastOff})` : ""}`);
  if (lastOutcome) lines.push(`Session:   ${lastOutcome}`);
  if (editorHandoffIncomplete) lines.push(`EditorLoad: incomplete (editor opened but never became ready)`);
  if (store.lastStreamCheckFail) {
    const sc = asRecord(store.lastStreamCheckFail);
    lines.push(`StreamChk: ${sc.bucket || "?"} vis=${sc.docVisibility || sc.docHidden} ms=${sc.msSinceReady ?? "?"}`);
  }
  if (store.lastAutoDiscardableError) {
    lines.push(`AutoDisc:  failed tab=${asRecord(store.lastAutoDiscardableError).tabId}`);
  }
  if (Array.isArray(store.streamLifecycleLog) && store.streamLifecycleLog.length) {
    const sl = store.streamLifecycleLog;
    const tags = sl
      .map((value) => {
        const entry = asRecord(value);
        return `${entry.tag}@${entry.t}`;
      })
      .join(" → ");
    lines.push(`SL(${sl.length}): ${tags.slice(0, 300)}`);
  }
  lines.push(...formatAudioDiagnosticsLines(store));
  if (attemptId) lines.push(`Ref:       ${attemptId}`);
  lines.push(`Time:      ${ts}`);

  try {
    const trace = await getStartFlowTrace();
    if (trace) {
      const timeline = formatStartFlowTimeline(trace);
      if (timeline) {
        lines.push("");
        lines.push("Start Flow:");
        lines.push(timeline);
      }
    }
  } catch {}

  return lines.join("\n");
};
