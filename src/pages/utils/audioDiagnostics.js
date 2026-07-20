export const AUDIO_DIAGNOSTIC_KEYS = Object.freeze([
  "lastMicInputSnapshot",
  "lastRecordingAudioGraphSnapshot",
  "lastRegionRecordingAudioGraphSnapshot",
  "lastRecordingAudioSnapshot",
]);

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const boolOrNull = (value) =>
  typeof value === "boolean" ? value : value == null ? null : Boolean(value);

const safeTrack = (track) => {
  if (!track || typeof track !== "object") return null;
  return {
    enabled: boolOrNull(track.enabled),
    readyState:
      typeof track.readyState === "string" ? track.readyState.slice(0, 24) : null,
    sampleRate: numberOrNull(track.sampleRate),
    channelCount: numberOrNull(track.channelCount),
    echoCancellation: boolOrNull(track.echoCancellation),
    noiseSuppression: boolOrNull(track.noiseSuppression),
    autoGainControl: boolOrNull(track.autoGainControl),
  };
};

const safeRoute = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const route = snapshot.route || {};
  return {
    at: numberOrNull(snapshot.at),
    mode: typeof snapshot.mode === "string" ? snapshot.mode.slice(0, 32) : null,
    audioContextSampleRate: numberOrNull(
      snapshot.audioContextSampleRate,
    ),
    liveStreamAudioTrackCount: numberOrNull(
      snapshot.liveStreamAudioTrackCount,
    ),
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

const safeMicInput = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const settings = snapshot.settings || {};
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

const safeEncoder = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return null;
  const trackSettings = snapshot.trackSettings || {};
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
      typeof snapshot.firstFrameFormat === "string"
        ? snapshot.firstFrameFormat.slice(0, 32)
        : null,
    paddedSilenceCount: numberOrNull(snapshot.paddedSilenceCount),
    finalAudioElapsedUs: numberOrNull(snapshot.finalAudioElapsedUs),
    finalAudioSamplesWritten: numberOrNull(snapshot.finalAudioSamplesWritten),
    finalAudioSampleRate: numberOrNull(snapshot.finalAudioSampleRate),
    finalFirstAudioFrameSampleRate: numberOrNull(
      snapshot.finalFirstAudioFrameSampleRate,
    ),
    finalAudioSampleRateMismatchRebuilds: numberOrNull(
      snapshot.finalAudioSampleRateMismatchRebuilds,
    ),
    finalDroppedAudioForBackpressure: numberOrNull(
      snapshot.finalDroppedAudioForBackpressure,
    ),
    finalPeakAudioEncodeQueueSize: numberOrNull(
      snapshot.finalPeakAudioEncodeQueueSize,
    ),
    finalAudioFlushMs: numberOrNull(snapshot.finalAudioFlushMs),
    finalMuxerFinalizeOk: boolOrNull(snapshot.finalMuxerFinalizeOk),
    finalFramesEncoded: numberOrNull(snapshot.finalFramesEncoded),
  };
};

export const buildFinalWebCodecsAudioSnapshot = (payload = {}, at = Date.now()) => {
  const diag = payload?.diag || {};
  return {
    finalAudioAt: numberOrNull(at),
    finalAudioElapsedUs: numberOrNull(diag.audioElapsedUs),
    finalAudioSamplesWritten: numberOrNull(diag.audioSamplesWritten),
    finalAudioSampleRate: numberOrNull(diag.audioSampleRate),
    finalFirstAudioFrameSampleRate: numberOrNull(
      diag.firstAudioFrameSampleRate,
    ),
    finalAudioSampleRateMismatchRebuilds: numberOrNull(
      diag.audioSampleRateMismatchRebuilds,
    ),
    finalDroppedAudioForBackpressure: numberOrNull(
      payload?.droppedForBackpressure?.audio ??
        diag.droppedAudioForBackpressure,
    ),
    finalPeakAudioEncodeQueueSize: numberOrNull(
      payload?.peakEncodeQueueSize?.audio ?? diag.peakAudioEncodeQueueSize,
    ),
    finalAudioFlushMs: numberOrNull(payload?.flushMs?.audio),
    finalMuxerFinalizeOk: boolOrNull(payload?.muxerFinalizeOk),
    finalFramesEncoded: numberOrNull(payload?.framesEncoded),
  };
};

export const persistFinalWebCodecsAudioSnapshot = async (payload = {}) => {
  const finalSnapshot = buildFinalWebCodecsAudioSnapshot(payload);
  try {
    const res = await chrome.storage.local.get(["lastRecordingAudioSnapshot"]);
    await chrome.storage.local.set({
      lastRecordingAudioSnapshot: {
        ...(res?.lastRecordingAudioSnapshot || {}),
        ...finalSnapshot,
      },
    });
  } catch {}
  return finalSnapshot;
};

export const buildAudioDiagnosticsSnapshot = (store = {}) => {
  const micInput = safeMicInput(store.lastMicInputSnapshot);
  const mainRoute = safeRoute(store.lastRecordingAudioGraphSnapshot);
  const regionRoute = safeRoute(store.lastRegionRecordingAudioGraphSnapshot);
  const encoder = safeEncoder(store.lastRecordingAudioSnapshot);

  const out = {};
  if (micInput) out.micInput = micInput;
  if (mainRoute) out.mainRoute = mainRoute;
  if (regionRoute) out.regionRoute = regionRoute;
  if (encoder) out.encoder = encoder;
  return Object.keys(out).length ? out : null;
};

export const buildAudioDiagnosticsContext = (store = {}) => {
  const snapshot = buildAudioDiagnosticsSnapshot(store);
  if (!snapshot) return {};

  const route = snapshot.mainRoute || snapshot.regionRoute || null;
  const ctx = {};
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
  if (snapshot.encoder?.finalAudioElapsedUs != null) {
    ctx.finalAudioMs = String(
      Math.round(snapshot.encoder.finalAudioElapsedUs / 1000),
    );
  }
  if (snapshot.encoder?.finalDroppedAudioForBackpressure != null) {
    ctx.audioDrops = String(snapshot.encoder.finalDroppedAudioForBackpressure);
  }
  if (snapshot.encoder?.finalPeakAudioEncodeQueueSize != null) {
    ctx.audioQPeak = String(snapshot.encoder.finalPeakAudioEncodeQueueSize);
  }
  if (snapshot.encoder?.finalAudioSampleRateMismatchRebuilds != null) {
    ctx.audioRateRebuilds = String(
      snapshot.encoder.finalAudioSampleRateMismatchRebuilds,
    );
  }
  return ctx;
};

export const formatAudioDiagnosticsLines = (store = {}) => {
  const ctx = buildAudioDiagnosticsContext(store);
  const lines = [];
  if (ctx.audioRoute) lines.push(`AudioRt:  ${ctx.audioRoute}`);
  if (ctx.micHz || ctx.micCh) {
    lines.push(
      `MicInput: ${ctx.micHz || "?"}Hz ch=${ctx.micCh || "?"}${
        ctx.micLowHz === "1" ? " low-rate" : ""
      }`,
    );
  }
  if (ctx.encHz || ctx.firstAudioHz) {
    lines.push(
      `Encoder:  ${ctx.encHz || "?"}Hz first=${ctx.firstAudioHz || "?"}Hz`,
    );
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
