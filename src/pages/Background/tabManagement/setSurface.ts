import { sendMessageTab } from "./sendMessageTab";

export const setSurface = async (request: { surface?: string }): Promise<void> => {
  const chromeApi = (
    globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: {
            set: (values: Record<string, unknown>) => Promise<void>;
            get: (keys: string[]) => Promise<Record<string, unknown>>;
          };
        };
      };
    }
  ).chrome;
  await chromeApi.storage.local.set({ surface: request.surface });

  const { activeTab } = await chromeApi.storage.local.get(["activeTab"]);

  await sendMessageTab(Number(activeTab) || null, {
    type: "set-surface",
    surface: request.surface,
    subscribed: true,
    instantMode: false,
  });
};
