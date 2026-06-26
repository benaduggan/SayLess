// Visual clip timeline with a playhead + scrubbing.
//  - Scrub ruler (top): click or drag to move the playhead anywhere on the output.
//  - Clip blocks: width ∝ duration; click anywhere on a clip to seek to that exact
//    point; drag a clip to reorder; select to mute/delete; ✂ splits at the playhead.
// The red playhead line reflects the current output position and moves during play.

import React, { useContext, useRef } from "react";
import { ContentStateContext } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import { outputToSource, sourceToOutput } from "../../../../edl/timeline";

const fmt = (s) => `${s.toFixed(1)}s`;

const TimelineStrip = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);
  const edlCtx = useContext(EdlContext);
  const trackRef = useRef(null);
  const scrubbing = useRef(false);

  if (!edlCtx || !edlCtx.timeline) return null;
  const {
    timeline,
    resolved,
    selectedClipId,
    setSelectedClipId,
    deleteClip,
    moveClip,
    toggleMuteClip,
    splitAtSourceTime,
  } = edlCtx;
  const segs = resolved.segments;
  const outDur = resolved.outputDuration;
  if (!segs.length || outDur <= 0) return null;

  const selIndex = segs.findIndex((s) => s.clipId === selectedClipId);
  const seekSource = (t) => setContentState((prev) => ({ ...prev, time: t, updatePlayerTime: true }));

  // current playhead as a % of the output timeline
  const playheadOut = sourceToOutput(timeline, contentState.time || 0);
  const playheadPct = playheadOut == null ? null : Math.max(0, Math.min(100, (playheadOut / outDur) * 100));

  // map an x within the track to an output time, then seek the source
  const seekAtClientX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const hit = outputToSource(timeline, frac * outDur);
    if (hit) seekSource(hit.sourceTime);
  };

  const onRulerDown = (e) => {
    scrubbing.current = true;
    seekAtClientX(e.clientX);
    const move = (ev) => scrubbing.current && seekAtClientX(ev.clientX);
    const up = () => {
      scrubbing.current = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  // click within a clip -> seek to that exact position (and select)
  const onClipClick = (e, seg) => {
    setSelectedClipId(seg.clipId);
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekSource(seg.sourceStart + frac * (seg.sourceEnd - seg.sourceStart));
  };

  const onDragStart = (e, i) => e.dataTransfer.setData("text/plain", String(i));
  const onDrop = (e, i) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!Number.isNaN(from) && from !== i) moveClip(from, i);
  };

  return (
    <div style={wrap}>
      <div style={toolbar}>
        <button style={btn} onClick={() => splitAtSourceTime(contentState.time || 0)} title="Split the clip at the playhead">
          ✂ Split at playhead
        </button>
        {selIndex >= 0 && (
          <>
            <button style={btn} disabled={selIndex <= 0} onClick={() => moveClip(selIndex, selIndex - 1)} title="Move left">◀</button>
            <button style={btn} disabled={selIndex >= segs.length - 1} onClick={() => moveClip(selIndex, selIndex + 1)} title="Move right">▶</button>
            <button style={btn} onClick={() => toggleMuteClip(selectedClipId)}>{segs[selIndex].muted ? "Unmute" : "Mute"}</button>
            <button style={btnDanger} onClick={() => deleteClip(selectedClipId)}>Delete clip</button>
          </>
        )}
      </div>

      <div ref={trackRef} style={track}>
        {/* scrub ruler */}
        <div style={ruler} onMouseDown={onRulerDown} title="Click or drag to scrub" />
        {/* clip blocks */}
        <div style={strip}>
          {segs.map((seg, i) => {
            const len = seg.sourceEnd - seg.sourceStart;
            const selected = seg.clipId === selectedClipId;
            return (
              <div
                key={seg.clipId}
                draggable
                onDragStart={(e) => onDragStart(e, i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, i)}
                onClick={(e) => onClipClick(e, seg)}
                style={{
                  ...clip,
                  width: `${(len / outDur) * 100}%`,
                  ...(selected ? clipSelected : {}),
                  ...(seg.muted ? clipMuted : {}),
                }}
                title={`clip ${i + 1}: source ${fmt(seg.sourceStart)}–${fmt(seg.sourceEnd)}`}
              >
                <span style={clipLabel}>{i + 1}</span>
                <span style={clipDur}>{fmt(len)}{seg.muted ? " 🔇" : ""}</span>
              </div>
            );
          })}
        </div>
        {/* playhead */}
        {playheadPct != null && <div style={{ ...playhead, left: `${playheadPct}%` }} />}
      </div>
      <div style={hint}>click a clip to seek there · drag the ruler to scrub · drag clips to reorder</div>
    </div>
  );
};

const wrap = { marginBottom: 8 };
const toolbar = { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 };
const track = { position: "relative", borderRadius: 8, overflow: "hidden", background: "#f4f6f8" };
const ruler = { height: 16, background: "#e7ebf0", cursor: "pointer", borderBottom: "1px solid #dde3ea" };
const strip = { display: "flex", alignItems: "stretch", height: 52 };
const clip = {
  boxSizing: "border-box",
  minWidth: 28,
  background: "#cfe0ff",
  borderRight: "2px solid #f4f6f8",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: "4px 6px",
  overflow: "hidden",
  userSelect: "none",
};
const clipSelected = { background: "#bcd4ff", boxShadow: "inset 0 0 0 2px #4597F7" };
const clipMuted = { background: "#fff1c2" };
const clipLabel = { fontSize: 11, fontWeight: 700, color: "#234" };
const clipDur = { fontSize: 10, color: "#456", whiteSpace: "nowrap" };
const playhead = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: 2,
  background: "#ff3b30",
  pointerEvents: "none",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.6)",
};
const btn = { padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 12 };
const btnDanger = { ...btn, background: "#ffe2e2", color: "#b00020", border: "1px solid #f3c2c2" };
const hint = { color: "#888", fontSize: 11, marginTop: 4 };

export default TimelineStrip;
