// chrome.storage / chrome.tabs proxy handlers for the offscreen recorder.

import { registerMessage } from "../../../messaging/messageRouter";
import { errorMessage, offscreenChrome, type ExtensionStorageArea } from "./chromeTypes";

const getArea = (area: unknown): ExtensionStorageArea => {
  if (typeof area !== "string") throw new Error("Storage area must be a string");
  const a = offscreenChrome().storage[area];
  if (!a) throw new Error(`Unknown storage area: ${area}`);
  return a as ExtensionStorageArea;
};

export const registerProxyStorageHandlers = (): void => {
  registerMessage("proxy-storage-get", async (message) => {
    try {
      const a = getArea(message.area);
      const result = await a.get(message.keys === null ? undefined : message.keys);
      return { ok: true, result: result || {} };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  registerMessage("proxy-storage-set", async (message) => {
    try {
      await getArea(message.area).set(
        typeof message.items === "object" && message.items !== null
          ? (message.items as Record<string, unknown>)
          : {},
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  registerMessage("proxy-storage-remove", async (message) => {
    try {
      await getArea(message.area).remove(message.keys);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  registerMessage("proxy-storage-clear", async (message) => {
    try {
      await getArea(message.area).clear();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  const chromeApi = offscreenChrome();
  chromeApi.storage.onChanged.addListener((changes, area) => {
    chromeApi.runtime
      .sendMessage({ type: "proxy-storage-onchanged", changes, area })
      .catch(() => {});
  });

  registerMessage("proxy-tabs-get", async (message) => {
    try {
      const tab = await chromeApi.tabs.get(Number(message.tabId));
      return { ok: true, tab };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });
};
