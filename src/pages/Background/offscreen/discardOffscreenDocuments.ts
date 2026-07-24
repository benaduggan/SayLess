import { closeOffscreenDocumentWithFlush } from "./closeOffscreenDocumentWithFlush";
import { perfSpan } from "../../utils/perfMarks";
import { errorMessage, offscreenChrome } from "./chromeTypes";

export const discardOffscreenDocuments = async ({
  reason = "discard",
  flush = true,
}: { reason?: string; flush?: boolean } = {}): Promise<void> => {
  const chromeApi = offscreenChrome();
  console.warn("[SayLess][discardOffscreenDocuments]", { reason, flush, stack: new Error().stack });
  const endFlush = perfSpan("BG.offscreen discardOffscreenDocuments", { reason, flush });
  try {
    if (flush) {
      await closeOffscreenDocumentWithFlush({ reason });
    } else {
      const existingContexts = await chromeApi.runtime.getContexts({});
      const offscreenDocument = existingContexts.find(
        (c) => c.contextType === "OFFSCREEN_DOCUMENT",
      );
      if (offscreenDocument) {
        await chromeApi.offscreen?.closeDocument();
      }
    }
  } catch (error) {
    console.error("Failed to discard offscreen documents:", errorMessage(error));
  }
  // verify gone before clearing flag; otherwise sendMessageRecord routes to dead listener
  try {
    const remaining = await chromeApi.runtime.getContexts({});
    const stillExists = remaining.some((c) => c.contextType === "OFFSCREEN_DOCUMENT");
    void chromeApi.storage.local.set({ offscreen: stillExists });
    endFlush({ stillExists });
  } catch {
    void chromeApi.storage.local.set({ offscreen: false });
    endFlush({ result: "getContexts-failed" });
  }
};
