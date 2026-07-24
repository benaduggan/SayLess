// Local, in-browser transcription (privacy-first, offline-capable).
// Runs Whisper via transformers.js (ONNX runtime; WebGPU if available, else WASM).
//
// The model + runtime are lazy-imported so users who never transcribe pay
// nothing for the (large) dependency — same pattern as the mediabunny chunk.
//
// Offline note: release defaults disable remote model downloads. The default
// config points env.localModelPath at assets/whisper/models/ inside the
// extension package.
//
// CSP: manifest already grants 'wasm-unsafe-eval', which the WASM backend needs.

import { blobToMono16k } from "../audio.ts";
import { classifyTranscriptionError } from "../errors.ts";
import type {
  Transcript,
  TranscriptionProvider,
  TranscriptionProviderOptions,
  Word,
} from "../types.ts";
import type {
  AutomaticSpeechRecognitionPipelineType,
  DataType,
  DeviceType,
} from "@huggingface/transformers";

// Default model: the *_timestamped export, which includes the cross-attention
// outputs + alignment-head config that word-level timestamps (return_timestamps:
// "word") require. A plain whisper export throws "Model outputs must contain
// cross attentions". Override via providerOptions["local-whisper"].model.
const DEFAULT_MODEL = "onnx-community/whisper-base_timestamped";

type ProgressCallback = (progress: number) => void;
type WhisperTranscriber = AutomaticSpeechRecognitionPipelineType;

let _pipelinePromise: Promise<WhisperTranscriber> | null = null;

export const normalizeWhisperDevice = (value: unknown): DeviceType | null => {
  switch (value) {
    case "auto":
    case "gpu":
    case "cpu":
    case "wasm":
    case "webgpu":
    case "cuda":
    case "dml":
    case "webnn":
    case "webnn-npu":
    case "webnn-gpu":
    case "webnn-cpu":
      return value;
    default:
      return null;
  }
};

export const normalizeWhisperDataType = (value: unknown): DataType | null => {
  switch (value) {
    case "auto":
    case "fp32":
    case "fp16":
    case "q8":
    case "int8":
    case "uint8":
    case "q4":
    case "bnb4":
    case "q4f16":
      return value;
    default:
      return null;
  }
};

async function getTranscriber(
  opts: TranscriptionProviderOptions,
  onProgress?: ProgressCallback,
): Promise<WhisperTranscriber> {
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const allowRemoteModels = opts.allowRemoteModels === true;
    if (!allowRemoteModels && !opts.localModelPath) {
      throw new Error(
        "local-whisper: no local model path configured. Bundle assets/whisper/models or explicitly allowRemoteModels for a development harness.",
      );
    }
    const { pipeline, env } = await import("@huggingface/transformers");
    // Release builds should load extension-bundled models only. Network model
    // fetches are available solely when a harness or custom config opts in.
    env.allowRemoteModels = allowRemoteModels;
    if (typeof opts.localModelPath === "string" && opts.localModelPath) {
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
      const chromeApi = (
        globalThis as typeof globalThis & {
          chrome?: { runtime?: { getURL?: (path: string) => string } };
        }
      ).chrome;
      const wasmPaths =
        (typeof opts.wasmPaths === "string" && opts.wasmPaths) ||
        chromeApi?.runtime?.getURL?.("ort/");
      const wasmBackend = env.backends.onnx.wasm;
      if (wasmBackend) {
        if (wasmPaths) wasmBackend.wasmPaths = wasmPaths;
        wasmBackend.numThreads = 1;
      }
    } catch {
      /* env shape differences across versions — best effort */
    }
    const model = typeof opts.model === "string" ? opts.model : DEFAULT_MODEL;
    const device = normalizeWhisperDevice(opts.device) || (await pickDevice());
    return pipeline("automatic-speech-recognition", model, {
      device,
      dtype: normalizeWhisperDataType(opts.dtype) || (device === "webgpu" ? "fp16" : "q8"),
      progress_callback: (p: unknown) => {
        // model-load progress (0..1) — surface as early progress
        const progress =
          typeof p === "object" && p !== null && "progress" in p
            ? Number((p as { progress?: unknown }).progress)
            : NaN;
        if (Number.isFinite(progress)) onProgress?.(Math.min(0.5, progress / 200));
      },
    });
  })().catch((err) => {
    _pipelinePromise = null; // allow retry after failure
    throw classifyTranscriptionError(err, { phase: "model-load" });
  });
  return _pipelinePromise;
}

async function pickDevice(): Promise<DeviceType> {
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
 * @param {unknown} output @param {"word"|"segment"} mode @returns {Transcript}
 */
function normalize(output: unknown, mode: "word" | "segment"): Transcript {
  const chunks =
    typeof output === "object" &&
    output !== null &&
    "chunks" in output &&
    Array.isArray((output as { chunks?: unknown }).chunks)
      ? (output as { chunks: unknown[] }).chunks
      : [];
  const words: Word[] = [];
  for (const c of chunks) {
    if (!c || typeof c !== "object") continue;
    const chunk = c as { timestamp?: unknown; text?: unknown };
    const timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
    const start = Number(timestamp[0] ?? 0);
    const end = Number(timestamp[1] ?? start);
    const text = String(chunk.text || "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (mode === "word") {
      words.push({ text, start, end });
    } else {
      const toks = text.split(/\s+/).filter(Boolean);
      const span = Math.max(0, end - start) / toks.length;
      toks.forEach((tok, i) =>
        words.push({ text: tok, start: start + i * span, end: start + (i + 1) * span }),
      );
    }
  }
  return { version: 1, language: "auto", words, providerId: "local-whisper" };
}

const isCrossAttnError = (error: unknown): boolean =>
  /cross attention/i.test(String(error instanceof Error ? error.message : error));

const localWhisperProvider: TranscriptionProvider = {
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

    let audio;
    try {
      audio = await blobToMono16k(input.blob);
    } catch (err) {
      throw classifyTranscriptionError(err, { phase: "audio-decode" });
    }
    const { pcm, duration } = audio;
    if (
      Number.isFinite(Number(opts.maxDurationSeconds)) &&
      duration > Number(opts.maxDurationSeconds)
    ) {
      throw classifyTranscriptionError(
        new Error(
          `recording too long: ${Math.round(duration)}s exceeds ${Math.round(
            Number(opts.maxDurationSeconds),
          )}s`,
        ),
        { phase: "audio-decode", durationSeconds: duration },
      );
    }
    onProgress?.(0.5);

    const transcriber = await getTranscriber(opts, onProgress);
    const language = input.language && input.language !== "auto" ? input.language : undefined;
    const base = {
      chunk_length_s: Number(opts.chunkLengthS) || 30,
      language,
    };

    try {
      const output = await transcriber(pcm, { ...base, return_timestamps: "word" });
      onProgress?.(1);
      return normalize(output, "word");
    } catch (e) {
      // A non-timestamped model can't do word-level alignment. Degrade to
      // segment-level timestamps (always available) and interpolate words.
      if (isCrossAttnError(e)) {
        try {
          const output = await transcriber(pcm, { ...base, return_timestamps: true });
          onProgress?.(1);
          return normalize(output, "segment");
        } catch (fallbackError) {
          throw classifyTranscriptionError(fallbackError, { phase: "inference" });
        }
      }
      throw classifyTranscriptionError(e, { phase: "inference" });
    }
  },
};

export default localWhisperProvider;
