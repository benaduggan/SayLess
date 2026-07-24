// Lazy-load @mediapipe/tasks-vision; ~133KB of code only needed when
// the user enables background effects on the camera. Eager import was
// adding the cost to every camera-bubble mount even for users who
// never touch effects.
import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";

type MediapipeModule = typeof import("@mediapipe/tasks-vision");
type VisionFileset = Awaited<ReturnType<MediapipeModule["FilesetResolver"]["forVisionTasks"]>>;
type SegmentationResultWithMask = ImageSegmenterResult & {
  categoryMask: NonNullable<ImageSegmenterResult["categoryMask"]>;
};

interface MutableRef<T> {
  current: T | null;
}

let _mpPromise: Promise<MediapipeModule> | null = null;
const loadMediapipe = (): Promise<MediapipeModule> => {
  if (!_mpPromise) {
    _mpPromise = import("@mediapipe/tasks-vision");
  }
  return _mpPromise;
};

// Reused across frames to avoid GC pressure.
let _frameCanvas: HTMLCanvasElement | null = null;
let _frameCtx: CanvasRenderingContext2D | null = null;
let _blurCanvas: HTMLCanvasElement | null = null;
let _blurCtx: CanvasRenderingContext2D | null = null;
let _maskCanvas: HTMLCanvasElement | null = null;
let _maskCtx: CanvasRenderingContext2D | null = null;
let _smoothMaskCanvas: HTMLCanvasElement | null = null;
let _smoothMaskCtx: CanvasRenderingContext2D | null = null;
let _personCanvas: HTMLCanvasElement | null = null;
let _personCtx: CanvasRenderingContext2D | null = null;

function getReusableCanvases(): {
  frameCanvas: HTMLCanvasElement;
  frameCtx: CanvasRenderingContext2D;
  blurCanvas: HTMLCanvasElement;
  blurCtx: CanvasRenderingContext2D;
  maskCanvas: HTMLCanvasElement;
  maskCtx: CanvasRenderingContext2D;
  smoothMaskCanvas: HTMLCanvasElement;
  smoothMaskCtx: CanvasRenderingContext2D;
  personCanvas: HTMLCanvasElement;
  personCtx: CanvasRenderingContext2D;
} {
  if (!_frameCanvas) {
    _frameCanvas = document.createElement("canvas");
    _frameCtx = _frameCanvas.getContext("2d");
    _blurCanvas = document.createElement("canvas");
    _blurCtx = _blurCanvas.getContext("2d");
    _maskCanvas = document.createElement("canvas");
    _maskCtx = _maskCanvas.getContext("2d");
    _smoothMaskCanvas = document.createElement("canvas");
    _smoothMaskCtx = _smoothMaskCanvas.getContext("2d");
    _personCanvas = document.createElement("canvas");
    _personCtx = _personCanvas.getContext("2d");
  }
  if (
    !_frameCanvas ||
    !_frameCtx ||
    !_blurCanvas ||
    !_blurCtx ||
    !_maskCanvas ||
    !_maskCtx ||
    !_smoothMaskCanvas ||
    !_smoothMaskCtx ||
    !_personCanvas ||
    !_personCtx
  ) {
    throw new Error("background-effect-canvas-context-unavailable");
  }
  return {
    frameCanvas: _frameCanvas,
    frameCtx: _frameCtx,
    blurCanvas: _blurCanvas,
    blurCtx: _blurCtx,
    maskCanvas: _maskCanvas,
    maskCtx: _maskCtx,
    smoothMaskCanvas: _smoothMaskCanvas,
    smoothMaskCtx: _smoothMaskCtx,
    personCanvas: _personCanvas,
    personCtx: _personCtx,
  };
}

let _maskImageDataCache: ImageData | null = null;
let _maskImageDataCacheSize = 0;

function getOrCreateMaskImageData(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): ImageData {
  const size = width * height;
  if (_maskImageDataCache && _maskImageDataCacheSize === size) {
    return _maskImageDataCache;
  }
  _maskImageDataCache = ctx.createImageData(width, height);
  _maskImageDataCacheSize = size;
  return _maskImageDataCache;
}

// Bound the model load; MediaPipe's wasm/tflite fetch can hang on flaky
// networks, blocked CDNs, or corrupted bundles.
const MODEL_LOAD_TIMEOUT_MS = 12000;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}-timeout-${ms}ms`)), ms),
    ),
  ]);

const tryCreateSegmenter = async (
  vision: VisionFileset,
  delegate: "CPU" | "GPU",
): Promise<ImageSegmenter> => {
  const { ImageSegmenter } = await loadMediapipe();
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./assets/mediapipeVision/selfie_segmenter.tflite",
      delegate,
    },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: "VIDEO",
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const loadSegmentationModel = async (): Promise<ImageSegmenter | null> => {
  try {
    const { FilesetResolver } = await loadMediapipe();
    const vision = await withTimeout(
      FilesetResolver.forVisionTasks("./assets/mediapipeVision"),
      MODEL_LOAD_TIMEOUT_MS,
      "fileset-resolver",
    );

    // GPU path; fall back to CPU on systems without WebGL2 or with bad
    // GPU drivers (old Intel iGPUs, Linux, some VMs).
    try {
      const gpu = await withTimeout(
        tryCreateSegmenter(vision, "GPU"),
        MODEL_LOAD_TIMEOUT_MS,
        "segmenter-gpu",
      );
      try {
        chrome.runtime.sendMessage({
          type: "diag-forward",
          event: "recorder-segmenter-loaded",
          data: { delegate: "GPU" },
        });
      } catch {}
      return gpu;
    } catch (gpuErr) {
      console.warn("[SayLess] GPU segmenter failed, falling back to CPU:", gpuErr);
      try {
        chrome.runtime.sendMessage({
          type: "diag-forward",
          event: "recorder-segmenter-gpu-fallback",
          data: { error: errorMessage(gpuErr).slice(0, 200) },
        });
      } catch {}
      const cpu = await withTimeout(
        tryCreateSegmenter(vision, "CPU"),
        MODEL_LOAD_TIMEOUT_MS,
        "segmenter-cpu",
      );
      try {
        chrome.runtime.sendMessage({
          type: "diag-forward",
          event: "recorder-segmenter-loaded",
          data: { delegate: "CPU" },
        });
      } catch {}
      return cpu;
    }
  } catch (error) {
    console.error("Error loading segmentation model:", error);
    try {
      chrome.runtime.sendMessage({
        type: "diag-forward",
        event: "recorder-segmenter-load-failed",
        data: { error: errorMessage(error).slice(0, 200) },
      });
    } catch {}
    return null;
  }
};

// segmentForVideo's callback fires synchronously, so the result can be returned directly.
export const segmentFromVideo = (
  videoElement: HTMLVideoElement | null,
  segmenter: ImageSegmenter | null,
): SegmentationResultWithMask | null => {
  if (!videoElement || !segmenter) return null;
  if (videoElement.readyState < 2 || videoElement.videoWidth === 0) return null;

  try {
    const timestampMs = performance.now();
    let result: ImageSegmenterResult | null = null;

    segmenter.segmentForVideo(videoElement, timestampMs, (r: ImageSegmenterResult) => {
      result = r;
    });

    const completedResult = result as ImageSegmenterResult | null;
    if (!completedResult?.categoryMask) return null;
    return completedResult as SegmentationResultWithMask;
  } catch (error) {
    console.error("Error during segmentation:", error);
    return null;
  }
};

function buildSmoothedMask(
  segmentationResult: SegmentationResultWithMask,
  edgeBlurAmount: number,
  personOpaque: boolean,
): { smoothMaskCanvas: HTMLCanvasElement; maskW: number; maskH: number } {
  const mask = segmentationResult.categoryMask;
  const maskData = mask.getAsUint8Array();
  const maskW = mask.width;
  const maskH = mask.height;

  const { maskCanvas, maskCtx, smoothMaskCanvas, smoothMaskCtx } = getReusableCanvases();

  if (maskCanvas.width !== maskW || maskCanvas.height !== maskH) {
    maskCanvas.width = maskW;
    maskCanvas.height = maskH;
    smoothMaskCanvas.width = maskW;
    smoothMaskCanvas.height = maskH;
  }

  const maskImageData = getOrCreateMaskImageData(maskCtx, maskW, maskH);
  const maskPixels = maskImageData.data;

  for (let i = 0; i < maskData.length; i++) {
    const offset = i * 4;
    const isPerson = maskData[i] === 1;
    if (personOpaque) {
      maskPixels[offset] = 255;
      maskPixels[offset + 1] = 255;
      maskPixels[offset + 2] = 255;
      maskPixels[offset + 3] = isPerson ? 255 : 0;
    } else {
      // For destination-out masking.
      maskPixels[offset] = 0;
      maskPixels[offset + 1] = 0;
      maskPixels[offset + 2] = 0;
      maskPixels[offset + 3] = isPerson ? 0 : 255;
    }
  }
  maskCtx.putImageData(maskImageData, 0, 0);

  smoothMaskCtx.clearRect(0, 0, maskW, maskH);
  smoothMaskCtx.filter = `blur(${edgeBlurAmount}px)`;
  smoothMaskCtx.drawImage(maskCanvas, 0, 0);
  smoothMaskCtx.filter = "none";

  return { smoothMaskCanvas, maskW, maskH };
}

export const renderBlurFromVideo = (
  videoElement: HTMLVideoElement | null,
  segmentationResult: SegmentationResultWithMask | null,
  canvasRef: MutableRef<HTMLCanvasElement>,
): boolean => {
  if (!videoElement || !segmentationResult || !canvasRef.current) return false;

  try {
    const backgroundBlurAmount = 16;
    const edgeBlurAmount = 8;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;

    const { frameCanvas, frameCtx, blurCanvas, blurCtx, personCanvas, personCtx } =
      getReusableCanvases();

    if (frameCanvas.width !== vw || frameCanvas.height !== vh) {
      frameCanvas.width = vw;
      frameCanvas.height = vh;
      blurCanvas.width = vw;
      blurCanvas.height = vh;
    }

    frameCtx.drawImage(videoElement, 0, 0);

    blurCtx.filter = `blur(${backgroundBlurAmount}px)`;
    blurCtx.drawImage(frameCanvas, 0, 0);
    blurCtx.filter = "none";

    const { smoothMaskCanvas, maskW, maskH } = buildSmoothedMask(
      segmentationResult,
      edgeBlurAmount,
      true,
    );

    const ratio = vw / vh;
    const outW = Math.round(window.innerHeight * ratio);
    const outH = window.innerHeight;

    if (canvasRef.current.width !== outW || canvasRef.current.height !== outH) {
      canvasRef.current.width = outW;
      canvasRef.current.height = outH;
    }

    if (personCanvas.width !== outW || personCanvas.height !== outH) {
      personCanvas.width = outW;
      personCanvas.height = outH;
    }

    const outputCtx = canvasRef.current.getContext("2d");
    if (!outputCtx) return false;

    outputCtx.drawImage(blurCanvas, 0, 0, vw, vh, 0, 0, outW, outH);

    personCtx.clearRect(0, 0, outW, outH);
    personCtx.globalCompositeOperation = "source-over";
    personCtx.drawImage(smoothMaskCanvas, 0, 0, maskW, maskH, 0, 0, outW, outH);
    personCtx.globalCompositeOperation = "source-in";
    personCtx.drawImage(frameCanvas, 0, 0, vw, vh, 0, 0, outW, outH);

    outputCtx.drawImage(personCanvas, 0, 0);

    return true;
  } catch (error) {
    console.error("Error rendering blur:", error);
    return false;
  }
};

export const renderPersonCutoutFromVideo = (
  videoElement: HTMLVideoElement | null,
  segmentationResult: SegmentationResultWithMask | null,
  canvasRef: MutableRef<HTMLCanvasElement>,
  canvasContextRef: MutableRef<CanvasRenderingContext2D>,
): boolean => {
  if (!videoElement || !segmentationResult || !canvasRef.current) return false;

  try {
    const edgeBlurAmount = 4;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;

    const { frameCanvas, frameCtx, personCanvas, personCtx } = getReusableCanvases();

    if (frameCanvas.width !== vw || frameCanvas.height !== vh) {
      frameCanvas.width = vw;
      frameCanvas.height = vh;
    }

    frameCtx.drawImage(videoElement, 0, 0);

    const { smoothMaskCanvas, maskW, maskH } = buildSmoothedMask(
      segmentationResult,
      edgeBlurAmount,
      true,
    );

    const canvas = canvasRef.current;
    const ctx = canvasContextRef.current;
    if (!ctx) return false;

    if (personCanvas.width !== canvas.width || personCanvas.height !== canvas.height) {
      personCanvas.width = canvas.width;
      personCanvas.height = canvas.height;
    }

    personCtx.clearRect(0, 0, canvas.width, canvas.height);
    personCtx.globalCompositeOperation = "source-over";
    personCtx.drawImage(smoothMaskCanvas, 0, 0, maskW, maskH, 0, 0, canvas.width, canvas.height);
    personCtx.globalCompositeOperation = "source-in";
    personCtx.drawImage(frameCanvas, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(personCanvas, 0, 0);

    return true;
  } catch (error) {
    console.error("Error rendering person cutout:", error);
    return false;
  }
};

export const loadEffect = (
  effectUrl: string | null | undefined,
): Promise<HTMLImageElement | null> => {
  return new Promise<HTMLImageElement | null>((resolve, reject) => {
    if (!effectUrl) {
      resolve(null);
      return;
    }

    const img = new Image();
    img.src = effectUrl;
    img.onload = () => resolve(img);
    img.onerror = (error) => {
      console.error("Failed to load effect image:", error);
      reject(error);
    };
  });
};

export const renderEffectBackground = (
  effectImg: HTMLImageElement | null,
  bottomCanvasRef: MutableRef<HTMLCanvasElement>,
  bottomCanvasContextRef: MutableRef<CanvasRenderingContext2D>,
): boolean => {
  if (!effectImg || !bottomCanvasRef.current || !bottomCanvasContextRef.current) return false;

  try {
    const canvas = bottomCanvasRef.current;
    const ctx = bottomCanvasContextRef.current;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const imgRatio = effectImg.width / effectImg.height;
    const canvasRatio = canvas.width / canvas.height;
    let drawWidth = canvas.width;
    let drawHeight = canvas.height;

    if (canvasRatio > imgRatio) {
      drawWidth = canvas.height * imgRatio;
      drawHeight = canvas.height;
    } else {
      drawWidth = canvas.width;
      drawHeight = canvas.width / imgRatio;
    }

    const x = (canvas.width - drawWidth) / 2;
    const y = (canvas.height - drawHeight) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(effectImg, x, y, drawWidth, drawHeight);

    return true;
  } catch (error) {
    console.error("Error rendering effect background:", error);
    return false;
  }
};
