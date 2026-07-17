// EDL editing context (v2: clip timeline). Kept SEPARATE from the big
// ContentState so it stays reviewable. Owns the transcript, the clip TIMELINE
// (split / delete / move / mute), and the bake (concatenate resolved clips into a
// final blob, which becomes the new editing source so edits can be iterated).
//
// Preview is non-destructive: the player plays the current source while
// timelinePreview walks the clips in output order. The transcript is a DERIVED
// view of (words ∩ clips) in output order, so it stays in sync automatically.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContentStateContext } from "./ContentState";

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
  sourceToOutput,
  clipWords,
} from "../../../edl/timeline";
import {
  pushTimelineHistory,
  redoTimelineHistory,
  undoTimelineHistory,
} from "../../../edl/timelineHistory";
import {
  buildCaptionCues,
  normalizeCaptionWords,
} from "../../../edl/captions";
import { buildChapterMarkers } from "../../../edl/chapters";
import {
  buildZoomSuggestions,
  normalizeZoomKeyframes,
} from "../../../edl/zoom";
import {
  buildAudioSilenceSuggestions,
  buildTranscriptSuggestions,
  mergeEditSuggestions,
} from "../../../edl/suggestions";
import { wordRange } from "../../../edl/fromTranscript";
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
import {
  getLocalRecordingProject,
  saveLocalRecordingProject,
} from "../../localRecordings/localRecordingLibrary";
import { normalizeExportSettings } from "../../localRecordings/projectSchema";

const lazyRenderTimeline = (...a) =>
  import("../../Editor/utils/renderTimeline").then((m) => m.default(...a));
const lazyRenderTimelineAudio = (...a) =>
  import("../../Editor/utils/renderTimelineAudio").then((m) => m.default(...a));

function readMeta(blob) {
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

async function buildAudioSuggestionsFromBlob(blob) {
  if (!blob?.arrayBuffer) return [];
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

export const EdlContext = createContext(null);

const isValidTimeline = (value) =>
  value?.version === 2 &&
  value?.source &&
  Array.isArray(value.clips) &&
  value.clips.every(
    (clip) =>
      clip?.id &&
      Number.isFinite(Number(clip.sourceStart)) &&
      Number.isFinite(Number(clip.sourceEnd)) &&
      Number(clip.sourceEnd) >= Number(clip.sourceStart),
  );

const isValidTranscript = (value) =>
  value?.version === 1 &&
  Array.isArray(value.words) &&
  value.words.every(
    (word) =>
      typeof word?.text === "string" &&
      Number.isFinite(Number(word.start)) &&
      Number.isFinite(Number(word.end)),
  );

export const EdlProvider = ({ children }) => {
  const [contentState, setContentState] = useContext(ContentStateContext);

  const [timeline, setTimeline] = useState(null);
  const [timelinePast, setTimelinePast] = useState([]);
  const [timelineFuture, setTimelineFuture] = useState([]);
  const [transcript, setTranscript] = useState(null);
  const [zoomKeyframes, setZoomKeyframes] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [exportSettings, setExportSettings] = useState(() =>
    normalizeExportSettings(),
  );
  const [editSource, setEditSource] = useState(null); // baked source after Apply
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("auto");
  const [transcriptCacheStatus, setTranscriptCacheStatus] = useState("idle");
  const [audioSuggestionStatus, setAudioSuggestionStatus] = useState("idle");
  const [audioSuggestions, setAudioSuggestions] = useState([]);
  const [projectSaveStatus, setProjectSaveStatus] = useState("idle");
  const [modelStatus, setModelStatus] = useState({
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
  const [error, setError] = useState(null);
  const hydratedProjectIdRef = useRef(null);
  const projectSaveTimerRef = useRef(null);
  const lastTranscriptCacheKeyRef = useRef(null);

  // The current editable source: the baked blob after Apply, else the original.
  const sourceBlob = editSource || contentState.originalBlob || contentState.blob;
  const duration = contentState.duration;

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
          setTranscriptionLanguage(
            normalizeTranscriptionLanguage(config.defaultLanguage),
          );
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
      return;
    }
    let cancelled = false;
    hydratedProjectIdRef.current = null;
    setProjectSaveStatus("loading");
    getLocalRecordingProject(recordingId)
      .then((project) => {
        if (cancelled) return;
        if (isValidTimeline(project?.timeline)) {
          setTimeline(project.timeline);
        } else {
          setTimeline((prev) => prev || (duration > 0 ? createTimeline(duration) : null));
        }
        setTimelinePast([]);
        setTimelineFuture([]);
        setTranscript(isValidTranscript(project?.transcript) ? project.transcript : null);
        setZoomKeyframes(
          normalizeZoomKeyframes(project?.zoomKeyframes, project?.source),
        );
        setSelectedClipId(project?.selectedClipId || null);
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
    if (!timeline && !transcript && !selectedClipId) return;
    setProjectSaveStatus("pending");
    if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = setTimeout(() => {
      setProjectSaveStatus("saving");
      saveLocalRecordingProject(recordingId, {
        source: {
          duration: duration || 0,
          mimeType: sourceBlob?.type || contentState.mimeType || null,
          byteSize: sourceBlob?.size || 0,
        },
        timeline,
        transcript,
        chapterMarkers,
        zoomKeyframes,
        selectedClipId,
        exportSettings,
      })
        .then(() => setProjectSaveStatus("saved"))
        .catch((e) => {
          console.warn("[SayLess] Failed to save local project state", e);
          setProjectSaveStatus("error");
        });
    }, 400);
    return () => {
      if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
    };
  }, [
    contentState.localRecordingId,
    contentState.mimeType,
    duration,
    selectedClipId,
    sourceBlob,
    timeline,
    transcript,
    chapterMarkers,
    zoomKeyframes,
    exportSettings,
  ]);

  const withTimeline = useCallback(
    (fn) => {
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
      setTimeline(history.timeline);
      return history.timeline;
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
    if (
      selectedClipId &&
      !history.timeline?.clips.some((clip) => clip.id === selectedClipId)
    ) {
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
    if (
      selectedClipId &&
      !history.timeline?.clips.some((clip) => clip.id === selectedClipId)
    ) {
      setSelectedClipId(history.timeline?.clips[0]?.id || null);
    }
  }, [selectedClipId, timeline, timelineFuture, timelinePast]);

  const updateTranscriptionLanguage = useCallback(async (language) => {
    const nextLanguage = normalizeTranscriptionLanguage(language);
    setTranscriptionLanguage(nextLanguage);
    setTranscriptCacheStatus("idle");
    try {
      await saveTranscriptionSettings({ defaultLanguage: nextLanguage });
    } catch (e) {
      setError(e?.message || String(e));
    }
  }, []);

  const updateExportSettings = useCallback(
    (patch = {}) => {
      setExportSettings((prev) => {
        const merged = {
          ...prev,
          ...patch,
          gif: { ...(prev.gif || {}), ...(patch.gif || {}) },
          captionStyle: {
            ...(prev.captionStyle || {}),
            ...(patch.captionStyle || {}),
          },
        };
        return normalizeExportSettings(merged, { duration: duration || 0 });
      });
    },
    [duration],
  );

  const runTranscription = useCallback(async (options = {}) => {
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
        modelStatus.state === "checking"
          ? await refreshModelStatus()
          : modelStatus;
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
  }, [
    contentState.localRecordingId,
    modelStatus,
    refreshModelStatus,
    sourceBlob,
    transcriptionLanguage,
  ]);

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
      setError(e?.message || String(e));
    }
  }, [contentState.localRecordingId]);

  // --- timeline edits ---
  const splitAtSourceTime = useCallback((t) => withTimeline((tl) => splitAtSource(tl, t)), [withTimeline]);
  const splitAtOutputTime = useCallback(
    (outTime) =>
      withTimeline((tl) => {
        const hit = outputToSource(tl, outTime);
        return hit ? splitAtSource(tl, hit.sourceTime) : tl;
      }),
    [withTimeline]
  );
  const deleteClipById = useCallback(
    (id) => {
      withTimeline((tl) => tlDeleteClip(tl, id));
      setSelectedClipId((s) => (s === id ? null : s));
    },
    [withTimeline]
  );
  const moveClip = useCallback((from, to) => withTimeline((tl) => tlMoveClip(tl, from, to)), [withTimeline]);
  const toggleMuteClip = useCallback(
    (id) =>
      withTimeline((tl) => {
        const c = tl.clips.find((x) => x.id === id);
        return setClipMuted(tl, id, !(c && c.muted));
      }),
    [withTimeline]
  );

  const editWords = useCallback(
    (fromIndex, toIndex, kind) => {
      if (!transcript) return;
      const lo = Math.min(fromIndex, toIndex);
      const hi = Math.max(fromIndex, toIndex);
      const { start, end } = wordRange(transcript.words, lo, hi);
      withTimeline((tl) => (kind === "delete" ? deleteSourceRange(tl, start, end) : muteSourceRange(tl, start, end)));
    },
    [transcript, withTimeline]
  );

  const suggestions = useMemo(
    () =>
      mergeEditSuggestions(
        buildTranscriptSuggestions(transcript),
        audioSuggestions,
      ),
    [audioSuggestions, transcript],
  );

  const applySuggestion = useCallback(
    (suggestion) => {
      if (!suggestion) return;
      const kind = suggestion.action || "delete";
      if (
        Number.isInteger(suggestion.fromIndex) &&
        Number.isInteger(suggestion.toIndex)
      ) {
        editWords(suggestion.fromIndex, suggestion.toIndex, kind);
        return;
      }
      const start = Number(suggestion.start);
      const end = Number(suggestion.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      withTimeline((tl) =>
        kind === "mute"
          ? muteSourceRange(tl, start, end)
          : deleteSourceRange(tl, start, end),
      );
    },
    [editWords, withTimeline],
  );

  const saveZoomSuggestion = useCallback(
    (suggestion) => {
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

  const removeZoomKeyframe = useCallback((id) => {
    setZoomKeyframes((prev) => prev.filter((keyframe) => keyframe.id !== id));
  }, []);

  const resetTimeline = useCallback(
    () => {
      withTimeline(() => createTimeline(duration || 0));
      setSelectedClipId(null);
    },
    [duration, withTimeline],
  );

  const resolved = useMemo(() => (timeline ? resolveTimeline(timeline) : { segments: [], outputDuration: 0 }), [timeline]);
  const clipView = useMemo(
    () => (timeline && transcript ? clipWords(timeline, transcript.words) : []),
    [timeline, transcript]
  );

  const hasEdits = useMemo(() => {
    if (!timeline || !timeline.clips.length) return false;
    if (timeline.clips.length !== 1) return true;
    const c = timeline.clips[0];
    return c.muted || c.sourceStart > 0.01 || Math.abs(c.sourceEnd - (duration || 0)) > 0.01;
  }, [timeline, duration]);

  const burnInCaptions = Boolean(
    exportSettings.captionStyle?.burnIn && transcript?.words?.length,
  );
  const hasZoomKeyframes = zoomKeyframes.length > 0;
  const needsTimelineRender = hasEdits || burnInCaptions || hasZoomKeyframes;

  const renderTimelineForExport = useCallback(
    async (onProgress = setExportProgress, options = {}) => {
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
          : zoomKeyframes
              .map((keyframe) => {
                const outputTime = sourceToOutput(timeline, keyframe.time);
                return outputTime == null ? null : { ...keyframe, time: outputTime };
              })
              .filter(Boolean);
      return lazyRenderTimeline(sourceBlob, clips, onProgress, {
        captions,
        captionStyle: exportSettings.captionStyle,
        zoomKeyframes: renderedZoomKeyframes,
        signal: options.signal,
      });
    },
    [
      burnInCaptions,
      exportSettings.captionStyle,
      needsTimelineRender,
      sourceBlob,
      timeline,
      transcript,
      zoomKeyframes,
    ],
  );

  const renderTimelineAudioForExport = useCallback(
    async (onProgress = setExportProgress, options = {}) => {
      if (!sourceBlob || !timeline) return null;
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
    [exportSettings.audioFormat, sourceBlob, timeline],
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
      const meta = (await readMeta(out)) || {};
      setContentState((prev) => ({
        ...prev,
        blob: out,
        duration: meta.duration ?? prev.duration,
        width: meta.width ?? prev.width,
        height: meta.height ?? prev.height,
        start: 0,
        end: 1,
        hasBeenEdited: true,
        mp4ready: true,
      }));
      setEditSource(out);
      setTimeline(createTimeline(meta.duration ?? 0));
      setTimelinePast([]);
      setTimelineFuture([]);
      setTranscript(null); // stale against the new (re-timed) source
      setZoomKeyframes([]);
      lastTranscriptCacheKeyRef.current = null;
      setTranscriptCacheStatus("idle");
      setSelectedClipId(null);
      setExportSettings((prev) =>
        normalizeExportSettings(prev, { duration: meta.duration ?? 0 }),
      );
    } catch (e) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setExporting(false);
    }
  }, [sourceBlob, timeline, renderTimelineForExport, setContentState]);

  const canUndoTimeline = timelinePast.length > 0;
  const canRedoTimeline = timelineFuture.length > 0;

  useEffect(() => {
    const isEditableTarget = (target) => {
      const tagName = target?.tagName?.toLowerCase?.();
      return (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable
      );
    };
    const seekBy = (deltaSeconds) => {
      setContentState((prev) => ({
        ...prev,
        time: Math.max(0, Math.min(duration || 0, (prev.time || 0) + deltaSeconds)),
        updatePlayerTime: true,
      }));
    };
    const onKeyDown = (event) => {
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
      timeline, resolved, transcript, clipView, selectedClipId, setSelectedClipId,
      canUndoTimeline, canRedoTimeline, undoTimeline, redoTimeline,
      transcribing, transcribeProgress, transcriptionLanguage,
      updateTranscriptionLanguage, transcriptCacheStatus, modelStatus,
      refreshModelStatus,
      exportSettings, updateExportSettings,
      projectSaveStatus,
      suggestions, audioSuggestionStatus, chapterMarkers,
      zoomSuggestions, zoomKeyframes, saveZoomSuggestion, removeZoomKeyframe,
      applySuggestion,
      exporting, exportProgress, error, hasEdits,
      runTranscription, regenerateTranscript, deleteTranscript,
      splitAtSourceTime, splitAtOutputTime, deleteClip: deleteClipById,
      moveClip, toggleMuteClip, editWords, resetTimeline, applyEdits,
      renderTimelineForExport, renderTimelineAudioForExport,
    }),
    [
      timeline, resolved, transcript, clipView, selectedClipId, transcribing,
      canUndoTimeline, canRedoTimeline, undoTimeline, redoTimeline,
      transcribeProgress, transcriptionLanguage, updateTranscriptionLanguage,
      transcriptCacheStatus, modelStatus, refreshModelStatus,
      exportSettings, updateExportSettings, projectSaveStatus,
      suggestions, audioSuggestionStatus, chapterMarkers,
      zoomSuggestions, zoomKeyframes, saveZoomSuggestion, removeZoomKeyframe,
      applySuggestion,
      exporting, exportProgress, error, hasEdits,
      runTranscription, regenerateTranscript, deleteTranscript,
      splitAtSourceTime, splitAtOutputTime, deleteClipById,
      moveClip, toggleMuteClip, editWords, resetTimeline, applyEdits,
      renderTimelineForExport, renderTimelineAudioForExport,
    ]
  );

  return <EdlContext.Provider value={value}>{children}</EdlContext.Provider>;
};
