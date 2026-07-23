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
  removeProjectAudio?: boolean;
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
  frame: string | null;
  base64?: string | ArrayBuffer | null;
  title: string | null;
  mode: string;
  playerLoading: boolean;
  finalizingRecording: boolean;
  undoDisabled: boolean;
  redoDisabled: boolean;
  reencoding: boolean;
  volume: number;
  cropPreset: string;
  replaceAudio: boolean;
  loopAudio: boolean;
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
  dragInteracted?: boolean;
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
  undo?: () => void;
  redo?: () => void;
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
  handleReencode?: (topLevel?: boolean) => Promise<true | undefined>;
  waitForUpdatedBlob?: () => Promise<unknown>;
}

export type EditorContentContextValue = [
  EditorContentState,
  Dispatch<SetStateAction<EditorContentState>>
];
