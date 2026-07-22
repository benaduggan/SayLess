export const LOCAL_RECORDING_EVENTS_KEY = "localRecordingEvents";
const MAX_EVENTS = 300;

let writeChain: Promise<void> = Promise.resolve();

export const appendLocalRecordingEvent = async (
  event: unknown,
): Promise<boolean> => {
  if (!event || typeof event !== "object") return false;
  const eventRecord = event as Record<string, unknown>;
  const chromeApi = (globalThis as typeof globalThis & {
    chrome: {
      storage: {
        local: {
          get: (keys: string[]) => Promise<Record<string, unknown>>;
          set: (values: Record<string, unknown>) => Promise<void>;
        };
      };
    };
  }).chrome;
  const job = writeChain.then(async () => {
    const existing = await chromeApi.storage.local.get([LOCAL_RECORDING_EVENTS_KEY]);
    const current: unknown[] = Array.isArray(existing[LOCAL_RECORDING_EVENTS_KEY])
      ? existing[LOCAL_RECORDING_EVENTS_KEY]
      : [];
    const next = [...current, event].slice(-MAX_EVENTS);
    await chromeApi.storage.local.set({
      [LOCAL_RECORDING_EVENTS_KEY]: next,
      lastLocalRecordingEvent: event,
    });
  });
  writeChain = job.catch(() => {});
  try {
    await job;
    return true;
  } catch (err) {
    // Don't throw (diagnostic events can't break recording), but log loudly:
    // silent event loss is the bug this serializer was added to fix.
    console.warn(
      "[localRecordingEventStore] write failed; event lost:",
      err instanceof Error ? err.message : err,
      { eventType: eventRecord.event || eventRecord.type || null },
    );
    return false;
  }
};
