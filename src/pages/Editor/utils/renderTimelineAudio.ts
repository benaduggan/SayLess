import { TimelineExporter } from "../mediabunny/lib/timelineExporter.ts";
import type { TimelineClip } from "./renderTimeline";

export interface RenderTimelineAudioOptions {
  format?: "wav" | "m4a";
  signal?: AbortSignal;
}

/** Render a resolved timeline's audio into a single audio file. */
export default async function renderTimelineAudio(
  sourceBlob: Blob,
  clips: TimelineClip[],
  onProgress: (progress: number) => void = () => {},
  options: RenderTimelineAudioOptions = {},
): Promise<Blob> {
  const exporter = new TimelineExporter();
  return exporter.exportAudio(sourceBlob, {
    clips,
    onProgress,
    format: options.format || "wav",
    signal: options.signal,
  });
}
