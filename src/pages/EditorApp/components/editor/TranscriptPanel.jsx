// Transcript + timeline editing drawer. Shows the clip TimelineStrip and the
// transcript as a DERIVED view grouped by clip in output order (deletes drop
// words, reorder moves them, mutes flag them — all automatically from the
// timeline). Select a word span to delete/mute it (which splits + edits the
// timeline). "Apply edits" bakes the timeline into the editor blob for download.

import React, { useContext, useMemo, useState } from "react";
import { ContentStateContext } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";

const TranscriptPanel = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const edlCtx = useContext(EdlContext);
  const [sel, setSel] = useState(null); // { from, to } original word indices
  const [open, setOpen] = useState(false); // start closed; opens via the launcher

  if (!edlCtx) return null;
  const {
    transcript,
    clipView,
    transcribing,
    transcribeProgress,
    runTranscription,
    editWords,
    resetTimeline,
    applyEdits,
    exporting,
    exportProgress,
    hasEdits,
    error,
  } = edlCtx;

  const seekSource = (sec) =>
    setContentState((prev) => ({ ...prev, time: sec, updatePlayerTime: true }));

  const onWordClick = (e, w) => {
    if (e.shiftKey && sel) {
      setSel({ from: Math.min(sel.from, w.index), to: Math.max(sel.to, w.index) });
    } else {
      setSel({ from: w.index, to: w.index });
      seekSource(w.start);
    }
  };

  const applyToSelection = (kind) => {
    if (!sel) return;
    editWords(sel.from, sel.to, kind);
    setSel(null);
  };

  const curSource = contentState.time || 0;

  const body = !transcript ? (
    <div>
      {transcribing ? (
        <div>
          Transcribing… {Math.round((transcribeProgress || 0) * 100)}%
          <div style={barOuter}>
            <div style={{ ...barInner, width: `${Math.round((transcribeProgress || 0) * 100)}%` }} />
          </div>
          <div style={hintText}>First run downloads the speech model — this can take a minute.</div>
        </div>
      ) : (
        <>
          <button style={btnPrimary} onClick={runTranscription}>Generate transcript</button>
          <div style={hintText}>
            Transcribe on-device, then delete &amp; mute words here, or split / reorder clips on the timeline below.
          </div>
        </>
      )}
      {error && <div style={errStyle}>{error}</div>}
    </div>
  ) : (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button style={sel ? btnDanger : btnDisabled} disabled={!sel} onClick={() => applyToSelection("delete")}>
          Delete words
        </button>
        <button style={sel ? btn : btnDisabled} disabled={!sel} onClick={() => applyToSelection("mute")}>
          Mute words
        </button>
        <span style={{ flex: 1 }} />
        {hasEdits && (
          <>
            <button style={btn} onClick={resetTimeline} disabled={exporting}>Reset</button>
            <button style={btnPrimary} onClick={applyEdits} disabled={exporting}>
              {exporting ? `Applying ${Math.round((exportProgress || 0) * 100)}%` : "Apply edits"}
            </button>
          </>
        )}
      </div>
      <div style={hintText}>click a word to seek · shift-click to extend selection</div>

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

  if (!open) {
    return (
      <button style={launcherStyle} onClick={() => setOpen(true)}>📝 Transcript</button>
    );
  }

  return (
    <div style={drawerStyle}>
      <div style={drawerHeaderStyle}>
        <span style={{ fontWeight: 700 }}>Transcript &amp; Timeline</span>
        <span style={{ flex: 1 }} />
        <button style={closeBtn} onClick={() => setOpen(false)} title="Hide">✕</button>
      </div>
      <div style={drawerBodyStyle}>{body}</div>
    </div>
  );
};

const Z = 2147483000;
const drawerStyle = {
  position: "fixed", top: 88, right: 0, height: "calc(100vh - 88px)", width: 400,
  maxWidth: "92vw", background: "#fff", borderLeft: "1px solid #eee",
  boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", zIndex: Z, display: "flex",
  flexDirection: "column", fontSize: 14, lineHeight: 1.7, pointerEvents: "auto",
};
const drawerHeaderStyle = { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid #eee" };
const drawerBodyStyle = { padding: 16, overflow: "auto", flex: 1 };
const launcherStyle = {
  position: "fixed", bottom: 20, right: 20, zIndex: Z, padding: "10px 16px",
  borderRadius: 999, border: "none", background: "#4597F7", color: "#fff",
  cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)", pointerEvents: "auto",
};
const closeBtn = { border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "#666", lineHeight: 1 };
const wordsWrap = { whiteSpace: "pre-wrap" };
const clipBlock = { border: "1px solid #eee", borderRadius: 8, padding: "8px 10px", marginBottom: 8 };
const clipBlockMuted = { background: "#fffaf0", borderColor: "#f0e0b0" };
const clipBadge = { fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 600 };
const wordStyle = { cursor: "pointer", borderRadius: 4, padding: "0 1px" };
const mutedStyle = { color: "#a98800" };
const selectedStyle = { background: "#cfe3ff" };
const currentStyle = { boxShadow: "inset 0 -2px 0 #4597F7" };
const btn = { padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" };
const btnDisabled = { ...btn, color: "#bbb", cursor: "default" };
const btnPrimary = { ...btn, background: "#4597F7", color: "#fff", border: "none" };
const btnDanger = { ...btn, background: "#ffe2e2", color: "#b00020", border: "1px solid #f3c2c2" };
const barOuter = { height: 6, background: "#eee", borderRadius: 4, marginTop: 6 };
const barInner = { height: 6, background: "#4597F7", borderRadius: 4 };
const hintText = { color: "#888", fontSize: 12, marginTop: 8 };
const errStyle = { color: "#b00020", fontSize: 12, marginTop: 8 };

export default TranscriptPanel;
