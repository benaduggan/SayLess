export interface ExtensionContext {
  contextType: string;
  documentUrl?: string;
}

export interface ExtensionTab {
  id?: number;
  url?: string;
  [key: string]: unknown;
}

export interface ExtensionStorageArea {
  get(keys?: unknown): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: unknown): Promise<void>;
  clear(): Promise<void>;
}

export interface OffscreenChromeApi {
  runtime: {
    lastError?: { message: string };
    getContexts(options: Record<string, unknown>): Promise<ExtensionContext[]>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(listener: (message: unknown) => void): void;
      removeListener(listener: (message: unknown) => void): void;
    };
  };
  offscreen?: {
    createDocument(options: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
    closeDocument(): Promise<void>;
  };
  storage: {
    local: ExtensionStorageArea;
    [area: string]: ExtensionStorageArea | unknown;
    onChanged: {
      addListener(
        listener: (changes: Record<string, unknown>, area: string) => void,
      ): void;
    };
  };
  tabs: {
    get(tabId: number): Promise<ExtensionTab>;
  };
  desktopCapture: {
    chooseDesktopMedia(
      sources: string[],
      targetTab: ExtensionTab | undefined,
      callback: (
        streamId: string,
        options?: { canRequestAudioTrack?: boolean },
      ) => void,
    ): void;
  };
  tabCapture: {
    getMediaStreamId(
      options: { targetTabId: number },
      callback: (streamId: string) => void,
    ): void;
  };
}

export const offscreenChrome = (): OffscreenChromeApi =>
  (globalThis as typeof globalThis & { chrome: OffscreenChromeApi }).chrome;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
