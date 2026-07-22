import { handleTabActivation } from "./onTabActivatedListener";
import { listenerChrome } from "./chromeTypes";

const handleWindowFocusChanged = async (windowId: number): Promise<void> => {
  const chromeApi = listenerChrome();
  if (windowId === chromeApi.windows.WINDOW_ID_NONE) return;

  try {
    const tabs = await chromeApi.tabs.query({ active: true, windowId });
    if (tabs[0]?.id != null) {
      await handleTabActivation({ tabId: tabs[0].id });
    }
  } catch (error) {
    console.error("Failed to query active tab:", error);
  }
};

export const onWindowFocusChangedListener = (): void => {
  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
};
