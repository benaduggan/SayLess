export const isRecorderToolbarHidden = ({
  hideToolbar,
  hideUI,
}: {
  hideToolbar?: boolean;
  hideUI?: boolean;
}): boolean => Boolean(hideToolbar && hideUI);

export const shouldShowRecorderToast = ({
  hideUI,
  hideUIAlerts,
}: {
  hideUI?: boolean;
  hideUIAlerts?: boolean;
}): boolean => !hideUI && !hideUIAlerts;

export const shouldEnableAnnotationPointerEvents = ({
  drawingMode,
}: {
  drawingMode?: boolean;
}): boolean => Boolean(drawingMode);
