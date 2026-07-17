// @ts-nocheck
// Multi-clip timeline exporter. Generalizes VideoCutter: takes an ORDERED list of
// clips (each a source [start,end] + muted flag) and concatenates them into one
// MP4, re-timestamping every sample to a running output cursor. Because each clip
// is read from the source by time range and re-based independently, arbitrary
// REORDERING works for free (a clip can appear out of source order). Muted clips
// have their audio samples zeroed (true silence), like VideoMuter.
import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WavOutputFormat,
  QUALITY_HIGH,
  VideoSampleSource,
  VideoSample,
  AudioSampleSource,
  AudioSample,
  VideoSampleSink,
  AudioSampleSink,
} from "mediabunny";
import { videoConverter } from "./videoConverter";
import { CAPTION_STYLE_PRESET_DETAILS } from "../../../../edl/captions";
import { computeZoomViewportTransform } from "../../../../edl/zoomViewport";

export class TimelineExporter {
  /**
   * @param {Blob} sourceBlob
   * @param {{clips: {sourceStart:number, sourceEnd:number, muted?:boolean}[], onProgress?:Function, captions?: {start:number,end:number,text:string}[], captionStyle?: {preset?:string}, zoomKeyframes?: {time:number,durationSeconds:number,scale:number,xRatio:number,yRatio:number}[], signal?: AbortSignal}} opts
   */
  async export(sourceBlob, { clips, onProgress, captions = [], captionStyle = {}, zoomKeyframes = [], signal }) {
    throwIfAborted(signal);
    const input = new Input({ source: new BlobSource(sourceBlob), formats: ALL_FORMATS });

    const outputTarget = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: outputTarget,
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const audioDecodable = audioTrack ? await audioTrack.canDecode().catch(() => false) : false;

    const codecInfo = await videoConverter.detectBestCodec("mp4");
    const videoSource = new VideoSampleSource({
      codec: codecInfo?.codec ?? "avc",
      bitrate: QUALITY_HIGH,
      sizeChangeBehavior: "passThrough",
    });
    output.addVideoTrack(videoSource);

    let audioSource = null;
    if (audioTrack && audioDecodable) {
      audioSource = new AudioSampleSource({ codec: "aac", bitrate: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }

    await output.start();

    const totalDur = clips.reduce((a, c) => a + Math.max(0, c.sourceEnd - c.sourceStart), 0) || 1;
    let outPts = 0; // microseconds
    let processed = 0;
    const frameRenderer = createFrameRenderer({
      captions,
      captionStyle,
      zoomKeyframes,
    });

    for (const clip of clips) {
      throwIfAborted(signal);
      const start = clip.sourceStart;
      const end = clip.sourceEnd;
      const base = outPts / 1_000_000;

      const videoSink = new VideoSampleSink(videoTrack);
      for await (const sample of videoSink.samples(start, end)) {
        throwIfAborted(signal);
        const timestamp = Math.max(0, base + (sample.timestamp - start));
        sample.setTimestamp(timestamp);
        const outSample = frameRenderer
          ? frameRenderer.render(sample, timestamp)
          : sample;
        await videoSource.add(outSample);
        if (outSample !== sample) outSample.close();
        sample.close();
        processed += sample.duration ?? 1 / 30;
        onProgress?.(Math.min(1, processed / totalDur));
        throwIfAborted(signal);
      }

      if (audioTrack && audioSource) {
        const audioSink = new AudioSampleSink(audioTrack);
        let clipAudioPts = base;
        for await (const sample of audioSink.samples(start, end)) {
          throwIfAborted(signal);
          const adjusted = Math.max(0, clipAudioPts);
          const sampleDuration =
            sample.duration || sample.numberOfFrames / sample.sampleRate || 0;
          clipAudioPts += sampleDuration;
          if (clip.muted) {
            // Replace with a silent sample of the same shape (true silence).
            const nch = sample.numberOfChannels;
            const frames = sample.numberOfFrames;
            const silent = new AudioSample({
              data: new Float32Array(frames * nch),
              format: "f32-planar",
              numberOfChannels: nch,
              sampleRate: sample.sampleRate,
              timestamp: adjusted,
              duration: sampleDuration || frames / sample.sampleRate,
            });
            await audioSource.add(silent);
            silent.close();
            sample.close();
          } else {
            sample.setTimestamp(adjusted);
            await audioSource.add(sample);
            sample.close();
          }
          processed += sampleDuration;
          onProgress?.(Math.min(1, processed / totalDur));
          throwIfAborted(signal);
        }
      }

      outPts += (end - start) * 1_000_000;
    }

    throwIfAborted(signal);
    await output.finalize();
    throwIfAborted(signal);
    onProgress?.(1);
    return new Blob([outputTarget.buffer], { type: "video/mp4" });
  }

  /**
   * @param {Blob} sourceBlob
   * @param {{clips: {sourceStart:number, sourceEnd:number, muted?:boolean}[], format?: "wav" | "m4a", onProgress?:Function, signal?: AbortSignal}} opts
   */
  async exportAudio(sourceBlob, { clips, format = "wav", onProgress, signal }) {
    throwIfAborted(signal);
    const input = new Input({ source: new BlobSource(sourceBlob), formats: ALL_FORMATS });
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const audioDecodable = audioTrack ? await audioTrack.canDecode().catch(() => false) : false;
    if (!audioTrack || !audioDecodable) {
      throw new Error("audio-export-track-unavailable");
    }

    const outputTarget = new BufferTarget();
    const outputFormat =
      format === "m4a"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WavOutputFormat({ large: true });
    const output = new Output({
      format: outputFormat,
      target: outputTarget,
    });
    const audioSource = new AudioSampleSource({
      codec: format === "m4a" ? "aac" : "pcm-f32",
      bitrate: QUALITY_HIGH,
    });
    output.addAudioTrack(audioSource);

    await output.start();

    const totalDur = clips.reduce((a, c) => a + Math.max(0, c.sourceEnd - c.sourceStart), 0) || 1;
    let outPts = 0;
    let processed = 0;

    for (const clip of clips) {
      throwIfAborted(signal);
      const start = clip.sourceStart;
      const end = clip.sourceEnd;
      const base = outPts / 1_000_000;
      const audioSink = new AudioSampleSink(audioTrack);
      let clipAudioPts = base;
      for await (const sample of audioSink.samples(start, end)) {
        throwIfAborted(signal);
        const adjusted = Math.max(0, clipAudioPts);
        const sampleDuration =
          sample.duration || sample.numberOfFrames / sample.sampleRate || 0;
        clipAudioPts += sampleDuration;
        if (clip.muted) {
          const nch = sample.numberOfChannels;
          const frames = sample.numberOfFrames;
          const silent = new AudioSample({
            data: new Float32Array(frames * nch),
            format: "f32-planar",
            numberOfChannels: nch,
            sampleRate: sample.sampleRate,
            timestamp: adjusted,
            duration: sampleDuration || frames / sample.sampleRate,
          });
          await audioSource.add(silent);
          silent.close();
          sample.close();
        } else {
          sample.setTimestamp(adjusted);
          await audioSource.add(sample);
          sample.close();
        }
        processed += sampleDuration;
        onProgress?.(Math.min(1, processed / totalDur));
        throwIfAborted(signal);
      }
      outPts += (end - start) * 1_000_000;
    }

    throwIfAborted(signal);
    await output.finalize();
    throwIfAborted(signal);
    onProgress?.(1);
    return new Blob([outputTarget.buffer], {
      type: format === "m4a" ? "audio/mp4" : "audio/wav",
    });
  }
}

function createAbortError() {
  try {
    return new DOMException("Export cancelled.", "AbortError");
  } catch {
    const error = new Error("Export cancelled.");
    error.name = "AbortError";
    return error;
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || createAbortError();
}

function createFrameRenderer({ captions, captionStyle, zoomKeyframes }) {
  const cues = (captions || [])
    .map((cue) => ({
      start: Number(cue.start),
      end: Number(cue.end),
      text: String(cue.text || "").trim(),
    }))
    .filter((cue) => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
  const zooms = (zoomKeyframes || [])
    .map((keyframe) => ({
      time: Number(keyframe.time),
      end: Number(keyframe.time) + Number(keyframe.durationSeconds || 0),
      scale: Number(keyframe.scale),
      xRatio: Number(keyframe.xRatio),
      yRatio: Number(keyframe.yRatio),
    }))
    .filter(
      (keyframe) =>
        Number.isFinite(keyframe.time) &&
        Number.isFinite(keyframe.end) &&
        keyframe.end > keyframe.time &&
        Number.isFinite(keyframe.scale) &&
        keyframe.scale > 1 &&
        Number.isFinite(keyframe.xRatio) &&
        Number.isFinite(keyframe.yRatio),
    );
  if (!cues.length && !zooms.length) return null;

  const preset =
    CAPTION_STYLE_PRESET_DETAILS[captionStyle?.preset] ||
    CAPTION_STYLE_PRESET_DETAILS.clean;
  let canvas = null;
  let context = null;

  const ensureCanvas = (sample) => {
    const width = Math.max(1, Math.round(sample.displayWidth || sample.codedWidth || 1));
    const height = Math.max(1, Math.round(sample.displayHeight || sample.codedHeight || 1));
    if (canvas && canvas.width === width && canvas.height === height) {
      return { canvas, context, width, height };
    }
    canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("caption-canvas-unavailable");
    return { canvas, context, width, height };
  };

  return {
    render(sample, timestamp) {
      const active = cues.find((cue) => timestamp >= cue.start && timestamp < cue.end);
      const activeZoom = zooms.find(
        (keyframe) => timestamp >= keyframe.time && timestamp < keyframe.end,
      );
      if (!active && !activeZoom) return sample;
      const target = ensureCanvas(sample);
      drawVideoFrame(sample, target.context, target.width, target.height, activeZoom);
      if (active) {
        drawCaptionOverlay(target.context, target.width, target.height, active.text, preset);
      }
      return new VideoSample(target.canvas, {
        timestamp,
        duration: sample.duration,
      });
    },
  };
}

function drawVideoFrame(sample, context, width, height, zoom) {
  context.clearRect(0, 0, width, height);
  if (!zoom) {
    sample.draw(context, 0, 0, width, height);
    return;
  }

  const transform = computeZoomViewportTransform(zoom, width, height);
  sample.draw(
    context,
    transform.dx,
    transform.dy,
    transform.drawWidth,
    transform.drawHeight,
  );
}

function drawCaptionOverlay(context, width, height, text, preset) {
  const fontSize = Math.max(18, Math.round(height * preset.fontScale));
  const lineHeight = Math.round(fontSize * 1.22);
  const horizontalPadding = Math.round(fontSize * 0.7);
  const verticalPadding = Math.round(fontSize * 0.42);
  const maxTextWidth = Math.round(width * 0.78);
  const lines = wrapCaptionText(context, text, maxTextWidth, fontSize).slice(0, 3);
  if (!lines.length) return;

  const textWidth = Math.min(
    maxTextWidth,
    Math.max(...lines.map((line) => context.measureText(line).width)),
  );
  const boxWidth = Math.ceil(textWidth + horizontalPadding * 2);
  const boxHeight = Math.ceil(lines.length * lineHeight + verticalPadding * 2);
  const x = Math.round((width - boxWidth) / 2);
  const y = Math.round(height - boxHeight - Math.max(height * 0.08, 24));

  context.save();
  context.globalAlpha = preset.boxAlpha;
  context.fillStyle = preset.boxColor;
  roundedRect(context, x, y, boxWidth, boxHeight, Math.max(6, Math.round(fontSize * 0.25)));
  context.fill();
  context.globalAlpha = 1;
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = preset.strokeColor;
  context.lineWidth = Math.max(3, Math.round(fontSize * 0.13));
  context.fillStyle = preset.textColor;
  lines.forEach((line, index) => {
    const lineY = y + verticalPadding + lineHeight * index + lineHeight / 2;
    context.strokeText(line, width / 2, lineY);
    context.fillText(line, width / 2, lineY);
  });
  context.restore();
}

function wrapCaptionText(context, text, maxWidth, fontSize) {
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}
