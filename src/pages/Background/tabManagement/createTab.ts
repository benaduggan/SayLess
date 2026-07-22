import type { BrowserTab } from "./getCurrentTab";

export const createTab = async (
  url: string | null | undefined,
  active = false,
): Promise<BrowserTab | undefined> => {
  if (!url) return;

  return chrome.tabs.create({ url, active });
};
