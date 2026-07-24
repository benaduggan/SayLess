import React, { useContext, useEffect, useMemo, useState, useRef } from "react";
import { useEditorContent } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import { attachTimelinePreview } from "../../../../edl/timelinePreview";
import { computeZoomViewportTransform, zoomTransformToCss } from "../../../../edl/zoomViewport";
import type { Timeline } from "../../../../edl/timeline";
import { cropPreviewLayout, cropRelativePoint } from "../../../../edl/crop";
import { useProjectAudioPreview } from "./useProjectAudioPreview";

interface VideoPlayerProps {
  onSeek?: (time: number, updatePlayerTime: boolean) => void;
}

const VideoPlayer = (_props: VideoPlayerProps) => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext); // null outside EdlProvider
  const tlRef = useRef<Timeline | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  // Probed from the blob's intrinsic dimensions; a fixed "16:9" would
  // pillarbox recordings of square-ish tabs.
  const [videoRatio, setVideoRatio] = useState("16:9");
  const activeZoom = useMemo(() => {
    const time = Number(contentState.time) || 0;
    return (edlCtx?.zoomKeyframes || []).find(
      (keyframe) =>
        time >= Number(keyframe.time) &&
        time < Number(keyframe.time) + Number(keyframe.durationSeconds || 0),
    );
  }, [contentState.time, edlCtx?.zoomKeyframes]);
  const activeZoomStyle = useMemo(() => {
    if (!activeZoom) return undefined;
    const viewportZoom = {
      ...activeZoom,
      ...cropRelativePoint(edlCtx?.crop, activeZoom.xRatio, activeZoom.yRatio),
    };
    return zoomTransformToCss(computeZoomViewportTransform(viewportZoom, 100, 100));
  }, [activeZoom, edlCtx?.crop]);
  const sourceDimensions = useMemo(() => {
    const [width, height] = videoRatio.split(":").map(Number);
    return { width, height };
  }, [videoRatio]);
  const cropLayout = useMemo(
    () => cropPreviewLayout(edlCtx?.crop, sourceDimensions.width, sourceDimensions.height),
    [edlCtx?.crop, sourceDimensions],
  );
  useProjectAudioPreview(videoRef, edlCtx?.audioAsset, edlCtx?.audioTrack, edlCtx?.timeline);

  useEffect(() => {
    if (videoRef.current && contentState.updatePlayerTime) {
      videoRef.current.currentTime = Number(contentState.time) || 0;
    }
  }, [contentState.time]);

  useEffect(() => {
    if (!contentState.blob) return;
    const probeUrl = URL.createObjectURL(contentState.blob);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = probeUrl;
    const onMeta = () => {
      const w = probe.videoWidth;
      const h = probe.videoHeight;
      if (w > 0 && h > 0) setVideoRatio(`${w}:${h}`);
      cleanup();
    };
    const onErr = () => cleanup();
    const cleanup = () => {
      probe.removeEventListener("loadedmetadata", onMeta);
      probe.removeEventListener("error", onErr);
      URL.revokeObjectURL(probeUrl);
    };
    probe.addEventListener("loadedmetadata", onMeta);
    probe.addEventListener("error", onErr);
    return cleanup;
  }, [contentState.blob]);

  useEffect(() => {
    if (contentState.blob) {
      const objectURL = URL.createObjectURL(contentState.blob);
      setUrl(objectURL);

      return () => {
        URL.revokeObjectURL(objectURL);
      };
    }
  }, [contentState.blob]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      setContentState((prevContentState) => ({
        ...prevContentState,
        time: video.currentTime,
        updatePlayerTime: false,
      }));
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [url]);

  // Keep the latest timeline available to the preview controller's per-tick reader.
  useEffect(() => {
    tlRef.current = edlCtx?.timeline || null;
  }, [edlCtx?.timeline]);

  // Non-destructive preview: when the timeline has edits, drive the video
  // element to play clips in output order (skip/reorder) and mute muted clips.
  useEffect(() => {
    if (!url || !edlCtx?.hasEdits) return;
    const video = videoRef.current;
    if (!video) return;
    const adapter = {
      getCurrentTime: () => video.currentTime || 0,
      seek: (time: number) => {
        video.currentTime = time;
      },
      setMuted: (muted: boolean) => {
        video.muted = muted;
      },
      pause: () => video.pause(),
      onTimeUpdate: (callback: () => void) => {
        video.addEventListener("timeupdate", callback);
        return () => video.removeEventListener("timeupdate", callback);
      },
    };
    const handle = attachTimelinePreview(adapter, () => tlRef.current);
    return () => handle.stop();
  }, [url, edlCtx?.hasEdits]);

  return (
    <div className="videoPlayer">
      <div className="playerWrap">
        {url && (
          <div
            className="plyr plyr--video sayless-native-player-shell"
            style={{
              aspectRatio: cropLayout?.aspectRatio || videoRatio.replace(":", " / "),
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...activeZoomStyle }}>
              <video
                ref={videoRef}
                id="plyr-player"
                className="sayless-native-player"
                src={url}
                controls
                playsInline
                preload="metadata"
                style={
                  cropLayout
                    ? {
                        position: "absolute",
                        maxWidth: "none",
                        left: `${cropLayout.leftPercent}%`,
                        top: `${cropLayout.topPercent}%`,
                        width: `${cropLayout.widthPercent}%`,
                        height: `${cropLayout.heightPercent}%`,
                      }
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>
      <style>
        {`
          .sayless-native-player-shell {
            overflow: hidden;
          }
          .sayless-native-player {
            transition: transform 160ms ease;
          }
        `}
      </style>
    </div>
  );
};

export default VideoPlayer;
