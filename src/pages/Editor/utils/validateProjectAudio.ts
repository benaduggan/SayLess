import { MAX_PROJECT_AUDIO_BYTES } from "../../../edl/projectAudio.ts";

export interface ProjectAudioProbe {
  duration: number;
  numberOfChannels: number;
  sampleRate: number;
}

type AudioContextLike = Pick<AudioContext, "decodeAudioData" | "close">;

type ProjectAudioValidationOptions = {
  createAudioContext?: () => AudioContextLike;
};

const defaultAudioContext = (): AudioContextLike => {
  const AudioContextCtor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("project-audio-decode-unavailable");
  }
  return new AudioContextCtor();
};

/** Decode-probe a project-audio asset before it is persisted. */
export async function validateProjectAudioBlob(
  blob: Blob,
  options: ProjectAudioValidationOptions = {},
): Promise<ProjectAudioProbe> {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("project-audio-invalid");
  }
  if (blob.size > MAX_PROJECT_AUDIO_BYTES) {
    throw new Error("project-audio-too-large");
  }

  const context = (options.createAudioContext || defaultAudioContext)();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const duration = Number(decoded.duration);
    const numberOfChannels = Number(decoded.numberOfChannels);
    const sampleRate = Number(decoded.sampleRate);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(numberOfChannels) ||
      numberOfChannels < 1 ||
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0
    ) {
      throw new Error("project-audio-decode-invalid");
    }
    return { duration, numberOfChannels, sampleRate };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("project-audio-decode-")) {
      throw cause;
    }
    throw new Error("project-audio-decode-unsupported", { cause });
  } finally {
    await context.close().catch(() => {});
  }
}
