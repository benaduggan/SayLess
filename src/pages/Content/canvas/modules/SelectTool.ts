interface SelectCanvasObject {
  type?: string;
  id?: string;
  canvas?: SelectCanvas;
  _objects?: SelectCanvasObject[];
  set(properties: Record<string, unknown>): void;
  _renderControls(context: CanvasRenderingContext2D, options: { hasControls: boolean }): void;
}

interface SelectCanvas {
  contextTop?: CanvasRenderingContext2D;
  getActiveObject(): SelectCanvasObject | undefined;
  requestRenderAll(): void;
  clearContext(context: CanvasRenderingContext2D): void;
  on(event: string, listener: (event: SelectCanvasEvent) => void): void;
  off(event: string, listener: (event: SelectCanvasEvent) => void): void;
}

interface SelectCanvasEvent {
  target?: SelectCanvasObject;
}

interface SelectToolState {
  tool?: string;
  isAddingImage?: boolean;
}

const SelectTool = (
  canvas: SelectCanvas,
  contentStateRef: { current?: SelectToolState | null },
  _setContentState: unknown,
): { removeEventListeners(): void } => {
  const getState = (): SelectToolState | null | undefined => contentStateRef.current;

  // On mouse over object
  const onMouseOver = (o: SelectCanvasEvent): void => {
    const state = getState();
    if (!state) return;
    if (state.tool !== "select") return;
    if (state.isAddingImage) return;
    if (!o.target) return;

    if (o.target !== canvas.getActiveObject()) {
      if (o.target.type === "group" && o.target.id === "select-group") {
        const selectStroke = o.target._objects?.find((object) => object.id === "select-stroke");
        if (selectStroke) selectStroke.set({ opacity: 1 });
      } else if (o.target.type === "group" && o.target.id === "arrowGroup") {
        o.target._objects?.forEach((obj) => {
          if (obj.id === "arrowLineControl") obj.set({ opacity: 1 });
        });
      } else {
        // draws fabric controls on the top context
        const contextTop = o.target.canvas?.contextTop;
        if (contextTop) {
          o.target._renderControls(contextTop, { hasControls: false });
        }
      }
      canvas.requestRenderAll();
    }
  };

  // On mouse out object
  const onMouseOut = (o: SelectCanvasEvent): void => {
    const state = getState();
    if (!state) return;
    if (state.tool !== "select") return;
    if (!o.target) return;

    if (o.target !== canvas.getActiveObject()) {
      if (o.target.type === "group" && o.target.id === "select-group") {
        const selectStroke = o.target._objects?.find((object) => object.id === "select-stroke");
        if (selectStroke) selectStroke.set({ opacity: 0 });
      } else if (o.target.type === "group" && o.target.id === "arrowGroup") {
        o.target._objects?.forEach((obj) => {
          if (obj.id === "arrowLineControl") obj.set({ opacity: 0 });
        });
      }
    }

    if (o.target?.canvas?.contextTop) {
      o.target.canvas.clearContext(o.target.canvas.contextTop);
    }
    canvas.requestRenderAll();
  };

  const onMouseDown = (o: SelectCanvasEvent): void => {
    const state = getState();
    if (!state) return;
    if (state.isAddingImage) return;
    if (state.tool !== "select") return;
    if (!o.target?.canvas?.contextTop) return;

    o.target.canvas.clearContext(o.target.canvas.contextTop);
  };

  canvas.on("mouse:over", onMouseOver);
  canvas.on("mouse:out", onMouseOut);
  canvas.on("mouse:down", onMouseDown);

  return {
    removeEventListeners(): void {
      canvas.off("mouse:over", onMouseOver);
      canvas.off("mouse:out", onMouseOut);
      canvas.off("mouse:down", onMouseDown);
    },
  };
};

export default SelectTool;
