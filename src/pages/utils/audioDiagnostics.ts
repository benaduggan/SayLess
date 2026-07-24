export const AUDIO_DIAGNOSTIC_KEYS = Object.freeze([
  "lastMicInputSnapshot",
  "lastRecordingAudioGraphSnapshot",
  "lastRegionRecordingAudioGraphSnapshot",
  "lastRecordingAudioSnapshot",
]);

type NullableNumber = number | null;
type NullableBoolean = boolean | null;

export interface SafeAudioTrack {
  enabled: NullableBoolean;
  readyState: string | null;
  sampleRate: NullableNumber;
  channelCount: NullableNumber;
  echoCancellation: NullableBoolean;
  noiseSuppression: NullableBoolean;
  autoGainControl: NullableBoolean;
}

export interface SafeAudioRoute {
  at: NullableNumber;
  mode: string | null;
  audioContextSampleRate: NullableNumber;
  liveStreamAudioTrackCount: NullableNumber;
  route: Record<string, boolean>;
  micTrack: SafeAudioTrack | null;
  systemTrack: SafeAudioTrack | null;
  liveAudioTrack: SafeAudioTrack | null;
}

export interface SafeMicInput {
  at: NullableNumber;
  sampleRate: NullableNumber;
  channelCount: NullableNumber;
  echoCancellation: NullableBoolean;
  noiseSuppression: NullableBoolean;
  autoGainControl: NullableBoolean;
  lowSampleRate: boolean;
}

export interface SafeEncoderSnapshot {
  [key: string]: NullableNumber | NullableBoolean | string | null | undefined;
  firstFrameFormat?: string | null;
}

export interface AudioDiagnosticsSnapshot {
  micInput?: SafeMicInput;
  mainRoute?: SafeAudioRoute;
  regionRoute?: SafeAudioRoute;
  encoder?: SafeEncoderSnapshot;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const numberOrNull = (value: unknown): NullableNumber => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const boolOrNull = (value: unknown): NullableBoolean =>
  typeof value === "boolean" ? value : value == null ? null : Boolean(value);

const safeTrack = (value: unknown): SafeAudioTrack | null => {
  const track = asRecord(value);
  if (Object.keys(track).length === 0) return null;
  return {
    enabled: boolOrNull(track.enabled),
    readyState: typeof track.readyState === "string" ? track.readyState.slice(0, 24) : null,
    sampleRate: numberOrNull(track.sampleRate),
    channelCount: numberOrNull(track.channelCount),
    echoCancellation: boolOrNull(track.echoCancellation),
    noiseSuppression: boolOrNull(track.noiseSuppression),
    autoGainControl: boolOrNull(track.autoGainControl),
  };
};

const safeRoute = (value: unknown): SafeAudioRoute | null => {
  const snapshot = asRecord(value);
  if (Object.keys(snapshot).length === 0) return null;
  const route = asRecord(snapshot.route);
  return {
    at: numberOrNull(snapshot.at),
    mode: typeof snapshot.mode === "string" ? snapshot.mode.slice(0, 32) : null,
    audioContextSampleRate: numberOrNull(snapshot.audioContextSampleRate),
    liveStreamAudioTrackCount: numberOrNull(snapshot.liveStreamAudioTrackCount),
    route: {
      useDirectMicTrack: Boolean(route.useDirectMicTrack),
      connectMicToMixer: Boolean(route.connectMicToMixer),
      connectSystemToMixer: Boolean(route.connectSystemToMixer),
      attachMixedAudioTrack: Boolean(route.attachMixedAudioTrack),
      stopUnusedSystemTrack: Boolean(route.stopUnusedSystemTrack),
    },
    micTrack: safeTrack(snapshot.micTrack),
    systemTrack: safeTrack(snapshot.systemTrack),
    liveAudioTrack: safeTrack(snapshot.liveAudioTrack),
  };
};

const safeMicInput = (value: unknown): SafeMicInput | null => {
  const snapshot = asRecord(value);
  if (Object.keys(snapshot).length === 0) return null;
  const settings = asRecord(snapshot.settings);
  const sampleRate = numberOrNull(settings.sampleRate);
  return {
    at: numberOrNull(snapshot.at),
    sampleRate,
    channelCount: numberOrNull(settings.channelCount),
    echoCancellation: boolOrNull(settings.echoCancellation),
    noiseSuppression: boolOrNull(settings.noiseSuppression),
    autoGainControl: boolOrNull(settings.autoGainControl),
    lowSampleRate: Boolean(sampleRate && sampleRate <= 24000),
  };
};

const safeEncoder = (value: unknown): SafeEncoderSnapshot | null => {
  const snapshot = asRecord(value);
  if (Object.keys(snapshot).length === 0) return null;
  const trackSettings = asRecord(snapshot.trackSettings);
  return {
    at: numberOrNull(snapshot.at),
    trackSampleRate: numberOrNull(trackSettings.sampleRate),
    trackChannelCount: numberOrNull(trackSettings.channelCount),
    trackEchoCancellation: boolOrNull(trackSettings.echoCancellation),
    trackNoiseSuppression: boolOrNull(trackSettings.noiseSuppression),
    trackAutoGainControl: boolOrNull(trackSettings.autoGainControl),
    encoderSampleRate: numberOrNull(snapshot.encoderSampleRate),
    encoderChannelCount: numberOrNull(snapshot.encoderChannelCount),
    firstFrameSampleRate: numberOrNull(snapshot.firstFrameSampleRate),
    firstFrameChannels: numberOrNull(snapshot.firstFrameChannels),
    firstFrameFormat:
      typeof snapshot.firstFrameFormat === "string" ? snapshot.firstFrameFormat.slice(0, 32) : null,
    paddedSilenceCount: numberOrNull(snapshot.paddedSilenceCount),
    finalAudioElapsedUs: numberOrNull(snapshot.finalAudioElapsedUs),
    finalAudioSamplesWritten: numberOrNull(snapshot.finalAudioSamplesWritten),
    finalAudioSampleRate: numberOrNull(snapshot.finalAudioSampleRate),
    finalFirstAudioFrameSampleRate: numberOrNull(snapshot.finalFirstAudioFrameSampleRate),
    finalAudioSampleRateMismatchRebuilds: numberOrNull(
      snapshot.finalAudioSampleRateMismatchRebuilds,
    ),
    finalDroppedAudioForBackpressure: numberOrNull(snapshot.finalDroppedAudioForBackpressure),
    finalPeakAudioEncodeQueueSize: numberOrNull(snapshot.finalPeakAudioEncodeQueueSize),
    finalAudioFlushMs: numberOrNull(snapshot.finalAudioFlushMs),
    finalMuxerFinalizeOk: boolOrNull(snapshot.finalMuxerFinalizeOk),
    finalFramesEncoded: numberOrNull(snapshot.finalFramesEncoded),
  };
};

export const buildFinalWebCodecsAudioSnapshot = (
  value: unknown = {},
  at = Date.now(),
): SafeEncoderSnapshot => {
  const payload = asRecord(value);
  const diag = asRecord(payload.diag);
  const droppedForBackpressure = asRecord(payload.droppedForBackpressure);
  const peakEncodeQueueSize = asRecord(payload.peakEncodeQueueSize);
  const flushMs = asRecord(payload.flushMs);
  return {
    finalAudioAt: numberOrNull(at),
    finalAudioElapsedUs: numberOrNull(diag.audioElapsedUs),
    finalAudioSamplesWritten: numberOrNull(diag.audioSamplesWritten),
    finalAudioSampleRate: numberOrNull(diag.audioSampleRate),
    finalFirstAudioFrameSampleRate: numberOrNull(diag.firstAudioFrameSampleRate),
    finalAudioSampleRateMismatchRebuilds: numberOrNull(diag.audioSampleRateMismatchRebuilds),
    finalDroppedAudioForBackpressure: numberOrNull(
      droppedForBackpressure.audio ?? diag.droppedAudioForBackpressure,
    ),
    finalPeakAudioEncodeQueueSize: numberOrNull(
      peakEncodeQueueSize.audio ?? diag.peakAudioEncodeQueueSize,
    ),
    finalAudioFlushMs: numberOrNull(flushMs.audio),
    finalMuxerFinalizeOk: boolOrNull(payload.muxerFinalizeOk),
    finalFramesEncoded: numberOrNull(payload.framesEncoded),
  };
};

export const persistFinalWebCodecsAudioSnapshot = async (
  payload: unknown = {},
): Promise<SafeEncoderSnapshot> => {
  const finalSnapshot = buildFinalWebCodecsAudioSnapshot(payload);
  try {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              get: (keys: string[]) => Promise<Record<string, unknown>>;
              set: (values: Record<string, unknown>) => Promise<void>;
            };
          };
        };
      }
    ).chrome;
    const res = await chromeApi.storage.local.get(["lastRecordingAudioSnapshot"]);
    await chromeApi.storage.local.set({
      lastRecordingAudioSnapshot: {
        ...asRecord(res.lastRecordingAudioSnapshot),
        ...finalSnapshot,
      },
    });
  } catch {}
  return finalSnapshot;
};

export const buildAudioDiagnosticsSnapshot = (
  value: unknown = {},
): AudioDiagnosticsSnapshot | null => {
  const store = asRecord(value);
  const micInput = safeMicInput(store.lastMicInputSnapshot);
  const mainRoute = safeRoute(store.lastRecordingAudioGraphSnapshot);
  const regionRoute = safeRoute(store.lastRegionRecordingAudioGraphSnapshot);
  const encoder = safeEncoder(store.lastRecordingAudioSnapshot);

  const out: AudioDiagnosticsSnapshot = {};
  if (micInput) out.micInput = micInput;
  if (mainRoute) out.mainRoute = mainRoute;
  if (regionRoute) out.regionRoute = regionRoute;
  if (encoder) out.encoder = encoder;
  return Object.keys(out).length ? out : null;
};

export const buildAudioDiagnosticsContext = (store: unknown = {}): Record<string, string> => {
  const snapshot = buildAudioDiagnosticsSnapshot(store);
  if (!snapshot) return {};

  const route = snapshot.mainRoute || snapshot.regionRoute || null;
  const ctx: Record<string, string> = {};
  if (snapshot.micInput?.sampleRate != null) {
    ctx.micHz = String(snapshot.micInput.sampleRate);
  }
  if (snapshot.micInput?.channelCount != null) {
    ctx.micCh = String(snapshot.micInput.channelCount);
  }
  if (snapshot.micInput?.lowSampleRate) ctx.micLowHz = "1";
  if (route?.mode) ctx.audioRoute = route.mode;
  if (route?.audioContextSampleRate != null) {
    ctx.audioCtxHz = String(route.audioContextSampleRate);
  }
  if (route?.liveStreamAudioTrackCount != null) {
    ctx.liveAudioTracks = String(route.liveStreamAudioTrackCount);
  }
  if (snapshot.encoder?.encoderSampleRate != null) {
    ctx.encHz = String(snapshot.encoder.encoderSampleRate);
  }
  if (snapshot.encoder?.firstFrameSampleRate != null) {
    ctx.firstAudioHz = String(snapshot.encoder.firstFrameSampleRate);
  }
  if (snapshot.encoder?.paddedSilenceCount != null) {
    ctx.padSilence = String(snapshot.encoder.paddedSilenceCount);
  }
  if (typeof snapshot.encoder?.finalAudioElapsedUs === "number") {
    ctx.finalAudioMs = String(Math.round(snapshot.encoder.finalAudioElapsedUs / 1000));
  }
  if (snapshot.encoder?.finalDroppedAudioForBackpressure != null) {
    ctx.audioDrops = String(snapshot.encoder.finalDroppedAudioForBackpressure);
  }
  if (snapshot.encoder?.finalPeakAudioEncodeQueueSize != null) {
    ctx.audioQPeak = String(snapshot.encoder.finalPeakAudioEncodeQueueSize);
  }
  if (snapshot.encoder?.finalAudioSampleRateMismatchRebuilds != null) {
    ctx.audioRateRebuilds = String(snapshot.encoder.finalAudioSampleRateMismatchRebuilds);
  }
  return ctx;
};

export const formatAudioDiagnosticsLines = (store: unknown = {}): string[] => {
  const ctx = buildAudioDiagnosticsContext(store);
  const lines: string[] = [];
  if (ctx.audioRoute) lines.push(`AudioRt:  ${ctx.audioRoute}`);
  if (ctx.micHz || ctx.micCh) {
    lines.push(
      `MicInput: ${ctx.micHz || "?"}Hz ch=${ctx.micCh || "?"}${
        ctx.micLowHz === "1" ? " low-rate" : ""
      }`,
    );
  }
  if (ctx.encHz || ctx.firstAudioHz) {
    lines.push(`Encoder:  ${ctx.encHz || "?"}Hz first=${ctx.firstAudioHz || "?"}Hz`);
  }
  if (ctx.finalAudioMs || ctx.audioDrops || ctx.audioQPeak) {
    lines.push(
      `AudioEnd: ${ctx.finalAudioMs || "?"}ms drops=${
        ctx.audioDrops || "?"
      } qPeak=${ctx.audioQPeak || "?"}`,
    );
  }
  if (ctx.audioRateRebuilds) {
    lines.push(`RateFix:  rebuilds=${ctx.audioRateRebuilds}`);
  }
  if (ctx.padSilence) lines.push(`Silence:  padded=${ctx.padSilence}`);
  return lines;
};
