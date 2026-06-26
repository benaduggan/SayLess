// Provider registry. Providers register themselves by id; the engine selects
// one purely by config, never by hard-coded import. This is what makes
// transcription "agnostic / configurable" — swap providers without touching
// callers.

/** @typedef {import("./types.js").TranscriptionProvider} TranscriptionProvider */

/** @type {Map<string, TranscriptionProvider>} */
const providers = new Map();

/**
 * @param {TranscriptionProvider} provider
 */
export function registerProvider(provider) {
  if (!provider || !provider.id) {
    throw new Error("registerProvider: provider.id is required");
  }
  if (typeof provider.transcribe !== "function") {
    throw new Error(`registerProvider(${provider.id}): transcribe() required`);
  }
  providers.set(provider.id, provider);
}

/** @param {string} id @returns {TranscriptionProvider | undefined} */
export function getProvider(id) {
  return providers.get(id);
}

/** @returns {TranscriptionProvider[]} */
export function listProviders() {
  return [...providers.values()];
}

/** Test/HMR helper. */
export function _resetProviders() {
  providers.clear();
}
