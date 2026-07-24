import { fabric } from "../fabricCompat";

type FabricImageInstance = InstanceType<typeof fabric.Image>;

interface SelectableCanvasObject {
  selectable: boolean;
}

interface ImageCanvasEvent {
  e: Event;
}

interface ImageCanvas {
  getPointer(event: Event): { x: number; y: number };
  requestRenderAll(): void;
  setActiveObject(object: FabricImageInstance): void;
  forEachObject(callback: (object: SelectableCanvasObject) => void): void;
  add(object: FabricImageInstance): void;
  bringToFront(object: FabricImageInstance): void;
  remove(object: FabricImageInstance): void;
  on(event: string, listener: (event: ImageCanvasEvent) => void): void;
  off(event: string, listener: (event: ImageCanvasEvent) => void): void;
}

type ToolSettings = Record<string, unknown>;
type SetToolSettings = (settings: ToolSettings) => void;

interface ImageToolContentState {
  openToast(message: string, onCancel: () => void): void;
}

const ImageTool = (
  canvas: ImageCanvas,
  src: string,
  toolSettings: ToolSettings,
  setToolSettings: SetToolSettings,
  saveCanvas: (settings: ToolSettings, setSettings: SetToolSettings) => void,
  contentState: ImageToolContentState,
): { removeEventListeners(): void } => {
  const image = new Image();
  let fabricImage: FabricImageInstance | null = null;

  image.src = src;

  const state = {
    isPlacing: true,
  };

  const cleanup = (): void => {
    state.isPlacing = false;
    canvas.off("mouse:move", onMouseMove);
    canvas.off("mouse:down", onMouseDown);
    canvas.off("mouse:up", onMouseUp);
  };

  const onMouseMove = (o: ImageCanvasEvent): void => {
    if (!fabricImage || !state.isPlacing) return;
    const pointer = canvas.getPointer(o.e);
    fabricImage.set({ left: pointer.x, top: pointer.y });
    fabricImage.setCoords();
    canvas.requestRenderAll();
  };

  const onMouseDown = (): void => {
    if (!fabricImage || !state.isPlacing) return;
    state.isPlacing = false;

    fabricImage.set({
      opacity: 1,
      selectable: true,
    });
    fabricImage.setCoords();

    canvas.setActiveObject(fabricImage);
    canvas.requestRenderAll();

    saveCanvas(toolSettings, setToolSettings);
    setToolSettings({ ...toolSettings, tool: "select", isAddingImage: false });

    // Make other objects selectable again
    canvas.forEachObject((obj) => {
      obj.selectable = true;
    });

    cleanup();
  };

  const onMouseUp = (): void => {};

  image.onload = () => {
    fabricImage = new fabric.Image(image);
    fabricImage.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      strokeUniform: true,
      fill: "transparent",
      angle: 0,
      noScaleCache: false,
      opacity: 0.5,
      selectable: false,
    });

    // Scale down
    const maxWidth = 500;
    const maxHeight = 500;
    const width = fabricImage.width;
    const height = fabricImage.height;
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    fabricImage.scale(ratio);

    canvas.add(fabricImage);
    canvas.bringToFront(fabricImage);
    canvas.requestRenderAll();

    // Make other objects unselectable
    canvas.forEachObject((obj) => {
      obj.selectable = false;
    });

    canvas.on("mouse:move", onMouseMove);
    canvas.on("mouse:down", onMouseDown);
    canvas.on("mouse:up", onMouseUp);

    // Open toast cancel handler
    contentState.openToast(chrome.i18n.getMessage("addImageToastTitle"), () => {
      if (fabricImage) {
        canvas.remove(fabricImage);
        canvas.requestRenderAll();
      }
      setToolSettings({
        ...toolSettings,
        tool: "select",
        isAddingImage: false,
      });
      canvas.forEachObject((obj) => (obj.selectable = true));
      cleanup();
    });
  };

  return {
    removeEventListeners: cleanup,
  };
};

export default ImageTool;
