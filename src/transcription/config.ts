// Config resolution for transcription. Precedence (low -> high):
//   1. built-in defaults
//   2. extension-bundled local model defaults
//   3. user/runtime settings persisted in chrome.storage.local under "transcription"
//
// Nothing here imports a specific provider — callers pass the resolved config
// to the engine, which looks the provider up in the registry by id.

export type ProviderOptions = Record<string, Record<string, unknown>>;

export interface TranscriptionConfig {
  providerId: string;
  privacyMode: boolean;
  defaultLanguage?: string;
  providerOptions: ProviderOptions;
}

export interface TranscriptionConfigLayer {
  providerId?: string;
  privacyMode?: boolean;
  defaultLanguage?: string;
  providerOptions?: ProviderOptions;
}

interface RuntimeWithGetUrl {
  runtime?: { getURL?: (path: string) => string };
}

interface TranscriptionChromeApi extends RuntimeWithGetUrl {
  storage?: {
    local?: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
  };
}

const getChromeApi = (): TranscriptionChromeApi | undefined =>
  (globalThis as typeof globalThis & { chrome?: TranscriptionChromeApi }).chrome;

export const LOCAL_WHISPER_MODEL_ID = "onnx-community/whisper-base_timestamped";
export const LOCAL_WHISPER_ASSET_ROOT = "assets/whisper/models/";
export const TRANSCRIPTION_STORAGE_KEY = "transcription";

export const TRANSCRIPTION_LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
];

const SUPPORTED_LANGUAGE_VALUES = new Set(
  TRANSCRIPTION_LANGUAGES.map((language) => language.value),
);

const allowRemoteModelOverrides = (): boolean =>
  typeof process !== "undefined" && process.env?.SAYLESS_DEV_MODE === "true";

const isRemoteModelPath = (value: unknown): boolean => /^https?:\/\//i.test(String(value || ""));
const isBundledExtensionModelPath = (value: unknown): boolean =>
  /^chrome-extension:\/\/[^/]+\/assets\/whisper\/models\/?$/i.test(String(value || ""));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const normalizeTranscriptionConfigLayer = (value: unknown): TranscriptionConfigLayer => {
  if (!isRecord(value)) return {};

  const layer: TranscriptionConfigLayer = {};
  if (typeof value.providerId === "string" && value.providerId.trim()) {
    layer.providerId = value.providerId.trim();
  }
  if (typeof value.privacyMode === "boolean") {
    layer.privacyMode = value.privacyMode;
  }
  if (typeof value.defaultLanguage === "string") {
    layer.defaultLanguage = normalizeTranscriptionLanguage(value.defaultLanguage);
  }
  if (isRecord(value.providerOptions)) {
    const providerOptions: ProviderOptions = {};
    for (const [providerId, options] of Object.entries(value.providerOptions)) {
      if (providerId && isRecord(options)) {
        providerOptions[providerId] = { ...options };
      }
    }
    layer.providerOptions = providerOptions;
  }
  return layer;
};

function enforceReleaseOfflineDefaults(config: TranscriptionConfig): TranscriptionConfig {
  if (allowRemoteModelOverrides()) return config;

  return {
    ...config,
    privacyMode: true,
    providerOptions: {
      ...config.providerOptions,
      "local-whisper": {
        ...config.providerOptions?.["local-whisper"],
        allowRemoteModels: false,
      },
    },
  };
}

export const normalizeTranscriptionLanguage = (language: unknown): string => {
  const value = String(language || "auto")
    .trim()
    .toLowerCase();
  return SUPPORTED_LANGUAGE_VALUES.has(value) ? value : "auto";
};

/** @type {TranscriptionConfig} */
export const DEFAULT_CONFIG: TranscriptionConfig = {
  providerId: "local-whisper",
  privacyMode: true,
  defaultLanguage: "auto",
  providerOptions: {
    "local-whisper": {
      allowRemoteModels: false,
      model: LOCAL_WHISPER_MODEL_ID,
    },
  },
};

/**
 * Deep-ish merge limited to the known shape (providerOptions merged per-key).
 * @param {...Partial<TranscriptionConfig>} layers
 * @returns {TranscriptionConfig}
 */
function mergeConfigLayers(...layers: unknown[]): TranscriptionConfigLayer {
  const out: TranscriptionConfigLayer = {};
  const providerOptions: ProviderOptions = {};
  let hasProviderOptions = false;

  for (const value of layers) {
    const layer = normalizeTranscriptionConfigLayer(value);
    if (layer.providerId !== undefined) out.providerId = layer.providerId;
    if (layer.privacyMode !== undefined) out.privacyMode = layer.privacyMode;
    if (layer.defaultLanguage !== undefined) {
      out.defaultLanguage = layer.defaultLanguage;
    }
    if (layer.providerOptions) {
      hasProviderOptions = true;
      for (const [providerId, options] of Object.entries(layer.providerOptions)) {
        const current = providerOptions[providerId] || {};
        const next = { ...current, ...options };
        if (
          providerId === "local-whisper" &&
          !allowRemoteModelOverrides() &&
          isBundledExtensionModelPath(current.localModelPath) &&
          isRemoteModelPath(next.localModelPath)
        ) {
          next.localModelPath = current.localModelPath;
        }
        providerOptions[providerId] = next;
      }
    }
  }
  if (hasProviderOptions) out.providerOptions = providerOptions;
  return out;
}

export function mergeConfig(...layers: unknown[]): TranscriptionConfig {
  const merged = mergeConfigLayers(...layers);
  return enforceReleaseOfflineDefaults({
    providerId: merged.providerId || DEFAULT_CONFIG.providerId,
    privacyMode: merged.privacyMode ?? DEFAULT_CONFIG.privacyMode,
    defaultLanguage: merged.defaultLanguage ?? DEFAULT_CONFIG.defaultLanguage,
    providerOptions: merged.providerOptions || {},
  });
}

export function getBundledLocalWhisperOptions(
  runtime: RuntimeWithGetUrl | undefined = getChromeApi(),
): TranscriptionConfigLayer {
  const getURL = runtime?.runtime?.getURL;
  if (typeof getURL !== "function") return {};
  return {
    providerOptions: {
      "local-whisper": {
        localModelPath: getURL(LOCAL_WHISPER_ASSET_ROOT),
      },
    },
  };
}

/**
 * Resolve the effective config. Reads chrome.storage.local("transcription")
 * when available; falls back to defaults otherwise (e.g. in tests).
 * @returns {Promise<TranscriptionConfig>}
 */
export async function resolveConfig(): Promise<TranscriptionConfig> {
  let stored: TranscriptionConfigLayer = {};
  try {
    const chromeApi = getChromeApi();
    if (chromeApi?.storage?.local) {
      const got = await chromeApi.storage.local.get(TRANSCRIPTION_STORAGE_KEY);
      stored = normalizeTranscriptionConfigLayer(got?.[TRANSCRIPTION_STORAGE_KEY]);
    }
  } catch {
    // ignore — fall back to defaults+env
  }
  return mergeConfig(DEFAULT_CONFIG, getBundledLocalWhisperOptions(), stored);
}

export async function saveTranscriptionSettings(
  patch: TranscriptionConfigLayer = {},
): Promise<TranscriptionConfig> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.storage?.local) {
    return mergeConfig(DEFAULT_CONFIG, patch);
  }
  const got = await chromeApi.storage.local.get(TRANSCRIPTION_STORAGE_KEY);
  const stored = normalizeTranscriptionConfigLayer(got?.[TRANSCRIPTION_STORAGE_KEY]);
  const nextStored = mergeConfigLayers(stored, patch);
  await chromeApi.storage.local.set({
    [TRANSCRIPTION_STORAGE_KEY]: nextStored,
  });
  return mergeConfig(DEFAULT_CONFIG, getBundledLocalWhisperOptions(), nextStored);
}
