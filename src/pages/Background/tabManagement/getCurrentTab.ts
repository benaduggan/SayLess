export type BrowserTab = chrome.tabs.Tab;

export const getCurrentTab = async (): Promise<BrowserTab | undefined> => {
  const queryOptions = { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab;
};
