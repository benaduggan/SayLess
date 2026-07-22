import { MIME_TYPES } from "./recorderConfig";

export function createMediaRecorder(
  stream: MediaStream,
  {
    audioBitsPerSecond,
    videoBitsPerSecond,
  }: Pick<MediaRecorderOptions, "audioBitsPerSecond" | "videoBitsPerSecond">,
): MediaRecorder {
  const mimeType = MIME_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type)
  );

  if (!mimeType) {
    throw new Error("❌ No supported MIME types found");
  }

  return new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond,
    videoBitsPerSecond,
  });
}
