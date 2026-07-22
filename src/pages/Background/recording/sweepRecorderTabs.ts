import { removeTab } from "../tabManagement/removeTab";
import { diagEvent } from "../../utils/diagnosticLog";

// Stop and remove every free recorder tab, optionally sparing one.
//
// The single `recordingTab` storage slot can only ever name one recorder
// tab. When a second one is spawned (countdown-finished racing the
// countdownFallback) or the slot is overwritten by the next attempt, the
// earlier recorder tab becomes both unreachable and unkillable: nothing
// holds its id. Its MediaRecorder then runs until the tab is closed by
// hand. This enumerates recorder tabs by URL so none can hide behind a
// lost handle.
//
// Scope: `recorder.html` only.
export const sweepRecorderTabs = async ({
  exceptTabId = null,
}: { exceptTabId?: number | null } = {}): Promise<number[]> => {
  const removed: number[] = [];
  try {
    const chromeApi = (globalThis as typeof globalThis & {
      chrome: {
        runtime: { getURL: (path: string) => string };
        tabs: {
          query: (options: Record<string, unknown>) => Promise<Array<{
            id?: number;
            url?: string;
            pendingUrl?: string;
          }>>;
        };
      };
    }).chrome;
    const recorderUrl = chromeApi.runtime.getURL("recorder.html");
    const tabs = await chromeApi.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null || tab.id === exceptTabId) continue;
      const url = tab.url || tab.pendingUrl || "";
      if (!url.startsWith(recorderUrl)) continue;
      try {
        await removeTab(tab.id);
        removed.push(tab.id);
      } catch {}
    }
  } catch (err) {
    console.warn("[SayLess] sweepRecorderTabs failed", err);
  }
  if (removed.length) {
    diagEvent("recorder-tabs-swept", { removed, exceptTabId });
  }
  return removed;
};
