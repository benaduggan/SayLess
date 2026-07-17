import { TimelineExporter } from "../mediabunny/lib/timelineExporter.ts";

/**
 * Render a resolved timeline's audio into a single audio file.
 * @param {Blob} sourceBlob
 * @param {{sourceStart:number,sourceEnd:number,muted?:boolean}[]} clips ordered
 * @param {(p:number)=>void} [onProgress]
 * @param {{"format"?: "wav" | "m4a", signal?: AbortSignal}} [options]
 * @returns {Promise<Blob>}
 */
export default async function renderTimelineAudio(
  sourceBlob,
  clips,
  onProgress = () => {},
  options = {},
) {
  const exporter = new TimelineExporter();
  return exporter.exportAudio(sourceBlob, {
    clips,
    onProgress,
    format: options.format || "wav",
    signal: options.signal,
  });
}
