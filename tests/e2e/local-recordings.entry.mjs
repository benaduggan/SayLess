globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const out = {};
        const names = Array.isArray(keys) ? keys : [keys];
        for (const key of names) {
          const raw = localStorage.getItem(`chrome:${key}`);
          out[key] = raw == null ? undefined : JSON.parse(raw);
        }
        return out;
      },
      async set(value) {
        for (const [key, item] of Object.entries(value)) {
          localStorage.setItem(`chrome:${key}`, JSON.stringify(item));
        }
      },
    },
  },
};

const library = await import(
  "../../src/pages/localRecordings/localRecordingLibrary.js"
);

window.LOCAL_RECORDINGS = library;
window.LOCAL_RECORDINGS_READY = true;
