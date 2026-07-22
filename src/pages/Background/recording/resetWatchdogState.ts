import {
  FIRST_CHUNK_WATCHDOG_ALARM,
  RECORDER_KEEPALIVE_ALARM,
} from "../alarms/alarmConstants";

export const resetWatchdogState = async (): Promise<void> => {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome: {
      alarms: { clear: (name: string) => Promise<boolean> };
      storage: {
        local: { set: (values: Record<string, unknown>) => Promise<void> };
      };
    };
  }).chrome;
  try {
    await chromeApi.alarms.clear(RECORDER_KEEPALIVE_ALARM);
  } catch {}
  try {
    await chromeApi.alarms.clear(FIRST_CHUNK_WATCHDOG_ALARM);
  } catch {}
  try {
    await chromeApi.storage.local.set({
      firstChunkAt: null,
      lastChunkAt: null,
      recordingStallLevel: 0,
    });
  } catch {}
};
