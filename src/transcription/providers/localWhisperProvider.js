// Local, in-browser transcription (privacy-first, offline after first model load).
// Runs Whisper via transformers.js (ONNX runtime; WebGPU if available, else WASM).
//
// The model + runtime are lazy-imported so users who never transcribe pay
// nothing for the (large) dependency — same pattern as the mediabunny chunk.
//
// Offline note: the first run downloads the model and caches it in the browser
// (transformers.js uses the Cache API). Inference itself is fully local, so
// `requiresNetwork` is false. To be download-free even on first use, bundle the
// model under web_accessible_resources and point `env.localModelPath` at it.
//
// CSP: manifest already grants 'wasm-unsafe-eval', which the WASM backend needs.

import { blobToMono16k } from "../audio.js";

/** @typedef {import("../types.js").TranscriptionProvider} TranscriptionProvider */
/** @typedef {import("../types.js").Transcript} Transcript */

// Default model: the *_timestamped export, which includes the cross-attention
// outputs + alignment-head config that word-level timestamps (return_timestamps:
// "word") require. A plain whisper export throws "Model outputs must contain
// cross attentions". Override via providerOptions["local-whisper"].model.
const DEFAULT_MODEL = "onnx-community/whisper-base_timestamped";

let _pipelinePromise = null;

async function getTranscriber(opts, onProgress) {
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Cache models in the browser; allow bundled local models if configured.
    env.allowRemoteModels = opts.allowRemoteModels !== false;
    if (opts.localModelPath) {
      env.localModelPath = opts.localModelPath;
      env.allowLocalModels = true;
    }
    // The extension CSP (script-src 'self') blocks transformers' default
    // jsdelivr CDN import of the ONNX Runtime wasm/mjs. Serve them from the
    // bundled build/ort/ instead (copied by webpack). Single-threaded avoids
    // the SharedArrayBuffer / cross-origin-isolation requirement that extension
    // pages don't satisfy.
    try {
      // opts.wasmPaths lets a test harness point at an http-served copy; in the
      // extension we use the bundled build/ort/ via chrome.runtime.getURL.
      const wasmPaths =
        opts.wasmPaths ||
        (typeof chrome !== "undefined" && chrome.runtime?.getURL
          ? chrome.runtime.getURL("ort/")
          : undefined);
      if (wasmPaths) env.backends.onnx.wasm.wasmPaths = wasmPaths;
      env.backends.onnx.wasm.numThreads = 1;
    } catch {
      /* env shape differences across versions — best effort */
    }
    const model = opts.model || DEFAULT_MODEL;
    const device = opts.device || (await pickDevice());
    return pipeline("automatic-speech-recognition", model, {
      device,
      dtype: opts.dtype || (device === "webgpu" ? "fp16" : "q8"),
      progress_callback: (p) => {
        // model-load progress (0..1) — surface as early progress
        if (p?.progress != null) onProgress?.(Math.min(0.5, p.progress / 200));
      },
    });
  })().catch((err) => {
    _pipelinePromise = null; // allow retry after failure
    throw err;
  });
  return _pipelinePromise;
}

async function pickDevice() {
  // Default to wasm: reliable inside the extension's CSP/non-isolated context.
  // WebGPU can be opted in via providerOptions["local-whisper"].device="webgpu"
  // once verified on the target machines.
  return "wasm";
}

/**
 * Normalize transformers output to a flat word list.
 *  - word mode: each chunk is a single word with [start, end].
 *  - segment fallback: each chunk is a phrase; split into words and linearly
 *    interpolate timings across the phrase (approximate but usable).
 * @param {any} output @param {"word"|"segment"} mode @returns {Transcript}
 */
function normalize(output, mode) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  /** @type {{text:string,start:number,end:number}[]} */
  const words = [];
  for (const c of chunks) {
    const start = Number(c.timestamp?.[0] ?? 0);
    const end = Number(c.timestamp?.[1] ?? start);
    const text = (c.text || "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (mode === "word") {
      words.push({ text, start, end });
    } else {
      const toks = text.split(/\s+/).filter(Boolean);
      const span = Math.max(0, end - start) / toks.length;
      toks.forEach((tok, i) =>
        words.push({ text: tok, start: start + i * span, end: start + (i + 1) * span })
      );
    }
  }
  return { version: 1, language: "auto", words, providerId: "local-whisper" };
}

const isCrossAttnError = (e) =>
  /cross attention/i.test(String(e?.message || e));

/** @type {TranscriptionProvider} */
const localWhisperProvider = {
  id: "local-whisper",
  label: "On-device (Whisper)",
  requiresNetwork: false,

  async isAvailable() {
    // The dependency resolving is enough of an availability signal; actual
    // model fetch happens lazily on first transcribe.
    try {
      await import("@huggingface/transformers");
      return true;
    } catch {
      return false;
    }
  },

  async transcribe(input, opts = {}) {
    if (!input.blob) throw new Error("local-whisper: expects input.blob");
    const onProgress = input.onProgress;

    const { pcm } = await blobToMono16k(input.blob);
    onProgress?.(0.5);

    const transcriber = await getTranscriber(opts, onProgress);
    const language =
      input.language && input.language !== "auto" ? input.language : undefined;
    const base = { chunk_length_s: opts.chunkLengthS || 30, language };

    try {
      const output = await transcriber(pcm, { ...base, return_timestamps: "word" });
      onProgress?.(1);
      return normalize(output, "word");
    } catch (e) {
      // A non-timestamped model can't do word-level alignment. Degrade to
      // segment-level timestamps (always available) and interpolate words.
      if (!isCrossAttnError(e)) throw e;
      const output = await transcriber(pcm, { ...base, return_timestamps: true });
      onProgress?.(1);
      return normalize(output, "segment");
    }
  },
};

export default localWhisperProvider;
