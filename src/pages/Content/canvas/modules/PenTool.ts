import { fabric } from "../fabricCompat";

type PencilBrushCompat = InstanceType<typeof fabric.PencilBrush> & {
  _points?: unknown[];
  points?: unknown[];
  _reset?: () => void;
  drawStraightLine?: boolean;
  straightLineKey?: string;
  strokeLineCap?: CanvasLineCap;
  globalCompositeOperation?: GlobalCompositeOperation;
};

type PathCompat = InstanceType<typeof fabric.Path> & { id?: string };

interface PenCanvasObject {
  type?: string;
  id?: string;
  _objects?: PenCanvasObject[];
  set(properties: Record<string, unknown>): void;
}

interface PenCanvasEvent {
  path?: PathCompat;
}

interface PenCanvas {
  freeDrawingBrush?: PencilBrushCompat;
  add(object: InstanceType<typeof fabric.Group>): void;
  remove(object: PathCompat): void;
  requestRenderAll(): void;
  getObjects(): PenCanvasObject[];
  getActiveObject(): PenCanvasObject | undefined;
  getActiveObjects(): PenCanvasObject[];
  on(event: string, listener: (event: PenCanvasEvent) => void): void;
  off(event: string, listener: (event: PenCanvasEvent) => void): void;
}

interface PenToolState {
  tool?: string;
  strokeWidth?: number;
  color: string;
  [key: string]: unknown;
}

type SetPenToolState = (state: PenToolState) => void;

const PenTool = (
  canvas: PenCanvas,
  contentStateRef: { current?: PenToolState | null },
  setContentState: SetPenToolState,
  saveCanvas: (state: PenToolState, setter: SetPenToolState) => void,
): { removeEventListeners(): void } => {
  const getState = (): PenToolState | null | undefined => contentStateRef.current;

  const resetBrushStroke = (): void => {
    const brush = canvas.freeDrawingBrush;
    if (!brush) return;

    // Fabric versions differ; do all safe resets.
    if (Array.isArray(brush._points)) brush._points.length = 0;
    if (Array.isArray(brush.points)) brush.points.length = 0;

    // Some brushes keep a "latest" pointer
    brush._reset?.();
  };

  const ensureBrush = (): PencilBrushCompat => {
    // fabric creates freeDrawingBrush lazily; make sure it's there
    if (!canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush = new fabric.PencilBrush(
        canvas as unknown as ConstructorParameters<typeof fabric.PencilBrush>[0],
      ) as PencilBrushCompat;
    }
    return canvas.freeDrawingBrush;
  };

  const syncBrushFromState = (): void => {
    const state = getState();
    if (!state) return;

    const brush = ensureBrush();

    // reset defaults
    brush.drawStraightLine = false;
    (brush as unknown as { straightLineKey: string }).straightLineKey = "none";
    brush.strokeLineCap = "round";
    brush.globalCompositeOperation = "source-over";

    if (state.tool === "pen") {
      brush.width = (state.strokeWidth || 2) * 4;
      brush.color = state.color;
      resetBrushStroke();
      return;
    }

    if (state.tool === "highlighter") {
      brush.width = (state.strokeWidth || 2) * 10;
      brush.color = new fabric.Color(state.color).setAlpha(0.5).toRgba();
      brush.globalCompositeOperation = "destination-over";
      brush.strokeLineCap = "square";
      resetBrushStroke();
    }
  };

  // Sync brush on interactions so tool switches apply immediately
  const onMouseDown = (): void => {
    syncBrushFromState();
  };

  const onMouseUp = (): void => {
    const state = getState();
    if (!state) return;
    if (state.tool !== "pen" && state.tool !== "highlighter") return;

    // Save with latest state
    // If you updated saveCanvas to accept ref, use: saveCanvas(contentStateRef, setContentState)
    saveCanvas(state, setContentState);
  };

  const onPathCreated = (o: PenCanvasEvent): void => {
    // Only wrap paths if we were drawing (pen/highlighter)
    const state = getState();
    if (!state) return;
    if (state.tool !== "pen" && state.tool !== "highlighter") return;

    const path = o.path;
    if (!path) return;

    const pathCopy = new fabric.Path(path.path, {
      id: "select-stroke",
      stroke: "#0D99FF",
      strokeWidth: 2,
      fill: null,
      opacity: 0,
      selectable: false,
      evented: false,
    } as ConstructorParameters<typeof fabric.Path>[1]) as PathCompat;

    const group = new fabric.Group([path, pathCopy], {
      selectable: true,
      evented: true,
      id: "select-group",
      subTargetCheck: true,
      perPixelTargetFind: true,
      hasControls: false,
      hasBorders: false,
    } as ConstructorParameters<typeof fabric.Group>[1]);

    canvas.add(group);
    canvas.remove(path);
    canvas.requestRenderAll();
  };

  const hideAllSelectStrokes = (): void => {
    canvas.getObjects().forEach((obj) => {
      if (obj.type === "group") {
        obj._objects?.forEach((child) => {
          if (child.id === "select-stroke") child.set({ opacity: 0 });
        });
      }
    });
  };

  const activateStroke = (): void => {
    const state = getState();
    if (!state) return;
    if (state.tool !== "select") return;

    hideAllSelectStrokes();

    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.id === "select-group") {
      activeObject._objects?.forEach((child) => {
        if (child.id === "select-stroke") child.set({ opacity: 1 });
      });
    }

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects && activeObjects.length > 1) {
      activeObjects.forEach((obj) => {
        if (obj.id === "select-group") {
          obj._objects?.forEach((child) => {
            if (child.id === "select-stroke") child.set({ opacity: 1 });
          });
        }
      });
    }

    canvas.requestRenderAll();
  };

  const deactivateStroke = (): void => {
    hideAllSelectStrokes();
    canvas.requestRenderAll();
  };

  // Attach once
  canvas.on("mouse:down", onMouseDown);
  canvas.on("mouse:up", onMouseUp);
  canvas.on("path:created", onPathCreated);
  canvas.on("selection:created", activateStroke);
  canvas.on("selection:updated", activateStroke);
  canvas.on("selection:cleared", deactivateStroke);

  // Initial sync
  syncBrushFromState();

  return {
    removeEventListeners: () => {
      canvas.off("mouse:down", onMouseDown);
      canvas.off("mouse:up", onMouseUp);
      canvas.off("path:created", onPathCreated);
      canvas.off("selection:created", activateStroke);
      canvas.off("selection:updated", activateStroke);
      canvas.off("selection:cleared", deactivateStroke);
    },
  };
};

export default PenTool;
