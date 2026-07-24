import { fabric } from "../fabricCompat";

type TextboxCompat = InstanceType<typeof fabric.Textbox> & {
  skipAutoWidthAdjustment?: boolean;
  _textLines?: string[][];
};

interface TextToolState {
  drawingMode?: boolean;
  tool?: string;
  color?: string;
  canvas?: TextCanvas;
  [key: string]: unknown;
}

interface TextCanvasEvent {
  e: Event;
  target?: TextboxCompat;
}

interface TextCanvas {
  perPixelTargetFind: boolean;
  getActiveObject(): TextboxCompat | undefined;
  getPointer(event: Event): InstanceType<typeof fabric.Point>;
  add(text: TextboxCompat): void;
  remove(text: TextboxCompat): void;
  setActiveObject(text: TextboxCompat): void;
  requestRenderAll(): void;
  forEachObject(callback: (object: TextboxCompat) => void): void;
  on(event: string, listener: (event: TextCanvasEvent) => void): void;
  off(event: string, listener: (event: TextCanvasEvent) => void): void;
}

type SetTextToolState = (update: (previous: TextToolState) => TextToolState) => void;

const TextTool = (
  canvas: TextCanvas,
  contentStateRef: { current?: TextToolState | null },
  setContentState: SetTextToolState,
  saveCanvas: (state: TextToolState, setter: SetTextToolState) => void,
): { removeEventListeners(): void } => {
  const getState = (): TextToolState | null | undefined => contentStateRef.current;

  // Track the currently-created textbox so we can finalize it cleanly
  let activeCreatedText: TextboxCompat | null = null;

  const finalizeIfNeeded = (): void => {
    if (!activeCreatedText) return;

    const text = activeCreatedText;
    const currentActive = canvas.getActiveObject();

    // If user clicked away / ended editing
    if (currentActive !== text) {
      if ((text.text || "").trim() === "") {
        canvas.remove(text);
      } else {
        // Save using latest state
        saveCanvas({ ...getState(), canvas }, setContentState);
      }
      activeCreatedText = null;
      canvas.requestRenderAll();
    }
  };

  const onCanvasMouseDownCapture = (): void => {
    // This runs on any mouse down to potentially finalize the last text.
    // But don't interfere if user is still editing that text.
    finalizeIfNeeded();
  };

  const onMouseDown = (o: TextCanvasEvent): void => {
    const state = getState();
    if (!state?.drawingMode) return;
    if (state.tool !== "text") return;

    // Before creating a new one, finalize previous if any
    finalizeIfNeeded();

    const pointer = canvas.getPointer(o.e);
    const x = pointer.x;
    const y = pointer.y;

    const text = new fabric.Textbox("", {
      left: x,
      top: y,
      fontFamily: "Satoshi-Medium",
      fontSize: 20,
      fill: state.color,
      fontWeight: "normal",
      fontStyle: "normal",
      originX: "left",
      originY: "top",
      textAlign: "center",
      lockUniScaling: true,
      centeredScaling: true,
      skipAutoWidthAdjustment: false,
      perPixelTargetFind: false,
    }) as TextboxCompat;

    text.on("editing:entered", () => {
      text.borderColor = "#0D99FF";
    });

    canvas.add(text);
    canvas.setActiveObject(text);

    // Start editing
    text.enterEditing();
    text.selectAll();

    activeCreatedText = text;

    // Set tool back to select (use latest state)
    setContentState((prev) => ({
      ...prev,
      tool: "select",
    }));

    canvas.requestRenderAll();
  };

  const onKeyPress = (event: KeyboardEvent): void => {
    const obj = canvas.getActiveObject();
    if (!obj || typeof obj !== "object") return;

    if (obj.type !== "textbox" || !obj.isEditing) return;

    const text = obj;

    // If user explicitly resized, skip
    if (text.skipAutoWidthAdjustment) return;

    // Guard: _textLines might not exist at some moments
    const lines = text._textLines || [];
    if (lines.length === 0) return;

    let currentLine = lines[lines.length - 1].join("");

    // Backspace
    if (event.key === "Backspace" && currentLine.length > 0) {
      currentLine = currentLine.slice(0, -1);
    } else if (event.key && event.key.length === 1) {
      currentLine += event.key;
    } else {
      // ignore other keys
      return;
    }

    // Measure
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    tempCtx.font = `${text.fontSize}px ${text.fontFamily}`;
    const textMetrics = tempCtx.measureText(currentLine);

    const maxLineWidth = getMaxLineWidth(lines, text);

    // Expand width if needed
    if (textMetrics.width > text.width) {
      const nextWidth = Math.max(text.width, textMetrics.width + 2);
      text.set({
        left: text.left - (nextWidth - text.width) / 2,
        width: nextWidth,
      });
    } else if (textMetrics.width < maxLineWidth) {
      text.set({
        left: text.left + (text.width - maxLineWidth) / 2,
        width: maxLineWidth,
      });
    }

    canvas.requestRenderAll();
  };

  function getMaxLineWidth(textLines: string[][], text: TextboxCompat): number {
    let maxLineWidth = 0;
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return 0;
    tempCtx.font = `${text.fontSize}px ${text.fontFamily}`;

    for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i].join("");
      const lineWidth = tempCtx.measureText(line).width;
      maxLineWidth = Math.max(maxLineWidth, lineWidth);
    }

    return maxLineWidth;
  }

  const onResize = (e: TextCanvasEvent): void => {
    if (e?.target?.type !== "textbox") return;
    e.target.skipAutoWidthAdjustment = true;
    canvas.requestRenderAll();
  };

  // Hover logic: DON'T use anonymous mouse:move that you later nuke.
  const onMouseMove = (event: TextCanvasEvent): void => {
    const pointer = canvas.getPointer(event.e);
    let hoveringTextbox = false;

    canvas.forEachObject((obj) => {
      if (obj.type === "textbox" && obj.containsPoint(pointer)) {
        hoveringTextbox = true;
      }
    });

    canvas.perPixelTargetFind = !hoveringTextbox;
  };

  // Attach listeners once
  // Note: we attach the “finalize” handler too, but it’s cheap.
  canvas.on("mouse:down", onCanvasMouseDownCapture);
  canvas.on("mouse:down", onMouseDown);

  document.addEventListener("keydown", onKeyPress);
  canvas.on("object:resizing", onResize);
  canvas.on("mouse:move", onMouseMove);

  return {
    removeEventListeners: () => {
      canvas.off("mouse:down", onCanvasMouseDownCapture);
      canvas.off("mouse:down", onMouseDown);
      document.removeEventListener("keydown", onKeyPress);
      canvas.off("object:resizing", onResize);
      canvas.off("mouse:move", onMouseMove);
    },
  };
};

export default TextTool;
