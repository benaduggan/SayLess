import React, { useContext, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ContentStateContext } from "../../context/ContentState";

import Title from "./Title";

const VideoPlayer = (props) => {
  const [contentState, setContentState] = useContext(ContentStateContext);

  const playerRef = useRef(null);
  const videoRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [overlayHost, setOverlayHost] = useState(null);
  const contentStateRef = useRef(contentState);
  const bannerRef = useRef(null);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  const getProcessingBannerText = () => {
    const base = chrome.i18n.getMessage("processingBannerEditor");
    const pct = Math.round(contentStateRef.current.processingProgress || 0);
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
      videoRef.current.currentTime = contentState.time;
    }
  }, [contentState.time]);

  useEffect(() => {
    if (contentState.webm || contentState.blob) {
      let vid;
      if (contentState.blob) {
        if (bannerRef.current) {
          bannerRef.current.style.display = "none";
          bannerRef.current.remove();
        }
        vid = contentState.blob;
      } else if (contentState.webm) {
        vid = contentState.webm;
      }
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
    let videoEl = null;
    let safetyId = null;
    let retryId = null;
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
      videoEl = videoRef.current || document.querySelector("#plyr-player");
      const playerEl = playerRef.current || document.querySelector(".plyr");
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

    const callback = function (mutationsList, observer) {
      for (let mutation of mutationsList) {
        if (
          document.querySelector(".plyr--video") &&
          !contentStateRef.current.mp4ready &&
          !contentStateRef.current.blob &&
          !bannerRef.current &&
          !contentStateRef.current.noffmpeg &&
          !(
            contentStateRef.current.duration >
              contentStateRef.current.editLimit &&
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

          document.querySelector(".plyr--video").appendChild(bannerRef.current);
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
          >
            <video
              ref={videoRef}
              id="plyr-player"
              className="sayless-native-player"
              src={url}
              controls
              playsInline
              preload="metadata"
            />
          </div>
        )}
        {(contentState.playerLoading || contentState.finalizingRecording) &&
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
              {contentState.finalizingRecording && (
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
