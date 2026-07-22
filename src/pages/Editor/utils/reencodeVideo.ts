import { VideoConverter } from "../mediabunny/lib/videoConverter.ts";

async function reencodeVideo(
  _ffmpeg: unknown,
  videoBlob: Blob,
  _duration: number,
  onProgress: (progress: number) => void = () => {},
): Promise<Blob> {
  const converter = new VideoConverter();

  return converter.convertToMP4(videoBlob, {
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    onProgress,
  });
}

export default reencodeVideo;
