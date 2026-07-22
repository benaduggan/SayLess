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

export type TranscriptionConfigLayer = Partial<TranscriptionConfig>;

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

const isRemoteModelPath = (value: unknown): boolean =>
  /^https?:\/\//i.test(String(value || ""));
const isBundledExtensionModelPath = (value: unknown): boolean =>
  /^chrome-extension:\/\/[^/]+\/assets\/whisper\/models\/?$/i.test(String(value || ""));

function enforceReleaseOfflineDefaults(
  config: TranscriptionConfig,
): TranscriptionConfig {
  if (allowRemoteModelOverrides()) return config;

  return {
    ...config,
    privacyMode: true,
    providerOptions: {
      ...(config.providerOptions || {}),
      "local-whisper": {
        ...(config.providerOptions?.["local-whisper"] || {}),
        allowRemoteModels: false,
      },
    },
  };
}

export const normalizeTranscriptionLanguage = (language: unknown): string => {
  const value = String(language || "auto").trim().toLowerCase();
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
function mergeConfigLayers(
  ...layers: Array<TranscriptionConfigLayer | null | undefined>
): TranscriptionConfig {
  const out: Record<string, unknown> & { providerOptions: ProviderOptions } = {
    providerOptions: {},
  };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (k === "providerOptions" && v && typeof v === "object") {
        for (const [pid, opts] of Object.entries(v)) {
          if (!opts || typeof opts !== "object" || Array.isArray(opts)) continue;
          const current = out.providerOptions[pid] || {};
          const next: Record<string, unknown> = { ...current, ...opts };
          if (
            pid === "local-whisper" &&
            !allowRemoteModelOverrides() &&
            isBundledExtensionModelPath(current.localModelPath) &&
            isRemoteModelPath(next.localModelPath)
          ) {
            next.localModelPath = current.localModelPath;
          }
          out.providerOptions[pid] = next;
        }
      } else if (v !== undefined) {
        out[k] = k === "defaultLanguage" ? normalizeTranscriptionLanguage(v) : v;
      }
    }
  }
  return out as unknown as TranscriptionConfig;
}

export function mergeConfig(
  ...layers: Array<TranscriptionConfigLayer | null | undefined>
): TranscriptionConfig {
  return enforceReleaseOfflineDefaults(mergeConfigLayers(...layers));
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
      stored = got?.[TRANSCRIPTION_STORAGE_KEY] || {};
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
  const stored = got?.[TRANSCRIPTION_STORAGE_KEY] || {};
  const nextStored = mergeConfigLayers(stored, patch);
  await chromeApi.storage.local.set({ [TRANSCRIPTION_STORAGE_KEY]: nextStored });
  return mergeConfig(DEFAULT_CONFIG, getBundledLocalWhisperOptions(), nextStored);
}
