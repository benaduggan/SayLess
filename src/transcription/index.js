// Transcription engine entry point. Callers use ONLY this module; they never
// import a concrete provider. Provider selection is config-driven and the set
// of providers is open (register more without touching callers).
//
// Usage:
//   import { transcribe } from "src/transcription";
//   const transcript = await transcribe({ blob, onProgress });

import { registerProvider, getProvider, listProviders } from "./registry.js";
import { resolveConfig } from "./config.js";
import remoteProvider from "./providers/remoteProvider.js";
import localWhisperProvider from "./providers/localWhisperProvider.js";

// Built-in providers. Additional ones (e.g. a different ASR vendor) can be
// registered by importing registerProvider elsewhere.
registerProvider(localWhisperProvider);
registerProvider(remoteProvider);

export { registerProvider, getProvider, listProviders };
export { resolveConfig } from "./config.js";

/**
 * Resolve the active provider per config, enforcing privacy mode.
 * @param {import("./config.js").TranscriptionConfig} [config]
 * @returns {Promise<{ provider: import("./types.js").TranscriptionProvider, options: object, config: import("./config.js").TranscriptionConfig }>}
 */
export async function getActiveProvider(config) {
  const cfg = config || (await resolveConfig());
  const provider = getProvider(cfg.providerId);
  if (!provider) {
    throw new Error(`transcription: unknown provider "${cfg.providerId}"`);
  }
  if (cfg.privacyMode && provider.requiresNetwork) {
    throw new Error(
      `transcription: provider "${provider.id}" needs network but privacyMode is on`
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
  return provider.transcribe({ ...input, language }, options);
}
