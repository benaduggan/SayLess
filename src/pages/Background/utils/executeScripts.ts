import { listenerChrome } from "../listeners/chromeTypes";

export const executeScripts = async (): Promise<void> => {
  const chromeApi = listenerChrome();
  const contentScripts = chromeApi.runtime.getManifest().content_scripts || [];
  const tabQueries = contentScripts.map((cs) => chromeApi.tabs.query({ url: cs.matches }));
  const tabResults = await Promise.all(tabQueries);

  const executeScriptPromises: Promise<unknown>[] = [];
  for (let i = 0; i < tabResults.length; i++) {
    const tabs = tabResults[i];
    const cs = contentScripts[i];

    for (const tab of tabs) {
      if (tab.id == null) continue;
      const executeScriptPromise = chromeApi.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: cs.js,
        },
        () => chromeApi.runtime.lastError,
      );
      executeScriptPromises.push(executeScriptPromise);
    }
  }

  await Promise.all(executeScriptPromises);
};
