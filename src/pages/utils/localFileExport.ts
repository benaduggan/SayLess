export interface SavePickerOptions {
  suggestedName: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

interface SaveFileHandleLike {
  createWritable: () => Promise<{
    write: (blob: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface SavePickerWindow {
  showSaveFilePicker?: (options: SavePickerOptions) => Promise<SaveFileHandleLike>;
}

interface DownloadChromeApi {
  downloads: {
    download: (
      options: { url: string; filename: string; saveAs: boolean },
      callback: (id?: number) => void,
    ) => void;
  };
  runtime: { lastError?: { message?: string } };
}

export type SaveBlobResult =
  | { saved: true; fileName: string; downloadId?: number }
  | { saved: false; reason: "unsupported" | "missing-input" | "cancelled" };

const pickerWindow = (): SavePickerWindow | undefined =>
  typeof window === "undefined" ? undefined : (window as SavePickerWindow);

const downloadChrome = (): DownloadChromeApi =>
  (globalThis as typeof globalThis & { chrome: DownloadChromeApi }).chrome;

export const hasFileSystemSavePicker = (): boolean =>
  typeof pickerWindow()?.showSaveFilePicker === "function";

export const assertLocalBlobUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url.startsWith("blob:")) {
    throw new Error("Expected local blob URL.");
  }
  return url;
};

const extensionFromFileName = (fileName: unknown): string => {
  const match = String(fileName || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
};

const mimeForFileName = (fileName: unknown, fallback = "application/octet-stream"): string => {
  const ext = extensionFromFileName(fileName);
  if (ext === "mp4" || ext === "m4a") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "gif") return "image/gif";
  if (ext === "wav") return "audio/wav";
  if (ext === "vtt") return "text/vtt";
  if (ext === "json") return "application/json";
  return fallback;
};

export const buildSavePickerOptions = (fileName: string, blobType = ""): SavePickerOptions => {
  const ext = extensionFromFileName(fileName);
  const mime = blobType || mimeForFileName(fileName);
  return {
    suggestedName: fileName || "SayLess export",
    types: ext
      ? [
          {
            description: "SayLess export",
            accept: {
              [mime]: [`.${ext}`],
            },
          },
        ]
      : undefined,
  };
};

export const saveBlobWithPicker = async (
  blob: Blob | null,
  fileName: string,
): Promise<SaveBlobResult> => {
  if (!hasFileSystemSavePicker()) return { saved: false, reason: "unsupported" };
  if (!blob || !fileName) return { saved: false, reason: "missing-input" };

  try {
    const showSaveFilePicker = pickerWindow()?.showSaveFilePicker;
    if (!showSaveFilePicker) return { saved: false, reason: "unsupported" };
    const handle = await showSaveFilePicker(buildSavePickerOptions(fileName, blob.type));
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return { saved: true, fileName };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { saved: false, reason: "cancelled" };
    }
    throw err;
  }
};

export const downloadBlobWithChrome = async (
  blob: Blob | null,
  fileName: string,
): Promise<number | null> => {
  if (!blob || !fileName) return null;
  const downloadUrl = assertLocalBlobUrl(URL.createObjectURL(blob));
  try {
    return await new Promise<number | null>((resolve, reject) => {
      const chromeApi = downloadChrome();
      chromeApi.downloads.download(
        { url: assertLocalBlobUrl(downloadUrl), filename: fileName, saveAs: true },
        (id) => {
          const lastErr = chromeApi.runtime.lastError;
          const errMsg = String(lastErr?.message || "");
          if (errMsg.includes("USER_CANCELED") || errMsg.includes("canceled")) {
            resolve(null);
            return;
          }
          if (lastErr || !id) {
            reject(lastErr || new Error("Download failed"));
          } else {
            resolve(id);
          }
        },
      );
    });
  } finally {
    URL.revokeObjectURL(downloadUrl);
  }
};

export const saveOrDownloadBlob = async (
  blob: Blob | null,
  fileName: string,
  { preferPicker = false }: { preferPicker?: boolean } = {},
): Promise<SaveBlobResult> => {
  if (preferPicker && hasFileSystemSavePicker()) {
    try {
      const pickerResult = await saveBlobWithPicker(blob, fileName);
      if (pickerResult.saved || pickerResult.reason === "cancelled") {
        return pickerResult;
      }
    } catch (err) {
      console.warn?.("[SayLess] Save picker failed, falling back to Chrome download.", err);
    }
  }
  const downloadId = await downloadBlobWithChrome(blob, fileName);
  return downloadId ? { saved: true, downloadId, fileName } : { saved: false, reason: "cancelled" };
};
