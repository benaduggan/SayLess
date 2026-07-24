import localforage from "localforage";
import { sendMessageTab } from "../tabManagement/sendMessageTab";

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

// in-memory promise chain. storage-based sendingChunks flag was racy:
// check-then-set via async chrome.storage let two concurrent triggers pass.
let _sendChain: Promise<void> = Promise.resolve();

export const chunksStore = localforage.createInstance({ name: "chunks" });
const DEBUG_POSTSTOP = false;

export interface StoredChunk {
  index?: number | null;
  [key: string]: unknown;
}

export interface ChunkTarget {
  tabId?: number | null;
  frameId?: number | null;
}

interface ChunkChromeApi {
  runtime: { lastError?: { message?: string } };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
  };
  tabs: {
    sendMessage: (
      tabId: number,
      message: Record<string, unknown>,
      options: { frameId: number },
      callback: (response: unknown) => void,
    ) => void;
  };
}

const chromeApi = (): ChunkChromeApi =>
  (globalThis as typeof globalThis & { chrome: ChunkChromeApi }).chrome;

export const clearAllRecordings = async (): Promise<void> => {
  try {
    await chunksStore.clear();
  } catch (err) {
    console.error("Failed to clear chunksStore", err);
  }
};

export const handleChunks = async (
  chunks: StoredChunk[],
  override = false,
  target: ChunkTarget | null = null,
): Promise<void> => {
  const priorChain = _sendChain;
  let releaseChain: (() => void) | undefined;
  _sendChain = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });
  try {
    await priorChain;
  } catch {}

  // outer try/finally guarantees lock release even if the storage read throws
  let mainCompleted = false;
  try {
    const { sandboxTab, bannerSupport } = await chromeApi().storage.local.get([
      "sandboxTab",
      "bannerSupport",
    ]);

    if (DEBUG_POSTSTOP)
      console.debug("[SayLess][BG] handleChunks called", {
        chunksLength: chunks?.length,
        sandboxTab,
        override,
      });

    // legacy flag kept in sync for callers still reading it
    await chromeApi().storage.local.set({ sendingChunks: true });

    try {
      if (!Array.isArray(chunks) || chunks.length === 0) {
        if (DEBUG_POSTSTOP) console.debug("[SayLess][BG] no chunks to send; deferring delivery");
        return;
      }

      chunks.sort((a, b) => {
        if (a.index == null) return -1;
        if (b.index == null) return 1;
        return a.index - b.index;
      });

      const targetTab = target?.tabId || Number(sandboxTab) || null;
      const targetFrame = target?.frameId ?? null;

      if (DEBUG_POSTSTOP)
        console.debug("[SayLess][BG] sending chunk-count", {
          count: chunks.length,
          targetTab,
          targetFrame,
          override,
        });

      const sendToTarget = (msg: Record<string, unknown>): Promise<unknown> =>
        new Promise<unknown>((resolve, reject) => {
          try {
            if (targetTab == null) return reject(new Error("no-target-tab"));
            if (typeof targetFrame === "number") {
              chromeApi().tabs.sendMessage(targetTab, msg, { frameId: targetFrame }, (resp) => {
                if (chromeApi().runtime.lastError)
                  return reject(chromeApi().runtime.lastError?.message);
                resolve(resp);
              });
            } else {
              sendMessageTab(targetTab, msg, null).then(resolve).catch(reject);
            }
          } catch (err) {
            reject(err);
          }
        });

      try {
        await sendToTarget({
          type: "chunk-count",
          count: chunks.length,
          override,
        });
      } catch (err) {
        if (DEBUG_POSTSTOP) console.warn("[SayLess][BG] chunk-count message failed", err);
      }

      if (bannerSupport) {
        try {
          await sendToTarget({ type: "banner-support" });
        } catch (err) {
          if (DEBUG_POSTSTOP) console.warn("[SayLess][BG] banner-support message failed", err);
        }
      }

      // editor reads chunks directly from IDB/OPFS via chooseReader; make-video-tab
      // just triggers that read (old per-chunk relay push removed)
      if (DEBUG_POSTSTOP)
        console.debug("[SayLess][BG] instructing sandbox to make video tab", {
          sandboxTab: targetTab,
        });
      try {
        await sendToTarget({ type: "make-video-tab", override });
      } catch (err) {
        if (DEBUG_POSTSTOP) console.warn("[SayLess][BG] make-video-tab message failed", err);
      }
    } finally {
      await chromeApi().storage.local.set({ sendingChunks: false });
      mainCompleted = true;
    }
  } finally {
    void mainCompleted;
    if (releaseChain) releaseChain();
  }
};
