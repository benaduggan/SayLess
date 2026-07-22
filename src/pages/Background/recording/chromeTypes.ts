export interface RecordingTab {
  id: number;
  windowId?: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
}

export interface RecordingStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface RecordingChromeApi {
  runtime: {
    lastError?: { message?: string };
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      get(
        keys: string[],
        callback: (result: Record<string, unknown>) => void,
      ): void;
      set(values: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (
          changes: Record<string, RecordingStorageChange>,
          area: string,
        ) => void,
      ): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<RecordingTab & { status?: string }>;
    create(
      options: { url: string; active: boolean },
      callback: (tab?: RecordingTab) => void,
    ): void;
    query(options: Record<string, unknown>): Promise<RecordingTab[]>;
    query(
      options: Record<string, unknown>,
      callback: (tabs: RecordingTab[]) => void,
    ): void;
    onUpdated: {
      addListener(
        listener: (
          tabId: number,
          changeInfo: { status?: string },
          tab: RecordingTab,
        ) => void,
      ): void;
      removeListener(
        listener: (
          tabId: number,
          changeInfo: { status?: string },
          tab: RecordingTab,
        ) => void,
      ): void;
    };
    onRemoved: {
      addListener(listener: (tabId: number) => void): void;
      removeListener(listener: (tabId: number) => void): void;
    };
  };
  action: {
    setIcon(options: { path: string }): Promise<void>;
  };
  alarms: {
    create(name: string, options: { delayInMinutes: number }): Promise<void>;
    clear(name: string): Promise<boolean>;
  };
  i18n: { getMessage(key: string): string };
}

export const recordingChrome = (): RecordingChromeApi =>
  (globalThis as typeof globalThis & { chrome: RecordingChromeApi }).chrome;

export const recordingErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
