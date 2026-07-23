import { VideoAudioMixer } from "../mediabunny/lib/videoAudioMixer.ts";
import type { ProjectAudioTrack } from "../../../edl/projectAudio";

export default async function mixProjectAudio(
  videoBlob: Blob,
  audioBlob: Blob,
  track: ProjectAudioTrack,
  onProgress: (progress: number) => void = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  const mixer = new VideoAudioMixer();
  const addAudio = mixer.addAudio as unknown as (
    video: Blob,
    audio: Blob,
    options: {
      mode: "mix" | "replace";
      videoVolume: number;
      audioVolume: number;
      loop: boolean;
      onProgress: (progress: number) => void;
      signal?: AbortSignal;
    },
  ) => Promise<Blob>;
  return addAudio.call(mixer, videoBlob, audioBlob, {
    mode: track.mode,
    videoVolume: track.mode === "replace" ? 0 : track.sourceVolume,
    audioVolume: track.volume,
    loop: track.loop,
    onProgress,
    signal,
  });
}
