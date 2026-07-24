// EDL editing context (v2: clip timeline). Kept SEPARATE from the big
// ContentState so it stays reviewable. Owns the transcript, the clip TIMELINE
// (split / delete / move / mute), and the bake (concatenate resolved clips into a
// final blob, which becomes the new editing source so edits can be iterated).
//
// Preview is non-destructive: the player plays the current source while
// timelinePreview walks the clips in output order. The transcript is a DERIVED
// view of (words ∩ clips) in output order, so it stays in sync automatically.

import React, {
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditorContent } from "./ContentState";

import {
  createTimeline,
  splitAtSource,
  deleteClip as tlDeleteClip,
  moveClip as tlMoveClip,
  setClipMuted,
  deleteSourceRange,
  muteSourceRange,
  resolveTimeline,
  outputToSource,
  clipWords,
} from "../../../edl/timeline";
import type { ClipWordGroup, ResolvedTimeline, Timeline } from "../../../edl/timeline";
import {
  pushTimelineHistory,
  redoTimelineHistory,
  undoTimelineHistory,
} from "../../../edl/timelineHistory";
import { buildCaptionCues, normalizeCaptionWords } from "../../../edl/captions";
import { buildChapterMarkers } from "../../../edl/chapters";
import type { ChapterMarker } from "../../../edl/chapters";
import {
  buildZoomSuggestions,
  mapZoomKeyframesToOutput,
  normalizeZoomKeyframes,
} from "../../../edl/zoom";
import type { ZoomKeyframe } from "../../../edl/zoom";
import { normalizeCropRegion } from "../../../edl/crop";
import type { CropRegion } from "../../../edl/crop";
import { normalizeProjectAudioTrack, updateProjectAudioTrack } from "../../../edl/projectAudio";
import type { ProjectAudioMode, ProjectAudioTrack } from "../../../edl/projectAudio";
import { validateProjectAudioBlob } from "../../Editor/utils/validateProjectAudio";
import {
  buildAudioSilenceSuggestions,
  buildTranscriptSuggestions,
  mergeEditSuggestions,
} from "../../../edl/suggestions";
import type { EditSuggestion } from "../../../edl/suggestions";
import { wordRange } from "../../../edl/fromTranscript";
import { contiguousTranscriptWordIndexRanges } from "../../../edl/transcriptSelection";
import {
  classifyTranscriptionError,
  formatTranscriptionError,
  transcribe,
} from "../../../transcription";
import {
  normalizeTranscriptionLanguage,
  resolveConfig,
  saveTranscriptionSettings,
} from "../../../transcription/config";
import {
  buildTranscriptCacheMetadata,
  deleteCachedTranscript,
  deleteCachedTranscriptsForRecording,
  getCachedTranscript,
  saveCachedTranscript,
} from "../../../transcription/cache";
import { checkLocalWhisperModelStatus } from "../../../transcription/modelStatus";
import type { Transcript } from "../../../transcription/types";
import {
  getLocalRecordingProject,
  checkpointAppliedLocalRecording,
  deleteLocalRecordingAudioAsset,
  readLocalRecordingAudioAsset,
  saveLocalRecordingAudioAsset,
  saveLocalRecordingProject,
} from "../../localRecordings/localRecordingLibrary";
import { normalizeExportSettings } from "../../localRecordings/projectSchema";
import type { ExportSettings } from "../../localRecordings/projectSchema";
import type { RenderTimelineOptions } from "../../Editor/utils/renderTimeline";
import type { RenderTimelineAudioOptions } from "../../Editor/utils/renderTimelineAudio";

type ProgressCallback = (progress: number) => void;
type ModelStatus = Awaited<ReturnType<typeof checkLocalWhisperModelStatus>>;
type EditKind = "delete" | "mute";
type ExportSettingsPatch = Partial<Omit<ExportSettings, "gif" | "captionStyle">> & {
  gif?: Partial<ExportSettings["gif"]>;
  captionStyle?: Partial<ExportSettings["captionStyle"]>;
};
interface TimelineRenderOptions extends RenderTimelineOptions {
  burnInCaptions?: boolean;
  renderZoomKeyframes?: boolean;
}

const lazyRenderTimeline = (
  sourceBlob: Blob,
  clips: Parameters<typeof import("../../Editor/utils/renderTimeline").default>[1],
  onProgress: ProgressCallback,
  options: RenderTimelineOptions,
) =>
  import("../../Editor/utils/renderTimeline").then((module) =>
    module.default(sourceBlob, clips, onProgress, options),
  );
const lazyRenderTimelineAudio = (
  sourceBlob: Blob,
  clips: Parameters<typeof import("../../Editor/utils/renderTimelineAudio").default>[1],
  onProgress: ProgressCallback,
  options: RenderTimelineAudioOptions,
) =>
  import("../../Editor/utils/renderTimelineAudio").then((module) =>
    module.default(sourceBlob, clips, onProgress, options),
  );
const lazyMixProjectAudio = (
  videoBlob: Blob,
  audioBlob: Blob,
  track: ProjectAudioTrack,
  onProgress: ProgressCallback,
  signal?: AbortSignal,
) =>
  import("../../Editor/utils/mixProjectAudio").then((module) =>
    module.default(videoBlob, audioBlob, track, onProgress, signal),
  );

interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
}

function readMeta(blob: Blob): Promise<MediaMetadata | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const m = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      URL.revokeObjectURL(v.src);
      v.remove();
      resolve(m);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(blob);
  });
}

async function buildAudioSuggestionsFromBlob(blob: Blob): Promise<EditSuggestion[]> {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return [];
  const ctx = new AudioCtx();
  try {
    const buffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index),
    );
    return buildAudioSilenceSuggestions({
      sampleRate: decoded.sampleRate,
      channels,
    });
  } finally {
    await ctx.close?.();
  }
}

export interface EdlContextValue {
  timeline: Timeline | null;
  resolved: ResolvedTimeline;
  transcript: Transcript | null;
  clipView: ClipWordGroup[];
  selectedClipId: string | null;
  setSelectedClipId: Dispatch<SetStateAction<string | null>>;
  canUndoTimeline: boolean;
  canRedoTimeline: boolean;
  undoTimeline: () => void;
  redoTimeline: () => void;
  transcribing: boolean;
  transcribeProgress: number;
  transcriptionLanguage: string;
  updateTranscriptionLanguage: (language: unknown) => Promise<void>;
  transcriptCacheStatus: string;
  modelStatus: ModelStatus;
  refreshModelStatus: () => Promise<ModelStatus>;
  exportSettings: ExportSettings;
  updateExportSettings: (patch?: ExportSettingsPatch) => void;
  projectSaveStatus: string;
  suggestions: EditSuggestion[];
  audioSuggestionStatus: string;
  chapterMarkers: ChapterMarker[];
  zoomSuggestions: ZoomKeyframe[];
  zoomKeyframes: ZoomKeyframe[];
  crop: CropRegion | null;
  updateCrop: (crop: CropRegion | null) => void;
  saveProjectCrop: (crop: CropRegion | null) => Promise<CropRegion | null>;
  audioTrack: ProjectAudioTrack | null;
  audioAsset: Blob | null;
  audioAssetStatus: "idle" | "loading" | "ready" | "missing" | "saving";
  saveProjectAudio: (
    blob: Blob,
    options: {
      fileName?: string;
      volume?: number;
      mode?: ProjectAudioMode;
      loop?: boolean;
    },
  ) => Promise<ProjectAudioTrack>;
  updateProjectAudio: (
    patch: Partial<Pick<ProjectAudioTrack, "volume" | "sourceVolume" | "mode" | "loop">>,
  ) => void;
  removeProjectAudio: () => Promise<void>;
  saveZoomSuggestion: (suggestion: ZoomKeyframe) => void;
  removeZoomKeyframe: (id: string) => void;
  applySuggestion: (suggestion: EditSuggestion | null | undefined) => void;
  exporting: boolean;
  exportProgress: number;
  error: string | null;
  hasEdits: boolean;
  runTranscription: (options?: { force?: boolean }) => Promise<void>;
  regenerateTranscript: () => Promise<void>;
  deleteTranscript: () => Promise<void>;
  splitAtSourceTime: (time: number) => Timeline;
  splitAtOutputTime: (time: number) => Timeline;
  deleteClip: (id: string) => void;
  moveClip: (from: number, to: number) => Timeline;
  toggleMuteClip: (id: string) => Timeline;
  editWords: (fromIndex: number, toIndex: number, kind: EditKind) => void;
  editWordIndexes: (wordIndexes: number[], kind: EditKind) => void;
  resetTimeline: () => void;
  applyEdits: () => Promise<void>;
  renderTimelineForExport: (
    onProgress?: ProgressCallback,
    options?: TimelineRenderOptions,
  ) => Promise<Blob | null>;
  renderTimelineAudioForExport: (
    onProgress?: ProgressCallback,
    options?: RenderTimelineAudioOptions,
  ) => Promise<Blob | null>;
}

export const EdlContext = createContext<EdlContextValue | null>(null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isValidTimeline = (value: unknown): value is Timeline =>
  isRecord(value) &&
  value.version === 2 &&
  isRecord(value.source) &&
  Array.isArray(value.clips) &&
  value.clips.every(
    (clip) =>
      isRecord(clip) &&
      typeof clip.id === "string" &&
      Number.isFinite(Number(clip.sourceStart)) &&
      Number.isFinite(Number(clip.sourceEnd)) &&
      Number(clip.sourceEnd) >= Number(clip.sourceStart),
  );

const isValidTranscript = (value: unknown): value is Transcript =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.language === "string" &&
  Array.isArray(value.words) &&
  value.words.every(
    (word) =>
      isRecord(word) &&
      typeof word.text === "string" &&
      Number.isFinite(Number(word.start)) &&
      Number.isFinite(Number(word.end)),
  );

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const EdlProvider = ({ children }: PropsWithChildren) => {
  const [contentState, setContentState] = useEditorContent();

  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [timelinePast, setTimelinePast] = useState<Timeline[]>([]);
  const [timelineFuture, setTimelineFuture] = useState<Timeline[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframe[]>([]);
  const [crop, setCrop] = useState<CropRegion | null>(null);
  const [audioTrack, setAudioTrack] = useState<ProjectAudioTrack | null>(null);
  const [audioAsset, setAudioAsset] = useState<Blob | null>(null);
  const [audioAssetStatus, setAudioAssetStatus] = useState<
    "idle" | "loading" | "ready" | "missing" | "saving"
  >("idle");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [exportSettings, setExportSettings] = useState(() => normalizeExportSettings());
  const [editSource, setEditSource] = useState<Blob | null>(null); // baked source after Apply
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("auto");
  const [transcriptCacheStatus, setTranscriptCacheStatus] = useState("idle");
  const [audioSuggestionStatus, setAudioSuggestionStatus] = useState("idle");
  const [audioSuggestions, setAudioSuggestions] = useState<EditSuggestion[]>([]);
  const [projectSaveStatus, setProjectSaveStatus] = useState("idle");
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: "checking",
    ready: false,
    message: "Checking bundled Whisper model...",
    requiredCount: 0,
    presentCount: 0,
    missingFiles: [],
    totalBytes: 0,
  });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSaveRevisionRef = useRef(0);
  const projectSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastTranscriptCacheKeyRef = useRef<string | null>(null);

  // The current editable source: the baked blob after Apply, else the original.
  const sourceBlob = editSource || contentState.originalBlob || contentState.blob;
  const duration = Number(contentState.duration) || 0;

  const chapterMarkers = useMemo(
    () =>
      buildChapterMarkers({
        transcript,
        silenceSuggestions: audioSuggestions,
        activityEvents: contentState.recordingMeta?.activityEvents || [],
        duration,
      }),
    [audioSuggestions, contentState.recordingMeta, duration, transcript],
  );

  const zoomSuggestions = useMemo(
    () =>
      buildZoomSuggestions(contentState.recordingMeta?.activityEvents || [], {
        duration,
      }),
    [contentState.recordingMeta, duration],
  );

  useEffect(() => {
    let cancelled = false;
    if (!sourceBlob) {
      setAudioSuggestions([]);
      setAudioSuggestionStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setAudioSuggestionStatus("analyzing");
    setAudioSuggestions([]);
    buildAudioSuggestionsFromBlob(sourceBlob)
      .then((nextSuggestions) => {
        if (cancelled) return;
        setAudioSuggestions(nextSuggestions);
        setAudioSuggestionStatus(nextSuggestions.length ? "ready" : "empty");
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[SayLess] Audio silence analysis failed", e);
        setAudioSuggestions([]);
        setAudioSuggestionStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [sourceBlob]);

  useEffect(() => {
    let cancelled = false;
    checkLocalWhisperModelStatus().then((status) => {
      if (!cancelled) setModelStatus(status);
    });
    resolveConfig()
      .then((config) => {
        if (!cancelled) {
          setTranscriptionLanguage(normalizeTranscriptionLanguage(config.defaultLanguage));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshModelStatus = useCallback(async () => {
    setModelStatus((prev) => ({
      ...prev,
      state: "checking",
      message: "Checking bundled Whisper model...",
    }));
    const status = await checkLocalWhisperModelStatus();
    setModelStatus(status);
    return status;
  }, []);

  // Auto-initialize a single full-span clip once a duration is known, so the
  // main timeline shows a clip immediately (split/delete work without a transcript).
  useEffect(() => {
    if (
      contentState.localRecordingId &&
      hydratedProjectIdRef.current !== contentState.localRecordingId
    ) {
      return;
    }
    if (!timeline && duration > 0) setTimeline(createTimeline(duration));
  }, [timeline, duration, contentState.localRecordingId]);

  useEffect(() => {
    const recordingId = contentState.localRecordingId;
    if (!recordingId) {
      hydratedProjectIdRef.current = null;
      setProjectSaveStatus("idle");
      setAudioTrack(null);
      setAudioAsset(null);
      setAudioAssetStatus("idle");
      return;
    }
    let cancelled = false;
    hydratedProjectIdRef.current = null;
    setProjectSaveStatus("loading");
    getLocalRecordingProject(recordingId)
      .then(async (project) => {
        if (cancelled) return;
        if (isValidTimeline(project?.timeline)) {
          setTimeline(project.timeline);
        } else {
          setTimeline((prev) => prev || (duration > 0 ? createTimeline(duration) : null));
        }
        setTimelinePast([]);
        setTimelineFuture([]);
        setTranscript(isValidTranscript(project?.transcript) ? project.transcript : null);
        setZoomKeyframes(normalizeZoomKeyframes(project?.zoomKeyframes, project?.source));
        setCrop(normalizeCropRegion(project?.crop));
        const nextAudioTrack = normalizeProjectAudioTrack(project?.audioTrack);
        setAudioTrack(nextAudioTrack);
        setAudioAsset(null);
        if (nextAudioTrack) {
          setAudioAssetStatus("loading");
          try {
            const blob = await readLocalRecordingAudioAsset(recordingId, nextAudioTrack);
            if (cancelled) return;
            setAudioAsset(blob);
            setAudioAssetStatus("ready");
          } catch {
            if (cancelled) return;
            setAudioAssetStatus("missing");
          }
        } else {
          setAudioAssetStatus("idle");
        }
        setSelectedClipId(
          typeof project?.selectedClipId === "string" ? project.selectedClipId : null,
        );
        setExportSettings(normalizeExportSettings(project?.exportSettings, project?.source));
        hydratedProjectIdRef.current = recordingId;
        setProjectSaveStatus(project ? "saved" : "idle");
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[SayLess] Failed to load local project state", e);
        hydratedProjectIdRef.current = recordingId;
        setProjectSaveStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [contentState.localRecordingId]);

  useEffect(() => {
    const recordingId = contentState.localRecordingId;
    if (!recordingId || hydratedProjectIdRef.current !== recordingId) return;
    // Applying edits resets the source and project fields in stages. Avoid
    // persisting a mixed pre/post-apply snapshot over the durable checkpoint.
    if (exporting) return;
    if (!timeline && !transcript && !selectedClipId) return;
    const revision = ++projectSaveRevisionRef.current;
    setProjectSaveStatus("pending");
    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = setTimeout(() => {
      projectSaveQueueRef.current = projectSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          if (revision !== projectSaveRevisionRef.current) return;
          setProjectSaveStatus("saving");
          try {
            await saveLocalRecordingProject(recordingId, {
              source: {
                duration: duration || 0,
                mimeType: sourceBlob?.type || contentState.mimeType || null,
                byteSize: sourceBlob?.size || 0,
                width: contentState.prevWidth || contentState.width || 0,
                height: contentState.prevHeight || contentState.height || 0,
              },
              timeline,
              transcript,
              chapterMarkers,
              zoomKeyframes,
              crop,
              audioTrack,
              selectedClipId,
              exportSettings,
            });
            if (revision === projectSaveRevisionRef.current) {
              setProjectSaveStatus("saved");
            }
          } catch (e) {
            console.warn("[SayLess] Failed to save local project state", e);
            if (revision === projectSaveRevisionRef.current) {
              setProjectSaveStatus("error");
            }
          }
        });
    }, 400);
    return () => {
      if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    };
  }, [
    contentState.localRecordingId,
    contentState.mimeType,
    contentState.prevWidth,
    contentState.prevHeight,
    contentState.width,
    contentState.height,
    duration,
    selectedClipId,
    sourceBlob,
    timeline,
    transcript,
    chapterMarkers,
    zoomKeyframes,
    crop,
    audioTrack,
    exportSettings,
    exporting,
  ]);

  const updateCrop = useCallback((nextCrop: CropRegion | null) => {
    setCrop(normalizeCropRegion(nextCrop));
  }, []);

  const saveProjectCrop = useCallback(
    async (nextCrop: CropRegion | null) => {
      const normalizedCrop = normalizeCropRegion(nextCrop);
      const recordingId = contentState.localRecordingId;
      if (!recordingId) {
        setCrop(normalizedCrop);
        return normalizedCrop;
      }
      const revision = ++projectSaveRevisionRef.current;
      if (projectSaveTimerRef.current) {
        clearTimeout(projectSaveTimerRef.current);
        projectSaveTimerRef.current = null;
      }
      const projectSave = projectSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          setProjectSaveStatus("saving");
          await saveLocalRecordingProject(recordingId, {
            source: {
              duration: duration || 0,
              mimeType: sourceBlob?.type || contentState.mimeType || null,
              byteSize: sourceBlob?.size || 0,
              width: contentState.prevWidth || contentState.width || 0,
              height: contentState.prevHeight || contentState.height || 0,
            },
            timeline,
            transcript,
            chapterMarkers,
            zoomKeyframes,
            crop: normalizedCrop,
            audioTrack,
            selectedClipId,
            exportSettings,
          });
          if (revision === projectSaveRevisionRef.current) {
            setProjectSaveStatus("saved");
          }
        });
      projectSaveQueueRef.current = projectSave;
      try {
        await projectSave;
        setCrop(normalizedCrop);
        return normalizedCrop;
      } catch (error) {
        if (revision === projectSaveRevisionRef.current) {
          setProjectSaveStatus("error");
        }
        throw error;
      }
    },
    [
      audioTrack,
      chapterMarkers,
      contentState.height,
      contentState.localRecordingId,
      contentState.mimeType,
      contentState.prevHeight,
      contentState.prevWidth,
      contentState.width,
      duration,
      exportSettings,
      selectedClipId,
      sourceBlob,
      timeline,
      transcript,
      zoomKeyframes,
    ],
  );

  const saveProjectAudio = useCallback(
    async (
      blob: Blob,
      options: {
        fileName?: string;
        volume?: number;
        mode?: ProjectAudioMode;
        loop?: boolean;
      },
    ) => {
      const recordingId = contentState.localRecordingId;
      if (!recordingId) throw new Error("project-audio-requires-local-recording");
      setAudioAssetStatus("saving");
      try {
        await validateProjectAudioBlob(blob);
        const nextTrack = await saveLocalRecordingAudioAsset(recordingId, blob, {
          ...options,
          sourceVolume: 0.7,
          loop: options.loop === true,
        });
        // The audio picker has an explicit Save action, so do not leave its
        // durability to the debounced autosave. Serialize behind any in-flight
        // project write, then persist the complete current snapshot with the new
        // track before returning to the player.
        const revision = ++projectSaveRevisionRef.current;
        if (projectSaveTimerRef.current) {
          clearTimeout(projectSaveTimerRef.current);
          projectSaveTimerRef.current = null;
        }
        const projectSave = projectSaveQueueRef.current
          .catch(() => {})
          .then(async () => {
            setProjectSaveStatus("saving");
            await saveLocalRecordingProject(recordingId, {
              source: {
                duration: duration || 0,
                mimeType: sourceBlob?.type || contentState.mimeType || null,
                byteSize: sourceBlob?.size || 0,
                width: contentState.prevWidth || contentState.width || 0,
                height: contentState.prevHeight || contentState.height || 0,
              },
              timeline,
              transcript,
              chapterMarkers,
              zoomKeyframes,
              crop,
              audioTrack: nextTrack,
              selectedClipId,
              exportSettings,
            });
            if (revision === projectSaveRevisionRef.current) {
              setProjectSaveStatus("saved");
            }
          });
        projectSaveQueueRef.current = projectSave;
        await projectSave;
        if (audioTrack && audioTrack.assetId !== nextTrack.assetId) {
          await deleteLocalRecordingAudioAsset(recordingId, audioTrack).catch(() => false);
        }
        setAudioTrack(nextTrack);
        setAudioAsset(blob);
        setAudioAssetStatus("ready");
        return nextTrack;
      } catch (error) {
        setAudioAssetStatus(audioTrack ? "missing" : "idle");
        throw error;
      }
    },
    [
      audioTrack,
      chapterMarkers,
      contentState.height,
      contentState.localRecordingId,
      contentState.mimeType,
      contentState.prevHeight,
      contentState.prevWidth,
      contentState.width,
      crop,
      duration,
      exportSettings,
      selectedClipId,
      sourceBlob,
      timeline,
      transcript,
      zoomKeyframes,
    ],
  );

  const updateProjectAudio = useCallback(
    (patch: Partial<Pick<ProjectAudioTrack, "volume" | "sourceVolume" | "mode" | "loop">>) => {
      setAudioTrack((current) => (current ? updateProjectAudioTrack(current, patch) : null));
    },
    [],
  );

  const removeProjectAudio = useCallback(async () => {
    const recordingId = contentState.localRecordingId;
    if (recordingId && audioTrack) {
      await deleteLocalRecordingAudioAsset(recordingId, audioTrack).catch(() => false);
    }
    setAudioTrack(null);
    setAudioAsset(null);
    setAudioAssetStatus("idle");
  }, [audioTrack, contentState.localRecordingId]);

  const withTimeline = useCallback(
    (fn: (timeline: Timeline) => Timeline): Timeline => {
      const current = timeline || createTimeline(duration || 0);
      const next = fn(current);
      const history = pushTimelineHistory({
        past: timelinePast,
        future: timelineFuture,
        current,
        next,
      });
      setTimelinePast(history.past);
      setTimelineFuture(history.future);
      const result = history.timeline || current;
      setTimeline(result);
      return result;
    },
    [duration, timeline, timelineFuture, timelinePast],
  );

  const undoTimeline = useCallback(() => {
    const history = undoTimelineHistory({
      past: timelinePast,
      future: timelineFuture,
      current: timeline,
    });
    setTimelinePast(history.past);
    setTimelineFuture(history.future);
    setTimeline(history.timeline);
    if (selectedClipId && !history.timeline?.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(history.timeline?.clips[0]?.id || null);
    }
  }, [selectedClipId, timeline, timelineFuture, timelinePast]);

  const redoTimeline = useCallback(() => {
    const history = redoTimelineHistory({
      past: timelinePast,
      future: timelineFuture,
      current: timeline,
    });
    setTimelinePast(history.past);
    setTimelineFuture(history.future);
    setTimeline(history.timeline);
    if (selectedClipId && !history.timeline?.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(history.timeline?.clips[0]?.id || null);
    }
  }, [selectedClipId, timeline, timelineFuture, timelinePast]);

  const updateTranscriptionLanguage = useCallback(async (language: unknown) => {
    const nextLanguage = normalizeTranscriptionLanguage(language);
    setTranscriptionLanguage(nextLanguage);
    setTranscriptCacheStatus("idle");
    try {
      await saveTranscriptionSettings({ defaultLanguage: nextLanguage });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const updateExportSettings = useCallback(
    (patch: ExportSettingsPatch = {}) => {
      setExportSettings((prev) => {
        const merged = {
          ...prev,
          ...patch,
          gif: { ...prev.gif, ...patch.gif },
          captionStyle: {
            ...prev.captionStyle,
            ...patch.captionStyle,
          },
        };
        return normalizeExportSettings(merged, { duration: duration || 0 });
      });
    },
    [duration],
  );

  const runTranscription = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!sourceBlob) {
        setError("No recording to transcribe yet.");
        return;
      }
      const force = options?.force === true;
      const language = normalizeTranscriptionLanguage(transcriptionLanguage);
      setError(null);
      setTranscribing(true);
      setTranscribeProgress(0);
      setTranscriptCacheStatus(force ? "refreshing" : "checking");
      try {
        const config = await resolveConfig();
        const cacheMetadata = contentState.localRecordingId
          ? await buildTranscriptCacheMetadata({
              blob: sourceBlob,
              recordingId: contentState.localRecordingId,
              config,
              language,
            })
          : null;
        lastTranscriptCacheKeyRef.current = cacheMetadata?.key || null;

        if (cacheMetadata && !force) {
          const cached = await getCachedTranscript(cacheMetadata.key);
          if (cached?.transcript) {
            setTranscript(cached.transcript);
            setTranscribeProgress(1);
            setTranscriptCacheStatus("hit");
            return;
          }
        }

        const latestModelStatus =
          modelStatus.state === "checking" ? await refreshModelStatus() : modelStatus;
        if (!latestModelStatus.ready) {
          const missingSummary = latestModelStatus.missingFiles?.length
            ? ` Missing: ${latestModelStatus.missingFiles.slice(0, 3).join(", ")}${
                latestModelStatus.missingFiles.length > 3 ? ", ..." : ""
              }`
            : "";
          throw classifyTranscriptionError(
            new Error(
              `${latestModelStatus.message || "Bundled Whisper model is not ready."}${missingSummary}`,
            ),
            { phase: "model-load" },
          );
        }

        setTranscriptCacheStatus("miss");
        const t = await transcribe({
          blob: sourceBlob,
          language,
          onProgress: setTranscribeProgress,
        });
        const transcriptWithLanguage = {
          ...t,
          language: t.language || language,
        };
        setTranscript(transcriptWithLanguage);
        if (cacheMetadata) {
          await saveCachedTranscript(cacheMetadata.key, {
            ...cacheMetadata,
            transcript: transcriptWithLanguage,
          });
          setTranscriptCacheStatus("saved");
        } else {
          setTranscriptCacheStatus("uncached");
        }
      } catch (e) {
        setError(formatTranscriptionError(e));
        setTranscriptCacheStatus("error");
      } finally {
        setTranscribing(false);
      }
    },
    [
      contentState.localRecordingId,
      modelStatus,
      refreshModelStatus,
      sourceBlob,
      transcriptionLanguage,
    ],
  );

  const regenerateTranscript = useCallback(
    () => runTranscription({ force: true }),
    [runTranscription],
  );

  const deleteTranscript = useCallback(async () => {
    setTranscript(null);
    setTranscribeProgress(0);
    setTranscriptCacheStatus("deleted");
    try {
      if (lastTranscriptCacheKeyRef.current) {
        await deleteCachedTranscript(lastTranscriptCacheKeyRef.current);
      } else if (contentState.localRecordingId) {
        await deleteCachedTranscriptsForRecording(contentState.localRecordingId);
      }
      lastTranscriptCacheKeyRef.current = null;
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [contentState.localRecordingId]);

  // --- timeline edits ---
  const splitAtSourceTime = useCallback(
    (time: number) => withTimeline((current) => splitAtSource(current, time)),
    [withTimeline],
  );
  const splitAtOutputTime = useCallback(
    (outTime: number) =>
      withTimeline((current) => {
        const hit = outputToSource(current, outTime);
        return hit ? splitAtSource(current, hit.sourceTime) : current;
      }),
    [withTimeline],
  );
  const deleteClipById = useCallback(
    (id: string) => {
      withTimeline((current) => tlDeleteClip(current, id));
      setSelectedClipId((s) => (s === id ? null : s));
    },
    [withTimeline],
  );
  const moveClip = useCallback(
    (from: number, to: number) => withTimeline((current) => tlMoveClip(current, from, to)),
    [withTimeline],
  );
  const toggleMuteClip = useCallback(
    (id: string) =>
      withTimeline((current) => {
        const clip = current.clips.find((candidate) => candidate.id === id);
        return setClipMuted(current, id, !clip?.muted);
      }),
    [withTimeline],
  );

  const editWordIndexes = useCallback(
    (wordIndexes: number[], kind: EditKind) => {
      if (!transcript) return;
      const ranges = contiguousTranscriptWordIndexRanges(wordIndexes)
        .filter(({ toIndex }) => toIndex < transcript.words.length)
        .map(({ fromIndex, toIndex }) => wordRange(transcript.words, fromIndex, toIndex))
        .sort((left, right) => right.start - left.start);
      if (!ranges.length) return;

      withTimeline((current) =>
        ranges.reduce(
          (next, { start, end }) =>
            kind === "delete"
              ? deleteSourceRange(next, start, end)
              : muteSourceRange(next, start, end),
          current,
        ),
      );
    },
    [transcript, withTimeline],
  );

  const editWords = useCallback(
    (fromIndex: number, toIndex: number, kind: EditKind) => {
      const lo = Math.min(fromIndex, toIndex);
      const hi = Math.max(fromIndex, toIndex);
      if (!transcript) return;
      const { start, end } = wordRange(transcript.words, lo, hi);
      withTimeline((current) =>
        kind === "delete"
          ? deleteSourceRange(current, start, end)
          : muteSourceRange(current, start, end),
      );
    },
    [transcript, withTimeline],
  );

  const suggestions = useMemo(
    () => mergeEditSuggestions(buildTranscriptSuggestions(transcript), audioSuggestions),
    [audioSuggestions, transcript],
  );

  const applySuggestion = useCallback(
    (suggestion: EditSuggestion | null | undefined) => {
      if (!suggestion) return;
      const kind = suggestion.action || "delete";
      if (
        typeof suggestion.fromIndex === "number" &&
        Number.isInteger(suggestion.fromIndex) &&
        typeof suggestion.toIndex === "number" &&
        Number.isInteger(suggestion.toIndex)
      ) {
        editWords(suggestion.fromIndex, suggestion.toIndex, kind);
        return;
      }
      const start = Number(suggestion.start);
      const end = Number(suggestion.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      withTimeline((current) =>
        kind === "mute"
          ? muteSourceRange(current, start, end)
          : deleteSourceRange(current, start, end),
      );
    },
    [editWords, withTimeline],
  );

  const saveZoomSuggestion = useCallback(
    (suggestion: ZoomKeyframe) => {
      const [normalized] = normalizeZoomKeyframes([suggestion], { duration });
      if (!normalized) return;
      setZoomKeyframes((prev) => {
        const exists = prev.some((keyframe) => keyframe.id === normalized.id);
        return normalizeZoomKeyframes(exists ? prev : [...prev, normalized], {
          duration,
        });
      });
    },
    [duration],
  );

  const removeZoomKeyframe = useCallback((id: string) => {
    setZoomKeyframes((prev) => prev.filter((keyframe) => keyframe.id !== id));
  }, []);

  const resetTimeline = useCallback(() => {
    withTimeline(() => createTimeline(duration || 0));
    setSelectedClipId(null);
  }, [duration, withTimeline]);

  const resolved = useMemo(
    () => (timeline ? resolveTimeline(timeline) : { segments: [], outputDuration: 0 }),
    [timeline],
  );
  const clipView = useMemo(
    () => (timeline && transcript ? clipWords(timeline, transcript.words) : []),
    [timeline, transcript],
  );

  const hasEdits = useMemo(() => {
    if (!timeline || !timeline.clips.length) return false;
    if (timeline.clips.length !== 1) return true;
    const c = timeline.clips[0];
    return c.muted || c.sourceStart > 0.01 || Math.abs(c.sourceEnd - (duration || 0)) > 0.01;
  }, [timeline, duration]);

  const burnInCaptions = Boolean(exportSettings.captionStyle?.burnIn && transcript?.words?.length);
  const hasZoomKeyframes = zoomKeyframes.length > 0;
  const needsTimelineRender =
    hasEdits || burnInCaptions || hasZoomKeyframes || Boolean(crop) || Boolean(audioTrack);

  const renderTimelineForExport = useCallback(
    async (
      onProgress: ProgressCallback = setExportProgress,
      options: TimelineRenderOptions = {},
    ) => {
      if (!sourceBlob || !timeline || !needsTimelineRender) return null;
      const { segments } = resolveTimeline(timeline);
      const clips = segments.map((s) => ({
        sourceStart: s.sourceStart,
        sourceEnd: s.sourceEnd,
        muted: s.muted,
      }));
      if (!clips.length) return null;
      const shouldBurnCaptions = burnInCaptions && options.burnInCaptions !== false;
      const captions = shouldBurnCaptions
        ? buildCaptionCues(normalizeCaptionWords({ timeline, transcript }))
        : [];
      const renderedZoomKeyframes =
        options.renderZoomKeyframes === false
          ? []
          : mapZoomKeyframesToOutput(zoomKeyframes, timeline);
      const timelineProgress = audioTrack
        ? (progress: number) => onProgress(progress * 0.7)
        : onProgress;
      const rendered = await lazyRenderTimeline(sourceBlob, clips, timelineProgress, {
        captions,
        captionStyle: exportSettings.captionStyle,
        zoomKeyframes: renderedZoomKeyframes,
        crop,
        signal: options.signal,
      });
      if (!audioTrack) return rendered;
      if (!audioAsset) throw new Error("project-audio-asset-missing");
      return lazyMixProjectAudio(
        rendered,
        audioAsset,
        audioTrack,
        (progress) => onProgress(0.7 + progress * 0.3),
        options.signal,
      );
    },
    [
      burnInCaptions,
      exportSettings.captionStyle,
      needsTimelineRender,
      sourceBlob,
      timeline,
      transcript,
      zoomKeyframes,
      crop,
      audioTrack,
      audioAsset,
    ],
  );

  const renderTimelineAudioForExport = useCallback(
    async (
      onProgress: ProgressCallback = setExportProgress,
      options: RenderTimelineAudioOptions = {},
    ) => {
      if (!sourceBlob || !timeline) return null;
      if (audioTrack) {
        const mixed = await renderTimelineForExport((progress) => onProgress(progress * 0.85), {
          burnInCaptions: false,
          renderZoomKeyframes: false,
          signal: options.signal,
        });
        if (!mixed) return null;
        return lazyRenderTimelineAudio(
          mixed,
          [{ sourceStart: 0, sourceEnd: resolved.outputDuration, muted: false }],
          (progress) => onProgress(0.85 + progress * 0.15),
          {
            format: options.format || exportSettings.audioFormat || "wav",
            signal: options.signal,
          },
        );
      }
      const { segments } = resolveTimeline(timeline);
      const clips = segments.map((s) => ({
        sourceStart: s.sourceStart,
        sourceEnd: s.sourceEnd,
        muted: s.muted,
      }));
      if (!clips.length) return null;
      return lazyRenderTimelineAudio(sourceBlob, clips, onProgress, {
        format: options.format || exportSettings.audioFormat || "wav",
        signal: options.signal,
      });
    },
    [
      audioTrack,
      exportSettings.audioFormat,
      renderTimelineForExport,
      resolved.outputDuration,
      sourceBlob,
      timeline,
    ],
  );

  useEffect(() => {
    setContentState((prev) => ({
      ...prev,
      getTimelineExportBlob: needsTimelineRender ? renderTimelineForExport : null,
      timelineExportDuration: needsTimelineRender ? resolved.outputDuration : null,
    }));
    return () => {
      setContentState((prev) =>
        prev.getTimelineExportBlob === renderTimelineForExport
          ? { ...prev, getTimelineExportBlob: null, timelineExportDuration: null }
          : prev,
      );
    };
  }, [needsTimelineRender, renderTimelineForExport, resolved.outputDuration, setContentState]);

  // Bake the timeline into a new blob, make it the editor's blob AND the new edit
  // source, and reset to a fresh single clip so editing can continue iteratively.
  const applyEdits = useCallback(async () => {
    if (!sourceBlob || !timeline) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const out = await renderTimelineForExport(setExportProgress, {
        burnInCaptions: false,
        renderZoomKeyframes: false,
      });
      if (!out) return;
      const meta = await readMeta(out);
      const nextDuration = meta?.duration ?? resolved.outputDuration;
      const nextWidth = meta?.width ?? contentState.width;
      const nextHeight = meta?.height ?? contentState.height;
      const nextTimeline = createTimeline(nextDuration);
      const nextExportSettings = normalizeExportSettings(exportSettings, {
        duration: nextDuration,
      });
      const recordingId = contentState.localRecordingId;
      setContentState((prev) => ({
        ...prev,
        blob: out,
        duration: nextDuration,
        width: nextWidth,
        height: nextHeight,
        start: 0,
        end: 1,
        hasBeenEdited: true,
        mp4ready: true,
      }));
      setEditSource(out);
      setTimeline(nextTimeline);
      setTimelinePast([]);
      setTimelineFuture([]);
      setTranscript(null); // stale against the new (re-timed) source
      setZoomKeyframes([]);
      setCrop(null);
      if (contentState.localRecordingId && audioTrack) {
        await deleteLocalRecordingAudioAsset(contentState.localRecordingId, audioTrack).catch(
          () => false,
        );
      }
      setAudioTrack(null);
      setAudioAsset(null);
      setAudioAssetStatus("idle");
      lastTranscriptCacheKeyRef.current = null;
      setTranscriptCacheStatus("idle");
      setSelectedClipId(null);
      setExportSettings(nextExportSettings);
      if (recordingId) {
        const revision = ++projectSaveRevisionRef.current;
        if (projectSaveTimerRef.current) {
          clearTimeout(projectSaveTimerRef.current);
          projectSaveTimerRef.current = null;
        }
        const applyCheckpoint = projectSaveQueueRef.current
          .catch(() => {})
          .then(async () => {
            setProjectSaveStatus("saving");
            await checkpointAppliedLocalRecording(recordingId, out, {
              source: {
                duration: nextDuration,
                mimeType: out.type || "video/mp4",
                byteSize: out.size,
                width: nextWidth,
                height: nextHeight,
              },
              timeline: nextTimeline,
              transcript: null,
              chapterMarkers: [],
              zoomKeyframes: [],
              crop: null,
              audioTrack: null,
              selectedClipId: null,
              exportSettings: nextExportSettings,
            });
            if (revision === projectSaveRevisionRef.current) {
              setProjectSaveStatus("saved");
            }
          });
        projectSaveQueueRef.current = applyCheckpoint;
        await applyCheckpoint;
      }
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setExporting(false);
    }
  }, [
    audioTrack,
    contentState.height,
    contentState.localRecordingId,
    contentState.width,
    exportSettings,
    resolved.outputDuration,
    sourceBlob,
    timeline,
    renderTimelineForExport,
    setContentState,
  ]);

  const canUndoTimeline = timelinePast.length > 0;
  const canRedoTimeline = timelineFuture.length > 0;

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const element = target instanceof HTMLElement ? target : null;
      const tagName = element?.tagName.toLowerCase();
      return Boolean(
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        element?.isContentEditable,
      );
    };
    const seekBy = (deltaSeconds: number) => {
      setContentState((prev) => ({
        ...prev,
        time: Math.max(0, Math.min(duration || 0, (prev.time || 0) + deltaSeconds)),
        updatePlayerTime: true,
      }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || exporting || transcribing) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTimeline();
        else undoTimeline();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redoTimeline();
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if ((key === "delete" || key === "backspace") && selectedClipId) {
        event.preventDefault();
        deleteClipById(selectedClipId);
      } else if (key === "m" && selectedClipId) {
        event.preventDefault();
        toggleMuteClip(selectedClipId);
      } else if (key === "s") {
        event.preventDefault();
        splitAtSourceTime(contentState.time || 0);
      } else if (key === "arrowleft") {
        event.preventDefault();
        seekBy(event.shiftKey ? -5 : -1);
      } else if (key === "arrowright") {
        event.preventDefault();
        seekBy(event.shiftKey ? 5 : 1);
      } else if (key === "j") {
        event.preventDefault();
        seekBy(-5);
      } else if (key === "l") {
        event.preventDefault();
        seekBy(5);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    contentState.time,
    deleteClipById,
    duration,
    exporting,
    redoTimeline,
    selectedClipId,
    setContentState,
    splitAtSourceTime,
    toggleMuteClip,
    transcribing,
    undoTimeline,
  ]);

  const value = useMemo(
    () => ({
      timeline,
      resolved,
      transcript,
      clipView,
      selectedClipId,
      setSelectedClipId,
      canUndoTimeline,
      canRedoTimeline,
      undoTimeline,
      redoTimeline,
      transcribing,
      transcribeProgress,
      transcriptionLanguage,
      updateTranscriptionLanguage,
      transcriptCacheStatus,
      modelStatus,
      refreshModelStatus,
      exportSettings,
      updateExportSettings,
      projectSaveStatus,
      suggestions,
      audioSuggestionStatus,
      chapterMarkers,
      zoomSuggestions,
      zoomKeyframes,
      saveZoomSuggestion,
      removeZoomKeyframe,
      crop,
      updateCrop,
      saveProjectCrop,
      audioTrack,
      audioAsset,
      audioAssetStatus,
      saveProjectAudio,
      updateProjectAudio,
      removeProjectAudio,
      applySuggestion,
      exporting,
      exportProgress,
      error,
      hasEdits,
      runTranscription,
      regenerateTranscript,
      deleteTranscript,
      splitAtSourceTime,
      splitAtOutputTime,
      deleteClip: deleteClipById,
      moveClip,
      toggleMuteClip,
      editWords,
      editWordIndexes,
      resetTimeline,
      applyEdits,
      renderTimelineForExport,
      renderTimelineAudioForExport,
    }),
    [
      timeline,
      resolved,
      transcript,
      clipView,
      selectedClipId,
      transcribing,
      canUndoTimeline,
      canRedoTimeline,
      undoTimeline,
      redoTimeline,
      transcribeProgress,
      transcriptionLanguage,
      updateTranscriptionLanguage,
      transcriptCacheStatus,
      modelStatus,
      refreshModelStatus,
      exportSettings,
      updateExportSettings,
      projectSaveStatus,
      suggestions,
      audioSuggestionStatus,
      chapterMarkers,
      zoomSuggestions,
      zoomKeyframes,
      saveZoomSuggestion,
      removeZoomKeyframe,
      crop,
      updateCrop,
      saveProjectCrop,
      audioTrack,
      audioAsset,
      audioAssetStatus,
      saveProjectAudio,
      updateProjectAudio,
      removeProjectAudio,
      applySuggestion,
      exporting,
      exportProgress,
      error,
      hasEdits,
      runTranscription,
      regenerateTranscript,
      deleteTranscript,
      splitAtSourceTime,
      splitAtOutputTime,
      deleteClipById,
      moveClip,
      toggleMuteClip,
      editWords,
      editWordIndexes,
      resetTimeline,
      applyEdits,
      renderTimelineForExport,
      renderTimelineAudioForExport,
    ],
  );

  return <EdlContext.Provider value={value}>{children}</EdlContext.Provider>;
};
