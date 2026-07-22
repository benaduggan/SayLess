declare var __screenityFirstChunkWatchdogMsForTests: number | undefined;
declare var __screenityMidStreamWatchdogMsForTests: number | undefined;
declare var __screenityReclaimRebuildThrottleMsForTests: number | undefined;
declare var __screenityReclaimResetAfterMsForTests: number | undefined;
declare var __screenityForceProbeResolution:
  | { width?: number; height?: number }
  | undefined;
declare var __screenityForceWebCodecsError: boolean | undefined;
declare var __screenityForceTrackEndAfterMs: number | undefined;
declare var __screenityForceAudioSampleRateOverride: number | undefined;
declare var __screenityForceSleepGapMs: number | undefined;
declare var __screenityForceZeroFrames: boolean | undefined;
declare var __screenitySuppressChunks: boolean | undefined;
declare var __screenitySuppressFirstChunks: number | undefined;
declare var __screenityForceConfigureHwQuotaError: boolean | undefined;
declare var __screenityForceConfigureHwQuotaError_fired: boolean | undefined;
declare var __screenityForceConfigureSwQuotaError: boolean | undefined;
declare var __screenityForceConfigureSwQuotaError_fired: boolean | undefined;
declare var __screenityFireVideoEncoderError:
  | ((message?: string) => void)
  | undefined;
declare var __screenityGetReclaimSnapshot:
  | (() => Record<string, unknown>)
  | undefined;

interface Window {
  SAYLESS_DEBUG_RECORDER?: boolean;
  SAYLESS_FORCE_MEDIARECORDER?: boolean;
  __saylessExportRecordingDebug?: () => Promise<void>;
  __saylessPingRecdbg?: () => unknown;
  __screenityContentBootstrapped?: boolean;
  __screenitySetupHandlersInitialized?: boolean;
  __screenitySetupHandlersRan?: boolean;
  __screenityHandlersInitialized?: boolean;
  __screenityLastProjectReady?: Record<string, unknown>;
}

interface Navigator {
  brave?: { isBrave?: () => Promise<boolean> };
}
