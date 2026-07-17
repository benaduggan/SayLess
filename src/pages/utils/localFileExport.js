export const hasFileSystemSavePicker = () =>
  typeof window !== "undefined" &&
  typeof window.showSaveFilePicker === "function";

export const assertLocalBlobUrl = (url) => {
  if (typeof url !== "string" || !url.startsWith("blob:")) {
    throw new Error("Expected local blob URL.");
  }
  return url;
};

const extensionFromFileName = (fileName) => {
  const match = String(fileName || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
};

const mimeForFileName = (fileName, fallback = "application/octet-stream") => {
  const ext = extensionFromFileName(fileName);
  if (ext === "mp4" || ext === "m4a") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "gif") return "image/gif";
  if (ext === "wav") return "audio/wav";
  if (ext === "vtt") return "text/vtt";
  if (ext === "json") return "application/json";
  return fallback;
};

export const buildSavePickerOptions = (fileName, blobType = "") => {
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

export const saveBlobWithPicker = async (blob, fileName) => {
  if (!hasFileSystemSavePicker()) return { saved: false, reason: "unsupported" };
  if (!blob || !fileName) return { saved: false, reason: "missing-input" };

  try {
    const handle = await window.showSaveFilePicker(
      buildSavePickerOptions(fileName, blob.type),
    );
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return { saved: true, fileName };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { saved: false, reason: "cancelled" };
    }
    throw err;
  }
};

export const downloadBlobWithChrome = async (blob, fileName) => {
  if (!blob || !fileName) return null;
  const downloadUrl = assertLocalBlobUrl(URL.createObjectURL(blob));
  try {
    return await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: assertLocalBlobUrl(downloadUrl), filename: fileName, saveAs: true },
        (id) => {
          const lastErr = chrome.runtime.lastError;
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
  blob,
  fileName,
  { preferPicker = false } = {},
) => {
  if (preferPicker && hasFileSystemSavePicker()) {
    try {
      const pickerResult = await saveBlobWithPicker(blob, fileName);
      if (pickerResult.saved || pickerResult.reason === "cancelled") {
        return pickerResult;
      }
    } catch (err) {
      console.warn?.(
        "[SayLess] Save picker failed, falling back to Chrome download.",
        err,
      );
    }
  }
  const downloadId = await downloadBlobWithChrome(blob, fileName);
  return downloadId
    ? { saved: true, downloadId, fileName }
    : { saved: false, reason: "cancelled" };
};
