export const TRANSCRIPTION_ERROR_CODES = {
  UNSUPPORTED_BROWSER: "unsupported-browser",
  UNSUPPORTED_MEDIA: "unsupported-media",
  MODEL_LOAD_FAILED: "model-load-failed",
  QUOTA_EXHAUSTED: "quota-exhausted",
  RECORDING_TOO_LONG: "recording-too-long",
  PRIVACY_BLOCKED: "privacy-blocked",
  UNKNOWN_PROVIDER: "unknown-provider",
  TRANSCRIPTION_FAILED: "transcription-failed",
} as const;

export type TranscriptionErrorCode =
  (typeof TRANSCRIPTION_ERROR_CODES)[keyof typeof TRANSCRIPTION_ERROR_CODES];

export interface TranscriptionErrorOptions {
  code?: TranscriptionErrorCode;
  message: string;
  action?: string;
  cause?: unknown;
  phase?: string;
  details?: unknown;
}

const errorProperty = (error: unknown, property: string): unknown =>
  typeof error === "object" && error !== null && property in error
    ? (error as Record<string, unknown>)[property]
    : undefined;

const getErrorText = (error: unknown): string => {
  if (!error) return "";
  return [
    errorProperty(error, "name"),
    errorProperty(error, "message"),
    errorProperty(error, "code"),
    errorProperty(error, "stack"),
    String(error),
  ]
    .filter(Boolean)
    .join(" ");
};

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly action: string;
  readonly phase: string;
  readonly details: unknown;
  override readonly cause: unknown;
  readonly userMessage: string;

  constructor({ code, message, action, cause, phase, details }: TranscriptionErrorOptions) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code || TRANSCRIPTION_ERROR_CODES.TRANSCRIPTION_FAILED;
    this.action = action || "";
    this.phase = phase || "";
    this.details = details || null;
    this.cause = cause;
    this.userMessage = action ? `${message} ${action}` : message;
  }
}

export const isTranscriptionError = (error: unknown): error is TranscriptionError =>
  error instanceof TranscriptionError || errorProperty(error, "name") === "TranscriptionError";

export const formatTranscriptionError = (error: unknown): string => {
  if (isTranscriptionError(error)) {
    return error.userMessage || error.message;
  }
  return String(errorProperty(error, "message") || error);
};

export function classifyTranscriptionError(
  error: unknown,
  context: { phase?: string; [key: string]: unknown } = {},
): TranscriptionError {
  if (isTranscriptionError(error)) return error;

  const text = getErrorText(error);
  const lower = text.toLowerCase();
  const phase = context.phase || "";

  if (
    /privacy.*network|network.*privacy|privacyMode/i.test(text) ||
    /needs network but privacymode is on/i.test(text)
  ) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.PRIVACY_BLOCKED,
      phase,
      cause: error,
      message: "Network transcription is blocked by local-only privacy mode.",
      action: "Use the bundled local Whisper model for offline transcription.",
    });
  }

  if (/unknown provider/i.test(text)) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.UNKNOWN_PROVIDER,
      phase,
      cause: error,
      message: "The selected transcription provider is not available.",
      action: "Switch back to the bundled local Whisper provider.",
    });
  }

  if (
    /webaudio|audiocontext|offlineaudiocontext|audio context/i.test(text) ||
    /not a constructor|is not defined/i.test(text)
  ) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_BROWSER,
      phase,
      cause: error,
      message: "This browser context cannot decode audio for local transcription.",
      action: "Use a current Chromium browser with WebAudio and extension pages enabled.",
    });
  }

  if (/quota|quotaexceeded|no space|disk full|insufficient storage|storage is full/i.test(text)) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.QUOTA_EXHAUSTED,
      phase,
      cause: error,
      message: "Local storage quota was exhausted while preparing transcription.",
      action: "Free browser storage or export/delete old local recordings, then retry.",
    });
  }

  if (
    /out of memory|allocation failed|array buffer allocation|cannot allocate|maximum call stack|rangeerror/i.test(
      text,
    ) ||
    /recording too long|too long/i.test(text)
  ) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.RECORDING_TOO_LONG,
      phase,
      cause: error,
      message: "This recording is too large for the current in-browser transcription path.",
      action: "Export or split a shorter section and transcribe that clip locally.",
    });
  }

  if (
    phase === "model-load" ||
    /local model|model path|model manifest|onnx|tokenizer|preprocessor|404|not found|failed to fetch|fetch failed/i.test(
      text,
    )
  ) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.MODEL_LOAD_FAILED,
      phase,
      cause: error,
      message: "The bundled Whisper model could not be loaded.",
      action: "Open the model status panel and verify every required model file is packaged.",
    });
  }

  if (
    /decodeaudiodata|decodable audio|encodingerror|not supported|unsupported media|no audio/i.test(
      lower,
    )
  ) {
    return new TranscriptionError({
      code: TRANSCRIPTION_ERROR_CODES.UNSUPPORTED_MEDIA,
      phase,
      cause: error,
      message: "This recording does not contain a decodable audio track for transcription.",
      action: "Record with microphone or system audio enabled, then retry.",
    });
  }

  return new TranscriptionError({
    code: TRANSCRIPTION_ERROR_CODES.TRANSCRIPTION_FAILED,
    phase,
    cause: error,
    message: "Local transcription failed.",
    action:
      "Retry after reopening the editor; if it fails again, export diagnostics from the local support tools.",
  });
}
