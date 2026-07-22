import React, {
  type KeyboardEvent as ReactKeyboardEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styles from "../../styles/player/_RightPanel.module.scss";

import { buildDiagnosticZip } from "../../../utils/buildDiagnosticZip";
import {
  getLocalRecordingCaptionExport,
  getLocalRecordingProjectExport,
  getLocalRecordingTranscriptExport,
} from "../../../localRecordings/localRecordingLibrary";
import {
  assertLocalBlobUrl,
  hasFileSystemSavePicker,
  saveOrDownloadBlob,
} from "../../../utils/localFileExport";
import {
  buildExportCompletionFromSaveResult,
  buildExportJobDescription,
  buildExportRetrySnapshot,
  buildExportJobTitle,
  buildRetryExportSettings,
  canRetryExportJob,
  canRevealExportJob,
} from "./exportPanelState";
import type { ExportRetrySettings } from "./exportPanelState";
import { buildProjectSummary } from "./projectPanelState";

import { ReactSVG } from "react-svg";

const ASSET_URL = chrome.runtime.getURL("assets/");

import CropUI from "../editor/CropUI";
import AudioUI from "../editor/AudioUI";

import { ContentStateContext } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import {
  normalizeExportSettings,
  type AudioExportFormat,
  type CaptionStylePreset,
  type ExportFormat,
  type ExportQualityPreset,
  type ExportSettings,
} from "../../../localRecordings/projectSchema";
import type { SaveBlobResult } from "../../../utils/localFileExport";

const EXPORT_FORMAT_OPTIONS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "gif", label: "GIF" },
  { value: "audio", label: "Audio" },
];

const EXPORT_QUALITY_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "compressed", label: "Smaller file" },
];

const CAPTION_STYLE_OPTIONS = [
  { value: "clean", label: "Clean" },
  { value: "large", label: "Large" },
  { value: "high-contrast", label: "High contrast" },
];

const AUDIO_FORMAT_OPTIONS = [
  { value: "wav", label: "WAV" },
  { value: "m4a", label: "M4A" },
];

const clampNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

const RightPanel = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const edlCtx = useContext(EdlContext);
  const contentStateRef = useRef(contentState);
  const consoleErrorRef = useRef<unknown[]>([]);
  const lastSelectedExportRef = useRef<ExportRetrySettings | null>(null);

  useEffect(() => {
    console.error = (...errors: unknown[]) => {
      consoleErrorRef.current.push(...errors);
    };
  }, []);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  const getNotAvailableLabel = () => {
    if (contentState.fallback && contentState.noffmpeg && contentState.editLimit === 0) {
      return chrome.i18n.getMessage("notAvailableLongRecording");
    }
    if (contentState.fallback && contentState.noffmpeg) {
      return chrome.i18n.getMessage("notAvailableRecoveryMode");
    }
    return chrome.i18n.getMessage("notAvailableLabel");
  };

  const getPreparingLabel = () => {
    const base = chrome.i18n.getMessage("preparingLabel");
    const pct = Math.round(contentState.processingProgress || 0);
    if (!contentState.mp4ready && pct > 0) {
      return `${base} (${pct}%)`;
    }
    return base;
  };

  const exportSettings =
    edlCtx?.exportSettings ?? normalizeExportSettings();
  const updateExportSettings =
    edlCtx?.updateExportSettings || (() => undefined);

  const updateGifSetting = (
    key: keyof ExportSettings["gif"],
    value: unknown,
  ) => {
    const gif = exportSettings.gif || {};
    const duration = Math.max(0.1, Number(contentState.duration) || 0.1);
    const limits: Record<keyof ExportSettings["gif"], [number, number]> = {
      startSeconds: [0, Math.max(0, duration)],
      durationSeconds: [0.1, Math.min(30, duration)],
      fps: [4, 30],
      width: [320, 1920],
    };
    const [min, max] = limits[key];
    updateExportSettings({
      gif: {
        ...gif,
        [key]: clampNumber(value, gif[key], min, max),
      },
    });
  };

  const downloadNamedBlob = async ({
    blob,
    fileName,
  }: {
    blob: Blob | null;
    fileName: string;
  }): Promise<SaveBlobResult> => {
    if (!blob || !fileName) return { saved: false, reason: "missing-input" };
    return saveOrDownloadBlob(blob, fileName, {
      preferPicker: Boolean(contentStateRef.current?.preferFilePicker),
    });
  };

  const safeDownloadBaseName = (name: unknown): string => {
    const cleaned = String(name || "SayLess recording")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
    return cleaned || "SayLess recording";
  };

  const downloadSelectedSidecars = async () => {
    const recordingId = contentStateRef.current?.localRecordingId;
    if (!recordingId) return;
    const exports = [];
    if (exportSettings.includeProjectSidecar) {
      exports.push(getLocalRecordingProjectExport(recordingId));
    }
    if (exportSettings.includeTranscriptSidecar) {
      exports.push(getLocalRecordingTranscriptExport(recordingId));
    }
    if (exportSettings.includeCaptionSidecar) {
      exports.push(getLocalRecordingCaptionExport(recordingId));
    }
    for (const sidecar of await Promise.all(exports)) {
      await downloadNamedBlob(sidecar);
    }
  };

  const getSelectedExportDisabled = () => {
    if (contentState.exportJob?.status === "running") return true;
    if (contentState.isFfmpegRunning) return true;
    if (!contentState.mp4ready) return true;
    if (exportSettings.format === "audio") {
      return typeof edlCtx?.renderTimelineAudioForExport !== "function";
    }
    if (exportSettings.format === "gif") {
      return contentState.downloadingGIF || contentState.noffmpeg;
    }
    if (exportSettings.format === "webm") {
      return contentState.downloadingWEBM;
    }
    return contentState.downloading;
  };

  const handleSelectedExport = async (
    overrideSettings: ExportSettings | ExportRetrySettings | null = null,
  ): Promise<void> => {
    if (getSelectedExportDisabled()) return;
    const selectedSettings = overrideSettings || exportSettings;
    lastSelectedExportRef.current = buildExportRetrySnapshot(selectedSettings);
    if (selectedSettings.format === "audio") {
      const audioFormat = selectedSettings.audioFormat || "wav";
      contentState.beginExportJob?.({
        kind: "audio",
        label: `${audioFormat.toUpperCase()} audio export`,
        canCancel: false,
      });
      if (!edlCtx) return;
      try {
        const blob = await edlCtx.renderTimelineAudioForExport(
          (progress) => contentState.updateExportJobProgress?.(progress * 100),
          { format: audioFormat },
        );
        const saveResult = await downloadNamedBlob({
          blob,
          fileName: `${safeDownloadBaseName(contentState.title)}.${audioFormat}`,
        });
        const completion = buildExportCompletionFromSaveResult(saveResult);
        const downloadId = completion.downloadId;
        if (downloadId) {
          setContentState((prev) => ({
            ...prev,
            lastExportDownloadId: downloadId,
          }));
        }
        contentState.finishExportJob?.(completion);
      } catch (err) {
        console.error("[SayLess] audio export failed", err);
        contentState.finishExportJob?.({
          status: "failed",
          error:
            err instanceof Error
              ? err.message
              : String(err || "Audio export failed."),
        });
        return;
      }
    } else if (selectedSettings.format === "gif") {
      await contentState.downloadGIF(selectedSettings.gif || {});
    } else if (selectedSettings.format === "webm") {
      await contentState.downloadWEBM();
    } else {
      await contentState.download();
    }
    try {
      await downloadSelectedSidecars();
    } catch (err) {
      console.error("[SayLess] sidecar export failed", err);
    }
  };

  const retrySelectedExport = () => {
    const retrySettings = buildRetryExportSettings(
      lastSelectedExportRef.current,
      contentState.exportJob,
    );
    if (!retrySettings) return;
    updateExportSettings(retrySettings);
    handleSelectedExport(retrySettings);
  };

  const handleEdit = () => {
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;
    if (!contentState.mp4ready) return;

    contentState.createBackup();

    setContentState((prevContentState) => ({
      ...prevContentState,
      mode: "edit",
      dragInteracted: false,
    }));
  };

  const handleCrop = () => {
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;

    if (!contentState.mp4ready) return;

    contentState.createBackup();

    // If the frame isn't cached yet, request it and defer the mode switch
    // until "new-frame" arrives, otherwise the cropper mounts over a blank
    // stage and there's a black flash for the round-trip duration.
    if (!contentState.frame) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        pendingCropEntry: true,
      }));
      if (!contentState.isFfmpegRunning) contentState.getFrame();
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      mode: "crop",
    }));
  };

  const handleAddAudio = async () => {
    if (
      contentState.duration > contentState.editLimit &&
      !contentState.override
    )
      return;
    if (!contentState.mp4ready) return;

    contentState.createBackup();

    setContentState((prevContentState) => ({
      ...prevContentState,
      mode: "audio",
    }));
  };

  // Best available blob: edited MP4 → fixed WebM → raw WebM.
  const handleDownloadOriginal = () => {
    const s = contentStateRef.current;
    const source = s.blob || s.webm || s.rawBlob;
    if (!source) return;
    const blob =
      source instanceof Blob
        ? source
        : new Blob([source], { type: "video/webm" });
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const rawTitle = s.title || "sayless-recording";
    const safe = rawTitle
      .replace(/[\\:*?"<>|]/g, " ")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "sayless-recording";
    const url = assertLocalBlobUrl(window.URL.createObjectURL(blob));
    chrome.downloads.download(
      { url: assertLocalBlobUrl(url), filename: `${safe}.${ext}` },
      () => {
        window.URL.revokeObjectURL(assertLocalBlobUrl(url));
      },
    );
  };

  const handleRawRecording = () => {
    if (typeof contentStateRef.current.openModal === "function") {
      contentStateRef.current.openModal(
        chrome.i18n.getMessage("rawRecordingModalTitle"),
        chrome.i18n.getMessage("rawRecordingModalDescription"),
        chrome.i18n.getMessage("rawRecordingModalButton"),
        chrome.i18n.getMessage("sandboxEditorCancelButton"),
        async () => {
          const s = contentStateRef.current;
          const blob = s.rawBlob || s.blob;
          if (!blob) {
            console.error("[SayLess] raw download: no rawBlob available");
            chrome.runtime.sendMessage({
              type: "show-toast",
              message: chrome.i18n.getMessage("rawRecordingModalTitle") + ": no data",
            });
            return;
          }

          const ext = blob.type.includes("mp4") ? "mp4" : "webm";
          const filename = `raw-recording.${ext}`;

          // base64-via-BG fallback: works in Brave and when blob-URL downloads
          // are restricted, doesn't depend on chrome.downloads from here.
          const fallbackViaBackground = async () => {
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            chrome.runtime.sendMessage({
              type: "request-download",
              base64,
              title: filename,
            });
          };

          try {
            const url = assertLocalBlobUrl(window.URL.createObjectURL(blob));
            const downloadId = await new Promise((resolve, reject) => {
              try {
                chrome.downloads.download(
                  { url: assertLocalBlobUrl(url), filename },
                  (id) => {
                    if (chrome.runtime.lastError || !id) {
                      reject(
                        chrome.runtime.lastError ||
                          new Error("download returned no id"),
                      );
                    } else {
                      resolve(id);
                    }
                  },
                );
              } catch (err) {
                reject(err);
              }
            });
            // Detect interrupted (non-user-cancel) downloads; matches the
            // main download flow in ContentState.jsx.
            const interruptHandler = async (
              delta: chrome.downloads.DownloadDelta,
            ) => {
              if (delta.id !== downloadId || !delta.state) return;
              if (
                delta.state.current === "interrupted" &&
                delta.error?.current !== "USER_CANCELED"
              ) {
                chrome.downloads.onChanged.removeListener(interruptHandler);
                try {
                  await fallbackViaBackground();
                } catch (err) {
                  console.error("[SayLess] raw download fallback failed:", err);
                }
              } else if (
                delta.state.current === "complete" ||
                delta.state.current === "interrupted"
              ) {
                chrome.downloads.onChanged.removeListener(interruptHandler);
                window.URL.revokeObjectURL(assertLocalBlobUrl(url));
              }
            };
            chrome.downloads.onChanged.addListener(interruptHandler);
          } catch (err) {
            console.warn(
              "[SayLess] raw download direct path failed, using fallback:",
              err,
            );
            try {
              await fallbackViaBackground();
            } catch (fallbackErr) {
              console.error(
                "[SayLess] raw download fallback failed:",
                fallbackErr,
              );
              chrome.runtime.sendMessage({
                type: "show-toast",
                message: chrome.i18n.getMessage("rawRecordingModalTitle") + ": failed",
              });
            }
          }
        },
        () => {}
      );
    }
  };

  const handleTroubleshooting = () => {
    if (typeof contentStateRef.current.openModal === "function") {
      contentStateRef.current.openModal(
        chrome.i18n.getMessage("troubleshootModalTitle"),
        chrome.i18n.getMessage("troubleshootModalDescription"),
        chrome.i18n.getMessage("troubleshootModalButton"),
        chrome.i18n.getMessage("sandboxEditorCancelButton"),
        async () => {
          try {
            const cs = contentStateRef.current;
            const { blob, filename } = await buildDiagnosticZip({
              source: "sandbox-editor",
              extraConfig: {
                editorMode: cs.mode || null,
                duration: cs.duration || null,
                width: cs.width || null,
                height: cs.height || null,
                hasBlobReady: Boolean(cs.blob || cs.rawBlob),
                mp4ready: Boolean(cs.mp4ready),
                ffmpegLoaded: Boolean(cs.ffmpegLoaded),
                fallback: Boolean(cs.fallback),
                offline: Boolean(cs.offline),
                noffmpeg: Boolean(cs.noffmpeg),
                updateChrome: Boolean(cs.updateChrome),
                hasBeenEdited: Boolean(cs.hasBeenEdited),
                editLimit: cs.editLimit || null,
              },
            });
            const url = assertLocalBlobUrl(window.URL.createObjectURL(blob));
            chrome.downloads.download(
              { url: assertLocalBlobUrl(url), filename },
              () => {
                window.URL.revokeObjectURL(assertLocalBlobUrl(url));
              },
            );
          } catch (err) {
            console.error("[SayLess] Troubleshooting export failed:", err);
          }
        },
        () => {},
      );
    }
  };

  const exportJob = contentState.exportJob;
  const exportJobProgress = Math.round(
    exportJob?.progress || contentState.processingProgress || 0,
  );
  const canSaveToFile = hasFileSystemSavePicker();
  const exportJobTitle = buildExportJobTitle(exportJob);
  const projectSummary = useMemo(
    () =>
      buildProjectSummary({
        recordingId: contentState.localRecordingId,
        saveStatus: edlCtx?.projectSaveStatus,
        timeline: edlCtx?.timeline,
        transcript: edlCtx?.transcript,
        chapterMarkers: edlCtx?.chapterMarkers,
        zoomKeyframes: edlCtx?.zoomKeyframes,
        exportSettings,
      }),
    [
      contentState.localRecordingId,
      edlCtx?.projectSaveStatus,
      edlCtx?.timeline,
      edlCtx?.transcript,
      edlCtx?.chapterMarkers,
      edlCtx?.zoomKeyframes,
      exportSettings,
    ],
  );
  const editActionDisabled =
    (contentState.duration > contentState.editLimit && !contentState.override) ||
    !contentState.mp4ready ||
    contentState.noffmpeg;
  const activateCard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    handler: () => void,
    disabled: boolean,
  ) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };

  return (
    <div className={styles.panel}>
      {contentState.mode === "audio" && <AudioUI />}
      {contentState.mode === "crop" && <CropUI />}
      {contentState.mode === "player" && (
        <div>
          {!contentState.fallback && contentState.offline && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/no-internet.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("offlineLabelTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("offlineLabelDescription")}
                </div>
              </div>
              <div className={styles.buttonRight}>
                {chrome.i18n.getMessage("offlineLabelTryAgain")}
              </div>
            </div>
          )}
          {contentState.fallback && contentState.noffmpeg && contentState.editLimit === 0 && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("longRecordingTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("longRecordingDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={handleDownloadOriginal}
              >
                {chrome.i18n.getMessage("rawRecordingModalButton")}
              </div>
            </div>
          )}
          {contentState.fallback && contentState.noffmpeg && contentState.editLimit !== 0 && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("recoveryModeTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("recoveryModeDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={handleDownloadOriginal}
              >
                {chrome.i18n.getMessage("rawRecordingModalButton")}
              </div>
            </div>
          )}
          {!contentState.fallback &&
            contentState.updateChrome &&
            !contentState.offline &&
            contentState.duration <= contentState.editLimit && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("updateChromeLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("updateChromeLabelDescription")}
                  </div>
                </div>
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    chrome.runtime.sendMessage({ type: "chrome-update-info" });
                  }}
                >
                  {chrome.i18n.getMessage("learnMoreLabel")}
                </div>
              </div>
            )}
          {!contentState.fallback &&
            contentState.duration > contentState.editLimit &&
            !contentState.override &&
            !contentState.offline &&
            !contentState.updateChrome && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("overLimitLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.blob?.type === "video/mp4"
                      ? chrome.i18n.getMessage(
                          "overLimitLabelDescriptionFastPath"
                        )
                      : chrome.i18n.getMessage("overLimitLabelDescription")}
                  </div>
                </div>
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    if (typeof contentState.openModal === "function") {
                      contentState.openModal(
                        chrome.i18n.getMessage("overLimitModalTitle"),
                        chrome.i18n.getMessage(
                          contentState.blob?.type === "video/mp4"
                            ? "overLimitModalDescriptionFastPath"
                            : "overLimitModalDescription"
                        ),
                        chrome.i18n.getMessage("overLimitModalButton"),
                        chrome.i18n.getMessage("sandboxEditorCancelButton"),
                        () => {
                          setContentState((prevContentState) => ({
                            ...prevContentState,
                            saved: true,
                          }));
                          chrome.runtime.sendMessage({
                            type: "force-processing",
                          });
                        },
                        () => {},
                        null,
                        chrome.i18n.getMessage("overLimitModalLearnMore"),
                        () => {
                          chrome.runtime.sendMessage({ type: "memory-limit-help" });
                        }
                      );
                    }
                  }}
                >
                  {chrome.i18n.getMessage("learnMoreLabel")}
                </div>
              </div>
            )}
          {exportJob && (
            <div className={styles.exportJobPanel}>
              <div className={styles.exportJobMain}>
                <div className={styles.exportJobTitle}>{exportJobTitle}</div>
                <div className={styles.exportJobDescription}>
                  {buildExportJobDescription(
                    exportJob,
                    contentState.processingProgress,
                  )}
                </div>
                {exportJob.status === "running" && (
                  <div className={styles.exportJobTrack}>
                    <div
                      className={styles.exportJobProgress}
                      style={{ width: `${exportJobProgress}%` }}
                    />
                  </div>
                )}
              </div>
              <div className={styles.exportJobActions}>
                {exportJob.status === "running" && exportJob.canCancel && (
                  <button type="button" onClick={() => contentState.cancelDownload?.()}>
                    {chrome.i18n.getMessage("cancelLabel")}
                  </button>
                )}
                {canRevealExportJob(
                  exportJob,
                  contentState.lastExportDownloadId,
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        if (contentState.lastExportDownloadId != null) {
                          chrome.downloads.show(contentState.lastExportDownloadId);
                        }
                      } catch (err) {
                        console.error("[SayLess] show export failed", err);
                      }
                    }}
                  >
                    Show
                  </button>
                )}
                {canRetryExportJob(exportJob) && (
                  <button type="button" onClick={retrySelectedExport}>
                    Retry
                  </button>
                )}
                {exportJob.status !== "running" && (
                  <button
                    type="button"
                    onClick={() => contentState.dismissExportJob?.()}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          )}
          {(!contentState.mp4ready || contentState.isFfmpegRunning) &&
            !contentState.downloadingWEBM &&
            !contentState.downloading &&
            contentState.exportJob?.status !== "running" &&
            (contentState.duration <= contentState.editLimit ||
              contentState.override) &&
            !contentState.offline &&
            !contentState.updateChrome &&
            !contentState.noffmpeg && (
              <div className={styles.alert}>
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("videoProcessingLabelTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.isFfmpegRunning
                      ? chrome.i18n.getMessage("editProcessingSafeDescription")
                      : chrome.i18n.getMessage("videoProcessingLabelDescription")}
                  </div>
                </div>
                {!contentState.isFfmpegRunning && (
                <div
                  className={styles.buttonRight}
                  onClick={() => {
                    setContentState((prev) => ({
                      ...prev,
                      editErrorType: null,
                    }));
                  }}
                >
                  {chrome.i18n.getMessage("permissionsModalDismiss")}
                </div>
                )}
              </div>
            )}

          {!contentState.fallback &&
            contentState.editErrorType === "too-long" &&
            !(
              contentState.duration > contentState.editLimit &&
              !contentState.override
            ) && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editTooLongTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editTooLongDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          {!contentState.fallback && contentState.editErrorType === "timeout" && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editTimeoutTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editTimeoutDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          {!contentState.fallback && contentState.editErrorType === "failed" && (
            <div className={styles.alert}>
              <div className={styles.buttonLeft}>
                <ReactSVG src={ASSET_URL + "editor/icons/alert.svg"} />
              </div>
              <div className={styles.buttonMiddle}>
                <div className={styles.buttonTitle}>
                  {chrome.i18n.getMessage("editFailedTitle")}
                </div>
                <div className={styles.buttonDescription}>
                  {chrome.i18n.getMessage("editFailedDescription")}
                </div>
              </div>
              <div
                className={styles.buttonRight}
                onClick={() =>
                  setContentState((prev) => ({ ...prev, editErrorType: null }))
                }
              >
                {chrome.i18n.getMessage("permissionsModalDismiss")}
              </div>
            </div>
          )}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              {chrome.i18n.getMessage("sandboxEditTitle")}
            </div>
            <div className={styles.buttonWrap}>
              <div
                role="button"
                className={styles.button}
                onClick={handleEdit}
                onKeyDown={(event) => activateCard(event, handleEdit, editActionDisabled)}
                tabIndex={editActionDisabled ? -1 : 0}
                aria-disabled={editActionDisabled}
                data-disabled={editActionDisabled ? "true" : undefined}
                data-testid="player-edit-action"
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/trim.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("editButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline && !contentState.ffmpegLoaded
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome ||
                        contentState.noffmpeg ||
                        (contentState.duration > contentState.editLimit &&
                          !contentState.override)
                      ? getNotAvailableLabel()
                      : contentState.mp4ready
                      ? chrome.i18n.getMessage("editButtonDescription")
                      : getPreparingLabel()}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
              <div
                role="button"
                className={styles.button}
                onClick={handleCrop}
                onKeyDown={(event) => activateCard(event, handleCrop, editActionDisabled)}
                tabIndex={editActionDisabled ? -1 : 0}
                aria-disabled={editActionDisabled}
                data-disabled={editActionDisabled ? "true" : undefined}
                data-testid="player-crop-action"
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/crop.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("cropButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline && !contentState.ffmpegLoaded
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome ||
                        contentState.noffmpeg ||
                        (contentState.duration > contentState.editLimit &&
                          !contentState.override)
                      ? getNotAvailableLabel()
                      : contentState.mp4ready
                      ? chrome.i18n.getMessage("cropButtonDescription")
                      : getPreparingLabel()}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
              <div
                role="button"
                className={styles.button}
                onClick={handleAddAudio}
                onKeyDown={(event) => activateCard(event, handleAddAudio, editActionDisabled)}
                tabIndex={editActionDisabled ? -1 : 0}
                aria-disabled={editActionDisabled}
                data-disabled={editActionDisabled ? "true" : undefined}
                data-testid="player-audio-action"
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/audio.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("addAudioButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline && !contentState.ffmpegLoaded
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome ||
                        contentState.noffmpeg ||
                        (contentState.duration > contentState.editLimit &&
                          !contentState.override)
                      ? getNotAvailableLabel()
                      : contentState.mp4ready
                      ? chrome.i18n.getMessage("addAudioButtonDescription")
                      : getPreparingLabel()}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              {chrome.i18n.getMessage("sandboxSaveTitle")}
            </div>
            <div className={styles.projectPanel}>
              <div>
                <div className={styles.projectTitle}>
                  {projectSummary.title}
                </div>
                <div className={styles.projectStatus}>
                  {projectSummary.status}
                </div>
              </div>
              <div className={styles.projectStats}>
                {projectSummary.stats.map((stat) => (
                  <div className={styles.projectStat} key={stat.label}>
                    <span>{stat.value}</span>
                    <small>{stat.label}</small>
                  </div>
                ))}
              </div>
              <div className={styles.projectMeta}>
                <span>{projectSummary.exportLabel}</span>
                <span>{projectSummary.sidecarLabel}</span>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              {chrome.i18n.getMessage("sandboxExportTitle")}
            </div>
            <div className={styles.exportPresetPanel}>
              <label className={styles.exportField}>
                <span>Format</span>
                <select
                  value={exportSettings.format || "mp4"}
                  onChange={(event) =>
                    updateExportSettings({
                      format: event.target.value as ExportFormat,
                    })
                  }
                >
                  {EXPORT_FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.exportField}>
                <span>Quality</span>
                <select
                  value={exportSettings.qualityPreset || "original"}
                  onChange={(event) =>
                    updateExportSettings({
                      qualityPreset: event.target.value as ExportQualityPreset,
                    })
                  }
                >
                  {EXPORT_QUALITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.exportField}>
                <span>Caption style</span>
                <select
                  value={exportSettings.captionStyle?.preset || "clean"}
                  onChange={(event) =>
                    updateExportSettings({
                      captionStyle: {
                        preset: event.target.value as CaptionStylePreset,
                      },
                    })
                  }
                >
                  {CAPTION_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {exportSettings.format === "audio" && (
                <label className={styles.exportField}>
                  <span>Audio format</span>
                  <select
                    value={exportSettings.audioFormat || "wav"}
                    onChange={(event) =>
                      updateExportSettings({
                        audioFormat: event.target.value as AudioExportFormat,
                      })
                    }
                  >
                    {AUDIO_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {exportSettings.format === "gif" && (
                <div className={styles.exportGrid}>
                  <label className={styles.exportField}>
                    <span>Start</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={exportSettings.gif?.startSeconds ?? 0}
                      onChange={(event) =>
                        updateGifSetting("startSeconds", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.exportField}>
                    <span>Seconds</span>
                    <input
                      type="number"
                      min="0.1"
                      max="30"
                      step="0.1"
                      value={exportSettings.gif?.durationSeconds ?? 6}
                      onChange={(event) =>
                        updateGifSetting("durationSeconds", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.exportField}>
                    <span>FPS</span>
                    <input
                      type="number"
                      min="4"
                      max="30"
                      step="1"
                      value={exportSettings.gif?.fps ?? 12}
                      onChange={(event) =>
                        updateGifSetting("fps", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.exportField}>
                    <span>Width</span>
                    <input
                      type="number"
                      min="320"
                      max="1920"
                      step="10"
                      value={exportSettings.gif?.width ?? 960}
                      onChange={(event) =>
                        updateGifSetting("width", event.target.value)
                      }
                    />
                  </label>
                </div>
              )}
              <div className={styles.exportChecks}>
                <label>
                  <input
                    type="checkbox"
                    checked={exportSettings.includeProjectSidecar !== false}
                    onChange={(event) =>
                      updateExportSettings({
                        includeProjectSidecar: event.target.checked,
                      })
                    }
                  />
                  Project sidecar
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(exportSettings.includeTranscriptSidecar)}
                    onChange={(event) =>
                      updateExportSettings({
                        includeTranscriptSidecar: event.target.checked,
                      })
                    }
                  />
                  Transcript sidecar
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(exportSettings.includeCaptionSidecar)}
                    onChange={(event) =>
                      updateExportSettings({
                        includeCaptionSidecar: event.target.checked,
                      })
                    }
                  />
                  VTT captions
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(exportSettings.captionStyle?.burnIn)}
                    onChange={(event) =>
                      updateExportSettings({
                        captionStyle: { burnIn: event.target.checked },
                      })
                    }
                  />
                  Burn into video
                </label>
                {canSaveToFile && (
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(contentState.preferFilePicker)}
                      onChange={(event) =>
                        setContentState((prev) => ({
                          ...prev,
                          preferFilePicker: event.target.checked,
                        }))
                      }
                    />
                    Save to file
                  </label>
                )}
              </div>
            </div>
            <div className={styles.buttonWrap}>
              <div
                role="button"
                className={styles.button}
                onClick={() => handleSelectedExport()}
                aria-disabled={getSelectedExportDisabled()}
                data-testid="export-selected-action"
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/download.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.downloading ||
                    contentState.downloadingWEBM ||
                    contentState.downloadingGIF
                      ? chrome.i18n.getMessage("downloadingLabel")
                      : `Export ${(exportSettings.format || "mp4").toUpperCase()}`}
                  </div>
                  <div className={styles.buttonDescription}>
                    Saves the file and checked local sidecars.
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
              {contentState.fallback && (
                <div
                  role="button"
                  className={styles.button}
                  onClick={() => {
                    lastSelectedExportRef.current = buildExportRetrySnapshot(
                      exportSettings,
                      { format: "webm", audioOnly: false },
                    );
                    contentState.downloadWEBM();
                  }}
                  aria-disabled={contentState.isFfmpegRunning}
                >
                  <div className={styles.buttonLeft}>
                    <ReactSVG src={ASSET_URL + "editor/icons/download.svg"} />
                  </div>
                  <div className={styles.buttonMiddle}>
                    <div className={styles.buttonTitle}>
                      {contentState.downloadingWEBM
                        ? chrome.i18n.getMessage("downloadingLabel")
                        : chrome.i18n.getMessage("downloadWEBMButtonTitle")}
                    </div>
                    <div className={styles.buttonDescription}>
                      {chrome.i18n.getMessage("downloadWEBMButtonDescription")}
                    </div>
                  </div>
                  <div className={styles.buttonRight}>
                    <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                  </div>
                </div>
              )}
              {(() => {
                // WebCodecs path produces a native MP4 blob; download is a
                // blob-URL anchor click, no ffmpeg/re-encode, so editLimit
                // and noffmpeg gates don't apply.
                const isNativeMp4 =
                  contentState.blob?.type === "video/mp4";
                const mp4Disabled = isNativeMp4
                  ? contentState.isFfmpegRunning || !contentState.mp4ready
                  : contentState.isFfmpegRunning ||
                    contentState.noffmpeg ||
                    !contentState.mp4ready;
                const mp4ShowNotAvailable = isNativeMp4
                  ? false
                  : contentState.updateChrome ||
                    contentState.noffmpeg ||
                    (contentState.duration > contentState.editLimit &&
                      !contentState.override);
                return (
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  if (!contentState.mp4ready) return;
                  lastSelectedExportRef.current = buildExportRetrySnapshot(
                    exportSettings,
                    { format: "mp4", audioOnly: false },
                  );
                  contentState.download();
                }}
                aria-disabled={mp4Disabled}
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/download.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.downloading
                      ? chrome.i18n.getMessage("downloadingLabel")
                      : chrome.i18n.getMessage("downloadMP4ButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline &&
                    !contentState.ffmpegLoaded &&
                    !isNativeMp4
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : mp4ShowNotAvailable
                      ? getNotAvailableLabel()
                      : contentState.mp4ready && !contentState.isFfmpegRunning
                      ? chrome.i18n.getMessage("downloadMP4ButtonDescription")
                      : getPreparingLabel()}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
                );
              })()}
              {!contentState.fallback && (
                <div
                  role="button"
                  className={styles.button}
                  onClick={() => {
                    lastSelectedExportRef.current = buildExportRetrySnapshot(
                      exportSettings,
                      { format: "webm", audioOnly: false },
                    );
                    contentState.downloadWEBM();
                  }}
                  aria-disabled={contentState.isFfmpegRunning}
                >
                  <div className={styles.buttonLeft}>
                    <ReactSVG src={ASSET_URL + "editor/icons/download.svg"} />
                  </div>
                  <div className={styles.buttonMiddle}>
                    <div className={styles.buttonTitle}>
                      {contentState.downloadingWEBM
                        ? chrome.i18n.getMessage("downloadingLabel")
                        : chrome.i18n.getMessage("downloadWEBMButtonTitle")}
                    </div>
                    <div className={styles.buttonDescription}>
                      {!contentState.isFfmpegRunning
                        ? chrome.i18n.getMessage(
                            "downloadWEBMButtonDescription"
                          )
                        : getPreparingLabel()}
                    </div>
                  </div>
                  <div className={styles.buttonRight}>
                    <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                  </div>
                </div>
              )}
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  // disabled on a div is meaningless; gate click manually.
                  // Not gated on isFfmpegRunning: it leaks from background
                  // poll handlers and would intermittently swallow the
                  // click. downloadGIF self-locks via downloadingGIF.
                  if (
                    contentState.downloadingGIF ||
                    contentState.duration > 30 ||
                    !contentState.mp4ready ||
                    contentState.noffmpeg
                  ) {
                    return;
                  }
                  lastSelectedExportRef.current = buildExportRetrySnapshot(
                    exportSettings,
                    { format: "gif", audioOnly: false },
                  );
                  contentState.downloadGIF();
                }}
                aria-disabled={
                  contentState.downloadingGIF ||
                  contentState.duration > 30 ||
                  !contentState.mp4ready ||
                  contentState.noffmpeg
                }
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/gif.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {contentState.downloadingGIF
                      ? chrome.i18n.getMessage("downloadingLabel")
                      : chrome.i18n.getMessage("downloadGIFButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {contentState.offline && !contentState.ffmpegLoaded
                      ? chrome.i18n.getMessage("noConnectionLabel")
                      : contentState.updateChrome ||
                        contentState.noffmpeg ||
                        (contentState.duration > contentState.editLimit &&
                          !contentState.override)
                      ? getNotAvailableLabel()
                      : contentState.mp4ready
                      ? chrome.i18n.getMessage("downloadGIFButtonDescription")
                      : getPreparingLabel()}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              {chrome.i18n.getMessage("sandboxAdvancedTitle")}
            </div>
            <div className={styles.buttonWrap}>
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  handleRawRecording();
                }}
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/download.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("rawRecordingButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("rawRecordingButtonDescription")}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
              <div
                role="button"
                className={styles.button}
                onClick={() => {
                  handleTroubleshooting();
                }}
              >
                <div className={styles.buttonLeft}>
                  <ReactSVG src={ASSET_URL + "editor/icons/flag.svg"} />
                </div>
                <div className={styles.buttonMiddle}>
                  <div className={styles.buttonTitle}>
                    {chrome.i18n.getMessage("troubleshootButtonTitle")}
                  </div>
                  <div className={styles.buttonDescription}>
                    {chrome.i18n.getMessage("troubleshootButtonDescription")}
                  </div>
                </div>
                <div className={styles.buttonRight}>
                  <ReactSVG src={ASSET_URL + "editor/icons/right-arrow.svg"} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RightPanel;
