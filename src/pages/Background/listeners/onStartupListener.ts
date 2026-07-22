// For some reason without this the service worker doesn't always work
import { listenerChrome } from "./chromeTypes";

export const onStartupListener = (): void => {
  listenerChrome().runtime.onStartup.addListener(() => {
    if (
      (globalThis as typeof globalThis & { SAYLESS_VERBOSE_LOGS?: boolean })
        .SAYLESS_VERBOSE_LOGS
    ) {
      console.log("Service worker started up successfully.");
    }
  });
};
