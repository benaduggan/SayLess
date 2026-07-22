// Extract mono 16 kHz PCM (Float32) from a recording blob — the input format
// Whisper expects. Uses WebAudio decode + OfflineAudioContext resample, which
// handles Chrome's MP4/AAC and WebM/Opus recordings (the two formats this
// extension produces).
//
// Note: decodeAudioData loads the whole audio into memory. For very long
// recordings we may later switch to a streaming demux via mediabunny (already a
// dep, used by the editor). Fine for typical clips.

const WHISPER_SAMPLE_RATE = 16000;

export interface WhisperAudio {
  pcm: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * @param {Blob} blob video/audio blob
 * @returns {Promise<{ pcm: Float32Array, sampleRate: number, duration: number }>}
 */
export async function blobToMono16k(blob: Blob): Promise<WhisperAudio> {
  const arrayBuffer = await blob.arrayBuffer();

  const audioGlobal = self as typeof self & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioCtx = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
  if (!AudioCtx) throw new Error("audio: WebAudio not available");

  const decodeCtx = new AudioCtx();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close?.();
  }

  if (!decoded || decoded.length === 0) {
    throw new Error("audio: no decodable audio track in recording");
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded; // OfflineAudioContext downmixes to mono via the 1-ch destination
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();

  return {
    pcm: rendered.getChannelData(0),
    sampleRate: WHISPER_SAMPLE_RATE,
    duration: decoded.duration,
  };
}
