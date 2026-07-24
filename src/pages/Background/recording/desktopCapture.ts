import { startRecorderSession } from "./openRecorderTab";
import { perfMark } from "../../utils/perfMarks";

export interface DesktopCaptureRequest {
  region?: boolean;
  camera?: boolean;
  customRegion?: boolean;
  initiatingTabId?: number;
  recordingType?: string;
  [key: string]: unknown;
}

export const desktopCapture = async (request: DesktopCaptureRequest): Promise<void> => {
  perfMark("BG.desktopCapture.enter", {
    region: Boolean(request?.region),
    camera: Boolean(request?.camera),
    customRegion: Boolean(request?.customRegion),
  });
  console.log("[SayLess][desktopCapture] entered", request);
  // batched: two sequential gets added 80-160ms of storage-queue latency
  const { onboarding } = await chrome.storage.local.get(["onboarding"]);

  // onboarding gate: prevent recorder tab opening behind the Welcome splash
  if (onboarding === true) {
    perfMark("BG.desktopCapture.blocked-by-onboarding");
    console.log("[SayLess][desktopCapture] blocked: onboarding active");
    return;
  }

  chrome.storage.local.set({ sendingChunks: false });

  // getCurrentTab uses lastFocusedWindow which races with editor-open focus pulls;
  // prefer the explicit sender tab id
  const initiatingTabId =
    typeof request?.initiatingTabId === "number" ? request.initiatingTabId : null;

  startRecorderSession(request, initiatingTabId);
};
