import type { Dispatch, SetStateAction } from "react";
import type {
  CreateExportJobOptions,
  ExportJob,
  ExportJobStatus,
} from "./exportJobState";
import type { GifExportOptions } from "../../Editor/utils/toGIF";

export type EditorHistorySnapshot = Partial<
  Omit<EditorContentState, "history" | "redoHistory">
>;

export interface EditorContentState {
  blob?: Blob | null;
  originalBlob?: Blob | null;
  pendingAudio?: Blob | null;
  time?: number;
  duration: number;
  width: number;
  height: number;
  prevWidth: number;
  prevHeight: number;
  top: number;
  left: number;
  start: number;
  end: number;
  mimeType?: string | null;
  localRecordingId?: string | null;
  webm?: Blob | null;
  rawBlob?: Blob | null;
  backupBlob?: Blob | null;
  frame: string | null;
  base64?: string | ArrayBuffer | null;
  title: string | null;
  mode: string;
  playerLoading: boolean;
  finalizingRecording: boolean;
  trimming: boolean;
  cutting: boolean;
  muting: boolean;
  undoDisabled: boolean;
  redoDisabled: boolean;
  reencoding: boolean;
  volume: number;
  cropPreset: string;
  replaceAudio: boolean;
  bannerSupport: boolean;
  reviewPrompt: boolean;
  reviewEligible: boolean;
  editLimit: number;
  processingProgress: number;
  chunkCount: number;
  chunkIndex: number;
  fallback: boolean;
  noffmpeg: boolean;
  override: boolean;
  offline: boolean;
  updateChrome: boolean;
  ffmpegLoaded: boolean;
  ffmpeg?: boolean;
  ready: boolean;
  saved: boolean;
  isFfmpegRunning: boolean;
  downloading: boolean;
  downloadingWEBM: boolean;
  downloadingGIF: boolean;
  downloadInProgress?: boolean;
  downloadError?: string | null;
  preferFilePicker: boolean;
  pendingCropEntry?: boolean;
  fromCropper?: boolean;
  fromAudio?: boolean;
  cropping?: boolean;
  dragInteracted?: boolean;
  hasTempChanges?: boolean;
  editErrorType?: string | null;
  exportJob: ExportJob | null;
  lastExportDownloadId: number | null;
  recordingMeta?: {
    activityEvents?: Array<{
      type?: string;
      time?: unknown;
      xRatio?: unknown;
      yRatio?: unknown;
      label?: unknown;
    }>;
  } | null;
  updatePlayerTime?: boolean;
  hasBeenEdited?: boolean;
  mp4ready?: boolean;
  getTimelineExportBlob?:
    | ((
        onProgress?: (progress: number) => void,
        options?: {
          burnInCaptions?: boolean;
          renderZoomKeyframes?: boolean;
          signal?: AbortSignal;
        }
      ) => Promise<Blob | null>)
    | null;
  timelineExportDuration?: number | null;
  history: EditorHistorySnapshot[];
  redoHistory: EditorHistorySnapshot[];
  lastDownloadInfo?: {
    path?: string;
    durationMs?: number;
    inputBytes?: number;
    outputBytes?: number;
    timelineExport?: boolean;
    at?: number;
  } | null;
  lastRecordingBackend?: string | null;
  addToHistory: () => void;
  loadFFmpeg: () => unknown;
  createBackup: () => void;
  getFrame: () => unknown;
  download: () => Promise<unknown>;
  downloadWEBM: () => Promise<unknown>;
  downloadGIF: (options?: GifExportOptions) => Promise<unknown>;
  beginExportJob: (options?: CreateExportJobOptions) => string;
  updateExportJobProgress: (progress: number) => void;
  finishExportJob: (result: {
    status: Exclude<ExportJobStatus, "running">;
    error?: string | null;
    downloadId?: unknown;
  }) => void;
  dismissExportJob: () => void;
  cancelDownload: () => void;
  cancelEditOp?: () => void;
  restoreBackup?: () => void;
  clearBackup?: () => void;
  undo?: () => void;
  redo?: () => void;
  handleTrim?: (cut: boolean) => Promise<void>;
  handleMute?: () => Promise<void>;
  openToast?:
    | ((
        title: string,
        action?: (() => void) | null,
        durationMs?: number
      ) => void)
    | null;
  openModal?:
    | ((
        title: string,
        description: string,
        button1: string | null,
        button2: string | null,
        action: () => void,
        action2: () => void,
        image?: string | null,
        learnMore?: string | null,
        learnMoreLink?: (() => void) | null,
        colorSafe?: boolean,
        sideButton?: string | false,
        sideButtonAction?: (() => void) | null
      ) => void)
    | null;
  handleCrop?: (
    left: number,
    top: number,
    width: number,
    height: number
  ) => Promise<true | undefined>;
  addAudio?: (
    videoBlob: Blob | null,
    audioBlob: Blob,
    volume: number
  ) => Promise<void>;
  handleReencode?: (topLevel?: boolean) => Promise<true | undefined>;
  waitForUpdatedBlob?: () => Promise<unknown>;
}

export type EditorContentContextValue = [
  EditorContentState,
  Dispatch<SetStateAction<EditorContentState>>
];
