export const buildProjectSummary = ({
  recordingId,
  saveStatus,
  timeline,
  transcript,
  chapterMarkers,
  zoomKeyframes,
  exportSettings,
} = {}) => {
  const clips = Array.isArray(timeline?.clips) ? timeline.clips : [];
  const transcriptWords = Array.isArray(transcript?.words)
    ? transcript.words
    : [];
  const chapters = Array.isArray(chapterMarkers) ? chapterMarkers : [];
  const zooms = Array.isArray(zoomKeyframes) ? zoomKeyframes : [];
  const settings = exportSettings || {};
  const sidecars = [];

  if (settings.includeProjectSidecar !== false) sidecars.push("project");
  if (settings.includeTranscriptSidecar) sidecars.push("transcript");
  if (settings.includeCaptionSidecar) sidecars.push("captions");

  const format = settings.audioOnly || settings.format === "audio"
    ? settings.audioFormat || "wav"
    : settings.format || "mp4";

  return {
    title: recordingId ? "Local project" : "Local project not saved yet",
    status: buildProjectSaveStatus(saveStatus, Boolean(recordingId)),
    stats: [
      { label: "Clips", value: clips.length || 0 },
      { label: "Words", value: transcriptWords.length || 0 },
      { label: "Chapters", value: chapters.length || 0 },
      { label: "Zooms", value: zooms.length || 0 },
    ],
    exportLabel: `${String(format).toUpperCase()} export`,
    sidecarLabel: sidecars.length
      ? `${sidecars.join(", ")} sidecar${sidecars.length === 1 ? "" : "s"}`
      : "no sidecars selected",
  };
};

export const buildProjectSaveStatus = (saveStatus, hasRecordingId = true) => {
  if (!hasRecordingId) {
    return "Open this recording from the Videos tab to autosave project data.";
  }
  if (saveStatus === "loading") return "Loading local project...";
  if (saveStatus === "pending") return "Project changes queued for autosave.";
  if (saveStatus === "saving") return "Saving local project...";
  if (saveStatus === "saved") return "Project autosaved locally.";
  if (saveStatus === "error") {
    return "Project autosave failed; export a project sidecar before closing.";
  }
  return "Project autosaves locally when edits change.";
};
