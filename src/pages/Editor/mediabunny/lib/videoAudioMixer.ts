// @ts-nocheck
import {
  Input,
  BlobSource,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  VideoSampleSource,
  AudioSampleSource,
  AudioSampleSink,
  VideoSampleSink,
  AudioSample,
  ALL_FORMATS,
  QUALITY_HIGH,
} from "mediabunny";
import { videoConverter } from "./videoConverter";

const AAC_SAMPLE_RATE = 48000;
const AAC_CHANNELS = 2;

export class VideoAudioMixer {
  async addAudio(
    videoBlob,
    audioBlob,
    {
      mode = "mix",
      videoVolume = 0.7,
      audioVolume = 0.3,
      loop = false,
      verbose = false,
      onProgress,
      signal,
    } = {}
  ) {
    throwIfAborted(signal);
    const input = new Input({
      source: new BlobSource(videoBlob),
      formats: ALL_FORMATS,
    });

    const outputTarget = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: outputTarget,
    });
    let outputStarted = false;
    let outputFinalized = false;

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      const videoSink = new VideoSampleSink(videoTrack);
      const codecInfo = await videoConverter.detectBestCodec("mp4");
      const videoCodec = codecInfo?.codec ?? "avc";
      const videoSource = new VideoSampleSource({
        codec: videoCodec,
        bitrate: QUALITY_HIGH,
      });
      output.addVideoTrack(videoSource);

      const videoDuration = await this._getDuration(videoBlob);

      const videoAudioTrack = await input
        .getPrimaryAudioTrack()
        .catch(() => null);
      const hasVideoAudio =
        !!videoAudioTrack &&
        (await videoAudioTrack.canDecode().catch(() => false));

      const audioSource = new AudioSampleSource({
        codec: "aac",
        bitrate: 128000,
      });
      output.addAudioTrack(audioSource);

      if (audioBlob.size > 50_000_000) {
        throw new Error("background-audio-too-large");
      }
      let bgArrayBuffer = await audioBlob.arrayBuffer();
      throwIfAborted(signal);
      const audioCtx = new AudioContext();
      let decodedAudio;
      try {
        decodedAudio = await audioCtx.decodeAudioData(bgArrayBuffer);
        bgArrayBuffer = null;
      } finally {
        audioCtx.close().catch(() => {});
      }
      const bgSr = decodedAudio.sampleRate;
      const bgDur = decodedAudio.duration;
      const bgData = decodedAudio.getChannelData(0);
      const bgLen = bgData.length;

      const bgSampleAt = (tSec) => {
        // Zero-duration BG would NaN through the modulo below.
        if (!(bgDur > 0)) return 0;
        let t = tSec;
        if (loop) {
          t = ((t % bgDur) + bgDur) % bgDur;
        } else if (t < 0 || t >= bgDur) {
          return 0;
        }
        const idx = t * bgSr;
        const i0 = Math.floor(idx);
        if (i0 < 0 || i0 >= bgLen) return 0;
        const frac = idx - i0;
        const s0 = bgData[i0];
        const s1 = i0 + 1 < bgLen ? bgData[i0 + 1] : s0;
        return s0 + (s1 - s0) * frac;
      };

      outputStarted = true;
      await output.start();

      for await (const frame of videoSink.samples(0, videoDuration)) {
        try {
          throwIfAborted(signal);
          const timestamp = frame.timestamp;
          await videoSource.add(frame);
          if (onProgress && videoDuration > 0)
            onProgress((timestamp / videoDuration) * 0.8);
          throwIfAborted(signal);
        } finally {
          frame.close();
        }
      }

      if (hasVideoAudio && mode === "mix") {
        const audioSink = new AudioSampleSink(videoAudioTrack);
        let lastEnd = 0;
        for await (const sample of audioSink.samples()) {
          let out = null;
          try {
            throwIfAborted(signal);
            const numCh = sample.numberOfChannels;
            const sr = sample.sampleRate;
            const N = sample.numberOfFrames;
            const ts = sample.timestamp;
            const source = new Float32Array(N * numCh);
            for (let ch = 0; ch < numCh; ch++) {
              const plane = source.subarray(ch * N, (ch + 1) * N);
              sample.copyTo(plane, { format: "f32-planar", planeIndex: ch });
            }

            const sourceDuration = sample.duration || N / sr;
            const outputFrames = Math.max(
              1,
              Math.round(sourceDuration * AAC_SAMPLE_RATE)
            );
            const mixed = new Float32Array(outputFrames * AAC_CHANNELS);
            for (let ch = 0; ch < AAC_CHANNELS; ch++) {
              const sourceChannel = Math.min(ch, numCh - 1);
              const sourceOffset = sourceChannel * N;
              const outputOffset = ch * outputFrames;
              for (let f = 0; f < outputFrames; f++) {
                const sourcePosition = (f * sr) / AAC_SAMPLE_RATE;
                const i0 = Math.min(N - 1, Math.floor(sourcePosition));
                const i1 = Math.min(N - 1, i0 + 1);
                const fraction = sourcePosition - i0;
                const sourceValue =
                  source[sourceOffset + i0] +
                  (source[sourceOffset + i1] - source[sourceOffset + i0]) *
                    fraction;
                const t = ts + f / AAC_SAMPLE_RATE;
                mixed[outputOffset + f] =
                  sourceValue * videoVolume + bgSampleAt(t) * audioVolume;
              }
            }

            out = new AudioSample({
              data: mixed,
              format: "f32-planar",
              numberOfChannels: AAC_CHANNELS,
              sampleRate: AAC_SAMPLE_RATE,
              timestamp: ts,
              duration: outputFrames / AAC_SAMPLE_RATE,
            });
            await audioSource.add(out);
            lastEnd = ts + outputFrames / AAC_SAMPLE_RATE;
            if (onProgress && videoDuration > 0)
              onProgress(0.8 + Math.min(1, ts / videoDuration) * 0.2);
            throwIfAborted(signal);
          } finally {
            out?.close();
            sample.close();
          }
        }

        // Source audio shorter than video: fill remainder with BG only.
        if (lastEnd < videoDuration - 0.01) {
          const sr = AAC_SAMPLE_RATE;
          const numCh = AAC_CHANNELS;
          const totalFrames = Math.floor((videoDuration - lastEnd) * sr);
          const chunkFrames = sr * 2;
          let frame = 0;
          while (frame < totalFrames) {
            throwIfAborted(signal);
            const n = Math.min(chunkFrames, totalFrames - frame);
            const chunk = new Float32Array(n * numCh);
            for (let ch = 0; ch < numCh; ch++) {
              const offset = ch * n;
              for (let f = 0; f < n; f++) {
                const t = lastEnd + (frame + f) / sr;
                chunk[offset + f] = bgSampleAt(t) * audioVolume;
              }
            }
            const out = new AudioSample({
              data: chunk,
              format: "f32-planar",
              numberOfChannels: numCh,
              sampleRate: sr,
              timestamp: lastEnd + frame / sr,
              duration: n / sr,
            });
            try {
              await audioSource.add(out);
            } finally {
              out.close();
            }
            frame += n;
          }
        }
      } else {
        const sr = AAC_SAMPLE_RATE;
        const totalFrames = Math.floor(videoDuration * sr);
        const chunkFrames = sr * 2;
        let frame = 0;
        while (frame < totalFrames) {
          throwIfAborted(signal);
          const n = Math.min(chunkFrames, totalFrames - frame);
          const chunk = new Float32Array(n * AAC_CHANNELS);
          for (let ch = 0; ch < AAC_CHANNELS; ch++) {
            const offset = ch * n;
            for (let f = 0; f < n; f++) {
              const t = (frame + f) / sr;
              chunk[offset + f] = bgSampleAt(t) * audioVolume;
            }
          }
          const out = new AudioSample({
            data: chunk,
            format: "f32-planar",
            numberOfChannels: AAC_CHANNELS,
            sampleRate: sr,
            timestamp: frame / sr,
            duration: n / sr,
          });
          try {
            await audioSource.add(out);
          } finally {
            out.close();
          }
          frame += n;
          if (onProgress && totalFrames > 0)
            onProgress(0.8 + (frame / totalFrames) * 0.2);
        }
      }

      await output.finalize();
      outputFinalized = true;
      throwIfAborted(signal);
      return new Blob([outputTarget.buffer], { type: "video/mp4" });
    } finally {
      if (outputStarted && !outputFinalized) {
        await output.cancel().catch(() => {});
      }
      input.dispose();
    }
  }

  async _getDuration(blob) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(blob);
      v.src = url;
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(v.duration);
      };
      v.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
    });
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason) throw signal.reason;
  const error = new Error("Export cancelled.");
  error.name = "AbortError";
  throw error;
}
