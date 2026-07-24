// Transcription engine entry point. Callers use ONLY this module; they never
// import a concrete provider. Provider selection is config-driven and the set
// of providers is open (register more without touching callers).
//
// Usage:
//   import { transcribe } from "src/transcription";
//   const transcript = await transcribe({ blob, onProgress });

import { registerProvider, getProvider, listProviders } from "./registry.ts";
import { DEFAULT_CONFIG, mergeConfig, resolveConfig } from "./config.ts";
import { classifyTranscriptionError } from "./errors.ts";
import localWhisperProvider from "./providers/localWhisperProvider.ts";
import type { TranscriptionConfig } from "./config.ts";
import type {
  TranscribeInput,
  Transcript,
  TranscriptionProvider,
  TranscriptionProviderOptions,
} from "./types.ts";

// Built-in providers stay local-only. Additional providers can still be
// registered by tests or custom forks, but release builds do not ship a remote
// transcription client.
registerProvider(localWhisperProvider);

export { registerProvider, getProvider, listProviders };
export { resolveConfig } from "./config.ts";
export {
  TRANSCRIPTION_ERROR_CODES,
  TranscriptionError,
  classifyTranscriptionError,
  formatTranscriptionError,
  isTranscriptionError,
} from "./errors.ts";

/**
 * Resolve the active provider per config, enforcing privacy mode.
 * @param {import("./config.ts").TranscriptionConfig} [config]
 * @returns {Promise<{ provider: import("./types.ts").TranscriptionProvider, options: object, config: import("./config.ts").TranscriptionConfig }>}
 */
export async function getActiveProvider(config?: TranscriptionConfig): Promise<{
  provider: TranscriptionProvider;
  options: TranscriptionProviderOptions;
  config: TranscriptionConfig;
}> {
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
      new Error(`transcription: provider "${provider.id}" needs network but privacyMode is on`),
      { phase: "provider" },
    );
  }
  const options = cfg.providerOptions?.[provider.id] || {};
  return { provider, options, config: cfg };
}

/**
 * Transcribe media using the configured provider.
 * @param {import("./types.ts").TranscribeInput} input
 * @param {import("./config.ts").TranscriptionConfig} [config]
 * @returns {Promise<import("./types.ts").Transcript>}
 */
export async function transcribe(
  input: TranscribeInput,
  config?: TranscriptionConfig,
): Promise<Transcript> {
  const { provider, options, config: cfg } = await getActiveProvider(config);
  const language = input.language || cfg.defaultLanguage;
  try {
    return await provider.transcribe({ ...input, language }, options);
  } catch (error) {
    throw classifyTranscriptionError(error, { phase: "transcribe" });
  }
}
