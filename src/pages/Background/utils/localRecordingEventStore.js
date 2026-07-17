export const LOCAL_RECORDING_EVENTS_KEY = "localRecordingEvents";
const MAX_EVENTS = 300;

let writeChain = Promise.resolve();

export const appendLocalRecordingEvent = async (event) => {
  if (!event || typeof event !== "object") return false;
  const job = writeChain.then(async () => {
    const existing = await chrome.storage.local.get([LOCAL_RECORDING_EVENTS_KEY]);
    const current = Array.isArray(existing?.[LOCAL_RECORDING_EVENTS_KEY])
      ? existing[LOCAL_RECORDING_EVENTS_KEY]
      : [];
    const next = [...current, event].slice(-MAX_EVENTS);
    await chrome.storage.local.set({
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
      err?.message || err,
      { eventType: event?.event || event?.type || null },
    );
    return false;
  }
};
