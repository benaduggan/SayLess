import {
  registerMessage,
  messageRouter,
} from "../../../messaging/messageRouter";
import { getContextRefs } from "../context/CameraContext";
import type { MutableRefObject } from "react";
import {
  getCameraStream,
  stopCameraStream,
  togglePip,
  surfaceHandler,
  cameraToggledToolbar,
} from "../utils/cameraUtils";
import { loadEffect } from "../utils/backgroundUtils";
import {
  setWidth,
  setHeight,
  setPipMode,
  setBackgroundEffects,
} from "../utils/uiState";

function waitForVideoRef(
  callback: (video: HTMLVideoElement) => void,
  attempts = 10,
): void {
  const { videoRef } = getContextRefs();

  if (videoRef?.current) {
    callback(videoRef.current);
  } else if (attempts > 0) {
    setTimeout(() => waitForVideoRef(callback, attempts - 1), 100);
  }
}

export const setupHandlers = ({
  setLoading,
}: {
  setLoading: (
    key: "recordingType" | "backgroundEffects" | "videoElement" | "modelLoading",
    active: boolean,
  ) => void;
}): void => {
  registerMessage("toggle-blur", handleToggleBlur);
  registerMessage("load-custom-effect", handleLoadCustomEffect);
  registerMessage("set-background-effect", handleSetBackgroundEffect);
  registerMessage("stop-recording", handleStopRecording);
  registerMessage("dismiss-recording", handleStopRecording);

  let cameraSwitchTimeout: ReturnType<typeof setTimeout> | undefined;
  registerMessage("switch-camera", (message) => {
    const cameraId = typeof message.id === "string" ? message.id : "none";
    if (cameraId !== "none") {
      clearTimeout(cameraSwitchTimeout);
      // stopCameraStream requires (streamRef, videoRef); a no-arg call
      // warns and returns, leaking the prior MediaStream.
      const refs = getContextRefs();
      stopCameraStream(refs.streamRef, refs.videoRef);

      cameraSwitchTimeout = setTimeout(() => {
        const {
          videoRef,
          streamRef,
          offScreenCanvasRef,
          offScreenCanvasContextRef,
        } = getContextRefs();

        getCameraStream(
          { video: { deviceId: { exact: cameraId } } },
          streamRef,
          videoRef,
          offScreenCanvasRef,
          offScreenCanvasContextRef,
          {
            onStart: () => setLoading("videoElement", true),
            onFinish: () => setLoading("videoElement", false),
          },
        );
      }, 500);
    }
  });

  registerMessage("background-effects-active", () =>
    setBackgroundEffects(true),
  );
  registerMessage("background-effects-inactive", () =>
    setBackgroundEffects(false),
  );
  registerMessage("camera-only-update", handleCameraOnlyUpdate);
  registerMessage("screen-update", handleScreenUpdate);
  registerMessage("toggle-pip", () => togglePip(getContextRefs().videoRef));
  registerMessage("set-surface", (message) => {
    console.log("Preparing Picture in Picture request");

    // Try synchronously first to preserve user gesture context for PiP.
    // If videoRef isn't ready yet, fall back to polling (PiP may fail
    // without gesture, but surfaceHandler handles that gracefully).
    const { videoRef } = getContextRefs();
    if (videoRef?.current) {
      surfaceHandler(message, videoRef);
    } else {
      waitForVideoRef((videoEl: HTMLVideoElement) => {
        surfaceHandler(message, { current: videoEl });
      });
    }
  });
  registerMessage("camera-toggled-toolbar", cameraToggledToolbar);
  registerMessage("turn-off-pip", () => {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch((error) => {
        console.error("Failed to exit Picture in Picture:", error);
      });
    }
    setPipMode(false);
    chrome.runtime.sendMessage({ type: "pip-ended" });
  });

  messageRouter();

  // Fallback when a runtime message is missed: close PiP on storage flag flip.
  chrome.storage.local.get(["pipForceClose"], (res) => {
    if (res.pipForceClose && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      setPipMode(false);
      chrome.runtime.sendMessage({ type: "pip-ended" });
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.pipForceClose) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      setPipMode(false);
      chrome.runtime.sendMessage({ type: "pip-ended" });
    }
  });
};

const handleStopRecording = async (): Promise<void> => {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    setPipMode(false);
    chrome.runtime.sendMessage({ type: "pip-ended" });
  }
  // Stop tracks so the webcam light goes off; otherwise the iframe holds
  // the stream until the page is torn down (may be much later or never if
  // the user navigates away from the recorded tab).
  try {
    const { streamRef, videoRef } = getContextRefs();
    stopCameraStream(streamRef, videoRef);
  } catch (err) {
    console.warn("Failed to stop camera stream on recording end:", err);
  }
};

const safelyApplyFilter = (
  contextRef: MutableRefObject<CanvasRenderingContext2D | null>,
  filter: string,
): void => {
  if (contextRef.current) {
    try {
      contextRef.current.filter = filter;
    } catch (error) {
      console.warn(
        "⚠️ Failed to apply filter:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
};

const handleSetBackgroundEffect = async (
  message: Record<string, unknown>,
): Promise<void> => {
  const { blurRef, effectRef, offScreenCanvasContextRef } = getContextRefs();
  const effect = typeof message.effect === "string" ? message.effect : "";

  await chrome.storage.local.set({ backgroundEffect: effect });

  if (effect === "blur") {
    blurRef.current = true;
    effectRef.current = null;
    safelyApplyFilter(offScreenCanvasContextRef, "blur(5px)");
  } else if (effect) {
    blurRef.current = false;

    try {
      const effectImage = await loadEffect(effect);
      effectRef.current = effectImage;
      safelyApplyFilter(offScreenCanvasContextRef, "none");
    } catch (err) {
      console.error("Failed to load effect:", err);
    }
  } else {
    blurRef.current = false;
    effectRef.current = null;
    safelyApplyFilter(offScreenCanvasContextRef, "none");
  }
};

const handleToggleBlur = async (
  message: Record<string, unknown>,
): Promise<void> => {
  const { blurRef, offScreenCanvasContextRef } = getContextRefs();
  const enabled =
    typeof message.enabled === "boolean" ? message.enabled : !blurRef.current;

  blurRef.current = enabled;

  await chrome.storage.local.set({ backgroundEffect: enabled ? "blur" : "" });

  safelyApplyFilter(offScreenCanvasContextRef, enabled ? "blur(5px)" : "none");
};

const handleLoadCustomEffect = async (
  message: Record<string, unknown>,
): Promise<void> => {
  const effectUrl =
    typeof message.effectUrl === "string" ? message.effectUrl : "";
  if (!effectUrl) {
    console.warn("⚠️ No effect URL provided");
    return;
  }

  const { blurRef, effectRef, offScreenCanvasContextRef } = getContextRefs();

  try {
    const effectImage = await loadEffect(effectUrl);
    blurRef.current = false;
    effectRef.current = effectImage;

    await chrome.storage.local.set({ backgroundEffect: effectUrl });

    safelyApplyFilter(offScreenCanvasContextRef, "none");
  } catch (error) {
    console.error("Failed to load custom effect:", error);
  }
};

const handleCameraOnlyUpdate = () => {
  const { recordingTypeRef, setWidth, setHeight, setIsCameraMode } =
    getContextRefs();

  if (setWidth && setHeight) {
    setWidth("auto");
    setHeight("100%");
  }

  setIsCameraMode(true);
  recordingTypeRef.current = "camera";
};

const handleScreenUpdate = () => {
  const { videoRef, recordingTypeRef, setWidth, setHeight, setIsCameraMode } =
    getContextRefs();

  if (!videoRef.current || !setWidth || !setHeight) {
    console.warn("⚠️ Missing required refs for screen update");
    return;
  }

  setIsCameraMode(false);

  const { videoWidth, videoHeight } = videoRef.current;

  if (videoWidth > videoHeight) {
    setWidth("auto");
    setHeight("100%");
  } else {
    setWidth("100%");
    setHeight("auto");
  }

  recordingTypeRef.current = "screen";
};
