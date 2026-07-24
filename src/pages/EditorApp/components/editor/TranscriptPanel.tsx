// Transcript + timeline editing drawer. Shows the clip TimelineStrip and the
// transcript as a DERIVED view grouped by clip in output order (deletes drop
// words, reorder moves them, mutes flag them — all automatically from the
// timeline). Select a word span to delete/mute it (which splits + edits the
// timeline). "Apply edits" bakes the timeline into the editor blob for download.

import React, { type CSSProperties, useContext, useState } from "react";
import { useEditorContent } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import { TRANSCRIPTION_LANGUAGES } from "../../../../transcription/config";
import type { TimelineWord } from "../../../../edl/timeline";
import type { EditSuggestion } from "../../../../edl/suggestions";

interface TranscriptPanelProps {
  variant?: "drawer" | "inline";
}

interface WordSelection {
  from: number;
  to: number;
}

const TranscriptPanel = ({ variant = "drawer" }: TranscriptPanelProps) => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext);
  const [sel, setSel] = useState<WordSelection | null>(null); // original word indices
  const [open, setOpen] = useState(false); // start closed; opens via the launcher

  if (!edlCtx) return null;
  const {
    transcript,
    clipView,
    transcribing,
    transcribeProgress,
    transcriptionLanguage,
    updateTranscriptionLanguage,
    transcriptCacheStatus,
    modelStatus,
    refreshModelStatus,
    runTranscription,
    regenerateTranscript,
    deleteTranscript,
    editWords,
    suggestions,
    audioSuggestionStatus,
    chapterMarkers,
    zoomSuggestions,
    zoomKeyframes,
    saveZoomSuggestion,
    removeZoomKeyframe,
    applySuggestion,
    resetTimeline,
    applyEdits,
    exporting,
    exportProgress,
    hasEdits,
    error,
  } = edlCtx;

  const seekSource = (seconds: number) =>
    setContentState((prev) => ({
      ...prev,
      time: seconds,
      updatePlayerTime: true,
    }));

  const onWordClick = (event: { shiftKey: boolean }, word: TimelineWord) => {
    if (event.shiftKey && sel) {
      setSel({
        from: Math.min(sel.from, word.index),
        to: Math.max(sel.to, word.index),
      });
    } else {
      setSel({ from: word.index, to: word.index });
      seekSource(word.start);
    }
  };

  const applyToSelection = (kind: "delete" | "mute") => {
    if (!sel) return;
    editWords(sel.from, sel.to, kind);
    setSel(null);
  };

  const formatChapterTime = (seconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const rest = totalSeconds % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  };

  const onSuggestionSeek = (suggestion: EditSuggestion) => {
    seekSource(suggestion.start);
    if (
      typeof suggestion.fromIndex === "number" &&
      Number.isInteger(suggestion.fromIndex) &&
      typeof suggestion.toIndex === "number" &&
      Number.isInteger(suggestion.toIndex)
    ) {
      setSel({
        from: suggestion.fromIndex,
        to: suggestion.toIndex,
      });
    } else {
      setSel(null);
    }
  };

  const audioSuggestionMessage =
    audioSuggestionStatus === "analyzing"
      ? "Analyzing local audio for silence..."
      : audioSuggestionStatus === "unavailable"
        ? "Audio silence analysis is unavailable for this recording."
        : audioSuggestionStatus === "empty"
          ? "No long audio silences detected."
          : null;

  const suggestionPanel = suggestions?.length ? (
    <div style={suggestionsPanel}>
      <div style={suggestionsHeader}>
        <span>Suggestions</span>
        <span style={suggestionsSubhead}>
          {transcript ? "local transcript and audio analysis" : "local audio analysis"}
        </span>
      </div>
      <div style={suggestionsList}>
        {suggestions.slice(0, 8).map((suggestion) => (
          <div key={suggestion.id} style={suggestionRow}>
            <button
              style={suggestionSeekButton}
              onClick={() => onSuggestionSeek(suggestion)}
              title="Seek to suggestion"
            >
              {suggestion.label}
            </button>
            <span style={suggestionReason}>{suggestion.reason}</span>
            <button
              style={miniButton}
              onClick={() => applySuggestion(suggestion)}
              disabled={exporting || transcribing}
            >
              Cut
            </button>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const chaptersPanel =
    chapterMarkers?.length > 1 ? (
      <div style={chaptersPanelStyle}>
        <div style={suggestionsHeader}>
          <span>Chapters</span>
          <span style={suggestionsSubhead}>local auto markers</span>
        </div>
        <div style={chaptersList}>
          {chapterMarkers.slice(0, 10).map((marker) => (
            <button
              key={marker.id}
              style={chapterButton}
              onClick={() => seekSource(marker.time)}
              title={`Seek to ${formatChapterTime(marker.time)}`}
            >
              <span style={chapterTime}>{formatChapterTime(marker.time)}</span>
              <span style={chapterLabel}>{marker.label}</span>
            </button>
          ))}
        </div>
      </div>
    ) : null;

  const zoomPanel =
    zoomSuggestions?.length || zoomKeyframes?.length ? (
      <div style={zoomPanelStyle}>
        <div style={suggestionsHeader}>
          <span>Zoom moments</span>
          <span style={suggestionsSubhead}>local click suggestions</span>
        </div>
        <div style={chaptersList}>
          {zoomSuggestions.slice(0, 8).map((suggestion) => {
            const saved = zoomKeyframes?.some((keyframe) => keyframe.id === suggestion.id);
            return (
              <div key={suggestion.id} style={zoomRow}>
                <button
                  style={chapterButton}
                  onClick={() => seekSource(suggestion.time)}
                  title={`Seek to ${formatChapterTime(suggestion.time)}`}
                >
                  <span style={chapterTime}>{formatChapterTime(suggestion.time)}</span>
                  <span style={chapterLabel}>{suggestion.label}</span>
                </button>
                <button
                  style={miniButton}
                  data-testid="zoom-suggestion-keep"
                  onClick={() => saveZoomSuggestion(suggestion)}
                  disabled={saved}
                >
                  {saved ? "Saved" : "Keep"}
                </button>
              </div>
            );
          })}
          {zoomKeyframes.map((keyframe) => (
            <div key={`saved-${keyframe.id}`} style={zoomRow}>
              <button
                style={chapterButton}
                onClick={() => seekSource(keyframe.time)}
                title={`Seek to saved zoom at ${formatChapterTime(keyframe.time)}`}
              >
                <span style={chapterTime}>{formatChapterTime(keyframe.time)}</span>
                <span style={chapterLabel}>{keyframe.label}</span>
              </button>
              <button
                style={miniButton}
                data-testid="zoom-keyframe-remove"
                onClick={() => removeZoomKeyframe(keyframe.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const curSource = contentState.time || 0;
  const cacheMessage =
    transcriptCacheStatus === "hit"
      ? "Loaded from local cache."
      : transcriptCacheStatus === "saved"
        ? "Saved to local cache."
        : transcriptCacheStatus === "checking"
          ? "Checking local cache..."
          : transcriptCacheStatus === "refreshing"
            ? "Regenerating transcript..."
            : transcriptCacheStatus === "deleted"
              ? "Transcript deleted."
              : null;
  const modelState = modelStatus?.state || "checking";
  const modelReady = modelStatus?.ready === true;
  const modelStatusStyle =
    modelState === "ready"
      ? modelStatusReady
      : modelState === "checking"
        ? modelStatusChecking
        : modelStatusMissing;
  const modelDetail =
    modelState === "missing" && modelStatus?.requiredCount
      ? `${modelStatus.presentCount || 0}/${modelStatus.requiredCount} files present`
      : modelStatus?.totalBytes
        ? `${Math.round((modelStatus.totalBytes / 1024 / 1024) * 10) / 10} MB bundled`
        : "";
  const modelStatusPanel = (
    <div style={{ ...modelStatusBase, ...modelStatusStyle }}>
      <div style={modelStatusTopLine}>
        <span>
          {modelReady
            ? "Model ready"
            : modelState === "checking"
              ? "Checking model"
              : "Model incomplete"}
        </span>
        <button
          style={miniButton}
          onClick={refreshModelStatus}
          disabled={modelState === "checking"}
        >
          Refresh
        </button>
      </div>
      <div style={modelStatusText}>
        {modelStatus?.message || "Bundled Whisper model status unavailable."}
        {modelDetail ? ` ${modelDetail}.` : ""}
      </div>
      {modelStatus?.missingFiles?.length ? (
        <details style={missingDetails}>
          <summary>Missing files</summary>
          <ul style={missingList}>
            {modelStatus.missingFiles.slice(0, 8).map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );

  const languageControl = (
    <label style={languageLabel}>
      <span style={labelText}>Language</span>
      <select
        style={selectStyle}
        value={transcriptionLanguage || "auto"}
        onChange={(event) => updateTranscriptionLanguage(event.target.value)}
        disabled={transcribing}
      >
        {TRANSCRIPTION_LANGUAGES.map((language) => (
          <option key={language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  );

  const body = !transcript ? (
    <div>
      {modelStatusPanel}
      {languageControl}
      {audioSuggestionMessage && <div style={hintText}>{audioSuggestionMessage}</div>}
      {suggestionPanel}
      {chaptersPanel}
      {zoomPanel}
      {transcribing ? (
        <div>
          Transcribing… {Math.round((transcribeProgress || 0) * 100)}%
          <div style={barOuter}>
            <div
              style={{ ...barInner, width: `${Math.round((transcribeProgress || 0) * 100)}%` }}
            />
          </div>
          <div style={hintText}>
            Loads the bundled local speech model; no remote transcription service is used.
          </div>
        </div>
      ) : (
        <>
          <button
            style={btnPrimary}
            onClick={() => runTranscription()}
            data-testid="transcript-generate"
          >
            Generate transcript
          </button>
          <div style={hintText}>
            Transcribe on-device with a bundled local model, then delete &amp; mute words here, or
            split / reorder clips on the timeline below.
          </div>
        </>
      )}
      {cacheMessage && <div style={hintText}>{cacheMessage}</div>}
      {error && <div style={errStyle}>{error}</div>}
    </div>
  ) : (
    <div>
      {modelStatusPanel}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button
          style={sel ? btnDanger : btnDisabled}
          disabled={!sel}
          onClick={() => applyToSelection("delete")}
          data-testid="transcript-delete-words"
        >
          Delete words
        </button>
        <button
          style={sel ? btn : btnDisabled}
          disabled={!sel}
          onClick={() => applyToSelection("mute")}
          data-testid="transcript-mute-words"
        >
          Mute words
        </button>
        <span style={{ flex: 1 }} />
        <button
          style={btn}
          onClick={regenerateTranscript}
          disabled={!modelReady || transcribing || exporting}
          data-testid="transcript-regenerate"
        >
          Regenerate
        </button>
        <button
          style={btnDanger}
          onClick={deleteTranscript}
          disabled={transcribing || exporting}
          data-testid="transcript-delete"
        >
          Delete transcript
        </button>
        {hasEdits && (
          <>
            <button
              style={btn}
              onClick={resetTimeline}
              disabled={exporting}
              data-testid="transcript-reset-edits"
            >
              Reset
            </button>
            <button style={btnPrimary} onClick={applyEdits} disabled={exporting}>
              {exporting ? `Applying ${Math.round((exportProgress || 0) * 100)}%` : "Apply edits"}
            </button>
          </>
        )}
      </div>
      {languageControl}
      <div style={hintText}>click a word to seek · shift-click to extend selection</div>
      {cacheMessage && <div style={hintText}>{cacheMessage}</div>}
      {audioSuggestionMessage && <div style={hintText}>{audioSuggestionMessage}</div>}
      {suggestionPanel}
      {chaptersPanel}
      {zoomPanel}

      <div style={{ marginTop: 8 }}>
        {clipView.map((group, gi) => (
          <div key={group.clipId} style={{ ...clipBlock, ...(group.muted ? clipBlockMuted : {}) }}>
            <div style={clipBadge}>
              clip {gi + 1}
              {group.muted ? " · muted" : ""}
            </div>
            <div style={wordsWrap}>
              {group.words.length === 0 ? (
                <span style={{ color: "#bbb" }}>(no words)</span>
              ) : (
                group.words.map((w) => {
                  const selected = sel && w.index >= sel.from && w.index <= sel.to;
                  const current = curSource >= w.start && curSource < w.end;
                  return (
                    <span
                      key={w.index}
                      onClick={(e) => onWordClick(e, w)}
                      role="button"
                      tabIndex={0}
                      data-testid="transcript-word"
                      aria-label={`Select transcript word ${w.text}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onWordClick(e, w);
                        }
                      }}
                      style={{
                        ...wordStyle,
                        ...(group.muted ? mutedStyle : {}),
                        ...(selected ? selectedStyle : {}),
                        ...(current ? currentStyle : {}),
                      }}
                      title={`${w.start.toFixed(2)}s`}
                    >
                      {w.text}{" "}
                    </span>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <div style={errStyle}>{error}</div>}
    </div>
  );

  if (variant === "inline") {
    return (
      <div style={inlinePanelStyle} data-testid="transcript-panel">
        <div style={inlineHeaderStyle}>
          <span style={{ fontWeight: 700 }}>Transcript</span>
          <span style={inlineSubheadStyle}>word-level local editing</span>
        </div>
        <div style={inlineBodyStyle} data-testid="transcript-body">
          {body}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button style={launcherStyle} onClick={() => setOpen(true)}>
        Transcript
      </button>
    );
  }

  return (
    <div style={drawerStyle}>
      <div style={drawerHeaderStyle}>
        <span style={{ fontWeight: 700 }}>Transcript &amp; Timeline</span>
        <span style={{ flex: 1 }} />
        <button style={closeBtn} onClick={() => setOpen(false)} title="Hide">
          ✕
        </button>
      </div>
      <div style={drawerBodyStyle}>{body}</div>
    </div>
  );
};

const Z = 2147483000;
const drawerStyle: CSSProperties = {
  position: "fixed",
  top: 88,
  right: 0,
  height: "calc(100vh - 88px)",
  width: 400,
  maxWidth: "92vw",
  background: "#fff",
  borderLeft: "1px solid #eee",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
  zIndex: Z,
  display: "flex",
  flexDirection: "column",
  fontSize: 14,
  lineHeight: 1.7,
  pointerEvents: "auto",
};
const drawerHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderBottom: "1px solid #eee",
};
const drawerBodyStyle = { padding: 16, overflow: "auto", flex: 1 };
const inlinePanelStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  fontSize: 14,
  lineHeight: 1.7,
};
const inlineHeaderStyle = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "14px 16px",
  borderBottom: "1px solid #eee",
};
const inlineSubheadStyle = { color: "#888", fontSize: 12 };
const inlineBodyStyle = { padding: 16, overflow: "auto", flex: 1, minHeight: 0 };
const launcherStyle: CSSProperties = {
  position: "fixed",
  bottom: 20,
  right: 20,
  zIndex: Z,
  padding: "10px 16px",
  borderRadius: 999,
  border: "none",
  background: "#4597F7",
  color: "#fff",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
  pointerEvents: "auto",
};
const closeBtn = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 16,
  color: "#666",
  lineHeight: 1,
};
const wordsWrap = { whiteSpace: "pre-wrap" };
const clipBlock = {
  border: "1px solid #eee",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 8,
};
const clipBlockMuted = { background: "#fffaf0", borderColor: "#f0e0b0" };
const clipBadge = { fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 600 };
const wordStyle = { cursor: "pointer", borderRadius: 4, padding: "0 1px" };
const mutedStyle = { color: "#a98800" };
const selectedStyle = { background: "#cfe3ff" };
const currentStyle = { boxShadow: "inset 0 -2px 0 #4597F7" };
const btn = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
};
const btnDisabled = { ...btn, color: "#bbb", cursor: "default" };
const btnPrimary = { ...btn, background: "#4597F7", color: "#fff", border: "none" };
const btnDanger = { ...btn, background: "#ffe2e2", color: "#b00020", border: "1px solid #f3c2c2" };
const miniButton = { ...btn, padding: "3px 8px", fontSize: 12, borderRadius: 6 };
const languageLabel = { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 };
const labelText = { fontSize: 12, color: "#666", fontWeight: 700 };
const selectStyle = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "6px 8px",
  background: "#fff",
  fontSize: 13,
};
const barOuter = { height: 6, background: "#eee", borderRadius: 4, marginTop: 6 };
const barInner = { height: 6, background: "#4597F7", borderRadius: 4 };
const hintText = { color: "#888", fontSize: 12, marginTop: 8 };
const errStyle = { color: "#b00020", fontSize: 12, marginTop: 8 };
const suggestionsPanel = {
  border: "1px solid #e4e8ef",
  borderRadius: 8,
  padding: "8px 10px",
  marginTop: 10,
  background: "#f8fafc",
};
const suggestionsHeader = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};
const suggestionsSubhead = { color: "#888", fontSize: 11, fontWeight: 500 };
const suggestionsList: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const suggestionRow = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  alignItems: "center",
  gap: 6,
};
const suggestionSeekButton: CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#1d4f91",
  fontSize: 12,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
  padding: 0,
};
const suggestionReason = {
  color: "#666",
  fontSize: 11,
  whiteSpace: "nowrap",
};
const chaptersPanelStyle = {
  ...suggestionsPanel,
  background: "#fbfbf8",
  borderColor: "#e6e2d2",
};
const chaptersList: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const zoomPanelStyle = {
  ...suggestionsPanel,
  background: "#f7fbfb",
  borderColor: "#cfe5e5",
};
const zoomRow = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
};
const chapterButton: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  gap: 8,
  alignItems: "center",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  padding: "3px 0",
};
const chapterTime = {
  color: "#7a6a2f",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};
const chapterLabel = {
  color: "#333",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const modelStatusBase = {
  borderRadius: 8,
  border: "1px solid #ddd",
  padding: "8px 10px",
  marginBottom: 10,
};
const modelStatusReady = { background: "#f1fbf4", borderColor: "#bfe8c9" };
const modelStatusChecking = { background: "#f6f8fb", borderColor: "#d9e2ef" };
const modelStatusMissing = { background: "#fff5f3", borderColor: "#f2c5bd" };
const modelStatusTopLine = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 12,
  fontWeight: 700,
};
const modelStatusText = { color: "#666", fontSize: 12, marginTop: 4, lineHeight: 1.4 };
const missingDetails = { color: "#666", fontSize: 12, marginTop: 6 };
const missingList = { margin: "6px 0 0 18px", padding: 0 };

export default TranscriptPanel;
