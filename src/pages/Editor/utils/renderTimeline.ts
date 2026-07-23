import { TimelineExporter } from "../mediabunny/lib/timelineExporter.ts";
import type { ZoomKeyframe } from "../../../edl/zoom";
import type { CropRegion } from "../../../edl/crop";

export interface TimelineClip {
  sourceStart: number;
  sourceEnd: number;
  muted?: boolean;
}

export interface TimelineCaption {
  start: number;
  end: number;
  text: string;
}

export interface RenderTimelineOptions {
  captions?: TimelineCaption[];
  captionStyle?: Record<string, unknown>;
  zoomKeyframes?: ZoomKeyframe[];
  crop?: CropRegion | null;
  signal?: AbortSignal;
}

/** Render an ordered, resolved timeline into a single MP4 blob. */
export default async function renderTimeline(
  sourceBlob: Blob,
  clips: TimelineClip[],
  onProgress: (progress: number) => void = () => {},
  options: RenderTimelineOptions = {},
): Promise<Blob> {
  const exporter = new TimelineExporter();
  const exportTimeline = exporter.export as unknown as (
    blob: Blob,
    settings: RenderTimelineOptions & {
      clips: TimelineClip[];
      onProgress: (progress: number) => void;
    },
  ) => Promise<Blob>;
  return exportTimeline.call(exporter, sourceBlob, {
    clips,
    onProgress,
    ...options,
  });
}
