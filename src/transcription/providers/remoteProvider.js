// Config-driven remote transcription provider. Talks to OUR backend (or any
// endpoint that returns word-level timings). Deliberately schema-light so it
// can adapt to whatever ASR backend we stand up.
//
// Expected response JSON (normalized below if shapes differ slightly):
//   { language, words: [{ text|word, start, end, confidence? }] }
//
// This provider is network-bound and is refused when privacyMode is on
// (enforced by the engine, but also self-declares requiresNetwork).

/** @typedef {import("../types.js").TranscriptionProvider} TranscriptionProvider */
/** @typedef {import("../types.js").Transcript} Transcript */

/** @param {any} raw @param {string} providerId @returns {Transcript} */
function normalize(raw, providerId) {
  const rawWords = Array.isArray(raw?.words) ? raw.words : [];
  const words = rawWords
    .map((w) => ({
      text: w.text ?? w.word ?? "",
      start: Number(w.start ?? w.startTime ?? 0),
      end: Number(w.end ?? w.endTime ?? 0),
      confidence: w.confidence != null ? Number(w.confidence) : undefined,
    }))
    .filter((w) => w.text !== "" && Number.isFinite(w.start) && Number.isFinite(w.end));
  return {
    version: 1,
    language: raw?.language || "auto",
    words,
    providerId,
  };
}

/** @type {TranscriptionProvider} */
const remoteProvider = {
  id: "remote-api",
  label: "Remote API (our backend)",
  requiresNetwork: true,

  async isAvailable(opts = {}) {
    return Boolean(opts.endpoint);
  },

  async transcribe(input, opts = {}) {
    const endpoint = opts.endpoint;
    if (!endpoint) throw new Error("remote-api: no endpoint configured");
    if (!input.blob) throw new Error("remote-api: expects input.blob");

    const form = new FormData();
    form.append("audio", input.blob, "audio");
    if (input.language) form.append("language", input.language);

    const headers = {};
    if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

    const res = await fetch(endpoint, {
      method: "POST",
      body: form,
      headers,
      signal: input.signal,
    });
    if (!res.ok) {
      throw new Error(`remote-api: HTTP ${res.status}`);
    }
    const raw = await res.json();
    input.onProgress?.(1);
    return normalize(raw, "remote-api");
  },
};

export default remoteProvider;
