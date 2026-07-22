import { VideoAudioMixer } from "../mediabunny/lib/videoAudioMixer.ts";

interface BlobLike {
  size: number;
  type?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  slice?: (start?: number, end?: number, contentType?: string) => unknown;
}

const isBlobLike = (input: unknown): input is BlobLike =>
  typeof input === "object" &&
  input !== null &&
  typeof (input as Partial<BlobLike>).size === "number";

async function ensureBlob(
  input: unknown,
  mimeType = "video/webm",
): Promise<Blob> {
  if (input instanceof Blob) return input;

  if (isBlobLike(input)) {
    if (typeof input.arrayBuffer === "function") {
      try {
        const buffer = await input.arrayBuffer();
        return new Blob([buffer], { type: input.type || mimeType });
      } catch {}
    }

    if (typeof input.slice === "function") {
      try {
        const sliced = input.slice(0, input.size, input.type || mimeType);
        if (sliced instanceof Blob) return sliced;
      } catch {}
    }
  }

  throw new Error(
    `Cannot convert to Blob: ${typeof input}, constructor: ${
      typeof input === "object" && input !== null
        ? input.constructor?.name
        : undefined
    }`,
  );
}

async function addAudioToVideo(
  _ffmpeg: unknown,
  videoBlob: unknown,
  audioBlob: unknown,
  _videoDuration: number,
  audioVolume = 1.0,
  replaceAudio = false,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const video = await ensureBlob(videoBlob, "video/webm");
  const audio = await ensureBlob(audioBlob, "audio/webm");

  const mixer = new VideoAudioMixer();
  const addAudio = mixer.addAudio as unknown as (
    videoSource: Blob,
    audioSource: Blob,
    options: {
      mode: "mix" | "replace";
      videoVolume: number;
      audioVolume: number;
      loop: boolean;
      onProgress?: (progress: number) => void;
    },
  ) => Promise<Blob>;
  return addAudio.call(mixer, video, audio, {
    mode: replaceAudio ? "replace" : "mix",
    videoVolume: replaceAudio ? 0 : 0.7,
    audioVolume,
    loop: false,
    onProgress,
  });
}

export default addAudioToVideo;
