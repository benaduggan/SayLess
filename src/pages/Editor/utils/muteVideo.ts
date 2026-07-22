import { VideoMuter } from "../mediabunny/lib/videoMuter.ts";

async function muteVideo(
  _ffmpeg: unknown,
  videoBlob: Blob,
  startTime: number,
  endTime: number,
  _duration: number,
  onProgress: (progress: number) => void = () => {},
): Promise<Blob> {
  const muter = new VideoMuter();
  const mute = muter.mute as unknown as (
    blob: Blob,
    options: {
      muteStart: number;
      muteEnd: number;
      outputFormat: "webm";
      onProgress: (progress: number) => void;
    },
  ) => Promise<Blob>;

  return mute.call(muter, videoBlob, {
    muteStart: startTime,
    muteEnd: endTime,
    outputFormat: "webm",
    onProgress,
  });
}

export default muteVideo;
