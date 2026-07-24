export const sendMessageTab = async (
  tabId: number | null,
  message: Record<string, unknown> | null,
  responseCallback: ((response: unknown) => void) | null = null,
  noTab: (() => void) | null = null,
): Promise<unknown> => {
  if (tabId === null || message === null) return Promise.reject("Tab ID or message is null");

  try {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          runtime: {
            lastError?: { message?: string };
            getURL: (path: string) => string;
            sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
          };
          tabs: {
            get: (id: number, callback: (tab: BrowserMessageTab) => void) => void;
            sendMessage: (
              id: number,
              message: unknown,
              callback: (response: unknown) => void,
            ) => void;
          };
        };
      }
    ).chrome;
    const tab = await new Promise<BrowserMessageTab>((resolve, reject) => {
      chromeApi.tabs.get(tabId, (tab) => {
        if (chromeApi.runtime.lastError) {
          reject(chromeApi.runtime.lastError.message);
        } else {
          resolve(tab as BrowserMessageTab);
        }
      });
    });

    const extOrigin = chromeApi.runtime.getURL("").replace(/\/$/, "");
    const isExtUrl = tab?.url && tab.url.startsWith(extOrigin);
    const isPendingExtUrl = tab?.pendingUrl && tab.pendingUrl.startsWith(extOrigin);

    if (isExtUrl || isPendingExtUrl) {
      return new Promise<unknown>((resolve, reject) => {
        chromeApi.runtime.sendMessage({ ...message, _targetTabId: tabId }, (response) => {
          if (chromeApi.runtime.lastError) {
            const msg = chromeApi.runtime.lastError.message || "";
            if (msg.includes("message port closed before a response")) {
              if (responseCallback) {
                responseCallback(undefined);
              } else {
                resolve(undefined);
              }
              return;
            }
            reject(msg);
            return;
          }
          if (responseCallback) {
            responseCallback(response);
          } else {
            resolve(response);
          }
        });
      });
    }

    if (
      !tab ||
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chromewebstore.google.com") ||
      tab.url.startsWith("chrome.google.com/webstore") ||
      tab.url === "" ||
      tab.url === "about:blank"
    ) {
      return Promise.reject("Invalid tab URL");
    }

    return new Promise<unknown>((resolve, reject) => {
      chromeApi.tabs.sendMessage(tabId, message, (response) => {
        if (chromeApi.runtime.lastError) {
          reject(chromeApi.runtime.lastError.message);
        } else if (responseCallback) {
          responseCallback(response);
        } else {
          resolve(response);
        }
      });
    });
  } catch (error) {
    console.error("Error sending message to tab:", error);
    if (noTab && typeof noTab === "function") {
      noTab();
    }
    return Promise.reject(error);
  }
};

interface BrowserMessageTab {
  id: number;
  url?: string;
  pendingUrl?: string;
}
