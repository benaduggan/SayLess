/**
 * Waits for a content script in the specified tab to be ready.
 * @param {number} tabId - The ID of the tab to wait for.
 * @param {number} [interval=500] - The interval in ms to ping the tab.
 * @param {number} [timeout=10000] - The max timeout in ms to wait.
 * @returns {Promise<void>} Resolves when the content script responds, rejects if it times out.
 */
export const waitForContentScript = async (
  tabId: number,
  interval = 500,
  timeout = 10000,
): Promise<void> => {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome: {
        tabs: {
          sendMessage: (
            tabId: number,
            message: unknown,
            callback: (response: unknown) => void,
          ) => void;
        };
      };
    }
  ).chrome;
  return new Promise<void>((resolve, reject) => {
    const maxAttempts = Math.floor(timeout / interval);
    let attempts = 0;

    const intervalId = setInterval(() => {
      attempts++;

      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        console.error(`❌ Content script did not respond within ${timeout}ms.`);
        reject(new Error(`Content script did not respond within ${timeout}ms`));
        return;
      }

      // Ping the content script
      chromeApi.tabs.sendMessage(tabId, { type: "ping" }, (response) => {
        if (
          typeof response === "object" &&
          response !== null &&
          (response as { status?: unknown }).status === "ready"
        ) {
          clearInterval(intervalId);
          resolve();
        }
      });
    }, interval);
  });
};
