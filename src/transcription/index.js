// Transcription engine entry point. Callers use ONLY this module; they never
// import a concrete provider. Provider selection is config-driven and the set
// of providers is open (register more without touching callers).
//
// Usage:
//   import { transcribe } from "src/transcription";
//   const transcript = await transcribe({ blob, onProgress });

import { registerProvider, getProvider, listProviders } from "./registry.js";
import { DEFAULT_CONFIG, mergeConfig, resolveConfig } from "./config.js";
import { classifyTranscriptionError } from "./errors.js";
import localWhisperProvider from "./providers/localWhisperProvider.js";

// Built-in providers stay local-only. Additional providers can still be
// registered by tests or custom forks, but release builds do not ship a remote
// transcription client.
registerProvider(localWhisperProvider);

export { registerProvider, getProvider, listProviders };
export { resolveConfig } from "./config.js";
export {
  TRANSCRIPTION_ERROR_CODES,
  TranscriptionError,
  classifyTranscriptionError,
  formatTranscriptionError,
  isTranscriptionError,
} from "./errors.js";

/**
 * Resolve the active provider per config, enforcing privacy mode.
 * @param {import("./config.js").TranscriptionConfig} [config]
 * @returns {Promise<{ provider: import("./types.js").TranscriptionProvider, options: object, config: import("./config.js").TranscriptionConfig }>}
 */
export async function getActiveProvider(config) {
  const cfg = config ? mergeConfig(DEFAULT_CONFIG, config) : await resolveConfig();
  const provider = getProvider(cfg.providerId);
  if (!provider) {
    throw classifyTranscriptionError(
      new Error(`transcription: unknown provider "${cfg.providerId}"`),
      { phase: "provider" },
    );
  }
  if (cfg.privacyMode && provider.requiresNetwork) {
    throw classifyTranscriptionError(
      new Error(
        `transcription: provider "${provider.id}" needs network but privacyMode is on`,
      ),
      { phase: "provider" },
    );
  }
  const options = cfg.providerOptions?.[provider.id] || {};
  return { provider, options, config: cfg };
}

/**
 * Transcribe media using the configured provider.
 * @param {import("./types.js").TranscribeInput} input
 * @param {import("./config.js").TranscriptionConfig} [config]
 * @returns {Promise<import("./types.js").Transcript>}
 */
export async function transcribe(input, config) {
  const { provider, options, config: cfg } = await getActiveProvider(config);
  const language = input.language || cfg.defaultLanguage;
  try {
    return await provider.transcribe({ ...input, language }, options);
  } catch (error) {
    throw classifyTranscriptionError(error, { phase: "transcribe" });
  }
}
