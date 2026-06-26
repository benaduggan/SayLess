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
  QUALITY_HIGH,
  VideoSampleSource,
  AudioSampleSource,
  AudioSample,
  VideoSampleSink,
  AudioSampleSink,
} from "mediabunny";
import { videoConverter } from "./videoConverter";

export class TimelineExporter {
  /**
   * @param {Blob} sourceBlob
   * @param {{clips: {sourceStart:number, sourceEnd:number, muted?:boolean}[], onProgress?:Function}} opts
   */
  async export(sourceBlob, { clips, onProgress }) {
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

    for (const clip of clips) {
      const start = clip.sourceStart;
      const end = clip.sourceEnd;
      const base = outPts / 1_000_000;

      const videoSink = new VideoSampleSink(videoTrack);
      for await (const sample of videoSink.samples(start, end)) {
        sample.setTimestamp(Math.max(0, base + (sample.timestamp - start)));
        await videoSource.add(sample);
        sample.close();
        processed += sample.duration ?? 1 / 30;
        onProgress?.(Math.min(1, processed / totalDur));
      }

      if (audioTrack && audioSource) {
        const audioSink = new AudioSampleSink(audioTrack);
        for await (const sample of audioSink.samples(start, end)) {
          const adjusted = Math.max(0, base + (sample.timestamp - start));
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
              duration: frames / sample.sampleRate,
            });
            await audioSource.add(silent);
            silent.close();
            sample.close();
          } else {
            sample.setTimestamp(adjusted);
            await audioSource.add(sample);
            sample.close();
          }
          processed += sample.duration ?? 0;
          onProgress?.(Math.min(1, processed / totalDur));
        }
      }

      outPts += (end - start) * 1_000_000;
    }

    await output.finalize();
    onProgress?.(1);
    return new Blob([outputTarget.buffer], { type: "video/mp4" });
  }
}
