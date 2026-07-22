// Provider registry. Providers register themselves by id; the engine selects
// one purely by config, never by hard-coded import. This is what makes
// transcription "agnostic / configurable" — swap providers without touching
// callers.

import type { TranscriptionProvider } from "./types.ts";

/** @type {Map<string, TranscriptionProvider>} */
const providers = new Map<string, TranscriptionProvider>();

/**
 * @param {TranscriptionProvider} provider
 */
export function registerProvider(provider: TranscriptionProvider): void {
  if (!provider || !provider.id) {
    throw new Error("registerProvider: provider.id is required");
  }
  if (typeof provider.transcribe !== "function") {
    throw new Error(`registerProvider(${provider.id}): transcribe() required`);
  }
  providers.set(provider.id, provider);
}

/** @param {string} id @returns {TranscriptionProvider | undefined} */
export function getProvider(id: string): TranscriptionProvider | undefined {
  return providers.get(id);
}

/** @returns {TranscriptionProvider[]} */
export function listProviders(): TranscriptionProvider[] {
  return [...providers.values()];
}

/** Test/HMR helper. */
export function _resetProviders(): void {
  providers.clear();
}
