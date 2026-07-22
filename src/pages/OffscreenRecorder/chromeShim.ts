// chrome.storage / chrome.i18n / chrome.tabs shim for offscreen docs - proxies to SW.
// Install before any code that uses chrome.storage runs.

const DEBUG = false;

interface ProxyResponse {
  ok?: boolean;
  result?: Record<string, unknown>;
  tab?: chrome.tabs.Tab;
  error?: string;
}

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

interface ShimStorageArea {
  get(
    keys?: unknown,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> | undefined;
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | undefined;
  remove(keys: string | string[], callback?: () => void): Promise<void> | undefined;
  clear(callback?: () => void): Promise<void> | undefined;
}

interface MutableChromeShim {
  runtime: {
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown) => void): void;
    };
  };
  storage?: {
    local: ShimStorageArea;
    session: ShimStorageArea;
    sync: ShimStorageArea;
    managed: ShimStorageArea;
    onChanged: {
      addListener(listener: StorageChangeListener): void;
      removeListener(listener: StorageChangeListener): void;
      hasListener(listener: StorageChangeListener): boolean;
    };
  };
  i18n?: {
    getMessage?: (
      key: string,
      substitutions?: string | string[],
    ) => string;
    getUILanguage?: () => string;
  };
  tabs?: {
    get(
      tabId: number,
      callback?: (tab: chrome.tabs.Tab | undefined) => void,
    ): Promise<chrome.tabs.Tab> | undefined;
  };
}

const chromeShim = chrome as unknown as MutableChromeShim;

const asProxyResponse = (value: unknown): ProxyResponse =>
  typeof value === "object" && value !== null
    ? (value as ProxyResponse)
    : {};

const sendProxy = async (
  type: string,
  payload: Record<string, unknown>,
): Promise<ProxyResponse> => {
  try {
    const resp = asProxyResponse(
      await chromeShim.runtime.sendMessage({ type, ...payload }),
    );
    if (DEBUG) console.log("[ChromeShim]", type, "->", resp);
    return resp;
  } catch (err) {
    console.warn("[ChromeShim]", type, "error:", err);
    return { ok: false, error: String(err) };
  }
};

const assertLocalExtensionUrl = (url: unknown): string => {
  const baseUrl = chromeShim.runtime.getURL("");
  if (typeof url !== "string" || !url.startsWith(baseUrl)) {
    throw new Error("Expected local extension URL.");
  }
  return url;
};

const makeStorageArea = (area: string): ShimStorageArea => ({
  get(keys?: unknown, callback?: (items: Record<string, unknown>) => void) {
    const normalised = keys === undefined ? null : keys;
    const promise = sendProxy("proxy-storage-get", {
      area,
      keys: normalised,
    }).then((resp) => (resp && resp.ok ? resp.result || {} : {}));
    if (typeof callback === "function") {
      promise.then(callback, () => callback({}));
      return undefined;
    }
    return promise;
  },
  set(items: Record<string, unknown>, callback?: () => void) {
    const promise = sendProxy("proxy-storage-set", { area, items }).then(
      () => undefined
    );
    if (typeof callback === "function") {
      promise.then(callback, callback);
      return undefined;
    }
    return promise;
  },
  remove(keys: string | string[], callback?: () => void) {
    const promise = sendProxy("proxy-storage-remove", { area, keys }).then(
      () => undefined
    );
    if (typeof callback === "function") {
      promise.then(callback, callback);
      return undefined;
    }
    return promise;
  },
  clear(callback?: () => void) {
    const promise = sendProxy("proxy-storage-clear", { area }).then(
      () => undefined
    );
    if (typeof callback === "function") {
      promise.then(callback, callback);
      return undefined;
    }
    return promise;
  },
});

const storageChangeListeners = new Set<StorageChangeListener>();

const bindOnChangedRelay = (): void => {
  chromeShim.runtime.onMessage.addListener((message: unknown) => {
    const msg =
      typeof message === "object" && message !== null
        ? (message as Record<string, unknown>)
        : {};
    if (msg.type === "proxy-storage-onchanged") {
      storageChangeListeners.forEach((fn) => {
        try {
          fn(
            (msg.changes || {}) as Record<string, chrome.storage.StorageChange>,
            typeof msg.area === "string" ? msg.area : "local",
          );
        } catch (err) {
          console.warn("[ChromeShim] storage.onChanged listener error:", err);
        }
      });
    }
  });
};

export function installChromeShims(): void {
  if (typeof chrome === "undefined") {
    console.error("[ChromeShim] chrome global missing - cannot shim");
    return;
  }

  if (!chromeShim.storage) {
    chromeShim.storage = {
      local: makeStorageArea("local"),
      session: makeStorageArea("session"),
      sync: makeStorageArea("sync"),
      managed: makeStorageArea("managed"),
      onChanged: {
        addListener: (fn) => storageChangeListeners.add(fn),
        removeListener: (fn) => storageChangeListeners.delete(fn),
        hasListener: (fn) => storageChangeListeners.has(fn),
      },
    };
    bindOnChangedRelay();
    console.log("[ChromeShim] chrome.storage installed");
  }

  if (!chromeShim.i18n || typeof chromeShim.i18n.getMessage !== "function") {
    chromeShim.i18n = chromeShim.i18n || {};

    // Offscreen docs have no native chrome.i18n, and the old stub returned the
    // message KEY, which leaked into user-facing copy. Preload the real catalog
    // (en + UI locale) so getMessage() returns localized strings.
    const catalog: Record<string, { message?: string }> = {};
    const loadCatalog = (
      locale: string | undefined,
    ): Record<string, { message?: string }> | null => {
      if (!locale) return null;
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "GET",
          assertLocalExtensionUrl(
            chromeShim.runtime.getURL(`_locales/${locale}/messages.json`),
          ),
          false,
        );
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) {
          return JSON.parse(xhr.responseText || "{}") as Record<
            string,
            { message?: string }
          >;
        }
      } catch {}
      return null;
    };
    const uiLang = (navigator.language || "en").replace("-", "_");
    const baseLang = uiLang.split("_")[0];
    for (const loc of ["en", baseLang, uiLang]) {
      const loaded = loadCatalog(loc);
      if (loaded) Object.assign(catalog, loaded);
    }
    // Returns "" on a miss (matching native chrome.i18n), never the key.
    chromeShim.i18n.getMessage = (key, substitutions) => {
      if (!key) return "";
      const entry = catalog[key];
      let msg = entry && typeof entry.message === "string" ? entry.message : "";
      if (!msg) return "";
      if (substitutions != null) {
        const subs = Array.isArray(substitutions)
          ? substitutions
          : [substitutions];
        msg = msg.replace(/\$(\d+)/g, (_, n: string) =>
          String(subs[Number(n) - 1] ?? ""),
        );
      }
      return msg;
    };
    if (typeof chromeShim.i18n.getUILanguage !== "function") {
      chromeShim.i18n.getUILanguage = () => navigator.language || "en";
    }
    console.log(
      "[ChromeShim] chrome.i18n catalog installed",
      Object.keys(catalog).length,
      "messages",
    );
  }

  if (!chromeShim.tabs) {
    chromeShim.tabs = {
      get(tabId: number, callback?: (tab: chrome.tabs.Tab | undefined) => void) {
        const promise = sendProxy("proxy-tabs-get", { tabId }).then((resp) => {
          if (resp.ok && resp.tab) return resp.tab;
          throw new Error(resp?.error || "Tab not found");
        });
        if (typeof callback === "function") {
          promise.then(callback, () => callback(undefined));
          return undefined;
        }
        return promise;
      },
    };
    console.log("[ChromeShim] chrome.tabs installed");
  }
}
