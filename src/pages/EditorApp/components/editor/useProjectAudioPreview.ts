import { useEffect } from "react";
import type { RefObject } from "react";
import type { Timeline } from "../../../../edl/timeline";
import type { ProjectAudioTrack } from "../../../../edl/projectAudio";
import { attachProjectAudioPreview } from "./projectAudioPreviewController";

export function useProjectAudioPreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  audioAsset: Blob | null | undefined,
  audioTrack: ProjectAudioTrack | null | undefined,
  timeline: Timeline | null | undefined,
): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !audioAsset || !audioTrack) return;
    const controller = attachProjectAudioPreview({
      video,
      audioAsset,
      audioTrack,
      timeline,
    });
    return controller.dispose;
  }, [audioAsset, audioTrack, timeline, videoRef]);
}
