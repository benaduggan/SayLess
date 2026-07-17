const clampProgress = (progress) =>
  Math.min(100, Math.max(0, Math.round(progress || 0)));

export const createExportJob = (
  { kind = "export", label = "Export", canCancel = true } = {},
  now = Date.now(),
) => ({
  id: `${kind}-${now}`,
  kind,
  label,
  status: "running",
  progress: 0,
  canCancel,
  canRetry: false,
  startedAt: now,
  completedAt: null,
  error: null,
});

export const beginExportJobState = (prev, options = {}, now = Date.now()) => ({
  ...prev,
  exportJob: createExportJob(options, now),
  lastExportDownloadId: null,
});

export const updateExportJobProgressState = (prev, progress) => {
  if (!prev.exportJob || prev.exportJob.status !== "running") return prev;
  return {
    ...prev,
    exportJob: {
      ...prev.exportJob,
      progress: clampProgress(progress),
    },
  };
};

export const finishExportJobState = (
  prev,
  { status, error = null } = {},
  now = Date.now(),
) => {
  if (!prev.exportJob || prev.exportJob.status !== "running") return prev;
  return {
    ...prev,
    exportJob: {
      ...prev.exportJob,
      status,
      progress: status === "completed" ? 100 : prev.exportJob.progress,
      canCancel: false,
      canRetry: status === "failed" || status === "cancelled",
      completedAt: now,
      error,
    },
  };
};

export const cancelExportJobState = (prev, now = Date.now()) => ({
  ...prev,
  downloading: false,
  downloadingWEBM: false,
  downloadingGIF: false,
  isFfmpegRunning: false,
  processingProgress: 0,
  exportJob:
    prev.exportJob?.status === "running"
      ? {
          ...prev.exportJob,
          status: "cancelled",
          canCancel: false,
          canRetry: true,
          completedAt: now,
        }
      : prev.exportJob,
});

export const dismissExportJobState = (prev) => ({
  ...prev,
  exportJob: null,
});
