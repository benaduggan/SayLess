import { sendMessageTab } from "../tabManagement/sendMessageTab";

interface DownloadTab {
  id?: number;
}

type TabUpdateListener = (tabId: number, changeInfo: { status?: string }) => void;

interface DownloadChromeApi {
  tabs: {
    create: (options: { url: string; active: boolean }) => Promise<DownloadTab>;
    onUpdated: {
      addListener: (listener: TabUpdateListener) => void;
      removeListener: (listener: TabUpdateListener) => void;
    };
  };
}

const chromeApi = (): DownloadChromeApi =>
  (globalThis as typeof globalThis & { chrome: DownloadChromeApi }).chrome;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const requestDownload = async (base64: string, title?: string): Promise<void> => {
  try {
    // Open a new tab with the download page
    const tab = await chromeApi().tabs.create({
      url: "download.html",
      active: false,
    });

    // Add a listener for when the tab finishes loading
    const listener: TabUpdateListener = (tabId, changeInfo) => {
      if (tab.id != null && tabId === tab.id && changeInfo.status === "complete") {
        chromeApi().tabs.onUpdated.removeListener(listener);

        // Send the message with the download data
        sendMessageTab(tab.id, {
          type: "download-video",
          base64,
          title,
        });
      }
    };

    chromeApi().tabs.onUpdated.addListener(listener);
  } catch (error) {
    console.error("Failed to request download:", errorMessage(error));
  }
};

export const downloadIndexedDB = async (): Promise<void> => {
  try {
    // Open a new tab with the download page
    const tab = await chromeApi().tabs.create({
      url: "download.html",
      active: false,
    });

    // Add a listener for when the tab finishes loading
    const listener: TabUpdateListener = (tabId, changeInfo) => {
      if (tab.id != null && tabId === tab.id && changeInfo.status === "complete") {
        chromeApi().tabs.onUpdated.removeListener(listener);

        // Send the message to trigger the IndexedDB download
        sendMessageTab(tab.id, {
          type: "download-indexed-db",
        });
      }
    };

    chromeApi().tabs.onUpdated.addListener(listener);
  } catch (error) {
    console.error("Failed to initiate IndexedDB download:", errorMessage(error));
  }
};
