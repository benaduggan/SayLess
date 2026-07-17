import React, { useContext, useEffect, useMemo, useState, useRef } from "react";
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context
import { EdlContext } from "../../context/EdlContext";
import { attachTimelinePreview } from "../../../../edl/timelinePreview";
import {
  computeZoomViewportTransform,
  zoomTransformToCss,
} from "../../../../edl/zoomViewport";

const VideoPlayer = (props) => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context
  const edlCtx = useContext(EdlContext); // null outside EdlProvider
  const tlRef = useRef(null);
  const videoRef = useRef(null);
  const [url, setUrl] = useState(null);
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
    return zoomTransformToCss(computeZoomViewportTransform(activeZoom, 100, 100));
  }, [activeZoom]);

  useEffect(() => {
    if (
      videoRef.current &&
      contentState.updatePlayerTime
    ) {
      videoRef.current.currentTime = contentState.time;
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
      seek: (t) => {
        video.currentTime = t;
      },
      setMuted: (m) => {
        video.muted = m;
      },
      pause: () => video.pause(),
      onTimeUpdate: (cb) => {
        video.addEventListener("timeupdate", cb);
        return () => video.removeEventListener("timeupdate", cb);
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
            style={{ aspectRatio: videoRatio.replace(":", " / ") }}
          >
            <video
              ref={videoRef}
              id="plyr-player"
              className="sayless-native-player"
              src={url}
              controls
              playsInline
              preload="metadata"
              style={activeZoomStyle}
            />
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
