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
  clipWords,
} from "../../../edl/timeline";
import { wordRange } from "../../../edl/fromTranscript";
import { transcribe } from "../../../transcription";

const lazyRenderTimeline = (...a) =>
  import("../../Editor/utils/renderTimeline").then((m) => m.default(...a));

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

export const EdlContext = createContext(null);

export const EdlProvider = ({ children }) => {
  const [contentState, setContentState] = useContext(ContentStateContext);

  const [timeline, setTimeline] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [editSource, setEditSource] = useState(null); // baked source after Apply
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [error, setError] = useState(null);

  // The current editable source: the baked blob after Apply, else the original.
  const sourceBlob = editSource || contentState.originalBlob || contentState.blob;
  const duration = contentState.duration;

  // Auto-initialize a single full-span clip once a duration is known, so the
  // main timeline shows a clip immediately (split/delete work without a transcript).
  useEffect(() => {
    if (!timeline && duration > 0) setTimeline(createTimeline(duration));
  }, [timeline, duration]);

  const withTimeline = useCallback(
    (fn) => setTimeline((prev) => fn(prev || createTimeline(duration || 0))),
    [duration]
  );

  const runTranscription = useCallback(async () => {
    if (!sourceBlob) {
      setError("No recording to transcribe yet.");
      return;
    }
    setError(null);
    setTranscribing(true);
    setTranscribeProgress(0);
    try {
      const t = await transcribe({ blob: sourceBlob, onProgress: setTranscribeProgress });
      setTranscript(t);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setTranscribing(false);
    }
  }, [sourceBlob]);

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

  const resetTimeline = useCallback(() => setTimeline(createTimeline(duration || 0)), [duration]);

  // Bake the timeline into a new blob, make it the editor's blob AND the new edit
  // source, and reset to a fresh single clip so editing can continue iteratively.
  const applyEdits = useCallback(async () => {
    if (!sourceBlob || !timeline) return;
    const { segments } = resolveTimeline(timeline);
    const clips = segments.map((s) => ({ sourceStart: s.sourceStart, sourceEnd: s.sourceEnd, muted: s.muted }));
    setExporting(true);
    setExportProgress(0);
    try {
      const out = await lazyRenderTimeline(sourceBlob, clips, setExportProgress);
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
      setTranscript(null); // stale against the new (re-timed) source
      setSelectedClipId(null);
    } catch (e) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setExporting(false);
    }
  }, [sourceBlob, timeline, setContentState]);

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

  const value = useMemo(
    () => ({
      timeline, resolved, transcript, clipView, selectedClipId, setSelectedClipId,
      transcribing, transcribeProgress, exporting, exportProgress, error, hasEdits,
      runTranscription, splitAtSourceTime, splitAtOutputTime, deleteClip: deleteClipById,
      moveClip, toggleMuteClip, editWords, resetTimeline, applyEdits,
    }),
    [
      timeline, resolved, transcript, clipView, selectedClipId, transcribing,
      transcribeProgress, exporting, exportProgress, error, hasEdits,
      runTranscription, splitAtSourceTime, splitAtOutputTime, deleteClipById,
      moveClip, toggleMuteClip, editWords, resetTimeline, applyEdits,
    ]
  );

  return <EdlContext.Provider value={value}>{children}</EdlContext.Provider>;
};
