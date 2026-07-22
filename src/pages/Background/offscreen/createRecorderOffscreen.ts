// Offscreen doc host for the recorder; immune to background-tab freeze/discard.
// Chrome allows only one offscreen doc per extension, so any existing one is
// closed first.
import { offscreenChrome } from "./chromeTypes";

export const createRecorderOffscreen = async (): Promise<void> => {
  const chromeApi = offscreenChrome();
  if (!chromeApi.offscreen || typeof chromeApi.offscreen.createDocument !== "function") {
    throw new Error("chrome.offscreen API unavailable");
  }

  try {
    const contexts = await chromeApi.runtime.getContexts({});
    const hasOffscreen = (contexts || []).some(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT",
    );
    if (hasOffscreen) {
      await chromeApi.offscreen.closeDocument();
    }
  } catch (err) {
    // non-fatal; still attempt create, a stale doc surfaces as a create error
    console.warn("[createRecorderOffscreen] pre-close failed", err);
  }

  await chromeApi.offscreen.createDocument({
    url: "offscreenrecorder.html",
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "BLOBS", "WORKERS"],
    justification:
      "Host the screen recorder so a long recording survives background-tab freeze/discard.",
  });
};
