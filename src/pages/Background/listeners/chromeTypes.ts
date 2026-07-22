export interface ListenerTab {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface ListenerChromeApi {
  runtime: {
    lastError?: { message?: string };
    reload(): void;
    getManifest(): {
      version: string;
      content_scripts?: Array<{ matches: string[]; js?: string[] }>;
    };
    onStartup: { addListener(listener: () => void): void };
    onUpdateAvailable: {
      addListener(listener: (details: { version?: string }) => void): void;
    };
    onInstalled: {
      addListener(
        listener: (details: {
          reason: string;
          previousVersion?: string;
        }) => void | Promise<void>,
      ): void;
    };
  };
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
      clear(): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
    managed: {
      get(
        key: string,
        callback: (values: Record<string, unknown>) => void,
      ): void;
    };
    onChanged: {
      addListener(
        listener: (changes: Record<string, unknown>, area: string) => void,
      ): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<ListenerTab>;
    query(options: Record<string, unknown>): Promise<ListenerTab[]>;
    create(options: { url: string }): Promise<ListenerTab>;
    onActivated: {
      addListener(listener: (info: { tabId: number; windowId?: number }) => void): void;
    };
  };
  windows: { WINDOW_ID_NONE: number };
  scripting: {
    executeScript(
      options: { target: { tabId: number }; files?: string[] },
      callback: () => unknown,
    ): Promise<unknown>;
  };
}

export const listenerChrome = (): ListenerChromeApi =>
  (globalThis as typeof globalThis & { chrome: ListenerChromeApi }).chrome;

export const listenerErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
