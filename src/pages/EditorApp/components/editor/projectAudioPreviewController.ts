import { sourceToOutput } from "../../../../edl/timeline.ts";
import type { Timeline } from "../../../../edl/timeline.ts";
import { resolveProjectAudioPreviewPosition } from "../../../../edl/projectAudio.ts";
import type { ProjectAudioTrack } from "../../../../edl/projectAudio.ts";

export interface PreviewVideo extends EventTarget {
  currentTime: number;
  volume: number;
  playbackRate: number;
  paused: boolean;
}

export interface PreviewAudio extends EventTarget {
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  loop: boolean;
  paused: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
}

type PreviewControllerOptions = {
  video: PreviewVideo;
  audioAsset: Blob;
  audioTrack: ProjectAudioTrack;
  timeline?: Timeline | null;
  createAudio?: (url: string) => PreviewAudio;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

export interface ProjectAudioPreviewController {
  audio: PreviewAudio;
  sync: (force?: boolean) => void;
  dispose: () => void;
}

export function attachProjectAudioPreview({
  video,
  audioAsset,
  audioTrack,
  timeline = null,
  createAudio = (url) => new Audio(url),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
}: PreviewControllerOptions): ProjectAudioPreviewController {
  const url = createObjectURL(audioAsset);
  const audio = createAudio(url);
  audio.preload = "auto";
  audio.volume = audioTrack.volume;
  audio.loop = audioTrack.loop;
  const previousVolume = video.volume;
  video.volume = audioTrack.mode === "replace" ? 0 : audioTrack.sourceVolume;

  const position = () => {
    const sourceTime = Number(video.currentTime) || 0;
    const outputTime = timeline ? sourceToOutput(timeline, sourceTime) : sourceTime;
    // Timeline preview will immediately snap deleted source gaps to a retained
    // clip. Preserve the current added-audio playhead during that transition.
    return outputTime == null
      ? null
      : resolveProjectAudioPreviewPosition(outputTime, audio.duration, audioTrack.loop);
  };

  const sync = (force = false) => {
    const next = position();
    if (!next) return;
    if (force || Math.abs((Number(audio.currentTime) || 0) - next.currentTime) > 0.3) {
      try {
        audio.currentTime = next.currentTime;
      } catch {
        // Metadata may not be available yet; loadedmetadata retries the sync.
      }
    }
  };

  const updatePlayback = (force = false) => {
    const next = position();
    if (!next) return;
    sync(force);
    if (!next.shouldPlay) {
      audio.pause();
    } else if (!video.paused && audio.paused) {
      void audio.play().catch(() => {});
    }
  };
  const play = () => {
    audio.playbackRate = video.playbackRate;
    updatePlayback(true);
  };
  const pause = () => audio.pause();
  const rate = () => {
    audio.playbackRate = video.playbackRate;
  };
  const tick = () => updatePlayback(false);
  const seek = () => updatePlayback(true);

  video.addEventListener("play", play);
  video.addEventListener("pause", pause);
  video.addEventListener("ended", pause);
  video.addEventListener("seeking", seek);
  video.addEventListener("timeupdate", tick);
  video.addEventListener("ratechange", rate);
  audio.addEventListener("loadedmetadata", tick);
  audio.addEventListener("durationchange", tick);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    audio.pause();
    video.volume = previousVolume;
    video.removeEventListener("play", play);
    video.removeEventListener("pause", pause);
    video.removeEventListener("ended", pause);
    video.removeEventListener("seeking", seek);
    video.removeEventListener("timeupdate", tick);
    video.removeEventListener("ratechange", rate);
    audio.removeEventListener("loadedmetadata", tick);
    audio.removeEventListener("durationchange", tick);
    revokeObjectURL(url);
  };

  return { audio, sync, dispose };
}
