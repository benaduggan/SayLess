globalThis.chrome = {
  runtime: {
    getURL(path) {
      return new URL(path, window.location.href).href;
    },
  },
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

const library = await import("../../src/pages/localRecordings/localRecordingLibrary.ts");
const transcriptCache = await import("../../src/transcription/cache.ts");
const timeline = await import("../../src/edl/timeline.ts");
const transcriptEdit = await import("../../src/edl/fromTranscript.ts");
const suggestions = await import("../../src/edl/suggestions.ts");
const renderTimeline = await import("../../src/pages/Editor/utils/renderTimeline.ts");
const renderTimelineAudio = await import("../../src/pages/Editor/utils/renderTimelineAudio.ts");
const mixProjectAudio = await import("../../src/pages/Editor/utils/mixProjectAudio.ts");
const validateProjectAudio = await import("../../src/pages/Editor/utils/validateProjectAudio.ts");
const projectAudioPreviewController =
  await import("../../src/pages/EditorApp/components/editor/projectAudioPreviewController.ts");
const audio = await import("../../src/transcription/audio.ts");
const exportJobState = await import("../../src/pages/EditorApp/context/exportJobState.ts");
const exportPanelState =
  await import("../../src/pages/EditorApp/layout/player/exportPanelState.ts");
const editorOps = await import("../../src/pages/EditorApp/editorOps.ts");

window.LOCAL_RECORDINGS = library;
window.TRANSCRIPT_CACHE = transcriptCache;
window.LOCAL_TIMELINE = timeline;
window.TRANSCRIPT_EDIT = transcriptEdit;
window.EDL_SUGGESTIONS = suggestions;
window.RENDER_TIMELINE = renderTimeline.default;
window.RENDER_TIMELINE_AUDIO = renderTimelineAudio.default;
window.MIX_PROJECT_AUDIO = mixProjectAudio.default;
window.VALIDATE_PROJECT_AUDIO = validateProjectAudio.validateProjectAudioBlob;
window.ATTACH_PROJECT_AUDIO_PREVIEW = projectAudioPreviewController.attachProjectAudioPreview;
window.TRANSCRIPTION_AUDIO = audio;
window.EXPORT_JOB_STATE = exportJobState;
window.EXPORT_PANEL_STATE = exportPanelState;
window.EDITOR_OPS = editorOps;
window.LOCAL_RECORDINGS_READY = true;
