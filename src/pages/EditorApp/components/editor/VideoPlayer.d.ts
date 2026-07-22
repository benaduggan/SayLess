import type { ComponentType } from "react";

export interface VideoPlayerProps {
  onSeek?: (time: number, updatePlayerTime: boolean) => void;
}

declare const VideoPlayer: ComponentType<VideoPlayerProps>;
export default VideoPlayer;
