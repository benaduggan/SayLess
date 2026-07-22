// Dev-only recorder logger, gated by window.SAYLESS_DEBUG_RECORDER (stripped from prod).
export interface DebugLogger {
  debug: (...args: unknown[]) => void;
  debugWarn: (...args: unknown[]) => void;
  debugError: (...args: unknown[]) => void;
}

export const createDebugLogger = (
  prefix: string,
  enabled: boolean,
): DebugLogger => ({
  debug: (...args: unknown[]): void => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.log(prefix, ...args);
  },
  debugWarn: (...args: unknown[]): void => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.warn(prefix, ...args);
  },
  debugError: (...args: unknown[]): void => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.error(prefix, ...args);
  },
});
