declare module "gif.js" {
  interface GifOptions {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
  }

  interface GifFrameOptions {
    copy?: boolean;
    delay?: number;
  }

  export default class GIF {
    constructor(options?: GifOptions);
    addFrame(frame: CanvasImageSource, options?: GifFrameOptions): void;
    on(event: "finished", listener: (blob: Blob) => void): void;
    on(event: "progress", listener: (progress: number) => void): void;
    render(): void;
  }
}
