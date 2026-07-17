// Main editor timeline. Redesigned from the old single-range trim/cut/mute UI
// into a clip TIMELINE: split at the playhead, drag clips to reorder, select a
// clip to delete or mute it, then Apply edits to bake. (Word-level delete/mute
// lives in the Transcript drawer; both edit the same timeline.)

import React, { useContext } from "react";
import styles from "../../styles/edit/_TrimUI.module.scss";
import TimelineStrip from "../../components/editor/TimelineStrip";
import { ContentStateContext } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";

const toTimeStamp = (time) => {
  const m = Math.floor(time / 60);
  const s = Math.floor(time - m * 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

const TrimUI = () => {
  const [contentState] = useContext(ContentStateContext);
  const edlCtx = useContext(EdlContext);
  if (!edlCtx) return null;

  const { hasEdits, exporting, exportProgress, applyEdits, resetTimeline, resolved } = edlCtx;
  const outDur = resolved?.outputDuration || 0;

  return (
    <div className={`${styles.trimWrap} trimWrap`} style={{ padding: "0 24px 20px", boxSizing: "border-box" }}>
      <div style={header}>
        <span style={{ fontWeight: 600 }}>Timeline</span>
        <span style={{ color: "#888", fontSize: 12 }}>
          {resolved.segments.length} clip{resolved.segments.length === 1 ? "" : "s"} · {toTimeStamp(outDur)}
        </span>
        <span style={{ flex: 1 }} />
        {hasEdits && (
          <>
            <button className="button simpleButton" onClick={resetTimeline} disabled={exporting}>
              Reset
            </button>
            <button className="button secondaryButton" onClick={applyEdits} disabled={exporting}>
              {exporting ? `Applying ${Math.round((exportProgress || 0) * 100)}%` : "Apply edits"}
            </button>
          </>
        )}
      </div>

      <TimelineStrip />
    </div>
  );
};

const header = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };

export default TrimUI;
