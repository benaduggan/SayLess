export type ExportJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface ExportJob {
  id: string;
  kind: string;
  label: string;
  status: ExportJobStatus;
  progress: number;
  canCancel: boolean;
  canRetry: boolean;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface ExportJobState {
  exportJob?: ExportJob | null;
  lastExportDownloadId?: unknown;
  downloading?: boolean;
  downloadingWEBM?: boolean;
  downloadingGIF?: boolean;
  isFfmpegRunning?: boolean;
  processingProgress?: number;
}

export interface CreateExportJobOptions {
  kind?: string;
  label?: string;
  canCancel?: boolean;
}

const clampProgress = (progress: unknown): number =>
  Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));

export const createExportJob = (
  {
    kind = "export",
    label = "Export",
    canCancel = true,
  }: CreateExportJobOptions = {},
  now = Date.now()
): ExportJob => ({
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

export const beginExportJobState = <T extends ExportJobState>(
  prev: T,
  options: CreateExportJobOptions = {},
  now = Date.now()
): T =>
  ({
    ...prev,
    exportJob: createExportJob(options, now),
    lastExportDownloadId: null,
  } as T);

export const updateExportJobProgressState = <T extends ExportJobState>(
  prev: T,
  progress: unknown
): T => {
  if (!prev.exportJob || prev.exportJob.status !== "running") return prev;
  return {
    ...prev,
    exportJob: {
      ...prev.exportJob,
      progress: clampProgress(progress),
    },
  } as T;
};

export const finishExportJobState = <T extends ExportJobState>(
  prev: T,
  {
    status = "failed",
    error = null,
  }: {
    status?: Exclude<ExportJobStatus, "running">;
    error?: string | null;
  } = {},
  now = Date.now()
): T => {
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
  } as T;
};

export const cancelExportJobState = <T extends ExportJobState>(
  prev: T,
  now = Date.now()
): T =>
  ({
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
  } as T);

export const dismissExportJobState = <T extends ExportJobState>(prev: T): T =>
  ({
    ...prev,
    exportJob: null,
  } as T);
