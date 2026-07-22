import {
  LOCAL_WHISPER_ASSET_ROOT,
  LOCAL_WHISPER_MODEL_ID,
} from "./config.ts";

export const MODEL_STATUS_MANIFEST_PATH = "assets/whisper/model-manifest.json";

interface ModelStatusRuntime {
  runtime?: { getURL?: (path: string) => string };
}

export interface LocalWhisperManifest {
  schemaVersion: number;
  defaultModel: string;
  assetRoot: string;
  requiredFiles: string[];
}

const defaultRuntime = (): ModelStatusRuntime | undefined =>
  (globalThis as typeof globalThis & { chrome?: ModelStatusRuntime }).chrome;

export const resolveExtensionAssetUrl = (
  assetPath: string,
  runtime: ModelStatusRuntime | undefined = defaultRuntime(),
): string => {
  const getURL = runtime?.runtime?.getURL;
  return typeof getURL === "function" ? getURL(assetPath) : assetPath;
};

const normalizeAssetRoot = (assetRoot: unknown): string =>
  String(assetRoot || LOCAL_WHISPER_ASSET_ROOT).replace(/\/?$/, "/");

export const loadLocalWhisperManifest = async (
  runtime: ModelStatusRuntime | undefined = defaultRuntime(),
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<LocalWhisperManifest> => {
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
  const manifest = (await response.json()) as Record<string, unknown>;
  const requiredFiles = Array.isArray(manifest.requiredFiles)
    ? manifest.requiredFiles.map(String)
    : [];
  return {
    schemaVersion: Number(manifest.schemaVersion) || 1,
    defaultModel: String(manifest.defaultModel || LOCAL_WHISPER_MODEL_ID),
    assetRoot: normalizeAssetRoot(manifest.assetRoot),
    requiredFiles,
  };
};

const probeAsset = async (assetUrl: string, fetchImpl: typeof fetch) => {
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
  runtime = defaultRuntime(),
  fetchImpl = globalThis.fetch,
}: { runtime?: ModelStatusRuntime; fetchImpl?: typeof fetch } = {}) => {
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

    const results: Array<{
      file: string;
      assetPath: string;
      assetUrl: string;
      ok: boolean;
      bytes?: number;
      status?: number;
    }> = [];
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
      message:
        error instanceof Error ? error.message : String(error),
      requiredCount: 0,
      presentCount: 0,
      missingFiles: [],
      totalBytes: 0,
    };
  }
};
