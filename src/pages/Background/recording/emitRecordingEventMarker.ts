export const emitRecordingEventMarker = async (
  eventType: string,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: { set: (values: Record<string, unknown>) => Promise<void> };
        };
      };
    }
  ).chrome;
  await chromeApi.storage.local
    .set({
      lastLocalRecordingEventMarker: {
        eventType,
        extra,
        ts: Date.now(),
      },
    })
    .catch(() => {});
};
