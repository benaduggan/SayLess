import { executeScripts } from "../utils/executeScripts";
import { listenerChrome } from "./chromeTypes";

export const onInstalledListener = (): void => {
  const chromeApi = listenerChrome();
  chromeApi.runtime.onInstalled.addListener(async (details) => {
    const version = chromeApi.runtime.getManifest().version;
    void version;

    if (details.reason === "install") {
      void chromeApi.storage.local.clear();

      void chromeApi.storage.local.set({
        firstTime: true,
        onboarding: false,
        bannerSupport: true,
        extensionInstalledAt: Date.now(),
      });

      chromeApi.storage.managed.get("skipSetup", (managedConfig) => {
        const skipSetup = managedConfig.skipSetup ?? false;
        if (!skipSetup) {
          void chromeApi.tabs.create({ url: "setup.html" });
        }
      });
    } else if (details.reason === "update") {
      // give WebCodecs a fresh shot on update: a one-time watchdog trip on
      // an older build shouldn't permanently pin a user to MediaRecorder.
      void chromeApi.storage.local.remove([
        "fastRecorderDisabledForDevice",
        "fastRecorderDisabledReason",
        "fastRecorderDisabledAt",
        "fastRecorderDisabledDetails",
      ]);
      if (details.previousVersion === "2.8.6") {
        void chromeApi.storage.local.set({ updatingFromOld: true });
      } else {
        void chromeApi.storage.local.set({ updatingFromOld: false });
      }

      // Existing users are already established, so backfill an install time in
      // the past to clear the review prompt's install-age gate immediately.
      const { extensionInstalledAt } = await chromeApi.storage.local.get("extensionInstalledAt");
      if (typeof extensionInstalledAt !== "number") {
        void chromeApi.storage.local.set({ extensionInstalledAt: 0 });
      }
    }

    if (details.reason === "install") {
      void chromeApi.storage.local.set({ systemAudio: true });
    }
    void chromeApi.storage.local.set({ offscreenRecording: false });

    // Backfill content scripts into already-open tabs. manifest
    // content_scripts only auto-inject on future loads; without this,
    // a fresh install / update can't record on tabs that were already
    // open. The `install` gate causes React double-mount under dev
    // HMR; accepted tradeoff vs the prod break.
    if (details.reason === "install" || details.reason === "update") {
      void executeScripts();
    }
  });
};
