import { VideoTrimmer } from "../mediabunny/lib/videoTrimmer.ts";
import { VideoCutter } from "../mediabunny/lib/videoCutter.ts";

export default async function cutVideo(
  _ffmpeg: unknown,
  videoBlob: Blob,
  startTime: number,
  endTime: number,
  cut: boolean,
  duration: number | null | undefined,
  _encode: unknown,
  onProgress: (progress: number) => void = () => {},
): Promise<Blob> {
  let result: Blob;

  // edge cut: delegate to trimmer for stream-copy. it snaps START to the prior keyframe, so cutting [0, endTime] can re-include up to one GOP (~1s); accepted since stream-copy is much faster than re-encode
  const EPS = 0.05;
  if (cut && startTime <= EPS) {
    const trimmer = new VideoTrimmer();
    result = await trimmer.trim(videoBlob, {
      startTime: endTime,
      endTime: duration ?? Number.POSITIVE_INFINITY,
      outputFormat: "mp4",
      onProgress,
    });
  } else if (cut && duration && endTime >= duration - EPS) {
    const trimmer = new VideoTrimmer();
    result = await trimmer.trim(videoBlob, {
      startTime: 0,
      endTime: startTime,
      outputFormat: "mp4",
      onProgress,
    });
  } else if (cut) {
    const cutter = new VideoCutter();
    const cutMiddle = cutter.cut as unknown as (
      blob: Blob,
      options: {
        cutStart: number;
        cutEnd: number;
        onProgress: (progress: number) => void;
      },
    ) => Promise<Blob>;
    result = await cutMiddle.call(cutter, videoBlob, {
      cutStart: startTime,
      cutEnd: endTime,
      onProgress,
    });
  } else {
    const trimmer = new VideoTrimmer();
    result = await trimmer.trim(videoBlob, {
      startTime,
      endTime,
      outputFormat: "mp4",
      videoBitrate: 5_000_000,
      audioBitrate: 128_000,
      onProgress,
    });
  }

  return result;
}
