export const buildExportJobTitle = (exportJob) => {
  if (!exportJob) return "Export";
  const label = exportJob.label || "Export";
  if (exportJob.status === "completed") return `${label} complete`;
  if (exportJob.status === "failed") return `${label} failed`;
  if (exportJob.status === "cancelled") return `${label} cancelled`;
  return label;
};

export const buildExportJobDescription = (
  exportJob,
  processingProgress = 0,
) => {
  if (!exportJob) return "";
  if (exportJob.status === "completed") return "Export finished.";
  if (exportJob.status === "failed") return exportJob.error || "Export failed.";
  if (exportJob.status === "cancelled") return "Export cancelled.";
  const pct = Math.round(exportJob.progress || processingProgress || 0);
  return pct > 0 ? `Rendering locally (${pct}%)` : "Rendering locally.";
};

export const canRetryExportJob = (exportJob) =>
  exportJob?.status === "failed" || exportJob?.status === "cancelled";

export const canRevealExportJob = (exportJob, lastExportDownloadId) =>
  exportJob?.status === "completed" && Boolean(lastExportDownloadId);

export const buildExportCompletionFromSaveResult = (saveResult) => {
  if (saveResult?.reason === "cancelled") {
    return { status: "cancelled" };
  }
  if (saveResult?.saved) {
    return { status: "completed", downloadId: saveResult.downloadId || null };
  }
  return { status: "failed", error: "Export could not be saved." };
};

export const buildExportRetrySnapshot = (settings = {}, overrides = {}) => {
  const merged = { ...(settings || {}), ...(overrides || {}) };
  return {
    format: merged.format || "mp4",
    qualityPreset: merged.qualityPreset || "original",
    includeProjectSidecar: merged.includeProjectSidecar !== false,
    includeTranscriptSidecar: Boolean(merged.includeTranscriptSidecar),
    includeCaptionSidecar: Boolean(merged.includeCaptionSidecar),
    audioOnly: Boolean(merged.audioOnly),
    audioFormat: merged.audioFormat || "wav",
    captionStyle: { ...(merged.captionStyle || {}) },
    gif: { ...(merged.gif || {}) },
  };
};

export const buildRetryExportSettings = (lastExport, exportJob) => {
  if (!lastExport || exportJob?.status === "running") return null;
  return buildExportRetrySnapshot(lastExport);
};
