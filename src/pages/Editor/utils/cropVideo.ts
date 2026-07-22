import { VideoCropper } from "../mediabunny/lib/videoCropper.ts";

export interface CropVideoOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function cropVideo(
  _ffmpeg: unknown,
  videoBlob: Blob,
  cropOptions: CropVideoOptions,
  onProgress: (progress: number) => void = () => {},
): Promise<Blob> {
  const cropper = new VideoCropper();

  return cropper.crop(videoBlob, {
    left: cropOptions.x,
    top: cropOptions.y,
    width: cropOptions.width,
    height: cropOptions.height,
    outputFormat: "webm",
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    onProgress,
  });
}

export default cropVideo;
