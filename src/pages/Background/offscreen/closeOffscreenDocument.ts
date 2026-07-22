import { offscreenChrome } from "./chromeTypes";

export const closeOffscreenDocument = async (): Promise<void> => {
  try {
    const chromeApi = offscreenChrome();
    const existingContexts = await chromeApi.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );

    if (offscreenDocument) {
      await chromeApi.offscreen?.closeDocument();
    }
  } catch (error) {
    console.error("Failed to close offscreen document:", error);
  }
};
