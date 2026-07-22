import { fabric } from "../fabricCompat";

interface ArrowObject {
  id?: string;
  type?: string;
  left: number;
  top: number;
  group?: ArrowObject;
  _objects?: ArrowObject[];
  set(properties: Record<string, unknown>): void;
  setCoords(): void;
  _restoreObjectsState(): void;
}

interface ArrowCanvasEvent {
  e: Event;
  subTargets?: ArrowObject[];
}

interface ArrowCanvas {
  selection: boolean;
  getPointer(event: Event): { x: number; y: number };
  add(object: ArrowObject): void;
  remove(object: ArrowObject): void;
  requestRenderAll(): void;
  discardActiveObject(): void;
  setActiveObject(object: ArrowObject): void;
  getActiveObject(): ArrowObject | undefined;
  getObjects(): ArrowObject[];
  on(event: string, listener: (event: ArrowCanvasEvent) => void): void;
  off(event: string, listener: (event: ArrowCanvasEvent) => void): void;
}

interface ArrowToolState {
  drawingMode?: boolean;
  tool?: string;
  color: string;
  strokeWidth?: number;
  [key: string]: unknown;
}

type SetArrowToolState = (state: ArrowToolState) => void;
type GetArrowToolState = () => ArrowToolState | null | undefined;
type SaveArrowCanvas = (
  state: ArrowToolState,
  setter: SetArrowToolState
) => void;

const createArrowLine = (
  x: number,
  y: number,
  color: string,
  strokeWidth?: number
): ArrowObject => {
  return new fabric.Line([x, y, x, y], {
    strokeWidth: (strokeWidth || 2) * 6,
    stroke: color,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
    id: "arrowLine",
    objectCaching: false,
  } as ConstructorParameters<typeof fabric.Line>[1]) as unknown as ArrowObject;
};

const createArrowHead = (
  x: number,
  y: number,
  color: string,
  strokeWidth?: number
): ArrowObject => {
  const size = (strokeWidth || 2) * 16;
  return new fabric.Triangle({
    width: size,
    height: size,
    left: x,
    top: y,
    fill: color,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
    id: "arrowHead",
    objectCaching: false,
  } as ConstructorParameters<typeof fabric.Triangle>[0]) as unknown as ArrowObject;
};

const createArrowCircle = (x: number, y: number, id: string): ArrowObject => {
  return new fabric.Circle({
    radius: 5,
    fill: "white",
    stroke: "#0D99FF",
    strokeWidth: 2,
    left: x,
    top: y,
    selectable: false,
    evented: true,
    id,
    opacity: 0,
    objectCaching: false,
  } as ConstructorParameters<typeof fabric.Circle>[0]) as unknown as ArrowObject;
};

const createArrowLineControl = (x: number, y: number): ArrowObject => {
  return new fabric.Line([x, y, x, y], {
    strokeWidth: 2,
    stroke: "#0D99FF",
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
    id: "arrowLineControl",
    opacity: 0,
    objectCaching: false,
  } as ConstructorParameters<typeof fabric.Line>[1]) as unknown as ArrowObject;
};

const ArrowTool = (
  canvas: ArrowCanvas,
  contentStateRef: { current?: ArrowToolState | null },
  setContentState: SetArrowToolState,
  saveCanvas: SaveArrowCanvas
): { removeEventListeners(): void } => {
  const getState: GetArrowToolState = () => contentStateRef.current;

  let arrowPoints: Array<{ x: number; y: number }> = [];
  let arrowLine: ArrowObject | null = null;
  let arrowHead: ArrowObject | null = null;
  let arrowCircle1: ArrowObject | null = null;
  let arrowCircle2: ArrowObject | null = null;
  let arrowLineControl: ArrowObject | null = null;

  // --- endpoint drag handler (store ref so we can remove safely)
  const onEndpointMouseDown = (e: ArrowCanvasEvent): void => {
    // Only when selecting / interacting with existing arrows
    if (!e?.subTargets?.length) return;

    const state = getState();
    // Allow endpoint dragging even if tool != arrow, but only in drawingMode
    if (!state?.drawingMode) return;

    const hit = e.subTargets.find(
      (obj) => obj?.id === "arrowCircle1" || obj?.id === "arrowCircle2"
    );
    if (!hit) return;

    moveArrowCircle(canvas, hit, getState, saveCanvas, setContentState);
  };

  const moveArrowCircle = (
    targetCanvas: ArrowCanvas,
    arrowCircle: ArrowObject,
    readState: GetArrowToolState,
    persistCanvas: SaveArrowCanvas,
    setState: SetArrowToolState
  ): void => {
    let isDown = true;

    const group = arrowCircle.group;
    const items = group?._objects;
    if (!group || !items) return;

    const arrowCircle1 = items.find((item) => item.id === "arrowCircle1");
    const arrowCircle2 = items.find((item) => item.id === "arrowCircle2");
    const arrowLine = items.find((item) => item.id === "arrowLine");
    const arrowHead = items.find((item) => item.id === "arrowHead");
    const arrowLineControl = items.find(
      (item) => item.id === "arrowLineControl"
    );

    if (
      !arrowCircle1 ||
      !arrowCircle2 ||
      !arrowLine ||
      !arrowHead ||
      !arrowLineControl
    )
      return;

    arrowLineControl.set({ opacity: 0 });

    // Ungroup temporarily so we can edit in canvas coords
    group._restoreObjectsState();
    targetCanvas.remove(group);
    items.forEach((item) => targetCanvas.add(item));
    targetCanvas.requestRenderAll();

    const updateGeometry = (): void => {
      const x1 = arrowCircle1.left + 5;
      const y1 = arrowCircle1.top + 5;
      const x2 = arrowCircle2.left + 5;
      const y2 = arrowCircle2.top + 5;

      arrowLine.set({ x1, y1, x2, y2 });
      arrowLineControl.set({ x1, y1, x2, y2 });

      arrowLine.setCoords();
      arrowLineControl.setCoords();

      const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      arrowHead.set({ angle: angle + 90, left: x2, top: y2 });
      arrowHead.setCoords();
    };

    const onMove = (o: ArrowCanvasEvent): void => {
      if (!isDown) return;

      const pointer = targetCanvas.getPointer(o.e);
      arrowCircle.set({ left: pointer.x - 5, top: pointer.y - 5 });
      arrowCircle.setCoords();

      updateGeometry();
      targetCanvas.requestRenderAll();
    };

    const onUp = (): void => {
      if (!isDown) return;
      isDown = false;

      targetCanvas.off("mouse:move", onMove);
      targetCanvas.off("mouse:up", onUp);

      arrowLineControl.set({ opacity: 1 });

      const newGroup = new fabric.Group(
        [
          arrowLine,
          arrowHead,
          arrowLineControl,
          arrowCircle1,
          arrowCircle2,
        ] as unknown as ConstructorParameters<typeof fabric.Group>[0],
        {
          selectable: true,
          evented: true,
          id: "arrowGroup",
          hasControls: false,
          hasBorders: false,
          hasRotatingPoint: false,
          subTargetCheck: true,
          originX: "left",
          originY: "top",
          perPixelTargetFind: true,
        } as ConstructorParameters<typeof fabric.Group>[1]
      ) as unknown as ArrowObject;

      targetCanvas.add(newGroup);
      targetCanvas.remove(arrowLine);
      targetCanvas.remove(arrowHead);
      targetCanvas.remove(arrowCircle1);
      targetCanvas.remove(arrowCircle2);
      targetCanvas.remove(arrowLineControl);
      targetCanvas.requestRenderAll();

      targetCanvas.discardActiveObject();
      targetCanvas.requestRenderAll();

      const state = readState();
      if (state) persistCanvas({ ...state, tool: "select" }, setState);

      targetCanvas.setActiveObject(newGroup);
      targetCanvas.requestRenderAll();
    };

    targetCanvas.on("mouse:move", onMove);
    targetCanvas.on("mouse:up", onUp);
  };

  // --- draw handlers
  const onMouseDown = (o: ArrowCanvasEvent): void => {
    const state = getState();
    if (!state?.drawingMode) return;
    if (state.tool !== "arrow") return;
    if (arrowPoints.length) return;

    canvas.selection = false;
    canvas.requestRenderAll();

    const { x, y } = canvas.getPointer(o.e);
    arrowPoints = [{ x, y }];

    arrowLine = createArrowLine(x, y, state.color, state.strokeWidth);
    arrowHead = createArrowHead(x, y, state.color, state.strokeWidth);
    arrowCircle1 = createArrowCircle(x - 5, y - 5, "arrowCircle1");
    arrowCircle2 = createArrowCircle(x - 5, y - 5, "arrowCircle2");
    arrowLineControl = createArrowLineControl(x, y);

    canvas.add(arrowLine);
    canvas.add(arrowHead);
    canvas.add(arrowLineControl);
    canvas.add(arrowCircle1);
    canvas.add(arrowCircle2);

    canvas.requestRenderAll();
  };

  const onMouseMove = (o: ArrowCanvasEvent): void => {
    const state = getState();
    if (!state?.drawingMode) return;
    if (state.tool !== "arrow") return;
    if (!arrowPoints.length) return;
    if (
      !arrowLine ||
      !arrowHead ||
      !arrowCircle1 ||
      !arrowCircle2 ||
      !arrowLineControl
    )
      return;

    const { x, y } = canvas.getPointer(o.e);
    const startX = arrowPoints[0].x;
    const startY = arrowPoints[0].y;

    arrowLine.set({ x1: startX, y1: startY, x2: x, y2: y });
    arrowLineControl.set({ x1: startX, y1: startY, x2: x, y2: y });
    arrowLine.setCoords();
    arrowLineControl.setCoords();

    const angle = (Math.atan2(y - startY, x - startX) * 180) / Math.PI;
    arrowHead.set({ left: x, top: y, angle: angle + 90 });
    arrowHead.setCoords();

    arrowCircle1.set({ left: startX - 5, top: startY - 5 });

    // keep your “slight offset” if you want, but simplest is:
    arrowCircle2.set({ left: x - 5, top: y - 5 });

    arrowCircle1.setCoords();
    arrowCircle2.setCoords();

    canvas.requestRenderAll();
  };

  const onMouseUp = (): void => {
    const state = getState();
    if (!state?.drawingMode) return;
    if (state.tool !== "arrow") return;
    if (!arrowPoints.length) return;
    if (
      !arrowLine ||
      !arrowHead ||
      !arrowCircle1 ||
      !arrowCircle2 ||
      !arrowLineControl
    )
      return;

    canvas.selection = true;
    arrowPoints = [];

    arrowCircle1.set({ opacity: 1 });
    arrowCircle2.set({ opacity: 1 });
    arrowLineControl.set({ opacity: 1 });

    const group = new fabric.Group(
      [
        arrowLine,
        arrowHead,
        arrowLineControl,
        arrowCircle1,
        arrowCircle2,
      ] as unknown as ConstructorParameters<typeof fabric.Group>[0],
      {
        selectable: true,
        evented: true,
        id: "arrowGroup",
        hasControls: false,
        hasBorders: false,
        hasRotatingPoint: false,
        subTargetCheck: true,
        originX: "left",
        originY: "top",
        perPixelTargetFind: true,
      } as ConstructorParameters<typeof fabric.Group>[1]
    ) as unknown as ArrowObject;

    canvas.add(group);
    canvas.remove(arrowLine);
    canvas.remove(arrowHead);
    canvas.remove(arrowCircle1);
    canvas.remove(arrowCircle2);
    canvas.remove(arrowLineControl);

    canvas.requestRenderAll();

    saveCanvas({ ...state, tool: "select" }, setContentState);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
  };

  // --- selection visibility handlers (keep refs for proper off)
  const onBeforeSelectionCleared = (): void => {
    const activeObject = canvas.getActiveObject();
    if (activeObject && activeObject.id === "arrowGroup") {
      activeObject._objects?.forEach((obj) => {
        if (
          obj.id === "arrowCircle1" ||
          obj.id === "arrowCircle2" ||
          obj.id === "arrowLineControl"
        ) {
          obj.set({ opacity: 0 });
        }
      });
      canvas.requestRenderAll();
    }
  };

  const onSelectionCleared = (): void => {
    canvas.getObjects().forEach((obj) => {
      if (obj.type === "group") {
        obj._objects?.forEach((obj2) => {
          if (
            obj2.id === "arrowCircle1" ||
            obj2.id === "arrowCircle2" ||
            obj2.id === "arrowLineControl"
          ) {
            obj2.set({ opacity: 0 });
          }
        });
      }
    });
    canvas.requestRenderAll();
  };

  const onSelectionChanged = (): void => {
    const activeObject = canvas.getActiveObject();

    if (activeObject && activeObject.id === "arrowGroup") {
      activeObject._objects?.forEach((obj) => {
        if (
          obj.id === "arrowCircle1" ||
          obj.id === "arrowCircle2" ||
          obj.id === "arrowLineControl"
        ) {
          obj.set({ opacity: 1 });
        }
      });
      canvas.requestRenderAll();
    }

    if (activeObject && activeObject.type === "activeSelection") {
      activeObject._objects?.forEach((obj) => {
        if (obj.id === "arrowGroup") {
          obj._objects?.forEach((obj2) => {
            if (obj2.id === "arrowLineControl") obj2.set({ opacity: 1 });
          });
        }
      });
      canvas.requestRenderAll();
    }
  };

  // attach
  canvas.on("mouse:down", onEndpointMouseDown); // endpoint dragging
  canvas.on("mouse:down", onMouseDown);
  canvas.on("mouse:move", onMouseMove);
  canvas.on("mouse:up", onMouseUp);

  canvas.on("before:selection:cleared", onBeforeSelectionCleared);
  canvas.on("selection:cleared", onSelectionCleared);
  canvas.on("selection:created", onSelectionChanged);
  canvas.on("selection:updated", onSelectionChanged);

  return {
    removeEventListeners(): void {
      canvas.off("mouse:down", onEndpointMouseDown);
      canvas.off("mouse:down", onMouseDown);
      canvas.off("mouse:move", onMouseMove);
      canvas.off("mouse:up", onMouseUp);

      canvas.off("before:selection:cleared", onBeforeSelectionCleared);
      canvas.off("selection:cleared", onSelectionCleared);
      canvas.off("selection:created", onSelectionChanged);
      canvas.off("selection:updated", onSelectionChanged);
    },
  };
};

export default ArrowTool;
