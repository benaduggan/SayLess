import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { Dispatch, MutableRefObject, PropsWithChildren, SetStateAction } from "react";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { loadSegmentationModel, loadEffect } from "../utils/backgroundUtils";
import { initializeCanvases, setupCanvasContexts } from "../utils/canvasUtils";

export interface CameraContextValue {
  width: string;
  height: string;
  backgroundEffects: boolean;
  isModelLoaded: boolean;
  pipMode: boolean;
  isCameraMode: boolean;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  streamRef: MutableRefObject<MediaStream>;
  recordingTypeRef: MutableRefObject<string>;
  offScreenCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  offScreenCanvasContextRef: MutableRefObject<CanvasRenderingContext2D | null>;
  segmenterRef: MutableRefObject<ImageSegmenter | null>;
  blurRef: MutableRefObject<boolean>;
  effectRef: MutableRefObject<HTMLImageElement | null>;
  setWidth: (width: string) => void;
  setHeight: (height: string) => void;
  setBackgroundEffects: (active: boolean) => void;
  setPipMode: Dispatch<SetStateAction<boolean>>;
  setIsCameraMode: Dispatch<SetStateAction<boolean>>;
  loadCustomEffect: (effectUrl: string | null) => Promise<boolean | undefined>;
  enableBlur: (enabled: boolean) => boolean;
  setCustomEffect: (effectUrl: string) => Promise<boolean>;
  clearEffect: () => boolean;
}

type CameraGlobalRefs = Partial<
  Pick<
    CameraContextValue,
    | "videoRef"
    | "streamRef"
    | "recordingTypeRef"
    | "offScreenCanvasRef"
    | "offScreenCanvasContextRef"
    | "segmenterRef"
    | "blurRef"
    | "effectRef"
    | "setWidth"
    | "setHeight"
    | "setBackgroundEffects"
  >
> & {
  backgroundEffectsRef?: MutableRefObject<boolean>;
  bottomCanvasRef?: MutableRefObject<HTMLCanvasElement | null>;
  bottomCanvasContextRef?: MutableRefObject<CanvasRenderingContext2D | null>;
  setPipMode?: Dispatch<SetStateAction<boolean>>;
  setIsCameraMode?: Dispatch<SetStateAction<boolean>>;
  width?: string | null;
  height?: string | null;
};

const CameraContext = createContext<CameraContextValue | null>(null);

export const globalRefs: CameraGlobalRefs = {};

export const useCameraContext = (): CameraContextValue => {
  const context = useContext(CameraContext);
  if (!context) throw new Error("useCameraContext requires CameraProvider");
  return context;
};

export const getContextRefs = () => {
  const missingRefs: string[] = [];

  if (!globalRefs.videoRef) missingRefs.push("videoRef");
  if (!globalRefs.streamRef) missingRefs.push("streamRef");
  if (!globalRefs.recordingTypeRef) missingRefs.push("recordingTypeRef");
  if (!globalRefs.offScreenCanvasRef) missingRefs.push("offScreenCanvasRef");
  if (!globalRefs.offScreenCanvasContextRef) missingRefs.push("offScreenCanvasContextRef");
  if (!globalRefs.segmenterRef) missingRefs.push("segmenterRef");
  if (!globalRefs.blurRef) missingRefs.push("blurRef");
  if (!globalRefs.effectRef) missingRefs.push("effectRef");
  if (!globalRefs.setWidth) missingRefs.push("setWidth");
  if (!globalRefs.setHeight) missingRefs.push("setHeight");
  if (!globalRefs.setBackgroundEffects) missingRefs.push("setBackgroundEffects");
  if (!globalRefs.backgroundEffectsRef) missingRefs.push("backgroundEffectsRef");

  if (missingRefs.length > 0) {
    console.warn(`⚠️ Some context references are not initialized yet: ${missingRefs.join(", ")}`);
  }

  return {
    videoRef: globalRefs.videoRef ?? { current: null },
    streamRef: globalRefs.streamRef ?? { current: new MediaStream() },
    recordingTypeRef: globalRefs.recordingTypeRef ?? { current: "screen" },
    offScreenCanvasRef: globalRefs.offScreenCanvasRef ?? { current: null },
    offScreenCanvasContextRef: globalRefs.offScreenCanvasContextRef ?? {
      current: null,
    },
    segmenterRef: globalRefs.segmenterRef ?? { current: null },
    blurRef: globalRefs.blurRef ?? { current: false },
    effectRef: globalRefs.effectRef ?? { current: null },
    setWidth:
      globalRefs.setWidth ?? ((_width: string) => console.warn("⚠️ setWidth not initialized")),
    setHeight:
      globalRefs.setHeight ?? ((_height: string) => console.warn("⚠️ setHeight not initialized")),
    setBackgroundEffects: globalRefs.setBackgroundEffects ?? (() => {}),
    backgroundEffectsRef: globalRefs.backgroundEffectsRef ?? { current: false },
    bottomCanvasRef: globalRefs.bottomCanvasRef ?? { current: null },
    bottomCanvasContextRef: globalRefs.bottomCanvasContextRef ?? { current: null },
    setPipMode: globalRefs.setPipMode ?? (() => {}),
    setIsCameraMode: globalRefs.setIsCameraMode ?? (() => {}),
  };
};

export const CameraProvider = ({ children }: PropsWithChildren) => {
  const [width, setWidth] = useState("auto");
  const [height, setHeight] = useState("100%");
  const [backgroundEffects, setBackgroundEffects] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [pipMode, setPipMode] = useState(false);
  const [isCameraMode, setIsCameraMode] = useState(false);

  const backgroundEffectsRef = useRef(false);
  const recordingTypeRef = useRef("screen");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef(new MediaStream());

  const offScreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offScreenCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const blurRef = useRef(false);
  const effectRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const { offScreenCanvas, offScreenCanvasContext } = initializeCanvases();

    offScreenCanvasRef.current = offScreenCanvas;
    offScreenCanvasContextRef.current = offScreenCanvasContext;

    globalRefs.videoRef = videoRef;
    globalRefs.streamRef = streamRef;
    globalRefs.recordingTypeRef = recordingTypeRef;
    globalRefs.offScreenCanvasRef = offScreenCanvasRef;
    globalRefs.offScreenCanvasContextRef = offScreenCanvasContextRef;
    globalRefs.segmenterRef = segmenterRef;
    globalRefs.blurRef = blurRef;
    globalRefs.effectRef = effectRef;
    globalRefs.setWidth = handleSetWidth;
    globalRefs.setHeight = handleSetHeight;
    globalRefs.setBackgroundEffects = handleSetBackgroundEffects;
    globalRefs.backgroundEffectsRef = backgroundEffectsRef;
    globalRefs.setPipMode = setPipMode;
    globalRefs.setIsCameraMode = setIsCameraMode;

    const initializeModel = async () => {
      try {
        const model = await loadSegmentationModel();
        if (model) {
          segmenterRef.current = model;
          setIsModelLoaded(true);
        } else {
          console.warn("Segmentation model unavailable, disabling background effects");
          handleSetBackgroundEffects(false);
        }
      } catch (error) {
        console.error("Failed to load segmentation model:", error);
        handleSetBackgroundEffects(false);
      }
    };

    initializeModel();

    chrome.storage.local.get(["backgroundEffect"], (result) => {
      if (result.backgroundEffect === "blur") {
        blurRef.current = true;
      } else if (result.backgroundEffect) {
        blurRef.current = false;
        loadCustomEffect(String(result.backgroundEffect));
      }
    });

    return () => {
      segmenterRef.current = null;
      setIsModelLoaded(false);
    };
  }, []);

  useEffect(() => {
    backgroundEffectsRef.current = backgroundEffects;
  }, [backgroundEffects]);

  const handleSetBackgroundEffects = useCallback(
    (active: boolean) => {
      setBackgroundEffects(active);
      backgroundEffectsRef.current = active;
      if (videoRef.current) {
        videoRef.current.style.display = !active ? "block" : "none";
      }
      chrome.storage.local.set({ backgroundEffectsActive: active });
    },
    [videoRef],
  );

  const handleSetWidth = useCallback(
    (newWidth: string) => {
      setWidth(newWidth);
      if (videoRef.current) {
        videoRef.current.style.width = newWidth;
      }
    },
    [videoRef],
  );

  const handleSetHeight = useCallback(
    (newHeight: string) => {
      setHeight(newHeight);
      if (videoRef.current) {
        videoRef.current.style.height = newHeight;
      }
    },
    [videoRef],
  );

  const loadCustomEffect = async (effectUrl: string | null): Promise<boolean | undefined> => {
    try {
      if (!effectUrl) {
        effectRef.current = null;
        return;
      }

      const image = await loadEffect(effectUrl);
      effectRef.current = image;

      return true;
    } catch (error) {
      console.error("Failed to load custom effect:", error);
      return false;
    }
  };

  const enableBlur = (enabled: boolean): boolean => {
    blurRef.current = enabled;

    chrome.storage.local.set({ backgroundEffect: enabled ? "blur" : "" });

    return enabled;
  };

  const setCustomEffect = async (effectUrl: string): Promise<boolean> => {
    try {
      const success = await loadCustomEffect(effectUrl);

      if (success) {
        blurRef.current = false;

        chrome.storage.local.set({ backgroundEffect: effectUrl });

        return true;
      }

      return false;
    } catch (error) {
      console.error("Error setting custom effect:", error);
      return false;
    }
  };

  const clearEffect = (): boolean => {
    blurRef.current = false;
    effectRef.current = null;

    chrome.storage.local.set({ backgroundEffect: "" });

    return true;
  };

  // Memoized so consumers (Camera, Background) only re-render when one
  // of the actual state values changes. Refs and setters are stable
  // identities anyway; without memoization a fresh object every render
  // forced every consumer to re-render on any provider re-render.
  const contextValue = useMemo(
    () => ({
      width,
      height,
      backgroundEffects,
      isModelLoaded,
      pipMode,
      isCameraMode,
      videoRef,
      streamRef,
      recordingTypeRef,
      offScreenCanvasRef,
      offScreenCanvasContextRef,
      segmenterRef,
      blurRef,
      effectRef,
      setWidth: handleSetWidth,
      setHeight: handleSetHeight,
      setBackgroundEffects: handleSetBackgroundEffects,
      setPipMode,
      setIsCameraMode,
      loadCustomEffect,
      enableBlur,
      setCustomEffect,
      clearEffect,
    }),
    [width, height, backgroundEffects, isModelLoaded, pipMode, isCameraMode],
  );

  return <CameraContext.Provider value={contextValue}>{children}</CameraContext.Provider>;
};

export default CameraProvider;
