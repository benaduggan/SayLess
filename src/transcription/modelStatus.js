import {
  LOCAL_WHISPER_ASSET_ROOT,
  LOCAL_WHISPER_MODEL_ID,
} from "./config.js";

export const MODEL_STATUS_MANIFEST_PATH = "assets/whisper/model-manifest.json";

export const resolveExtensionAssetUrl = (
  assetPath,
  runtime = globalThis.chrome,
) => {
  const getURL = runtime?.runtime?.getURL;
  return typeof getURL === "function" ? getURL(assetPath) : assetPath;
};

const normalizeAssetRoot = (assetRoot) =>
  String(assetRoot || LOCAL_WHISPER_ASSET_ROOT).replace(/\/?$/, "/");

export const loadLocalWhisperManifest = async (
  runtime = globalThis.chrome,
  fetchImpl = globalThis.fetch,
) => {
  if (typeof fetchImpl !== "function") {
    throw new Error("local-whisper-status: fetch unavailable");
  }
  const manifestUrl = resolveExtensionAssetUrl(MODEL_STATUS_MANIFEST_PATH, runtime);
  const response = await fetchImpl(manifestUrl, { cache: "no-store" });
  if (!response?.ok) {
    throw new Error(
      `local-whisper-status: missing model manifest (${response?.status || "unknown"})`,
    );
  }
  const manifest = await response.json();
  const requiredFiles = Array.isArray(manifest.requiredFiles)
    ? manifest.requiredFiles
    : [];
  return {
    schemaVersion: manifest.schemaVersion || 1,
    defaultModel: manifest.defaultModel || LOCAL_WHISPER_MODEL_ID,
    assetRoot: normalizeAssetRoot(manifest.assetRoot),
    requiredFiles,
  };
};

const probeAsset = async (assetUrl, fetchImpl) => {
  let response = await fetchImpl(assetUrl, { method: "HEAD", cache: "no-store" });
  if (response?.ok) return { ok: true, bytes: Number(response.headers?.get?.("content-length")) || 0 };
  if (response?.status === 405 || response?.status === 501) {
    response = await fetchImpl(assetUrl, { method: "GET", cache: "no-store" });
    if (response?.ok) {
      return {
        ok: true,
        bytes: Number(response.headers?.get?.("content-length")) || 0,
      };
    }
  }
  return {
    ok: false,
    status: response?.status || 0,
  };
};

export const checkLocalWhisperModelStatus = async ({
  runtime = globalThis.chrome,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof fetchImpl !== "function") {
    return {
      state: "failed",
      ready: false,
      message: "Model status unavailable in this browser context.",
      requiredCount: 0,
      presentCount: 0,
      missingFiles: [],
      totalBytes: 0,
    };
  }

  try {
    const manifest = await loadLocalWhisperManifest(runtime, fetchImpl);
    if (!manifest.requiredFiles.length) {
      return {
        state: "failed",
        ready: false,
        message: "Bundled model manifest has no required files.",
        manifest,
        requiredCount: 0,
        presentCount: 0,
        missingFiles: [],
        totalBytes: 0,
      };
    }

    const results = [];
    for (const file of manifest.requiredFiles) {
      const assetPath = `${manifest.assetRoot}${file}`;
      const assetUrl = resolveExtensionAssetUrl(assetPath, runtime);
      const probe = await probeAsset(assetUrl, fetchImpl);
      results.push({ file, assetPath, assetUrl, ...probe });
    }

    const missingFiles = results
      .filter((result) => !result.ok)
      .map((result) => result.file);
    const totalBytes = results.reduce(
      (sum, result) => sum + (Number(result.bytes) || 0),
      0,
    );
    const ready = missingFiles.length === 0;
    return {
      state: ready ? "ready" : "missing",
      ready,
      message: ready
        ? "Bundled Whisper model is ready."
        : `${missingFiles.length} bundled Whisper model files are missing.`,
      manifest,
      requiredCount: manifest.requiredFiles.length,
      presentCount: manifest.requiredFiles.length - missingFiles.length,
      missingFiles,
      totalBytes,
    };
  } catch (error) {
    return {
      state: "failed",
      ready: false,
      message: error?.message || String(error),
      requiredCount: 0,
      presentCount: 0,
      missingFiles: [],
      totalBytes: 0,
    };
  }
};
