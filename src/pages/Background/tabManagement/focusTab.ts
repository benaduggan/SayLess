export const focusTab = async (
  tabId: unknown,
  context: Record<string, unknown> = {},
): Promise<boolean> => {
  if (!Number.isInteger(tabId)) {
    console.warn("[SayLess][BG] focusTab skipped: invalid tabId", {
      tabId,
      context,
    });
    return false;
  }

  try {
    const chromeApi = (globalThis as typeof globalThis & {
      chrome: {
        tabs: {
          get: (id: number) => Promise<{ id?: number; windowId?: number }>;
          update: (id: number, options: { active: boolean }) => Promise<unknown>;
        };
        windows: {
          update: (id: number, options: { focused: boolean }) => Promise<unknown>;
        };
      };
    }).chrome;
    const tab = await chromeApi.tabs.get(tabId as number);
    if (!tab?.id || typeof tab.windowId !== "number") {
      console.warn("[SayLess][BG] focusTab skipped: tab unavailable", {
        tabId,
        context,
      });
      return false;
    }

    await chromeApi.windows.update(tab.windowId, { focused: true });
    await chromeApi.tabs.update(tab.id, { active: true });
    return true;
  } catch (error) {
    console.warn("[SayLess][BG] focusTab failed", {
      tabId,
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
