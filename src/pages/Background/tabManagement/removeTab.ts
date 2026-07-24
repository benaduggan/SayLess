export const removeTab = async (tabId: number | null): Promise<void> => {
  if (tabId === null) return;

  try {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            get: (id: number, callback: (tab?: { id?: number }) => void) => void;
            remove: (id: number) => unknown;
          };
        };
      }
    ).chrome;
    const tab = await new Promise<{ id?: number } | undefined>((resolve) => {
      chromeApi.tabs.get(tabId, (tab) => {
        resolve(tab);
      });
    });

    if (tab && tab.id) {
      chromeApi.tabs.remove(tab.id);
    }
  } catch (error) {
    // Tab doesn't exist or can't be accessed
  }
};
