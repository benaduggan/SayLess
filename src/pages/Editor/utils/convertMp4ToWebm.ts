import { VideoConverter } from "../mediabunny/lib/videoConverter.ts";

async function convertMp4ToWebm(
  mp4Blob: Blob,
  onProgress: (progress: number) => void = () => {},
): Promise<Blob> {
  const converter = new VideoConverter();

  return converter.convertToWebM(mp4Blob, {
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    onProgress,
  });
}

export default convertMp4ToWebm;
