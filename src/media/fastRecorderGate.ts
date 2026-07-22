// mediabunny is ~3MB; defer until validateFastRecorderOutputBlob runs.
let _mediabunnyPromise: Promise<typeof import("mediabunny")> | null = null;
const loadMediabunny = () => {
  if (!_mediabunnyPromise) {
    _mediabunnyPromise = import("mediabunny");
  }
  return _mediabunnyPromise;
};

export type FastRecorderProbeResult = {
  ok: boolean;
  reasons: string[];
  details: FastRecorderProbeDetails;
  at?: number;
};

export interface FastRecorderProbeDetails extends Record<string, unknown> {
  selectedVideoConfig?: VideoEncoderConfig;
  audioConfig?: AudioEncoderConfig;
  containerKind?: "mp4" | "webm";
  userAgent?: string;
  gateVersion?: string;
}

export type FastRecorderStickyState = {
  disabled: boolean;
  reason?: string | null;
  details?: unknown;
};

export type FastRecorderValidationResult = {
  ok: boolean;
  hardFail: boolean;
  reasons: string[];
  details: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorStack = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;

const normalizeStoredVideoConfig = (
  value: unknown
): VideoEncoderConfig | undefined => {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.codec !== "string" ||
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.height) ||
    value.height <= 0
  ) {
    return undefined;
  }
  const config: VideoEncoderConfig = {
    codec: value.codec,
    width: value.width,
    height: value.height,
  };
  if (typeof value.bitrate === "number" && value.bitrate > 0) {
    config.bitrate = value.bitrate;
  }
  if (typeof value.framerate === "number" && value.framerate > 0) {
    config.framerate = value.framerate;
  }
  if (
    value.hardwareAcceleration === "no-preference" ||
    value.hardwareAcceleration === "prefer-hardware" ||
    value.hardwareAcceleration === "prefer-software"
  ) {
    config.hardwareAcceleration = value.hardwareAcceleration;
  }
  if (value.latencyMode === "quality" || value.latencyMode === "realtime") {
    config.latencyMode = value.latencyMode;
  }
  if (value.bitrateMode === "constant" || value.bitrateMode === "variable") {
    config.bitrateMode = value.bitrateMode;
  }
  if (value.alpha === "discard" || value.alpha === "keep") {
    config.alpha = value.alpha;
  }
  return config;
};

export const normalizeFastRecorderProbeResult = (
  value: unknown
): FastRecorderProbeResult | null => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) => typeof reason === "string")
  ) {
    return null;
  }
  if (!isRecord(value.details)) return null;
  if (value.at !== undefined && typeof value.at !== "number") return null;
  const details: FastRecorderProbeDetails = { ...value.details };
  const selectedVideoConfig = normalizeStoredVideoConfig(
    value.details.selectedVideoConfig
  );
  if (selectedVideoConfig) details.selectedVideoConfig = selectedVideoConfig;
  else delete details.selectedVideoConfig;
  if (
    value.details.containerKind === "mp4" ||
    value.details.containerKind === "webm"
  ) {
    details.containerKind = value.details.containerKind;
  } else {
    delete details.containerKind;
  }
  if (typeof value.details.userAgent === "string") {
    details.userAgent = value.details.userAgent;
  } else {
    delete details.userAgent;
  }
  if (typeof value.details.gateVersion === "string") {
    details.gateVersion = value.details.gateVersion;
  } else {
    delete details.gateVersion;
  }
  return {
    ok: value.ok,
    reasons: value.reasons,
    details,
    at: value.at,
  };
};

const STORAGE_KEYS = {
  userSetting: "fastRecorderBeta",
  stickyDisabled: "fastRecorderDisabledForDevice",
  stickyReason: "fastRecorderDisabledReason",
  stickyDetails: "fastRecorderDisabledDetails",
  lastFailureAt: "fastRecorderDisabledAt",
  probe: "fastRecorderProbe",
  validation: "fastRecorderValidation",
  inUse: "fastRecorderInUse",
};

const GATE_VERSION = "ladder-v1";

const getFastRecDebug = () => {
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("fastRecDebug") === "1") return true;
    }
  } catch {}
  return (
    (globalThis as typeof globalThis & { SAYLESS_FAST_REC_DEBUG?: unknown })
      .SAYLESS_FAST_REC_DEBUG === true
  );
};

const debugLog = (...args: unknown[]) => {
  if (!getFastRecDebug()) return;
  // eslint-disable-next-line no-console
  console.log("[FastRecorderGate]", ...args);
};

debugLog("gate version", GATE_VERSION, Date.now());

const safeCanPlayType = (mime: string) => {
  try {
    if (typeof document === "undefined") return "";
    const video = document.createElement("video");
    return video?.canPlayType?.(mime) || "";
  } catch {
    return "";
  }
};

const safeMseSupport = (mime: string) => {
  try {
    if (typeof MediaSource === "undefined") return false;
    return MediaSource.isTypeSupported(mime);
  } catch {
    return false;
  }
};

// Expire sticky disables so a one-off failure (codec reclaim, HW slot
// contention, sleep) doesn't permanently downgrade users now that the
// WebCodecs recorder self-heals via salvage paths.
const STICKY_DISABLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const getFastRecorderStickyState =
  async (): Promise<FastRecorderStickyState> => {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.stickyDisabled,
        STORAGE_KEYS.stickyReason,
        STORAGE_KEYS.stickyDetails,
        STORAGE_KEYS.lastFailureAt,
      ]);
      const stored = isRecord(result) ? result : {};
      const disabledRaw = stored[STORAGE_KEYS.stickyDisabled] === true;
      const storedLastFailureAt = stored[STORAGE_KEYS.lastFailureAt];
      const lastFailureAt =
        typeof storedLastFailureAt === "number" ? storedLastFailureAt : 0;
      const storedReason = stored[STORAGE_KEYS.stickyReason];
      // Report stale disables as cleared. Don't wipe other keys here to
      // avoid racing concurrent setters; next failure overwrites anyway.
      const expired =
        disabledRaw &&
        lastFailureAt > 0 &&
        Date.now() - lastFailureAt > STICKY_DISABLE_TTL_MS;
      if (expired) {
        try {
          await chrome.storage.local.set({
            [STORAGE_KEYS.stickyDisabled]: false,
          });
        } catch {}
        return { disabled: false };
      }
      return {
        disabled: disabledRaw,
        reason: typeof storedReason === "string" ? storedReason : null,
        details: stored[STORAGE_KEYS.stickyDetails] ?? null,
      };
    } catch {
      return { disabled: false };
    }
  };

// Stream-setup failures, not codec issues. Don't sticky-disable on these.
const TRANSIENT_ERROR_PATTERNS = [
  /no video track/i,
  /stream missing/i,
  /display stream missing/i,
  /track ended/i,
  /track inactive/i,
  /capture stream is not ready/i,
  // Hardware codec reclaimed by Chrome (idle/background/pressure).
  /codec reclaimed/i,
  /reclaimed due to inactivity/i,
  // stop() raced with an in-flight encode/flush.
  /encoder.*closed/i,
  /encoder is closed/i,
];

export const isTransientFastRecorderError = (errorString: string) => {
  if (!errorString) return false;
  return TRANSIENT_ERROR_PATTERNS.some((re) => re.test(errorString));
};
const isTransientError = isTransientFastRecorderError;

// firstChunkSeen=false means no output ever landed: cancel or contention,
// not an encoder defect (real breakage emits at least one chunk first).
export const isFastRecorderFailureTransient = (
  reasonCode: string,
  errorString: string,
  detail: unknown
): boolean => {
  if (isTransientFastRecorderError(errorString)) return true;
  if (
    reasonCode === "webcodecs-zero-frames-at-stop" &&
    isRecord(detail) &&
    detail.firstChunkSeen === false
  ) {
    return true;
  }
  // No-first-chunk watchdog with zero encoded frames: the capture track
  // never delivered a frame (macOS static-screen starvation, cancel, or HW
  // contention), not an encoder defect — so don't sticky-disable the device.
  // The genuine "28-byte ftyp" silent-encoder defect this guard exists for
  // draws real frames first (framesEncoded > 0) and only then emits no chunk,
  // so that case still falls through to the sticky-disable below. Discriminate
  // on framesEncoded, not the reason code.
  if (
    reasonCode === "webcodecs-no-first-chunk" &&
    isRecord(detail) &&
    detail.firstChunkSeen === false &&
    detail.framesEncoded === 0
  ) {
    return true;
  }
  return false;
};

export const markFastRecorderFailure = async (
  reasonCode: string,
  details: Record<string, unknown> = {}
) => {
  try {
    const errStr = typeof details?.error === "string" ? details.error : "";
    const detail =
      details && typeof details === "object" && details.detail
        ? details.detail
        : null;
    if (isFastRecorderFailureTransient(reasonCode, errStr, detail)) {
      // Clear any sticky disable a coarser path set earlier in this same
      // attempt (e.g. the BG no-first-chunk alarm fires without detail and
      // can't discriminate; the detailed recorder-side report arriving here
      // is authoritative). Reaching a WebCodecs failure at all means the gate
      // allowed WebCodecs this attempt, so an outstanding sticky flag is
      // either from this race or already expired — safe to clear.
      await chrome.storage.local.set({
        [STORAGE_KEYS.stickyDisabled]: false,
        [STORAGE_KEYS.lastFailureAt]: Date.now(),
        fastRecorderTransientFailure: {
          reasonCode,
          details,
          at: Date.now(),
        },
      });
      return;
    }
    await chrome.storage.local.set({
      [STORAGE_KEYS.stickyDisabled]: true,
      [STORAGE_KEYS.stickyReason]: reasonCode,
      [STORAGE_KEYS.stickyDetails]: details,
      [STORAGE_KEYS.lastFailureAt]: Date.now(),
    });
  } catch {
    // ignore
  }
};

// Push 4 synthetic frames through a real VideoEncoder to catch the
// "28-byte ftyp" zero-output failure isConfigSupported misses.
const PROBE_FRAME_COUNT = 4;
const PROBE_WALL_CLOCK_CAP_MS = 1500;
const verifyEncoderProducesOutput = async (
  config: VideoEncoderConfig
): Promise<{ ok: boolean; reason?: string; chunks: number; ms: number }> => {
  const started = Date.now();
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoFrame === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    // Can't run the round-trip in this context; report it as
    // unverified rather than penalizing the probe.
    return { ok: true, reason: "unverified", chunks: 0, ms: 0 };
  }
  let chunks = 0;
  let encoderError: string | null = null;
  let encoder: VideoEncoder | null = null;
  const frames: VideoFrame[] = [];
  const width = Number(config.width) || 1280;
  const height = Number(config.height) || 720;
  try {
    encoder = new VideoEncoder({
      output: () => {
        chunks += 1;
      },
      error: (error) => {
        encoderError = errorMessage(error);
      },
    });
    encoder.configure(config);
    const canvas = new OffscreenCanvas(width, height);
    // getContext('2d') returns the union OffscreenRenderingContext; cast
    // Narrows to the only variant used by the recorder gate.
    // fillStyle/fillRect without complaining about ImageBitmapRenderingContext.
    const ctx = canvas.getContext(
      "2d"
    ) as OffscreenCanvasRenderingContext2D | null;
    const frameDurationUs = Math.round(1_000_000 / 30);
    for (let i = 0; i < PROBE_FRAME_COUNT; i += 1) {
      if (ctx) {
        ctx.fillStyle = i % 2 === 0 ? "#1a1a1a" : "#e8e8e8";
        ctx.fillRect(0, 0, width, height);
      }
      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });
      frames.push(frame);
      encoder.encode(frame, { keyFrame: i === 0 });
    }
    // Wall-clock cap: a stressed encoder can drain for tens of seconds.
    // Classify on whatever landed.
    let flushTimedOut = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        encoder.flush(),
        new Promise<void>((_, reject) => {
          flushTimer = setTimeout(() => {
            flushTimedOut = true;
            reject(new Error("flush-timeout"));
          }, PROBE_WALL_CLOCK_CAP_MS);
        }),
      ]);
    } catch (error: unknown) {
      // If we timed out and at least one chunk landed, that's an OK
      // signal; encoder is producing output, just slow. Don't bubble
      // an error in that case.
      if (!flushTimedOut || chunks === 0) {
        encoderError = encoderError || errorMessage(error);
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
    }
  } catch (error: unknown) {
    encoderError = encoderError || errorMessage(error);
  } finally {
    for (const f of frames) {
      try {
        f.close();
      } catch {}
    }
    try {
      encoder?.close();
    } catch {}
  }
  const ms = Date.now() - started;
  if (encoderError) return { ok: false, reason: "error", chunks, ms };
  // Only zero-output is a firm fail; runtime watchdogs handle slow encoders.
  if (chunks === 0) return { ok: false, reason: "no-output", chunks, ms };
  return { ok: true, chunks, ms };
};

// Audio equivalent of the video probe: catches first-encode failures that
// isConfigSupported misses (Opus 48k mismatch, AAC channel layout, etc).
const verifyAudioEncoderProducesOutput = async (
  config: AudioEncoderConfig
): Promise<{ ok: boolean; reason?: string; chunks: number; ms: number }> => {
  const started = Date.now();
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    return { ok: true, reason: "unverified", chunks: 0, ms: 0 };
  }
  let chunks = 0;
  let encoderError: string | null = null;
  let encoder: AudioEncoder | null = null;
  const sampleRate = config.sampleRate || 48000;
  const channels = config.numberOfChannels || 2;
  // 10 chunks × 4800 samples = ~1s at 48kHz.
  const CHUNKS = 10;
  const SAMPLES_PER_CHUNK = Math.round(sampleRate / 10);
  try {
    encoder = new AudioEncoder({
      output: () => {
        chunks += 1;
      },
      error: (error) => {
        encoderError = errorMessage(error);
      },
    });
    encoder.configure(config);
    // Interleaved f32 silence; zero buffer keeps it deterministic and
    // doesn't allocate per-channel.
    const data = new Float32Array(SAMPLES_PER_CHUNK * channels);
    for (let i = 0; i < CHUNKS; i += 1) {
      const audioData = new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: SAMPLES_PER_CHUNK,
        numberOfChannels: channels,
        timestamp: Math.round((i * SAMPLES_PER_CHUNK * 1_000_000) / sampleRate),
        data,
      });
      try {
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }
    }
    await encoder.flush();
  } catch (error: unknown) {
    encoderError = encoderError || errorMessage(error);
  } finally {
    try {
      encoder?.close();
    } catch {}
  }
  const ms = Date.now() - started;
  if (encoderError) return { ok: false, reason: "error", chunks, ms };
  if (chunks === 0) return { ok: false, reason: "no-output", chunks, ms };
  return { ok: true, chunks, ms };
};

// Cache key: userAgent + GATE_VERSION. ok=false isn't cached so a driver
// recovery re-probes immediately.
const PROBE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Short window for failed probes: coalesces back-to-back calls during
// one startup without masking driver recovery.
const PROBE_FAILURE_CACHE_TTL_MS = 60 * 1000;
let _probeInMemory: FastRecorderProbeResult | null = null;
let _probeInMemoryAt = 0;
let _probeInFlight: Promise<FastRecorderProbeResult> | null = null;

const tryReadCachedProbe =
  async (): Promise<FastRecorderProbeResult | null> => {
    if (_probeInMemory) {
      if (_probeInMemory.ok) return _probeInMemory;
      if (Date.now() - _probeInMemoryAt < PROBE_FAILURE_CACHE_TTL_MS) {
        return _probeInMemory;
      }
    }
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const stored = await chrome.storage.local.get([STORAGE_KEYS.probe]);
      const cached = normalizeFastRecorderProbeResult(
        isRecord(stored) ? stored[STORAGE_KEYS.probe] : null
      );
      if (
        cached &&
        cached.ok === true &&
        typeof cached.at === "number" &&
        Date.now() - cached.at < PROBE_CACHE_TTL_MS &&
        cached.details?.userAgent === ua &&
        cached.details?.gateVersion === GATE_VERSION
      ) {
        _probeInMemory = cached;
        return cached;
      }
    } catch {}
    return null;
  };

export const probeFastRecorderSupport =
  async (): Promise<FastRecorderProbeResult> => {
    const cached = await tryReadCachedProbe();
    if (cached) return cached;
    if (_probeInFlight) return _probeInFlight;
    _probeInFlight = _probeFastRecorderSupportUncached().finally(() => {
      _probeInFlight = null;
    });
    const result = await _probeInFlight;
    // Cache both success and failure in memory. Success rides the long
    // TTL via storage; failure rides the short in-memory TTL only so a
    // hardware/driver fix is rediscovered within a minute.
    _probeInMemory = result;
    _probeInMemoryAt = Date.now();
    return result;
  };

// Best-effort pre-warm: kicks the probe asynchronously so the result is
// ready in memory by the time preflight needs it. Safe to call multiple
// times; coalesces via _probeInFlight.
export const prewarmFastRecorderProbe = (): void => {
  if (_probeInMemory || _probeInFlight) return;
  void probeFastRecorderSupport().catch(() => {});
};

const _probeFastRecorderSupportUncached =
  async (): Promise<FastRecorderProbeResult> => {
    try {
      debugLog("probe start", GATE_VERSION, Date.now());
      const reasons: string[] = [];
      const details: FastRecorderProbeDetails = {};

      const hasVideoEncoder = typeof VideoEncoder !== "undefined";
      const hasAudioEncoder = typeof AudioEncoder !== "undefined";
      const hasTrackProcessor =
        typeof MediaStreamTrackProcessor !== "undefined";

      details.hasVideoEncoder = hasVideoEncoder;
      details.hasAudioEncoder = hasAudioEncoder;
      details.hasTrackProcessor = hasTrackProcessor;

      if (!hasVideoEncoder) reasons.push("no-video-encoder");
      if (!hasAudioEncoder) reasons.push("no-audio-encoder");
      if (!hasTrackProcessor) reasons.push("no-track-processor");

      const baseVideoConfig = {
        width: 1280,
        height: 720,
        bitrate: 4_000_000,
        framerate: 30,
        bitrateMode: "constant",
        latencyMode: "realtime",
        hardwareAcceleration: "no-preference",
      } as VideoEncoderConfig;

      const audioConfig = {
        codec: "mp4a.40.2",
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      } as AudioEncoderConfig;

      const attemptSummaries: Array<{
        codec: string;
        size: string;
        knobs: string[];
        supported: boolean;
      }> = [];

      const normalizeEven = (value: number) =>
        value % 2 === 0 ? value : value - 1;
      const sizes = [
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
      ];
      // High L4.2 and Baseline L4.0. Main (avc1.4D...) excluded for the
      // Windows MFT silent-no-output bug (see WebCodecsRecorder).
      const codecCandidates = ["avc1.64002A", "avc1.42E028"];
      const hwOptions: Array<
        VideoEncoderConfig["hardwareAcceleration"] | null
      > = ["prefer-hardware", "prefer-software", "no-preference", null];
      type OptionalVideoConfigKey =
        | "framerate"
        | "bitrateMode"
        | "latencyMode"
        | "alpha"
        | "bitrate";
      const ladderSteps: Array<{
        label: string;
        omit: OptionalVideoConfigKey[];
      }> = [
        { label: "full", omit: [] },
        { label: "no-framerate", omit: ["framerate"] },
        { label: "no-bitrateMode", omit: ["bitrateMode"] },
        { label: "no-latencyMode", omit: ["latencyMode"] },
        { label: "no-alpha", omit: ["alpha"] },
        { label: "no-bitrate", omit: ["bitrate"] },
      ];

      let selectedVideoConfig: VideoEncoderConfig | null = null;
      let selectedAudioConfig: AudioEncoderConfig | null = null;

      if (
        hasVideoEncoder &&
        typeof VideoEncoder.isConfigSupported === "function"
      ) {
        for (const size of sizes) {
          const width = normalizeEven(size.width);
          const height = normalizeEven(size.height);
          for (const codec of codecCandidates) {
            for (const hw of hwOptions) {
              for (const step of ladderSteps) {
                const config: VideoEncoderConfig = {
                  ...baseVideoConfig,
                  codec,
                  width,
                  height,
                };
                if (hw) {
                  config.hardwareAcceleration = hw;
                } else {
                  delete config.hardwareAcceleration;
                }
                for (const key of step.omit) {
                  delete config[key];
                }

                let supported = false;
                try {
                  const support = await VideoEncoder.isConfigSupported(config);
                  supported = Boolean(support?.supported);
                  if (supported) {
                    selectedVideoConfig = support?.config || config;
                  }
                } catch {
                  supported = false;
                }

                attemptSummaries.push({
                  codec,
                  size: `${width}x${height}`,
                  knobs: [
                    step.label,
                    hw ? `hw:${hw}` : "hw:omit",
                    config.bitrate ? "bitrate:on" : "bitrate:omit",
                    config.framerate ? "framerate:on" : "framerate:omit",
                    config.bitrateMode ? "bitrateMode:on" : "bitrateMode:omit",
                    config.latencyMode ? "latencyMode:on" : "latencyMode:omit",
                  ],
                  supported,
                });

                if (supported && selectedVideoConfig) {
                  details.selectedVideoConfig = selectedVideoConfig;
                  details.videoConfigSupported = true;
                  details.attemptedConfigCount = attemptSummaries.length;
                  details.attemptSummary = attemptSummaries;
                  break;
                }
              }
              if (selectedVideoConfig) break;
            }
            if (selectedVideoConfig) break;
          }
          if (selectedVideoConfig) break;
        }
      }

      if (!selectedVideoConfig) {
        details.videoConfigSupported = false;
        details.attemptedConfigCount = attemptSummaries.length;
        details.attemptSummary = attemptSummaries;
        reasons.push("video-config-unsupported");
      }

      if (
        hasAudioEncoder &&
        typeof AudioEncoder.isConfigSupported === "function"
      ) {
        try {
          const support = await AudioEncoder.isConfigSupported(audioConfig);
          details.audioConfigSupported = Boolean(support?.supported);
          selectedAudioConfig = support?.config || audioConfig;
          details.audioConfig = selectedAudioConfig;
          if (!support?.supported) reasons.push("audio-config-unsupported");
        } catch (err) {
          details.audioConfigError = String(err);
          reasons.push("audio-config-error");
        }
      }

      const videoCodecCandidates = ["avc1.64002A", "avc1.42E028"];
      const audioCodec = "mp4a.40.2";
      details.videoCodecCandidates = videoCodecCandidates;
      details.audioCodec = audioCodec;

      const playableCodecs: string[] = [];
      for (const codec of videoCodecCandidates) {
        const mp4Mime = `video/mp4; codecs="${codec}, ${audioCodec}"`;
        const canPlay = safeCanPlayType(mp4Mime);
        if (canPlay) playableCodecs.push(codec);
      }

      details.playableVideoCodecs = playableCodecs;
      details.canPlayType = playableCodecs.length > 0 ? "maybe" : "";

      const mseSupported = safeMseSupport(
        `video/mp4; codecs="${videoCodecCandidates[0]}, ${audioCodec}"`
      );
      details.mediaSourceSupported = mseSupported;

      if (playableCodecs.length === 0) {
        reasons.push("mp4-playback-unsupported");
      }

      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const isLinux = /Linux/i.test(ua);
      details.userAgent = ua;
      details.isLinux = isLinux;
      details.gateVersion = GATE_VERSION;

      if (isLinux && playableCodecs.length === 0) {
        reasons.push("linux-missing-codecs");
      }

      let containerKind: "mp4" | "webm" = "mp4";
      const mp4Reasons = [...reasons];
      const mp4Ok = mp4Reasons.length === 0;

      if (!mp4Ok && hasVideoEncoder && hasAudioEncoder) {
        const webmAudioConfig = {
          codec: "opus",
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate: 128000,
        } as AudioEncoderConfig;
        const webmVideoBase = {
          codec: "vp09.00.10.08",
          width: 1280,
          height: 720,
          bitrate: 4_000_000,
          framerate: 30,
          bitrateMode: "constant",
          latencyMode: "realtime",
        } as VideoEncoderConfig;

        let webmAudioSupport: AudioEncoderSupport | null = null;
        try {
          webmAudioSupport = await AudioEncoder.isConfigSupported(
            webmAudioConfig
          );
        } catch (err) {
          details.webmAudioError = String(err);
        }

        let selectedWebmVideo: VideoEncoderConfig | null = null;
        const webmHwOptions: Array<VideoEncoderConfig["hardwareAcceleration"]> =
          ["prefer-hardware", "prefer-software"];
        for (const hw of webmHwOptions) {
          try {
            const candidate: VideoEncoderConfig = {
              ...webmVideoBase,
              hardwareAcceleration: hw,
            };
            const support = await VideoEncoder.isConfigSupported(candidate);
            if (support?.supported) {
              selectedWebmVideo = support.config || candidate;
              break;
            }
          } catch {}
        }

        if (selectedWebmVideo && webmAudioSupport?.supported) {
          containerKind = "webm";
          details.containerKind = "webm";
          details.webmSelectedVideoConfig = selectedWebmVideo;
          selectedVideoConfig = selectedWebmVideo;
          selectedAudioConfig = webmAudioSupport.config || webmAudioConfig;
          details.webmAudioConfig = selectedAudioConfig;
          details.selectedVideoConfig = selectedWebmVideo;
          details.audioConfig = selectedAudioConfig;
          details.videoConfigSupported = true;
          details.audioConfigSupported = true;
          details.mp4FallbackReasons = mp4Reasons;
          const carryOver = new Set([
            "no-video-encoder",
            "no-audio-encoder",
            "no-track-processor",
            "probe_exception",
          ]);
          for (let i = reasons.length - 1; i >= 0; i--) {
            if (!carryOver.has(reasons[i])) reasons.splice(i, 1);
          }
        }
      }

      if (containerKind === "mp4") details.containerKind = "mp4";

      // Verify the encoder emits chunks; otherwise route to MediaRecorder.
      if (selectedVideoConfig) {
        // Retry once on transient errors (VTDecoderXPC, NVIDIA, VAAPI all
        // reject the first configure() after another encoder ran). "no-output"
        // is a real HW bug and does NOT retry.
        let encodeCheck = await verifyEncoderProducesOutput(
          selectedVideoConfig
        );
        if (!encodeCheck.ok && encodeCheck.reason === "error") {
          await new Promise((r) => setTimeout(r, 200));
          const retry = await verifyEncoderProducesOutput(selectedVideoConfig);
          details.encodeRoundTripRetry = retry;
          if (retry.ok) {
            encodeCheck = retry;
          }
        }
        details.encodeRoundTrip = encodeCheck;
        if (!encodeCheck.ok) {
          reasons.push(`video-encode-${encodeCheck.reason}`);
        }
      }

      // Audio round-trip guard. Catches Opus 48k mismatch and AAC
      // platform configure-time bugs that isConfigSupported misses.
      // Doesn't block video; just tags the audio reason separately.
      if (selectedAudioConfig && details.audioConfigSupported === true) {
        const audioEncodeCheck = await verifyAudioEncoderProducesOutput(
          selectedAudioConfig
        );
        details.audioEncodeRoundTrip = audioEncodeCheck;
        if (!audioEncodeCheck.ok) {
          reasons.push(`audio-encode-${audioEncodeCheck.reason}`);
        }
      }

      let ok = reasons.length === 0;
      const at = Date.now();

      // Trust a clean probe from the last 7 days when only transient errors
      // failed: in-session MediaRecorder swap covers the WebCodecs miss.
      if (!ok) {
        const onlyTransientReasons = reasons.every(
          (r) => r === "video-encode-error" || r === "audio-encode-error"
        );
        if (onlyTransientReasons) {
          try {
            const ua =
              typeof navigator !== "undefined" ? navigator.userAgent : "";
            const stored = await chrome.storage.local.get([STORAGE_KEYS.probe]);
            const prior = normalizeFastRecorderProbeResult(
              isRecord(stored) ? stored[STORAGE_KEYS.probe] : null
            );
            const PROBE_TRUST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
            if (
              prior &&
              prior.ok === true &&
              typeof prior.at === "number" &&
              Date.now() - prior.at < PROBE_TRUST_WINDOW_MS &&
              prior.details?.userAgent === ua &&
              prior.details?.gateVersion === GATE_VERSION
            ) {
              details.transientFailureOverridden = true;
              details.transientReasons = reasons.slice();
              ok = true;
            }
          } catch {}
        }
      }

      debugLog("probe result", { ok, reasons, details, at });

      try {
        if (ok) {
          // Refresh the storage probe on success: longest TTL applies.
          await chrome.storage.local.set({
            [STORAGE_KEYS.probe]: { ok, reasons, details, at },
          });
        } else {
          // Keep the good cached probe; record the failure separately so the
          // next start short-circuits even after SW restart.
          await chrome.storage.local.set({
            fastRecorderProbeLastFailure: { reasons, details, at },
          });
        }
      } catch {}

      return { ok, reasons, details, at };
    } catch (error: unknown) {
      const details = {
        message: errorMessage(error),
        stack: errorStack(error),
      };
      const at = Date.now();
      const result = {
        ok: false,
        reasons: ["probe_exception"],
        details,
        at,
      };
      try {
        await chrome.storage.local.set({
          [STORAGE_KEYS.probe]: result,
        });
      } catch {}
      return result;
    }
  };

export const shouldUseFastRecorder = (
  userSetting: boolean | null | undefined,
  probeResult: FastRecorderProbeResult,
  stickyDisableState: FastRecorderStickyState
) => {
  if (userSetting === false) return false;
  if (stickyDisableState?.disabled && userSetting !== true) return false;
  return (
    probeResult?.ok === true &&
    Boolean(probeResult?.details?.selectedVideoConfig)
  );
};

export const validateFastRecorderOutputBlob = async (
  blob: Blob | null,
  opts: {
    minBytes?: number;
    timeoutMs?: number;
    videoCodec?: string;
    audioCodec?: string | null;
    recordingId?: string | null;
  } = {}
): Promise<FastRecorderValidationResult> => {
  const reasons: string[] = [];
  const details: Record<string, unknown> = {};

  if (!blob) {
    reasons.push("no-blob");
    return { ok: false, hardFail: true, reasons, details };
  }

  const minBytes = opts.minBytes ?? 64 * 1024;
  details.size = blob.size;
  details.type = blob.type;

  if (blob.size < minBytes) {
    reasons.push("blob-too-small");
  }

  if (
    !blob.type ||
    !(blob.type.includes("mp4") || blob.type.includes("webm"))
  ) {
    reasons.push("unexpected-mime");
  }

  if (opts.recordingId) {
    details.recordingId = opts.recordingId;
  }

  // mediabunny handles moov-at-end without the ~3-4s timeout stacking
  // the old <video>+seek+rVFC pipeline incurred.
  try {
    const { Input, BlobSource, ALL_FORMATS } = await loadMediabunny();
    const demuxInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
    const demuxTimeoutMs = opts.timeoutMs ?? 2000;
    const tracks = await Promise.race([
      demuxInput.getTracks(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("demuxer-timeout")), demuxTimeoutMs)
      ),
    ]);
    const videoTracks = tracks.filter((track) => track.type === "video");
    const audioTracks = tracks.filter((track) => track.type === "audio");
    details.demuxerVideoTrackCount = videoTracks.length;
    details.demuxerAudioTrackCount = audioTracks.length;
    details.demuxerVideoCodec = videoTracks[0]?.codec || null;
    details.demuxerAudioCodec = audioTracks[0]?.codec || null;
    const firstVideo = videoTracks[0];
    if (firstVideo?.isVideoTrack?.()) {
      details.codedWidth = firstVideo.codedWidth ?? null;
      details.codedHeight = firstVideo.codedHeight ?? null;
    }
    if (videoTracks.length === 0) {
      reasons.push("demuxer-no-video-track");
    }
  } catch (error: unknown) {
    details.demuxerError = errorMessage(error);
    reasons.push("demuxer-error");
  }

  const containerKind = blob.type.includes("webm") ? "webm" : "mp4";
  const defaultVideoCodec = containerKind === "webm" ? "vp9" : "avc1.42E01E";
  const defaultAudioCodec = containerKind === "webm" ? "opus" : "mp4a.40.2";
  const videoCodec = opts.videoCodec || defaultVideoCodec;
  const audioCodec =
    opts.audioCodec === undefined ? defaultAudioCodec : opts.audioCodec;
  const codecSuffix = audioCodec ? `, ${audioCodec}` : "";
  const playMime =
    containerKind === "webm"
      ? `video/webm; codecs="${videoCodec}${codecSuffix}"`
      : `video/mp4; codecs="${videoCodec}${codecSuffix}"`;
  details.containerKind = containerKind;
  details.expectedVideoCodec = videoCodec;
  details.expectedAudioCodec = audioCodec;
  details.canPlayType = safeCanPlayType(playMime);
  details.mediaSourceSupported = safeMseSupport(playMime);

  const hardFail =
    reasons.includes("no-blob") ||
    reasons.includes("blob-too-small") ||
    reasons.includes("unexpected-mime") ||
    reasons.includes("demuxer-no-video-track");

  const ok = reasons.length === 0;

  debugLog("validation result", { ok, hardFail, reasons, details });

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.validation]: {
        ok,
        hardFail,
        reasons,
        details,
        ts: Date.now(),
      },
    });
  } catch {}

  return { ok, hardFail, reasons, details };
};

export const fastRecorderStorageKeys = STORAGE_KEYS;
