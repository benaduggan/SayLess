import { removeTab } from "../tabManagement/removeTab";
import { sendChunks } from "./sendChunks";

type TabUpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
) => void;

export const forceProcessing = async (): Promise<void> => {
  const editorURL = "editor.html";

  const chromeApi = (globalThis as typeof globalThis & {
    chrome: {
      storage: {
        local: {
          get: (keys: string[]) => Promise<Record<string, unknown>>;
          set: (values: Record<string, unknown>) => Promise<void>;
        };
      };
      tabs: {
        create: (
          options: { url: string; active: boolean },
          callback: (tab: { id?: number }) => void,
        ) => void;
        onUpdated: {
          addListener: (listener: TabUpdatedListener) => void;
          removeListener: (listener: TabUpdatedListener) => void;
        };
      };
    };
  }).chrome;

  const { sandboxTab } = await chromeApi.storage.local.get(["sandboxTab"]);

  chromeApi.tabs.create(
    {
      url: editorURL,
      active: true,
    },
    (tab) => {
      if (tab.id == null) return;
      const onTabUpdate: TabUpdatedListener = (
        tabId,
        changeInfo,
      ) => {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chromeApi.tabs.onUpdated.removeListener(onTabUpdate);

          if (sandboxTab) {
            void removeTab(Number(sandboxTab));
          }

          void chromeApi.storage.local.set({ sandboxTab: tab.id });

          void sendChunks(true);
        }
      };
      chromeApi.tabs.onUpdated.addListener(onTabUpdate);
    }
  );
};
