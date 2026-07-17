export const emitRecordingEventMarker = async (eventType, extra = {}) => {
  await chrome.storage.local
    .set({
      lastLocalRecordingEventMarker: {
        eventType,
        extra,
        ts: Date.now(),
      },
    })
    .catch(() => {});
};
