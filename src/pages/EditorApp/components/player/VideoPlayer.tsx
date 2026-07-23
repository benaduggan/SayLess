import { useContext, useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useEditorContent } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import { cropPreviewLayout, cropRelativePoint } from "../../../../edl/crop";
import {
  computeZoomViewportTransform,
  zoomTransformToCss,
} from "../../../../edl/zoomViewport";
import { useProjectAudioPreview } from "../editor/useProjectAudioPreview";

import Title from "./Title";

const VideoPlayer = () => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext);

  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const contentStateRef = useRef(contentState);
  const bannerRef = useRef<HTMLDivElement | null>(null);
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
      ...cropRelativePoint(
        edlCtx?.crop,
        activeZoom.xRatio,
        activeZoom.yRatio,
      ),
    };
    return zoomTransformToCss(
      computeZoomViewportTransform(viewportZoom, 100, 100),
    );
  }, [activeZoom, edlCtx?.crop]);
  const cropLayout = useMemo(
    () => cropPreviewLayout(
      edlCtx?.crop,
      contentState.prevWidth || contentState.width,
      contentState.prevHeight || contentState.height,
    ),
    [contentState.height, contentState.prevHeight, contentState.prevWidth, contentState.width, edlCtx?.crop],
  );
  useProjectAudioPreview(
    videoRef,
    edlCtx?.audioAsset,
    edlCtx?.audioTrack,
    edlCtx?.timeline,
  );

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  const getProcessingBannerText = () => {
    const base = chrome.i18n.getMessage("processingBannerEditor");
    const pct = Math.round(Number(contentStateRef.current.processingProgress) || 0);
    if (pct > 0 && pct < 100) {
      return `${base} (${pct}%)`;
    }
    return base;
  };

  useEffect(() => {
    if (
      videoRef.current &&
      contentState.updatePlayerTime
    ) {
      videoRef.current.currentTime = Number(contentState.time) || 0;
    }
  }, [contentState.time]);

  useEffect(() => {
    if (contentState.webm || contentState.blob) {
      let vid: Blob | null = null;
      if (contentState.blob instanceof Blob) {
        if (bannerRef.current) {
          bannerRef.current.style.display = "none";
          bannerRef.current.remove();
        }
        vid = contentState.blob;
      } else if (contentState.webm instanceof Blob) {
        vid = contentState.webm;
      }
      if (!vid) return;
      const objectURL = URL.createObjectURL(vid);
      // Long recordings can take seconds to parse metadata.
      setContentState((prev) => ({ ...prev, playerLoading: true }));
      setUrl(objectURL);

      return () => {
        URL.revokeObjectURL(objectURL);
      };
    }
  }, [contentState.webm, contentState.blob]);

  // Long or corrupt local files can delay or skip media events. Keep a safety
  // timeout so the editor does not remain covered by a loading overlay.
  useEffect(() => {
    if (!url) return;
    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      setContentState((prev) =>
        prev.playerLoading ? { ...prev, playerLoading: false } : prev,
      );
    };
    let videoEl: HTMLVideoElement | null = null;
    let safetyId: ReturnType<typeof setTimeout> | null = null;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    let errorSurfaced = false;
    // Corrupt/zero-byte/header-only OPFS file (recorder died before chunks
    // landed, or quota hit past moov) fires MediaError. Without this,
    // playerLoading only clears via the 15s safety timeout, leaving a black
    // <video>. Surface a toast and clear loading immediately.
    const onVideoError = () => {
      if (errorSurfaced) return;
      errorSurfaced = true;
      try {
        chrome.runtime.sendMessage({
          type: "show-toast",
          message: chrome.i18n.getMessage("recordingCorruptToast"),
          timeout: 8000,
        });
      } catch {}
      try {
        chrome.runtime.sendMessage({
          type: "diag-forward",
          event: "editor-video-decode-error",
          data: {
            mediaError: videoEl?.error?.code ?? null,
            mediaErrorMessage:
              String(videoEl?.error?.message || "").slice(0, 120) || null,
            blobSize: contentStateRef.current?.blob?.size ?? null,
          },
        });
      } catch {}
      clear();
    };
    const tryAttach = () => {
      videoEl =
        videoRef.current || document.querySelector<HTMLVideoElement>("#plyr-player");
      const playerEl =
        playerRef.current || document.querySelector<HTMLElement>(".plyr");
      if (playerEl) setOverlayHost(playerEl);
      if (!videoEl) return false;
      videoEl.addEventListener("loadedmetadata", clear);
      videoEl.addEventListener("canplay", clear);
      videoEl.addEventListener("error", onVideoError);
      if (videoEl.readyState >= 1) clear();
      // Error may have already fired pre-attach.
      if (videoEl.error) onVideoError();
      return true;
    };
    if (!tryAttach()) {
      retryId = setTimeout(tryAttach, 50);
    }
    safetyId = setTimeout(clear, 15000);
    return () => {
      if (retryId) clearTimeout(retryId);
      if (safetyId) clearTimeout(safetyId);
      if (videoEl) {
        videoEl.removeEventListener("loadedmetadata", clear);
        videoEl.removeEventListener("canplay", clear);
        videoEl.removeEventListener("error", onVideoError);
      }
      setOverlayHost(null);
    };
  }, [url]);

  useEffect(() => {
    if (contentStateRef.current.mp4ready || contentStateRef.current.blob)
      return;
    const config = { attributes: true, childList: true, subtree: true };

    const callback = function (mutationsList: MutationRecord[]) {
      for (let mutation of mutationsList) {
        if (
          document.querySelector(".plyr--video") &&
          !contentStateRef.current.mp4ready &&
          !contentStateRef.current.blob &&
          !bannerRef.current &&
          !contentStateRef.current.noffmpeg &&
          !(
            Number(contentStateRef.current.duration) >
              Number(contentStateRef.current.editLimit) &&
            !contentStateRef.current.override
          )
        ) {
          bannerRef.current = document.createElement("div");
          bannerRef.current.classList.add("videoBanner");
          bannerRef.current.innerHTML =
            "<img src='" +
            chrome.runtime.getURL("assets/editor/icons/alert-white.svg") +
            "'/> <span>" +
            getProcessingBannerText() +
            "</span>";

          document.querySelector(".plyr--video")?.appendChild(bannerRef.current);
        }
      }
    };

    const observer = new MutationObserver(callback);
    observer.observe(document.body, config);

    return () => {
      observer.disconnect();

      if (bannerRef.current) {
        bannerRef.current.style.display = "none";
        bannerRef.current.remove();
        bannerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!bannerRef.current) return;
    bannerRef.current.innerHTML =
      "<img src='" +
      chrome.runtime.getURL("assets/editor/icons/alert-white.svg") +
      "'/> <span>" +
      getProcessingBannerText() +
      "</span>";
  }, [contentState.processingProgress]);

  return (
    <div className="videoPlayer">
      <div className="playerWrap">
        {url && (
          <div
            ref={playerRef}
            className="plyr plyr--video sayless-native-player-shell"
            style={{
              aspectRatio: cropLayout?.aspectRatio,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{ position: "absolute", inset: 0, overflow: "hidden", ...activeZoomStyle }}
            >
              <video
                ref={videoRef}
                id="plyr-player"
                className="sayless-native-player"
                src={url}
                controls
                playsInline
                preload="metadata"
                style={cropLayout ? {
                  position: "absolute",
                  maxWidth: "none",
                  left: `${cropLayout.leftPercent}%`,
                  top: `${cropLayout.topPercent}%`,
                  width: `${cropLayout.widthPercent}%`,
                  height: `${cropLayout.heightPercent}%`,
                } : undefined}
              />
            </div>
          </div>
        )}
        {Boolean(contentState.playerLoading || contentState.finalizingRecording) &&
          overlayHost &&
          createPortal(
            <div
              className="sayless-player-loading"
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 5,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  border: "3px solid rgba(255,255,255,0.2)",
                  borderTopColor: "#fff",
                  borderRadius: "50%",
                  animation: "sayless-spin 0.9s linear infinite",
                }}
              />
              {Boolean(contentState.finalizingRecording) && (
                <div
                  style={{
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 500,
                    opacity: 0.9,
                  }}
                >
                  {chrome.i18n.getMessage("sandboxFinalizingRecording")}
                </div>
              )}
            </div>,
            overlayHost
          )}
        {contentState.mode === "player" && <Title />}
      </div>
      <style>
        {`
					@media (max-width: 900px) {
						.videoPlayer {
							position: relative!important;
						}
					}
						@keyframes sayless-spin {
						to { transform: rotate(360deg); }
					}
					`}
      </style>
    </div>
  );
};

export default VideoPlayer;
