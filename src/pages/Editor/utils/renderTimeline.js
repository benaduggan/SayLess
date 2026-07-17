import { TimelineExporter } from "../mediabunny/lib/timelineExporter.ts";

/**
 * Render a resolved timeline (ordered clips) into a single MP4 blob.
 * @param {Blob} sourceBlob
 * @param {{sourceStart:number,sourceEnd:number,muted?:boolean}[]} clips ordered
 * @param {(p:number)=>void} [onProgress]
 * @param {{captions?:{start:number,end:number,text:string}[],captionStyle?:Object,zoomKeyframes?:Object[],signal?:AbortSignal}} [options]
 * @returns {Promise<Blob>}
 */
export default async function renderTimeline(sourceBlob, clips, onProgress = () => {}, options = {}) {
  const exporter = new TimelineExporter();
  return exporter.export(sourceBlob, { clips, onProgress, ...options });
}
