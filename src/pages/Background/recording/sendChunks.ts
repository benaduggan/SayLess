import { chunksStore } from "./chunkHandler";
import { handleChunks } from "./chunkHandler";
import { diagEvent } from "../../utils/diagnosticLog";
import type { ChunkTarget, StoredChunk } from "./chunkHandler";

export type SendChunksResult =
  | { status: "empty"; chunkCount: number }
  | { status: "ok"; chunkCount: number }
  | { status: "error"; error: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const sendChunks = async (
  override = false,
  target: ChunkTarget | null = null,
): Promise<SendChunksResult> => {
  const startedAt = Date.now();
  try {
    const maxAttempts = 50;
    const delayMs = 200;
    let chunkCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      chunkCount = 0;
      await chunksStore.iterate(() => {
        chunkCount += 1;
      });
      console.debug("[SayLess][BG] sendChunks: chunkCount check", {
        attempt,
        chunkCount,
      });
      if (chunkCount > 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    diagEvent("sw-sendchunks-start", {
      initialCount: chunkCount,
      override: Boolean(override),
      targetTabId: target?.tabId ?? null,
    });

    if (chunkCount === 0) {
      console.warn("[SayLess][BG] sendChunks: no chunks available after waiting");
      try {
        const chromeApi = (
          globalThis as typeof globalThis & {
            chrome: {
              storage: {
                local: { set: (values: Record<string, unknown>) => Promise<void> };
              };
            };
          }
        ).chrome;
        await chromeApi.storage.local.set({
          lastChunkSendFailure: {
            ts: Date.now(),
            why: "no-chunks-after-wait",
            override,
            targetTabId: target?.tabId ?? null,
          },
        });
      } catch (writeErr) {
        // diag-write failure means storage itself is broken (quota/corruption)
        diagEvent("storage-write-failed", {
          key: "lastChunkSendFailure",
          err: errorMessage(writeErr).slice(0, 200),
        });
      }
      diagEvent("chunks-fail", { why: "no-chunks-after-wait" });
      return { status: "empty", chunkCount: 0 };
    }

    const chunks: StoredChunk[] = [];
    await chunksStore.iterate((value) => {
      if (typeof value === "object" && value !== null) {
        chunks.push(value as StoredChunk);
      }
    });
    console.debug("[SayLess][BG] sendChunks: collected chunks", {
      count: chunks.length,
    });
    await handleChunks(chunks, override, target);
    diagEvent("chunks-sent", { count: chunks.length });
    diagEvent("sw-sendchunks-done", {
      totalSent: chunks.length,
      elapsedMs: Date.now() - startedAt,
    });
    return { status: "ok", chunkCount: chunks.length };
  } catch (error) {
    diagEvent("sw-sendchunks-error", {
      error: errorMessage(error).slice(0, 200),
      elapsedMs: Date.now() - startedAt,
    });
    // never runtime.reload() here; caller retries on error status
    console.error("Failed to send chunks", error);
    return {
      status: "error",
      error: errorMessage(error).slice(0, 200),
    };
  }
};
