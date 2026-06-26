// Config resolution for transcription. Precedence (low -> high):
//   1. built-in defaults
//   2. build-time env (webpack DefinePlugin: process.env.SCREENITY_TRANSCRIPTION_*)
//   3. user/runtime settings persisted in chrome.storage.local under "transcription"
//
// Nothing here imports a specific provider — callers pass the resolved config
// to the engine, which looks the provider up in the registry by id.

/**
 * @typedef {Object} TranscriptionConfig
 * @property {string} providerId          Which registered provider to use.
 * @property {boolean} privacyMode        If true, network providers are refused (local-only).
 * @property {string} [defaultLanguage]   "auto" or BCP-47.
 * @property {Object<string, object>} providerOptions  Per-provider opts keyed by provider id
 *                                        (e.g. { "remote-api": { endpoint, apiKey } }).
 */

/** @type {TranscriptionConfig} */
export const DEFAULT_CONFIG = {
  providerId: "local-whisper",
  privacyMode: true,
  defaultLanguage: "auto",
  providerOptions: {},
};

function envConfig() {
  /** @type {Partial<TranscriptionConfig>} */
  const env = {};
  // These are inlined by webpack DefinePlugin at build time; guard for undefined.
  const pid =
    typeof process !== "undefined" &&
    process.env &&
    process.env.SCREENITY_TRANSCRIPTION_PROVIDER;
  if (pid) env.providerId = pid;

  const endpoint =
    typeof process !== "undefined" &&
    process.env &&
    process.env.SCREENITY_TRANSCRIPTION_ENDPOINT;
  if (endpoint) {
    env.providerOptions = { "remote-api": { endpoint } };
  }
  return env;
}

/**
 * Deep-ish merge limited to the known shape (providerOptions merged per-key).
 * @param {...Partial<TranscriptionConfig>} layers
 * @returns {TranscriptionConfig}
 */
export function mergeConfig(...layers) {
  /** @type {any} */
  const out = { providerOptions: {} };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (k === "providerOptions" && v) {
        for (const [pid, opts] of Object.entries(v)) {
          out.providerOptions[pid] = { ...(out.providerOptions[pid] || {}), ...opts };
        }
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Resolve the effective config. Reads chrome.storage.local("transcription")
 * when available; falls back to defaults+env otherwise (e.g. in tests).
 * @returns {Promise<TranscriptionConfig>}
 */
export async function resolveConfig() {
  let stored = {};
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const got = await chrome.storage.local.get("transcription");
      stored = got?.transcription || {};
    }
  } catch {
    // ignore — fall back to defaults+env
  }
  return mergeConfig(DEFAULT_CONFIG, envConfig(), stored);
}
