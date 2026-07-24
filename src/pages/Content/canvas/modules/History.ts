interface HistoryCanvas {
  clear(): void;
  renderAll(): void;
  discardActiveObject(): void;
  loadFromJSON(serialized: string): Promise<unknown>;
  toJSON(propertiesToInclude?: string[]): unknown;
  on(event: "object:modified", listener: () => void): void;
  off(event: "object:modified", listener: () => void): void;
}

export interface CanvasHistoryState {
  canvas?: HistoryCanvas;
  undoStack?: string[];
  redoStack?: string[];
  [key: string]: unknown;
}

type HistoryStateSource =
  | CanvasHistoryState
  | { current?: CanvasHistoryState | null }
  | null
  | undefined;

type HistoryStateSetter = (state: CanvasHistoryState) => void;

const getState = (stateOrRef: HistoryStateSource): CanvasHistoryState | null | undefined =>
  stateOrRef && "current" in stateOrRef
    ? (stateOrRef as { current?: CanvasHistoryState | null }).current
    : stateOrRef;

// Undo and redo functionality for Fabric.js
const undoCanvas = (stateOrRef: HistoryStateSource, setToolSettings: HistoryStateSetter): void => {
  const state = getState(stateOrRef);
  if (!state?.canvas) return;

  const canvas = state.canvas;

  const storedUndoStack = state.undoStack;
  if (storedUndoStack && storedUndoStack.length > 0) {
    const undoStack = [...storedUndoStack];
    const redoStack = [...(state.redoStack || [])];

    const lastItem = undoStack.pop();
    if (lastItem !== undefined) redoStack.push(lastItem);

    const penultimateItem = undoStack[undoStack.length - 1];
    if (!penultimateItem) {
      // nothing meaningful to load
      setToolSettings({ ...state, undoStack, redoStack });
      return;
    }

    canvas.clear();
    canvas.renderAll();

    // v6 change: loadFromJSON's second arg is a per-object reviver
    // (called for every deserialized object), NOT the load-complete
    // callback. The function now returns a Promise that resolves when
    // loading finishes. v5-style callback usage would either silently
    // misfire (treating the callback as a reviver) or never run the
    // post-load cleanup.
    canvas.loadFromJSON(penultimateItem).then(() => {
      canvas.discardActiveObject();
      canvas.renderAll();
    });

    setToolSettings({ ...state, undoStack, redoStack });
  }
};

const redoCanvas = (stateOrRef: HistoryStateSource, setToolSettings: HistoryStateSetter): void => {
  const state = getState(stateOrRef);
  if (!state?.canvas) return;

  const canvas = state.canvas;

  const storedRedoStack = state.redoStack;
  if (storedRedoStack && storedRedoStack.length > 0) {
    const undoStack = [...(state.undoStack || [])];
    const redoStack = [...storedRedoStack];

    const lastItem = redoStack.pop();
    if (lastItem === undefined) return;
    undoStack.push(lastItem);

    // v6: loadFromJSON returns a Promise. See undoCanvas comment above.
    canvas.loadFromJSON(lastItem).then(() => {
      canvas.discardActiveObject();
      canvas.renderAll();
    });

    setToolSettings({ ...state, undoStack, redoStack });
  }
};

const saveCanvas = (stateOrRef: HistoryStateSource, setToolSettings: HistoryStateSetter): void => {
  const state = getState(stateOrRef);
  if (!state?.canvas) return;

  const canvas = state.canvas;

  const json = canvas.toJSON([
    "id",
    "selectable",
    "evented",
    "hasControls",
    "hasBorders",
    "hasRotatingPoint",
    "subTargetCheck",
    "originX",
    "originY",
    "perPixelTargetFind",
    "skipAutoWidthAdjustment",
  ]);

  const jsonString = JSON.stringify(json);
  const undoStack = [...(state.undoStack || []), jsonString];

  setToolSettings({
    ...state,
    undoStack,
    redoStack: [],
  });
};

const checkChanges = (
  canvas: HistoryCanvas,
  stateRef: HistoryStateSource,
  setToolSettings: HistoryStateSetter,
): { removeEventListeners(): void } => {
  const onChange = (): void => {
    // always save with latest state
    saveCanvas(stateRef, setToolSettings);
  };

  canvas.on("object:modified", onChange);

  return {
    removeEventListeners(): void {
      canvas.off("object:modified", onChange);
    },
  };
};

export { undoCanvas, redoCanvas, saveCanvas, checkChanges };
