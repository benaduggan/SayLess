import { useContext, useRef, useEffect, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import styles from "../../styles/edit/_Waveform.module.scss";
import { useEditorContent } from "../../context/ContentState";

const WaveformGenerator = () => {
  const [contentState, setContentState] = useEditorContent();
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const customCursorRef = useRef<HTMLDivElement>(null);
  const ghostCursorRef = useRef<HTMLDivElement>(null);
  const [showGhost, setShowGhost] = useState(false);
  const mouseDown = useRef(false);

  const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> =>
    blob.arrayBuffer();

  const loadWaveform = async (blob: Blob) => {
    const container = waveformContainerRef.current;
    if (!container) return;
    try {
      wavesurferRef.current = WaveSurfer.create({
        container,
        waveColor: "#C4C5CE",
        progressColor: "#9596A2",
        height: "auto",
        cursorWidth: 0,
      });
      const audioArrayBuffer = await blobToArrayBuffer(blob);

      await wavesurferRef.current.loadBlob(
        new Blob([audioArrayBuffer], { type: "audio/wav" })
      );

      wavesurferRef.current.on("seeking", (currentTime) => {
        const containerRect =
          container.getBoundingClientRect();
        const cursorX =
          containerRect.width *
          (currentTime / (wavesurferRef.current?.getDuration() || 1));
        if (customCursorRef.current) {
          customCursorRef.current.style.left = `${cursorX}px`;
        }
        setContentState((prevContentState) => ({
          ...prevContentState,
          time: currentTime,
          updatePlayerTime: true,
        }));
      });
    } catch (error) {
      console.error("Error loading waveform:", error);
    }
  };

  const handleMouseEnter = () => {
    if (mouseDown.current) return;
    setShowGhost(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const containerRect = waveformContainerRef.current?.getBoundingClientRect();
    if (!containerRect || !ghostCursorRef.current) return;
    const cursorX = e.clientX - containerRect.left;
    const minX = 0;
    const maxX = containerRect.width;
    const cursorStyle = ghostCursorRef.current.style;
    cursorStyle.left = `${cursorX}px`;
  };

  const handleMouseLeave = () => {
    setShowGhost(false);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.target instanceof Node && waveformContainerRef.current?.contains(e.target)) return;
    mouseDown.current = true;
    setShowGhost(false);
  };

  const handleMouseUp = () => {
    mouseDown.current = false;
  };

  useEffect(() => {
    if (!(contentState.blob instanceof Blob)) return;
    loadWaveform(contentState.blob);
    const container = waveformContainerRef.current;
    if (!container) return;
    container.addEventListener("mouseover", handleMouseEnter);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      // WaveSurfer 7 leaves old canvas behind on destroy.
      if (container) {
        container.innerHTML = "";
      }
      container.removeEventListener("mouseover", handleMouseEnter);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [contentState.blob]);

  useEffect(() => {
    if (!contentState.blob) return;
    if (contentState.updatePlayerTime) return;
    if (waveformContainerRef.current === null) return;

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = async () => {
      const containerRect = waveformContainerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      const cursorX =
        containerRect.width * ((Number(contentState.time) || 0) / video.duration);
      if (customCursorRef.current) customCursorRef.current.style.left = `${cursorX}px`;

      URL.revokeObjectURL(video.src);
      video.remove();
    };
    if (contentState.blob instanceof Blob) {
      video.src = URL.createObjectURL(contentState.blob);
    }
  }, [contentState.time, contentState.blob, waveformContainerRef.current]);

  return (
    <div style={{ height: "100%" }}>
      <div className={styles.cursor} ref={customCursorRef}></div>
      <div
        className={styles.ghostCursor}
        style={showGhost ? { opacity: 1 } : { opacity: 0 }}
        ref={ghostCursorRef}
      ></div>
      <div className={styles.waveform} ref={waveformContainerRef}></div>
    </div>
  );
};

export default WaveformGenerator;
