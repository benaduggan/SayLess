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
const transcriptCache = await import("../../src/transcription/cache.js");
const timeline = await import("../../src/edl/timeline.js");
const transcriptEdit = await import("../../src/edl/fromTranscript.js");
const suggestions = await import("../../src/edl/suggestions.js");
const renderTimeline = await import("../../src/pages/Editor/utils/renderTimeline.js");
const renderTimelineAudio = await import("../../src/pages/Editor/utils/renderTimelineAudio.js");
const audio = await import("../../src/transcription/audio.js");
const exportJobState = await import(
  "../../src/pages/EditorApp/context/exportJobState.js"
);
const exportPanelState = await import(
  "../../src/pages/EditorApp/layout/player/exportPanelState.js"
);

window.LOCAL_RECORDINGS = library;
window.TRANSCRIPT_CACHE = transcriptCache;
window.LOCAL_TIMELINE = timeline;
window.TRANSCRIPT_EDIT = transcriptEdit;
window.EDL_SUGGESTIONS = suggestions;
window.RENDER_TIMELINE = renderTimeline.default;
window.RENDER_TIMELINE_AUDIO = renderTimelineAudio.default;
window.TRANSCRIPTION_AUDIO = audio;
window.EXPORT_JOB_STATE = exportJobState;
window.EXPORT_PANEL_STATE = exportPanelState;
window.LOCAL_RECORDINGS_READY = true;
