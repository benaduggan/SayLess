interface BrowserHelperChromeApi {
  action: { getUserSettings: () => Promise<{ isOnToolbar: boolean }> };
  runtime: { getPlatformInfo: () => Promise<Record<string, unknown>> };
  windows: {
    getCurrent: (callback: (window: { id?: number }) => void) => void;
    update: (
      id: number,
      options: { width: number; height: number },
    ) => unknown;
  };
}

const chromeApi = (): BrowserHelperChromeApi =>
  (globalThis as typeof globalThis & { chrome: BrowserHelperChromeApi }).chrome;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isPinned = async (): Promise<boolean> => {
  try {
    const userSettings = await chromeApi().action.getUserSettings();
    return userSettings.isOnToolbar;
  } catch (error) {
    console.error("Failed to check if the extension is pinned:", errorMessage(error));
    return false;
  }
};

export const getPlatformInfo = async (): Promise<Record<string, unknown> | null> => {
  try {
    return await chromeApi().runtime.getPlatformInfo();
  } catch (error) {
    console.error("Failed to retrieve platform info:", errorMessage(error));
    return null;
  }
};

export const resizeWindow = async (width: number, height: number): Promise<void> => {
  if (width === 0 || height === 0) {
    return;
  }

  chromeApi().windows.getCurrent((window) => {
    if (window.id == null) return;
    chromeApi().windows.update(window.id, {
      width: width,
      height: height,
    });
  });
};

export const checkAvailableMemory = async (): Promise<
  { data: StorageEstimate } | { error: string }
> => {
  try {
    const data = await navigator.storage.estimate();

    return { data };
  } catch (error) {
    console.error("Failed to estimate memory:", error);
    return { error: errorMessage(error) };
  }
};
