import {
  AudioSampleSink,
  BlobSource,
  Input,
  WEBM,
} from "mediabunny";

import { WebCodecsRecorder } from "../../src/pages/Recorder/webcodecs/WebCodecsRecorder.ts";

const fail = (message, detail = {}) => {
  throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rms = (samples) => {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(samples.length, 1));
};

const estimateDominantFrequency = (samples, sampleRate, minHz, maxHz) => {
  const startLag = Math.max(1, Math.floor(sampleRate / maxHz));
  const endLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / minHz),
  );
  let bestLag = startLag;
  let bestScore = -Infinity;

  for (let lag = startLag; lag <= endLag; lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < samples.length; i += 1) {
      score += samples[i] * samples[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return sampleRate / bestLag;
};

const collectAudioSamples = async (audioTrack) => {
  const sink = new AudioSampleSink(audioTrack);
  const chunks = [];
  let totalFrames = 0;
  let sampleRate = await audioTrack.getSampleRate();
  let firstTimestamp = null;
  let lastEndTimestamp = null;
  let sampleCount = 0;

  for await (const sample of sink.samples()) {
    sampleCount += 1;
    sampleRate = sample.sampleRate || sampleRate;
    if (firstTimestamp === null) firstTimestamp = sample.timestamp;
    lastEndTimestamp = sample.timestamp + sample.duration;

    const frames = sample.numberOfFrames;
    const plane = new Float32Array(frames);
    sample.copyTo(plane, {
      planeIndex: 0,
      format: "f32-planar",
    });
    chunks.push(plane);
    totalFrames += frames;
    sample.close();
  }

  const merged = new Float32Array(totalFrames);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    samples: merged,
    sampleRate,
    firstTimestamp,
    lastEndTimestamp,
    sampleCount,
  };
};

const recordSyntheticMic = async ({
  durationMs = 3000,
  toneHz = 440,
  audioSampleRate = 44100,
} = {}) => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  const videoStream = canvas.captureStream(30);

  const audioContext = new AudioContext({ sampleRate: audioSampleRate });
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const destination = audioContext.createMediaStreamDestination();
  oscillator.frequency.value = toneHz;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(destination);

  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const chunks = [];
  let finalizedPayload = null;
  const errors = [];
  const recorder = new WebCodecsRecorder(stream, {
    width: 320,
    height: 180,
    fps: 30,
    videoBitrate: 1_000_000,
    audioBitrate: 128_000,
    enableAudio: true,
    containerKind: "webm",
    videoEncoderConfig: {
      codec: "vp8",
      width: 320,
      height: 180,
      framerate: 30,
      bitrate: 1_000_000,
    },
    audioEncoderMaxQueueSize: 80,
    debug: false,
    onChunk: (chunk) => {
      chunks.push(chunk);
    },
    onError: (error) => {
      errors.push(String(error?.message || error));
    },
    onFinalized: (payload) => {
      finalizedPayload = payload;
    },
  });

  const started = await recorder.start();
  if (!started) fail("recorder failed to start", { errors });

  const start = performance.now();
  const draw = () => {
    const elapsed = performance.now() - start;
    ctx.fillStyle = elapsed % 400 < 200 ? "#143d8f" : "#0d6b57";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "24px sans-serif";
    ctx.fillText("synthetic mic", 28, 96);
    if (elapsed < durationMs) requestAnimationFrame(draw);
  };
  oscillator.start();
  draw();
  await sleep(durationMs);
  await recorder.stop();
  oscillator.stop();
  await audioContext.close();
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: "video/webm" });
  return {
    blob,
    finalizedPayload,
    errors,
    chunkCount: chunks.length,
    byteLength: blob.size,
  };
};

const runCase = async ({
  name,
  targetDurationSeconds = 3,
  targetToneHz = 440,
  audioSampleRate,
}) => {
  const result = await recordSyntheticMic({
    durationMs: targetDurationSeconds * 1000,
    toneHz: targetToneHz,
    audioSampleRate,
  });

  if (result.errors.length > 0) {
    fail("recorder surfaced errors", { name, errors: result.errors });
  }
  if (!result.finalizedPayload?.muxerFinalizeOk) {
    fail("muxer did not finalize cleanly", { name, ...result.finalizedPayload });
  }
  if (result.byteLength < 10_000 || result.chunkCount < 1) {
    fail("recording output is unexpectedly small", {
      name,
      byteLength: result.byteLength,
      chunkCount: result.chunkCount,
    });
  }

  const input = new Input({
    formats: [WEBM],
    source: new BlobSource(result.blob),
  });
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) fail("recording has no primary audio track", { name });
  const inputDuration = await input.computeDuration();
  const audioDuration = await audioTrack.computeDuration();
  const audioStats = await audioTrack.computePacketStats();
  const decoded = await collectAudioSamples(audioTrack);
  input.dispose();

  const decodedDuration = decoded.samples.length / decoded.sampleRate;
  const middleStart = Math.floor(decoded.samples.length * 0.25);
  const middleEnd = Math.floor(decoded.samples.length * 0.75);
  const middle = decoded.samples.subarray(middleStart, middleEnd);
  const frequencyHz = estimateDominantFrequency(
    middle,
    decoded.sampleRate,
    300,
    600,
  );
  const middleRms = rms(middle);
  const diag = result.finalizedPayload.diag || {};
  const audioElapsedSeconds = (diag.audioElapsedUs || 0) / 1_000_000;

  const summary = {
    name,
    requestedAudioSampleRate: audioSampleRate,
    byteLength: result.byteLength,
    chunkCount: result.chunkCount,
    inputDuration,
    audioDuration,
    decodedDuration,
    sampleRate: decoded.sampleRate,
    sampleCount: decoded.sampleCount,
    packetCount: audioStats.packetCount ?? null,
    firstTimestamp: decoded.firstTimestamp,
    lastEndTimestamp: decoded.lastEndTimestamp,
    frequencyHz,
    middleRms,
    audioElapsedSeconds,
    droppedAudioForBackpressure:
      result.finalizedPayload.droppedForBackpressure?.audio ?? null,
    peakAudioEncodeQueueSize:
      result.finalizedPayload.peakEncodeQueueSize?.audio ?? null,
    audioSampleRateMismatchRebuilds:
      diag.audioSampleRateMismatchRebuilds ?? null,
  };

  if (Math.abs(audioDuration - targetDurationSeconds) > 0.35) {
    fail("audio duration drifted from capture duration", summary);
  }
  if (Math.abs(audioElapsedSeconds - audioDuration) > 0.2) {
    fail("recorder audio clock disagrees with muxed audio duration", summary);
  }
  if (Math.abs(frequencyHz - targetToneHz) > 12) {
    fail("decoded tone frequency indicates speed/pitch drift", summary);
  }
  if (middleRms < 0.05) {
    fail("decoded audio is too quiet or missing", summary);
  }
  if ((result.finalizedPayload.droppedForBackpressure?.audio ?? 0) !== 0) {
    fail("recorder dropped audio for backpressure", summary);
  }

  return summary;
};

window.WEBCODECS_MIC_QUALITY = {
  async run() {
    const cases = [
      {
        name: "speech-standard-44k",
        audioSampleRate: 44100,
      },
      {
        name: "narrowband-16k",
        audioSampleRate: 16000,
      },
    ];
    const summaries = [];
    for (const testCase of cases) {
      summaries.push(await runCase(testCase));
    }
    return summaries;
  },
};

window.WEBCODECS_MIC_QUALITY_READY = true;
