// Pure helpers split out from WebCodecsRecorder so the decision logic
// is unit-testable in Node without mocking VideoEncoder/MSTP.
// Tests: tests/unit/recorderLogic.test.mjs

// AVC Level 5.1 max encoded frame area (~4K). Outer safety net: our
// preferred codec strings declare lower levels (4.2 ~2.07M, 3.0 ~414K)
// but Chrome usually clamps the level silently during HW renegotiation.
// This stops the pathological 6K+ case across NVENC/VT/VAAPI.
export const AVC_MAX_PIXELS = 9_437_184;

// Per-dimension cap before area cap runs. 3840 covers all 4K configs.
export const VIDEO_DIM_HARD_CAP = 3840;

// AAC-LC valid sample rates per ISO/IEC 14496-3. Necessary but not
// sufficient: implementations may still reject rate/bitrate combos
// (e.g. BT HFP narrowband lands at rates the encoder claims to support
// but chokes on at typical bitrates).
export const AAC_SUPPORTED_RATES = Object.freeze(
  new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000]),
);

// Chrome reports reclaim via message text, not a structured code.
const RECLAIM_MESSAGE_RE = /codec\s+reclaimed|reclaimed\s+due\s+to\s+inactivity/i;

export function isReclaimErrorMessage(errOrMessage: unknown): boolean {
  if (!errOrMessage) return false;
  const msg =
    typeof errOrMessage === "string"
      ? errOrMessage
      : String(errOrMessage instanceof Error ? errOrMessage.message : errOrMessage || "");
  return RECLAIM_MESSAGE_RE.test(msg);
}

export function isAacRateInSpec(rate: number): boolean {
  return Number.isFinite(rate) && AAC_SUPPORTED_RATES.has(rate);
}

export function advanceAudioClock({
  elapsedUs = 0,
  frames,
  sampleRate,
}: {
  elapsedUs?: number;
  frames: number;
  sampleRate: number;
}): { timestampUs: number; durationUs: number; nextElapsedUs: number } {
  const safeElapsedUs = Number.isFinite(elapsedUs) ? elapsedUs : 0;
  const safeFrames = Number.isFinite(frames) && frames > 0 ? frames : 0;
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const exactDurationUs = (safeFrames * 1_000_000) / safeSampleRate;
  const durationUs = Math.round(exactDurationUs);
  const timestampUs = Math.round(safeElapsedUs);
  return {
    timestampUs,
    durationUs,
    nextElapsedUs: safeElapsedUs + exactDurationUs,
  };
}

export function shouldDropAudioForBackpressure(queueSize: number, maxQueueSize: number): boolean {
  if (!Number.isFinite(queueSize) || queueSize < 0) return false;
  if (!Number.isFinite(maxQueueSize) || maxQueueSize < 0) return false;
  return queueSize > maxQueueSize;
}

// Cap each dim by min(userMax, hardCap), preserve aspect, round even
// (H.264 requirement) with min 32, then scale down if total pixels
// still exceed avcMaxPixels.
export function computeAvcCappedDimensions({
  sourceWidth,
  sourceHeight,
  userMaxWidth = null,
  userMaxHeight = null,
  hardCap = VIDEO_DIM_HARD_CAP,
  avcMaxPixels = AVC_MAX_PIXELS,
}: {
  sourceWidth: number;
  sourceHeight: number;
  userMaxWidth?: number | null;
  userMaxHeight?: number | null;
  hardCap?: number;
  avcMaxPixels?: number;
}): {
  width: number;
  height: number;
  capped: { perDim: boolean; area: boolean };
} {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error("computeAvcCappedDimensions: invalid source dimensions");
  }
  const userW = Number.isFinite(userMaxWidth) ? Number(userMaxWidth) : hardCap;
  const userH = Number.isFinite(userMaxHeight) ? Number(userMaxHeight) : hardCap;
  const effectiveCapW = Math.min(userW, hardCap);
  const effectiveCapH = Math.min(userH, hardCap);

  let width = Math.min(sourceWidth, effectiveCapW);
  let height = Math.round((sourceHeight / sourceWidth) * width);
  if (height > effectiveCapH) {
    height = effectiveCapH;
    width = Math.round((sourceWidth / sourceHeight) * height);
  }
  const perDimCapped = width < sourceWidth || height < sourceHeight;

  width = Math.max(32, width - (width % 2));
  height = Math.max(32, height - (height % 2));

  let areaCapped = false;
  if (width * height > avcMaxPixels) {
    areaCapped = true;
    const scale = Math.sqrt(avcMaxPixels / (width * height));
    width = Math.max(32, Math.floor((width * scale) / 2) * 2);
    height = Math.max(32, Math.floor((height * scale) / 2) * 2);
  }

  return { width, height, capped: { perDim: perDimCapped, area: areaCapped } };
}

// Skip a rebuild if the last one was within the throttle window;
// otherwise encoder.error fires per frame and burns the cap in ms.
export function shouldThrottleReclaimRebuild(
  nowMs: number,
  lastRebuildAtMs: number | null | undefined,
  throttleMs: number,
): boolean {
  if (lastRebuildAtMs === null || lastRebuildAtMs === undefined) return false;
  if (!Number.isFinite(throttleMs) || throttleMs <= 0) return false;
  return nowMs - lastRebuildAtMs < throttleMs;
}

// After resetAfterMs of clean chunks since the last reclaim, restore
// the full rebuild budget for a future intermittent reclaim.
export function shouldResetReclaimCounter(
  lastChunkAtMs: number,
  lastReclaimAtMs: number | null | undefined,
  resetAfterMs: number,
  currentCount: number,
): boolean {
  if (currentCount <= 0) return false;
  if (lastReclaimAtMs === null || lastReclaimAtMs === undefined) return false;
  return lastChunkAtMs - lastReclaimAtMs >= resetAfterMs;
}

// Frame-arrival gap above sleepGapMs is treated as wake-from-sleep. Gated
// on running/!stopping to suppress spurious detections after stop().
export function shouldTriggerSleepRecovery(
  nowMs: number,
  lastFrameArrivalAtMs: number | null | undefined,
  sleepGapMs: number,
  firstChunkSeen: boolean,
  running = true,
  stopping = false,
): boolean {
  if (!running || stopping) return false;
  if (!firstChunkSeen) return false;
  if (lastFrameArrivalAtMs === null || lastFrameArrivalAtMs === undefined) {
    return false;
  }
  if (!Number.isFinite(sleepGapMs) || sleepGapMs <= 0) return false;
  return nowMs - lastFrameArrivalAtMs > sleepGapMs;
}

// Flush resolved but no chunks were emitted: a header-only file plays
// silently as a corrupt blob. Caller swaps to MediaRecorder.
export function shouldFailZeroChunksAtStop(firstChunkSeen: boolean, frameCount: number): boolean {
  return !firstChunkSeen || frameCount === 0;
}
