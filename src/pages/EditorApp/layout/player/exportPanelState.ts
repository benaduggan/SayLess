import type { ExportJob } from "../../context/exportJobState.ts";
import type { ExportSettings } from "../../../localRecordings/projectSchema.ts";
import type { SaveBlobResult } from "../../../utils/localFileExport.ts";

export interface ExportRetrySettings extends Omit<ExportSettings, "captionStyle" | "gif"> {
  captionStyle: Partial<ExportSettings["captionStyle"]>;
  gif: Partial<ExportSettings["gif"]>;
}

type ExportSettingsInput = Partial<Omit<ExportSettings, "captionStyle" | "gif">> & {
  captionStyle?: Partial<ExportSettings["captionStyle"]>;
  gif?: Partial<ExportSettings["gif"]>;
};

type ExportJobView = Pick<ExportJob, "label" | "status" | "error" | "progress">;

export const buildExportJobTitle = (exportJob: ExportJobView | null): string => {
  if (!exportJob) return "Export";
  const label = exportJob.label || "Export";
  if (exportJob.status === "completed") return `${label} complete`;
  if (exportJob.status === "failed") return `${label} failed`;
  if (exportJob.status === "cancelled") return `${label} cancelled`;
  return label;
};

export const buildExportJobDescription = (
  exportJob: ExportJobView | null,
  processingProgress = 0,
): string => {
  if (!exportJob) return "";
  if (exportJob.status === "completed") return "Export finished.";
  if (exportJob.status === "failed") return exportJob.error || "Export failed.";
  if (exportJob.status === "cancelled") return "Export cancelled.";
  const pct = Math.round(exportJob.progress || processingProgress || 0);
  return pct > 0 ? `Rendering locally (${pct}%)` : "Rendering locally.";
};

export const canRetryExportJob = (exportJob: ExportJobView | null): boolean =>
  exportJob?.status === "failed" || exportJob?.status === "cancelled";

const isDownloadId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const canRevealExportJob = (
  exportJob: ExportJobView | null,
  lastExportDownloadId: unknown,
): boolean => exportJob?.status === "completed" && isDownloadId(lastExportDownloadId);

export const revealExportDownload = (
  downloadId: unknown,
  downloadsApi?: { show: (id: number) => unknown },
): boolean => {
  if (!isDownloadId(downloadId) || !downloadsApi) return false;
  try {
    downloadsApi.show(downloadId);
    return true;
  } catch {
    return false;
  }
};

export const buildExportCompletionFromSaveResult = (
  saveResult: SaveBlobResult | null,
): {
  status: "cancelled" | "completed" | "failed";
  downloadId?: number | null;
  error?: string;
} => {
  if (saveResult && !saveResult.saved && saveResult.reason === "cancelled") {
    return { status: "cancelled" };
  }
  if (saveResult?.saved) {
    return { status: "completed", downloadId: saveResult.downloadId ?? null };
  }
  return { status: "failed", error: "Export could not be saved." };
};

export const buildExportRetrySnapshot = (
  settings: ExportSettingsInput = {},
  overrides: ExportSettingsInput = {},
): ExportRetrySettings => {
  const merged = { ...settings, ...overrides };
  return {
    format: merged.format || "mp4",
    qualityPreset: merged.qualityPreset || "original",
    includeProjectSidecar: merged.includeProjectSidecar !== false,
    includeTranscriptSidecar: Boolean(merged.includeTranscriptSidecar),
    includeCaptionSidecar: Boolean(merged.includeCaptionSidecar),
    audioOnly: Boolean(merged.audioOnly),
    audioFormat: merged.audioFormat || "wav",
    captionStyle: { ...merged.captionStyle },
    gif: { ...merged.gif },
  };
};

export const buildRetryExportSettings = (
  lastExport: ExportRetrySettings | null,
  exportJob: ExportJobView | null,
): ExportRetrySettings | null => {
  if (!lastExport || exportJob?.status === "running") return null;
  return buildExportRetrySnapshot(lastExport);
};
