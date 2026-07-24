// Decides whether screen/window capture uses getDisplayMedia instead of
// chrome.desktopCapture. macOS system audio only works via getDisplayMedia
// (Chrome 141+/macOS 14.2+); desktopCapture has no macOS system-audio backend.
// Core predicate is pure (unit-tested in tests/unit/).

export interface ScreenCaptureModeOptions {
  chromeMajor?: number;
  isMac?: boolean;
  force?: boolean;
  disabled?: boolean;
}

export interface ScreenCaptureSettings {
  forceDisplayMediaScreen?: boolean;
  macSystemAudioCapture?: boolean;
}

export function parseChromeMajor(ua?: string | null): number {
  const m = (ua || "").match(/Chrom(?:e|ium)\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function isMacUserAgent(ua?: string | null): boolean {
  return /Mac/i.test(ua || "");
}

// force = storage override (E2E tests / escape hatch); disabled = kill-switch.
export function screenCaptureUsesDisplayMedia({
  chromeMajor = 0,
  isMac = false,
  force = false,
  disabled = false,
}: ScreenCaptureModeOptions = {}): boolean {
  if (force === true) return true;
  if (disabled === true) return false;
  return isMac === true && Number(chromeMajor) >= 141;
}

// Resolves platform/version from navigator + the forceDisplayMediaScreen /
// macSystemAudioCapture storage flags.
export function shouldUseDisplayMediaForScreen(settings: ScreenCaptureSettings = {}): boolean {
  const ua = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
  return screenCaptureUsesDisplayMedia({
    chromeMajor: parseChromeMajor(ua),
    isMac: isMacUserAgent(ua),
    force: settings.forceDisplayMediaScreen === true,
    disabled: settings.macSystemAudioCapture === false,
  });
}
