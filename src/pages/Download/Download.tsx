import React, { useState, useCallback, useEffect } from "react";

import localforage from "localforage";
import { openExistingChunksStore } from "../Recorder/recorderStorage/chooseChunksStore";
import { destroySessionDir } from "../Recorder/recorderStorage/opfsKvStore";
import { assertLocalBlobUrl } from "../utils/localFileExport";
import type { ChunksBackend, RecorderTrack } from "../Recorder/recorderStorage/chooseChunksStore";

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "sayless",
  version: 1,
});

// Default IDB instances for legacy paths (recover-indexed-db, recover-indexed-db-mp4)
// that don't go through the recorder's per-session backend choice.
const chunksStore = localforage.createInstance({ name: "chunks" });
const cameraChunksStore = localforage.createInstance({ name: "cameraChunks" });
const audioChunksStore = localforage.createInstance({ name: "audioChunks" });

interface StoredChunk {
  chunk: Blob;
  index?: number;
}

interface RecoveryStore {
  iterate(callback: (value: StoredChunk, key: string, index: number) => void): Promise<unknown>;
  clear(): Promise<void>;
}

interface RecorderSessionData extends Record<string, unknown> {
  storageBackends?: Partial<Record<RecorderTrack, ChunksBackend>>;
  opfsSessionId?: string;
  id?: string;
  trackContainers?: Partial<Record<RecorderTrack, string>>;
  tracks?: Record<
    string,
    {
      uploader?: {
        journalKey?: string;
        journalLookupKey?: string;
        projectId?: string;
        sceneId?: string;
        type?: string;
        trackType?: string;
      };
    }
  >;
  projectId?: string;
}

interface DownloadMessage {
  type?: string;
  base64?: string;
  title?: unknown;
}

const asRecorderSession = (value: unknown): RecorderSessionData | null =>
  typeof value === "object" && value !== null ? (value as RecorderSessionData) : null;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const asRecoveryStore = (value: unknown): RecoveryStore => value as RecoveryStore;

const Download = (): React.JSX.Element => {
  const base64ToUint8Array = (base64: string): Blob => {
    const dataUrlRegex = /^data:(.*?);base64,/;
    const matches = base64.match(dataUrlRegex);
    if (matches !== null) {
      const mimeType = matches[1];
      const binaryString = atob(base64.slice(matches[0].length));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    } else {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: "video/webm" });
    }
  };

  // Mirror Sandbox/ContentState's sanitizeDownloadFilename. Covers C0/C1
  // controls (chrome.downloads rejects), trailing dots/spaces (Windows
  // reserves), empty result, and MAX_PATH length cap.
  const sanitizeFilename = (raw: unknown): string => {
    let out = String(raw ?? "");
    out = out.replace(/[/\\:?~<>|*"]/g, "_");
    out = out.replace(/[\u0000-\u001f\u007f]/g, "_");
    out = out.replace(/\s+/g, " ").trim();
    out = out.replace(/[. ]+$/g, "");
    if (!out) out = "SayLess recording";
    if (out.length > 200) out = out.slice(0, 200).trim();
    return out;
  };

  const handleMessage = useCallback((rawMessage: unknown): void => {
    const message = rawMessage as DownloadMessage;
    if (message.type === "download-video") {
      const base64 = message.base64;
      if (typeof base64 !== "string") return;
      const blob = base64ToUint8Array(base64);
      const title = sanitizeFilename(message.title);
      const url = assertLocalBlobUrl(URL.createObjectURL(blob));

      chrome.downloads
        .download({
          url: assertLocalBlobUrl(url),
          filename: title,
          saveAs: true,
        })
        .then(() => {
          URL.revokeObjectURL(assertLocalBlobUrl(url));
          window.close();
        });
    } else if (message.type === "recover-indexed-db" || message.type === "download-indexed-db") {
      const chunkArray: Blob[] = [];
      chunksStore
        .iterate<StoredChunk, void>((value) => {
          chunkArray.push(value.chunk);
        })
        .then(() => {
          const blob = new Blob(chunkArray, { type: "video/webm" });
          const url = assertLocalBlobUrl(URL.createObjectURL(blob));
          chrome.downloads
            .download({
              url: assertLocalBlobUrl(url),
              filename: "recovered-video.webm",
              saveAs: true,
            })
            .then(() => {
              URL.revokeObjectURL(assertLocalBlobUrl(url));
              window.close();
            });
        });
    } else if (message.type === "recover-local-indexed-db") {
      (async () => {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        let downloaded = 0;
        let recoveryFailed = false;
        // Revoke blob URLs only after every download has been queued.
        const urlsToRevoke: string[] = [];

        // Pick the right backend per track — sessions written before the
        // OPFS migration default to IDB across the board.
        const { recorderSession: rawPrefetchedSession } = await chrome.storage.local.get([
          "recorderSession",
        ]);
        const prefetchedSession = asRecorderSession(rawPrefetchedSession);
        const backends = prefetchedSession?.storageBackends || {
          screen: "idb",
          audio: "idb",
          camera: "idb",
        };
        const opfsSessionId = prefetchedSession?.opfsSessionId || prefetchedSession?.id || null;
        const usedOpfs = Object.values(backends).some((b) => b === "opfs");

        const screenStore = openExistingChunksStore({
          sessionId: opfsSessionId,
          track: "screen",
          backend: backends.screen || "idb",
        }).store;
        const cameraStore = openExistingChunksStore({
          sessionId: opfsSessionId,
          track: "camera",
          backend: backends.camera || "idb",
        }).store;
        const audioStore = openExistingChunksStore({
          sessionId: opfsSessionId,
          track: "audio",
          backend: backends.audio || "idb",
        }).store;

        // Per-track container drives the recovery-file extension. Sessions
        // recorded under WebCodecs put screen+camera in fragmented MP4;
        // older / fallback sessions stay on WebM. Audio stays on WebM.
        const containers = prefetchedSession?.trackContainers || {
          screen: "video/webm",
          camera: "video/webm",
          audio: "video/webm",
        };
        const containerToExt = (c: string | undefined): "mp4" | "webm" =>
          c === "video/mp4" ? "mp4" : "webm";
        const screenExt = containerToExt(containers.screen);
        const cameraExt = containerToExt(containers.camera);
        const audioExt = "webm";

        // Clear only tracks that actually downloaded — without this a
        // failing track keeps ALL chunks, so retry re-downloads the
        // successful ones too.
        const successfulStores: RecoveryStore[] = [];
        const downloadTrack = async (
          rawStore: unknown,
          label: string,
          mimeType: string,
          ext: string,
        ): Promise<void> => {
          const store = asRecoveryStore(rawStore);
          const entries: StoredChunk[] = [];
          await store.iterate((value) => {
            if (value?.chunk) entries.push(value);
          });
          entries.sort((a, b) => (a.index || 0) - (b.index || 0));
          if (!entries.length) {
            successfulStores.push(store);
            return;
          }
          try {
            const blob = new Blob(
              entries.map((e) => e.chunk),
              { type: mimeType },
            );
            const url = assertLocalBlobUrl(URL.createObjectURL(blob));
            urlsToRevoke.push(url);
            await chrome.downloads.download({
              url: assertLocalBlobUrl(url),
              filename: `SayLess-Recovery-${label}-${ts}.${ext}`,
              saveAs: false,
            });
            downloaded++;
            successfulStores.push(store);
          } catch (err) {
            recoveryFailed = true;
            console.error(`[SayLess][LocalRestore] ${label} track download failed`, err);
          }
        };

        await downloadTrack(screenStore, "Screen", containers.screen || "video/webm", screenExt);
        await downloadTrack(cameraStore, "Camera", containers.camera || "video/webm", cameraExt);
        await downloadTrack(audioStore, "Audio", "audio/webm", audioExt);

        // Let the download manager fetch the blob URLs first.
        await new Promise((r) => setTimeout(r, 2000));
        for (const u of urlsToRevoke) {
          try {
            URL.revokeObjectURL(assertLocalBlobUrl(u));
          } catch {}
        }

        // Failed tracks remain so the user can retry recovery for them.
        await Promise.allSettled(successfulStores.map((s) => s.clear()));

        // If anything was on OPFS, drop the session directory once all
        // tracks downloaded successfully; failed tracks leave their files
        // behind for retry, and the startup orphan sweep reaps them
        // eventually.
        if (usedOpfs && opfsSessionId && successfulStores.length === 3 && !recoveryFailed) {
          destroySessionDir(opfsSessionId).catch(() => {});
        }

        const { recorderSession: rawRecorderSession } = await chrome.storage.local.get([
          "recorderSession",
        ]);
        const recorderSession = asRecorderSession(rawRecorderSession);

        // Remove stale legacy scene/journal keys so the next local recording
        // cannot inherit stale crash-recovery metadata.
        const journalKeysToRemove = ["sceneId", "sceneIdStatus"];
        const tracks = recorderSession?.tracks || {};
        for (const trackData of Object.values(tracks)) {
          const upl = trackData?.uploader;
          if (!upl) continue;
          if (upl.journalKey) journalKeysToRemove.push(upl.journalKey);
          if (upl.journalLookupKey) journalKeysToRemove.push(upl.journalLookupKey);
          const pid = upl.projectId || recorderSession?.projectId || null;
          const sid = upl.sceneId || null;
          const t = upl.type || upl.trackType || null;
          if (pid && t) {
            journalKeysToRemove.push(`bunnyVideoMap-${pid}-${sid || "none"}-${t || "none"}`);
          }
        }
        try {
          await chrome.storage.local.remove([...new Set(journalKeysToRemove)]);
        } catch (err) {
          console.warn("[SayLess][LocalRestore] failed to remove stale journal keys", err);
        }

        if (recorderSession && !recoveryFailed) {
          await chrome.storage.local.set({
            recorderSession: {
              ...recorderSession,
              status: "recovered",
              recoveredAt: Date.now(),
            },
          });
        }

        if (downloaded > 0 && !recoveryFailed) window.close();
      })();
    } else if (message.type === "recover-indexed-db-mp4") {
      // Bytes can live in OPFS (WebCodecs path) or IDB (legacy MR fast-mp4).
      // Before this branch, the IDB-only iterate produced a 0-byte file when
      // the source was OPFS — the "Download anyway" button on the hard-fail
      // modal silently failed.
      (async () => {
        let blob: Blob | null = null;
        try {
          const { lastRecordingBackendRef: rawBackendRef } = await chrome.storage.local.get([
            "lastRecordingBackendRef",
          ]);
          const lastRecordingBackendRef = asRecord(rawBackendRef);
          if (
            lastRecordingBackendRef.backend === "opfs" &&
            typeof lastRecordingBackendRef.fileName === "string"
          ) {
            try {
              const dir = await navigator.storage.getDirectory();
              const handle = await dir.getFileHandle(lastRecordingBackendRef.fileName);
              const file = await handle.getFile();
              if (file && file.size > 0) {
                blob = new Blob([file], { type: "video/mp4" });
              }
            } catch (err) {
              console.warn("[SayLess][Download] OPFS read failed, falling back to IDB", err);
            }
          }
          if (!blob) {
            const chunkArray: Array<{ index: number; chunk: Blob }> = [];
            await chunksStore.iterate<StoredChunk, void>((value) => {
              if (value && typeof value.index === "number" && value.chunk) {
                chunkArray.push({ index: value.index, chunk: value.chunk });
              }
            });
            chunkArray.sort((a, b) => a.index - b.index);
            if (chunkArray.length > 0) {
              blob = new Blob(
                chunkArray.map((entry) => entry.chunk),
                { type: "video/mp4" },
              );
            }
          }
        } catch (err) {
          console.error("[SayLess][Download] recovery failed", err);
        }
        if (!blob || blob.size === 0) {
          console.warn("[SayLess][Download] no bytes available to download");
          window.close();
          return;
        }
        const url = assertLocalBlobUrl(URL.createObjectURL(blob));
        const filename = `sayless-recording-${Date.now()}.mp4`;
        try {
          await chrome.downloads.download({
            url: assertLocalBlobUrl(url),
            filename,
            saveAs: true,
          });
        } finally {
          URL.revokeObjectURL(assertLocalBlobUrl(url));
          window.close();
        }
      })();
    }
  }, []);

  useEffect(() => {
    const listener = (message: unknown): void => {
      handleMessage(message);
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [handleMessage]);

  return <div></div>;
};

export default Download;
