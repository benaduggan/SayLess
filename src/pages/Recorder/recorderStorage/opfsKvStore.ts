// OPFS-backed kv store shaped like localforage, one file per chunk at
// sayless-recorder-chunks/<sessionId>/<track>/<index>.bin. Async writes via
// createWritable() so it works from tab and SW contexts. Probe values
// are JSON; chunk values write the Blob directly. Keys keep their
// track prefix on iterate() to match what callers got from localforage.

export {};

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

const ROOT_DIR_NAME = "sayless-recorder-chunks";
const PROBE_FILE = "__probe.bin";
const CHUNK_FILE_RE = /^(\d+)\.bin$/;

export interface OpfsKvStoreOptions {
  sessionId: string;
  track: string;
  prefix: string;
}

export interface OpfsChunkValue {
  index: number;
  chunk: Blob;
  timestamp: number | null;
}

type WritableChunkValue = { chunk: Blob };

const errorName = (error: unknown): string | undefined =>
  error instanceof DOMException || error instanceof Error
    ? error.name
    : undefined;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runtimeSendMessage = (message: unknown): void => {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome?: { runtime?: { sendMessage?: (value: unknown) => unknown } };
  }).chrome;
  chromeApi?.runtime?.sendMessage?.(message);
};

const opfsDiag = (
  event: string,
  data: Record<string, unknown> = {},
): void => {
  try {
    runtimeSendMessage({
      type: "diag-forward",
      event: `opfs-recorder-${event}`,
      data,
    });
  } catch {}
};

const safeRemove = async (
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> => {
  try {
    await parent.removeEntry(name);
  } catch (err) {
    if (errorName(err) !== "NotFoundError") throw err;
  }
};

export class OpfsKvStore {
  readonly sessionId: string;
  readonly track: string;
  readonly prefix: string;
  private _dirPromise: Promise<FileSystemDirectoryHandle> | null;

  constructor({ sessionId, track, prefix }: OpfsKvStoreOptions) {
    if (!sessionId) throw new Error("OpfsKvStore: sessionId required");
    if (!track) throw new Error("OpfsKvStore: track required");
    if (!prefix) throw new Error("OpfsKvStore: prefix required");
    this.sessionId = sessionId;
    this.track = track;
    this.prefix = prefix;
    this._dirPromise = null;
  }

  private async _dir(
    options?: { create?: true },
  ): Promise<FileSystemDirectoryHandle>;
  private async _dir(
    options: { create: false },
  ): Promise<FileSystemDirectoryHandle | null>;
  private async _dir(
    { create = true }: { create?: boolean } = {},
  ): Promise<FileSystemDirectoryHandle | null> {
    if (this._dirPromise && create) return this._dirPromise;
    if (!create) {
      // read-only path. returns null if the tree doesn't exist so callers
      // can treat missing dirs as "no chunks".
      const root = await navigator.storage.getDirectory();
      const chunksRoot = await root
        .getDirectoryHandle(ROOT_DIR_NAME)
        .catch(() => null);
      if (!chunksRoot) return null;
      const session = await chunksRoot
        .getDirectoryHandle(this.sessionId)
        .catch(() => null);
      if (!session) return null;
      return session.getDirectoryHandle(this.track).catch(() => null);
    }
    if (!this._dirPromise) {
      this._dirPromise = (async () => {
        const root = await navigator.storage.getDirectory();
        const chunksRoot = await root.getDirectoryHandle(ROOT_DIR_NAME, {
          create: true,
        });
        const session = await chunksRoot.getDirectoryHandle(this.sessionId, {
          create: true,
        });
        return session.getDirectoryHandle(this.track, { create: true });
      })().catch((err) => {
        // Reset so retries can re-attempt; otherwise a transient init failure
        // poisons the instance permanently.
        this._dirPromise = null;
        throw err;
      });
    }
    return this._dirPromise;
  }

  private _keyToFile(key: string): string {
    if (key === "__probe") return PROBE_FILE;
    if (this.prefix && typeof key === "string" && key.startsWith(this.prefix)) {
      const tail = key.slice(this.prefix.length);
      if (/^\d+$/.test(tail)) return `${tail}.bin`;
    }
    // Fall back to a sanitized key for any non-numeric writes (e.g. probes
    // with custom keys); never used in steady state but keeps the adapter
    // permissive.
    const safe = String(key).replace(/[^A-Za-z0-9_-]/g, "_");
    return `${safe}.bin`;
  }

  private _fileToKey(name: string): string | null {
    if (name === PROBE_FILE) return "__probe";
    const m = name.match(CHUNK_FILE_RE);
    if (!m) return null;
    return `${this.prefix}${m[1]}`;
  }

  async setItem<T>(key: string, value: T): Promise<T> {
    const fileName = this._keyToFile(key);
    const dir = await this._dir();
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    try {
      if (
        typeof value === "object" &&
        value !== null &&
        "chunk" in value &&
        (value as WritableChunkValue).chunk instanceof Blob
      ) {
        await writable.write((value as WritableChunkValue).chunk);
      } else if (value instanceof Blob) {
        await writable.write(value);
      } else if (value !== undefined && value !== null) {
        // Probe path: just serialize whatever scalar/object the caller gave.
        await writable.write(JSON.stringify(value));
      }
    } finally {
      await writable.close();
    }
    return value;
  }

  async getItem(key: string): Promise<OpfsChunkValue | { ts: number } | null> {
    const fileName = this._keyToFile(key);
    const dir = await this._dir({ create: false });
    if (!dir) return null;
    let handle;
    try {
      handle = await dir.getFileHandle(fileName);
    } catch (err) {
      if (errorName(err) === "NotFoundError") return null;
      throw err;
    }
    const file = await handle.getFile();
    if (key === "__probe") {
      // Probe reads aren't load-bearing; return a placeholder.
      return { ts: 0 };
    }
    const m = fileName.match(CHUNK_FILE_RE);
    const index = m ? Number(m[1]) : 0;
    // File is itself a Blob; wrap so callers always get a stable Blob shape.
    const blob = file instanceof Blob ? file : new Blob([file]);
    return { index, chunk: blob, timestamp: null };
  }

  async removeItem(key: string): Promise<void> {
    const fileName = this._keyToFile(key);
    const dir = await this._dir({ create: false });
    if (!dir) return;
    await safeRemove(dir, fileName);
  }

  async iterate<T>(
    callback: (value: OpfsChunkValue, key: string, iterationNumber: number) => T,
  ): Promise<T | undefined> {
    const dir = await this._dir({ create: false });
    if (!dir) return undefined;
    const entries: Array<{
      name: string;
      index: number;
      key: string;
      handle: FileSystemFileHandle;
    }> = [];
    for await (const [name, handle] of dir.entries()) {
      if (name === PROBE_FILE) continue;
      if (handle.kind !== "file") continue;
      const m = name.match(CHUNK_FILE_RE);
      if (!m) continue;
      entries.push({
        name,
        index: Number(m[1]),
        key: `${this.prefix}${m[1]}`,
        handle: handle as FileSystemFileHandle,
      });
    }
    entries.sort((a, b) => a.index - b.index);
    let i = 0;
    for (const entry of entries) {
      const file = await entry.handle.getFile();
      const blob = file instanceof Blob ? file : new Blob([file]);
      const value = { index: entry.index, chunk: blob, timestamp: null };
      const result = callback(value, entry.key, ++i);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  async length(): Promise<number> {
    const dir = await this._dir({ create: false });
    if (!dir) return 0;
    let count = 0;
    for await (const [name] of dir.entries()) {
      if (name === PROBE_FILE) continue;
      if (!CHUNK_FILE_RE.test(name)) continue;
      count++;
    }
    return count;
  }

  async clear(): Promise<void> {
    const dir = await this._dir({ create: false });
    if (!dir) return;
    const names: string[] = [];
    for await (const [name] of dir.entries()) names.push(name);
    await Promise.all(names.map((n) => safeRemove(dir, n)));
  }

  // Local recorder helper: removes the track subdirectory. Call after a session
  // is fully torn down so the parent session dir can also be reaped by
  // destroySessionDir() once all tracks are gone.
  async destroyTrackDir(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const chunksRoot = await root.getDirectoryHandle(ROOT_DIR_NAME).catch(() => null);
      if (!chunksRoot) return;
      const session = await chunksRoot
        .getDirectoryHandle(this.sessionId)
        .catch(() => null);
      if (!session) return;
      await removeDirRecursive(session, this.track);
      this._dirPromise = null;
    } catch (err) {
      opfsDiag("destroy-track-failed", {
        sessionId: this.sessionId,
        track: this.track,
        error: errorMessage(err),
      });
    }
  }
}

// Manual recursive remove. Chrome's removeEntry({recursive: true}) is
// supposed to delete non-empty directories but in practice silently
// fails on some Chromium builds when subdirectories aren't fully empty
// (e.g. lingering __probe.bin or pending write handles). Walking the
// tree explicitly is slower but reliable.
const removeDirRecursive = async (
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> => {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await parent.getDirectoryHandle(name);
  } catch (err) {
    if (errorName(err) === "NotFoundError") return;
    throw err;
  }
  const childNames: string[] = [];
  for await (const [childName] of handle.entries()) childNames.push(childName);
  for (const childName of childNames) {
    let isDir = false;
    try {
      await handle.getDirectoryHandle(childName);
      isDir = true;
    } catch {}
    if (isDir) {
      await removeDirRecursive(handle, childName);
    } else {
      await handle.removeEntry(childName).catch(() => {});
    }
  }
  await parent.removeEntry(name).catch((err) => {
    opfsDiag("remove-entry-failed", {
      name,
      error: errorMessage(err),
    });
  });
};

// Best-effort whole-session cleanup. Call once after all per-track
// destroyTrackDir() complete (or independently for orphan reaping).
export const destroySessionDir = async (sessionId: string): Promise<void> => {
  if (!sessionId) return;
  try {
    const root = await navigator.storage.getDirectory();
    const chunksRoot = await root.getDirectoryHandle(ROOT_DIR_NAME).catch(() => null);
    if (!chunksRoot) return;
    await removeDirRecursive(chunksRoot, sessionId);
  } catch (err) {
    opfsDiag("destroy-session-failed", {
      sessionId,
      error: errorMessage(err),
    });
  }
};

// Lists session subdirectories under sayless-recorder-chunks/. Used by the background
// startup pass to find orphan sessions whose recorderSession is gone.
export const listSessionDirs = async (): Promise<string[]> => {
  try {
    const root = await navigator.storage.getDirectory();
    const chunksRoot = await root
      .getDirectoryHandle(ROOT_DIR_NAME)
      .catch(() => null);
    if (!chunksRoot) return [];
    const names: string[] = [];
    for await (const [name, handle] of chunksRoot.entries()) {
      if (handle.kind === "directory") names.push(name);
    }
    return names;
  } catch {
    return [];
  }
};

export const isOpfsSupported = (): boolean => {
  try {
    if (typeof navigator === "undefined") return false;
    if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
      return false;
    }
    if (typeof FileSystemFileHandle === "undefined") return false;
    if (
      typeof FileSystemFileHandle.prototype?.createWritable !== "function"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};
