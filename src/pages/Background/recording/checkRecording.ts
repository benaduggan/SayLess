import { discardRecording } from "./discardRecording";
import { discardOffscreenDocuments } from "../offscreen/discardOffscreenDocuments";

export const checkRecording = async (): Promise<void> => {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          lastError?: { message?: string };
          getContexts: (
            options: Record<string, unknown>,
          ) => Promise<Array<{ contextType: string }>>;
        };
        storage: {
          local: { get: (keys: string[]) => Promise<Record<string, unknown>> };
        };
        tabs: {
          get: (tabId: number, callback: (tab?: { id?: number }) => void) => void;
        };
      };
    }
  ).chrome;
  const { recordingTab, offscreen } = await chromeApi.storage.local.get([
    "recordingTab",
    "offscreen",
  ]);

  if (recordingTab && !offscreen) {
    try {
      chromeApi.tabs.get(Number(recordingTab), (tab) => {
        if (chromeApi.runtime.lastError || !tab) {
          void discardRecording();
        }
      });
    } catch (error) {
      void discardRecording();
    }
  } else if (offscreen) {
    try {
      const existingContexts = await chromeApi.runtime.getContexts({});
      const offDocument = existingContexts.find((c) => c.contextType === "OFFSCREEN_DOCUMENT");

      if (!offDocument) {
        void discardOffscreenDocuments();
        void discardRecording();
      }
    } catch (error) {
      console.error("Error checking offscreen document: ", error);
      void discardRecording();
    }
  }
};
