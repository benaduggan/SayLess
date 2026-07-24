export function startClickTracking(
  isRegion = false,
  regionWidth = 0,
  regionHeight = 0,
  regionX = 0,
  regionY = 0,
  contentStateRef: { current?: { blurMode?: boolean } | null } | null = null,
): () => void {
  // Refreshed on storage change: a restart can swap recordingType
  // (camera ↔ screen) and we'd otherwise dispatch against the prior mode.
  let cachedSurface = "unknown";
  let cachedRecordingWindowId: number | null = null;
  let cachedRecordingType: string | null = null;
  chrome.storage.local
    .get(["surface", "recordingWindowId", "recordingType"])
    .then((vals) => {
      cachedSurface = typeof vals.surface === "string" ? vals.surface : "unknown";
      cachedRecordingWindowId =
        typeof vals.recordingWindowId === "number" ? vals.recordingWindowId : null;
      cachedRecordingType = typeof vals.recordingType === "string" ? vals.recordingType : null;
    })
    .catch(() => {});

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== "local") return;
    if (changes.surface)
      cachedSurface =
        typeof changes.surface.newValue === "string" ? changes.surface.newValue : "unknown";
    if (changes.recordingWindowId)
      cachedRecordingWindowId =
        typeof changes.recordingWindowId.newValue === "number"
          ? changes.recordingWindowId.newValue
          : null;
    if (changes.recordingType)
      cachedRecordingType =
        typeof changes.recordingType.newValue === "string" ? changes.recordingType.newValue : null;
  };
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch {}

  const handleClick = (e: MouseEvent): void => {
    if (contentStateRef?.current?.blurMode) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (
      target.closest(".ToolbarRoot") ||
      target.closest(".ToolbarRecordingControls") ||
      target.closest(".ToolbarToggleWrap") ||
      target.closest(".ToolbarPaused") ||
      target.closest(".Toast") ||
      target.closest("#screenity-root-container")
    ) {
      return;
    }

    const canvasWrapper = document.getElementById("canvas-wrapper-screenity");
    if (canvasWrapper && canvasWrapper.contains(target)) {
      return;
    }

    if (cachedRecordingType === "camera") {
      return;
    }

    let clickX = e.clientX;
    let clickY = e.clientY;

    if (isRegion) {
      const inRegion =
        clickX >= regionX &&
        clickX <= regionX + regionWidth &&
        clickY >= regionY &&
        clickY <= regionY + regionHeight;

      if (!inRegion) {
        return;
      }

      clickX = clickX - regionX;
      clickY = clickY - regionY;
    }

    chrome.runtime.sendMessage({
      type: "click-event",
      payload: {
        x: clickX,
        y: clickY,
        viewportWidth: isRegion ? regionWidth : window.innerWidth,
        viewportHeight: isRegion ? regionHeight : window.innerHeight,
        relativeToRegion: isRegion,
        surface: cachedSurface,
        recordingWindowId: cachedRecordingWindowId,
        timestamp: Date.now(),
        region: isRegion,
        isTab: cachedRecordingType === "region",
      },
    });
  };

  window.addEventListener("mousedown", handleClick, true);
  return () => {
    window.removeEventListener("mousedown", handleClick, true);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {}
  };
}
