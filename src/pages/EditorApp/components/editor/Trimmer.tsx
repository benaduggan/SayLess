import { useRef, useEffect, useContext } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import styles from "../../styles/edit/_Trimmer.module.css";
import WaveformGenerator from "./Waveform";

import { useEditorContent } from "../../context/ContentState";

const Trimmer = () => {
  const [contentState, setContentState] = useEditorContent();

  const trimmerRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const activeHandle = useRef<"start" | "end" | null>(null);
  // Refs so doc-level mousemove/mouseup don't re-bind per render and leak
  // listeners with stale bounds.
  const setContentStateRef = useRef(setContentState);
  const addToHistoryRef = useRef<(() => void) | null>(null);
  const startBoundRef = useRef(0);
  const endBoundRef = useRef(1);

  useEffect(() => {
    setContentStateRef.current = setContentState;
    addToHistoryRef.current = contentState.addToHistory;
    startBoundRef.current = Number(contentState.start) || 0;
    endBoundRef.current = Number(contentState.end) || 1;
  });

  const handleMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<(() => void) | null>(null);

  if (!handleMouseMoveRef.current) {
    handleMouseMoveRef.current = (e) => {
      if (!isDragging.current) return;
      const trimmerRect = trimmerRef.current?.getBoundingClientRect();
      if (!trimmerRect) return;
      const trimmerWidth = trimmerRect.width;
      const mouseX = e.clientX - trimmerRect.left;
      const newPosition = mouseX / trimmerWidth;

      if (activeHandle.current === "start") {
        const validPosition = Math.max(Math.min(newPosition, endBoundRef.current - 0.02), 0);
        setContentStateRef.current((prev) => ({
          ...prev,
          start: Math.min(validPosition, (Number(prev.end) || 1) - 0.02),
        }));
      } else if (activeHandle.current === "end") {
        const validPosition = Math.min(Math.max(newPosition, startBoundRef.current + 0.02), 1);
        setContentStateRef.current((prev) => ({
          ...prev,
          end: Math.max(validPosition, (Number(prev.start) || 0) + 0.02),
        }));
      }
    };
  }
  if (!handleMouseUpRef.current) {
    handleMouseUpRef.current = () => {
      isDragging.current = false;
      activeHandle.current = null;
      try {
        addToHistoryRef.current?.();
      } catch {}
      setContentStateRef.current((prev) => ({
        ...prev,
        dragInteracted: true,
      }));
      if (handleMouseMoveRef.current) {
        document.removeEventListener("mousemove", handleMouseMoveRef.current);
      }
      if (handleMouseUpRef.current) {
        document.removeEventListener("mouseup", handleMouseUpRef.current);
      }
    };
  }

  // Cleanup if component unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (handleMouseMoveRef.current) {
        document.removeEventListener("mousemove", handleMouseMoveRef.current);
      }
      if (handleMouseUpRef.current) {
        document.removeEventListener("mouseup", handleMouseUpRef.current);
      }
    };
  }, []);

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>, handle: "start" | "end") => {
    e.preventDefault();
    isDragging.current = true;
    activeHandle.current = handle;
    if (handleMouseMoveRef.current) {
      document.addEventListener("mousemove", handleMouseMoveRef.current);
    }
    if (handleMouseUpRef.current) {
      document.addEventListener("mouseup", handleMouseUpRef.current);
    }
  };

  useEffect(() => {
    if (startHandleRef.current) {
      startHandleRef.current.style.left = `calc(${(contentState.start || 0) * 100}%)`;
    }
    if (endHandleRef.current) {
      endHandleRef.current.style.left = `${(contentState.end || 1) * 100}%`;
    }
  }, [contentState.start, contentState.end]);

  return (
    <div>
      <div className={styles.trimmerContainer} ref={trimmerRef}>
        <div className={styles.trimWrap}>
          <div
            className={styles.leftOverlay}
            style={{ width: `${(contentState.start || 0) * 100}%` }}
          />
          <div
            className={styles.rightOverlay}
            style={{ width: `${(1 - (contentState.end || 1)) * 100}%` }}
          />
          <div
            className={styles.trimSection}
            style={{
              width: `${((contentState.end || 1) - (contentState.start || 0)) * 100}%`,
              left: `${(contentState.start || 0) * 100}%`,
            }}
          />
          <div className={styles.trimmer}>
            <div
              className={`${styles.handle} ${styles.startHandle}`}
              onMouseDown={(e) => handleMouseDown(e, "start")}
              ref={startHandleRef}
            />
            <div
              className={`${styles.handle} ${styles.endHandle}`}
              onMouseDown={(e) => handleMouseDown(e, "end")}
              ref={endHandleRef}
            />
          </div>
        </div>
        <WaveformGenerator />
      </div>
    </div>
  );
};

export default Trimmer;
