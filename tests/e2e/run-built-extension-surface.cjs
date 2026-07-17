/**
 * Built-extension release surface smoke.
 *
 * Loads build/ as an unpacked extension in real Chrome, opens packaged
 * extension pages, and scans rendered text plus common accessible labels for
 * paid/account/cloud calls to action or account-tier gates. This complements
 * release-audit's static bundle checks with a browser-level sanity check over
 * actual extension URLs.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BUILD_DIR = path.join(ROOT, "build");
const MIN_EXPECTED_PACKAGED_WHISPER_BYTES = 70 * 1024 * 1024;
const PAGES = [
  "setup.html",
  "permissions.html",
  "recorder.html",
  "editor.html",
  "download.html",
];
const FORBIDDEN_SURFACE_PATTERNS = [
  /\bpaid tiers?\b/i,
  /\bpaid[- ]plans?\b/i,
  /\bpaid[- ]accounts?\b/i,
  /\baccount[- ]level\b/i,
  /\baccount[- ]plans?\b/i,
  /\baccount[- ]tiers?\b/i,
  /\baccount[- ]gated\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]plans?\b/i,
  /\b(?:starter|team|business|enterprise|free|limited)[- ]tiers?\b/i,
  /\benterprise[- ]only\b/i,
  /\bplan[- ]limits?\b/i,
  /\btier[- ]limits?\b/i,
  /\busage[- ]limits?\b/i,
  /\bmemberships?\b/i,
  /\bpaid[- ]memberships?\b/i,
  /\bmember[- ]only\b/i,
  /\bfeature gates?\b/i,
  /\bpaywalls?\b/i,
  /\bpremium\b/i,
  /\bScreenity Pro\b/i,
  /\bfree[- ]trials?\b/i,
  /\btrial[- ]only\b/i,
  /\btrial expired\b/i,
  /\blicen[cs]e[- ]required\b/i,
  /\bentitlements?\b/i,
  /\bpricing\b/i,
  /\bsubscription\b/i,
  /\bbilling\b/i,
  /\bcheckout\b/i,
  /\bstripe\b/i,
  /\blocked[- ]features?\b/i,
  /\bfeatures?[- ]locked\b/i,
  /\blocked by (?:plan|tier|account|membership)\b/i,
  /\b(?:plan|tier|subscription|membership)[- ]required\b/i,
  /\bunlock\b/i,
  /\bupgrade (?:to|for|your plan|your account)\b/i,
  /\bcontact sales\b/i,
  /\bsales[- ]gated\b/i,
  /\blicen[cs]e[- ]keys?\b/i,
  /\bactivation[- ](?:required|keys?|codes?)\b/i,
  /\bsign\s*in\b/i,
  /\bsign-in\b/i,
  /\blog\s*in\b/i,
  /\blogin\b/i,
  /\bhosted dashboard\b/i,
  /\bcloud recorder\b/i,
  /\bcloud upload\b/i,
  /\bGoogle Drive\b/i,
  /app\.screenity\.io/i,
];

const fail = (message) => {
  console.error(`BUILT EXTENSION SURFACE FAIL: ${message}`);
  process.exit(1);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatPageError = (error) =>
  String(error?.stack || error?.message || error).slice(0, 2000);

const formatConsoleError = (message) => {
  const location = message.location();
  return [
    message.text(),
    location?.url ? `at ${location.url}:${location.lineNumber}:${location.columnNumber}` : "",
    ...message.args().map((arg) => String(arg).slice(0, 500)),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
};

const recordPageErrors = (hits, pageName, pageErrors) => {
  for (const pageError of pageErrors) {
    hits.push({
      pageName,
      pattern: "pageerror",
      match: pageError,
    });
  }
};

const recordConsoleErrors = (hits, pageName, consoleErrors) => {
  for (const consoleError of consoleErrors) {
    hits.push({
      pageName,
      pattern: "console-error",
      match: consoleError,
    });
  }
};

const isTargetClosedError = (error) =>
  /Target page, context or browser has been closed|Page closed|has been closed/i.test(
    String(error?.message || error),
  );

const scanExtensionPage = async (context, extensionId, pageName) => {
  const url = `chrome-extension://${extensionId}/${pageName}`;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(formatPageError(error)));
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(formatConsoleError(message));
      }
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const openedUrl = page.url();
      const chromeError = openedUrl.startsWith("chrome-error://")
        ? openedUrl
        : null;
      const text = await page.evaluate(collectSurfaceText);

      // Give async page errors a short chance to surface. Some CI Chrome builds
      // close extension pages during this idle window; once text is collected,
      // that should not turn a completed surface probe into a runner crash.
      try {
        await page.waitForTimeout(750);
      } catch (error) {
        if (!isTargetClosedError(error)) throw error;
      }

      await page.close().catch(() => {});
      return {
        pageName,
        url,
        openedUrl,
        chromeError,
        text,
        textBytes: Buffer.byteLength(text, "utf8"),
        pageErrors,
        consoleErrors,
      };
    } catch (error) {
      lastError = error;
      await page.close().catch(() => {});
      if (attempt === 0 && isTargetClosedError(error)) {
        await sleep(500);
        continue;
      }
      return {
        pageName,
        url,
        openedUrl: url,
        chromeError: null,
        text: "",
        textBytes: 0,
        pageErrors: [
          ...pageErrors,
          `surface probe failed: ${formatPageError(error)}`,
        ],
        consoleErrors,
      };
    }
  }

  return {
    pageName,
    url,
    openedUrl: url,
    chromeError: null,
    text: "",
    textBytes: 0,
    pageErrors: [`surface probe failed: ${formatPageError(lastError)}`],
    consoleErrors: [],
  };
};

const startLocalPageServer = async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
      <html>
        <head><title>SayLess packaged content smoke</title></head>
        <body>
          <main>
            <h1>Local test page</h1>
            <p>This page exists only so the packaged content script can mount.</p>
          </main>
        </body>
      </html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const getExtensionIdFromPreferences = async (userDataDir) => {
  const preferencesPath = path.join(userDataDir, "Default", "Preferences");
  const expectedBuildDir = fs.realpathSync(BUILD_DIR);
  const preferenceSnapshots = [];
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      const settings = preferences?.extensions?.settings || {};
      preferenceSnapshots.length = 0;
      for (const [id, entry] of Object.entries(settings)) {
        const entryPath = entry?.path ? path.resolve(entry.path) : "";
        const realEntryPath = entryPath && fs.existsSync(entryPath)
          ? fs.realpathSync(entryPath)
          : entryPath;
        const manifest = entry?.manifest || {};
        preferenceSnapshots.push({
          id,
          path: entry?.path || "",
          realPath: realEntryPath,
          manifestName: manifest.name || "",
          serviceWorker: manifest.background?.service_worker || "",
        });
        if (
          realEntryPath === expectedBuildDir ||
          (manifest.name === "__MSG_extName__" &&
            manifest.background?.service_worker === "background.bundle.js")
        ) {
          return id;
        }
      }
    } catch {}
    await sleep(250);
  }
  if (preferenceSnapshots.length) {
    console.warn(
      "  [extension preferences]",
      JSON.stringify(preferenceSnapshots, null, 2),
    );
  }
  return null;
};

const getExtensionId = async (context, userDataDir) => {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    try {
      worker = await context.waitForEvent("serviceworker", { timeout: 5000 });
    } catch {}
  }
  if (worker) {
    const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (match) return match[1];
  }
  const id = await getExtensionIdFromPreferences(userDataDir);
  if (id) return id;
  throw new Error("Unable to derive extension id from service worker or Chrome Preferences");
};

const ensureServiceWorker = async (context, extensionId) => {
  let worker = context.serviceWorkers().find((candidate) =>
    candidate.url().startsWith(`chrome-extension://${extensionId}/`),
  );
  if (worker) return worker;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/setup.html`);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(500);
  worker = context.serviceWorkers().find((candidate) =>
    candidate.url().startsWith(`chrome-extension://${extensionId}/`),
  );
  if (!worker) {
    try {
      worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
    } catch {}
  }
  await page.close().catch(() => {});
  if (!worker) {
    throw new Error(`Unable to start extension service worker for ${extensionId}`);
  }
  return worker;
};

const sendMessageToTab = async (context, extensionId, tabUrl, message) => {
  const worker = await ensureServiceWorker(context, extensionId);
  return worker.evaluate(
    ({ tabUrl, message }) =>
      new Promise((resolve, reject) => {
        chrome.tabs.query({}, (tabs) => {
          const tab = tabs.find((candidate) => candidate.url === tabUrl);
          if (!tab?.id) {
            reject(new Error(`No extension tab found for ${tabUrl}`));
            return;
          }
          chrome.tabs.sendMessage(tab.id, message, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              reject(new Error(lastError.message));
              return;
            }
            resolve(response || null);
          });
        });
      }),
    { tabUrl, message },
  );
};

const injectContentScriptIntoTab = async (context, extensionId, tabUrl) => {
  const worker = await ensureServiceWorker(context, extensionId);
  return worker.evaluate(
    (tabUrl) =>
      new Promise((resolve, reject) => {
        chrome.tabs.query({}, async (tabs) => {
          const tab = tabs.find((candidate) => candidate.url === tabUrl);
          if (!tab?.id) {
            reject(new Error(`No extension tab found for ${tabUrl}`));
            return;
          }
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["contentScript.bundle.js"],
            });
            resolve(null);
          } catch (error) {
            reject(error);
          }
        });
      }),
    tabUrl,
  );
};

const exerciseDownloadId = async (context, extensionId) => {
  const worker = await ensureServiceWorker(context, extensionId);
  return worker.evaluate(
    () =>
      new Promise((resolve, reject) => {
        if (!chrome.downloads?.download || !chrome.downloads?.search) {
          reject(new Error("chrome.downloads API unavailable"));
          return;
        }
        const filename = `sayless-e2e-download-id-${Date.now()}.txt`;
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("download-id-probe-timeout"));
        }, 15000);
        const cleanup = () => {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(onChanged);
        };
        const finish = (id) => {
          chrome.downloads.search({ id }, (items) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              cleanup();
              reject(new Error(lastError.message));
              return;
            }
            chrome.downloads.erase({ id }, () => {});
            cleanup();
            const item = items?.[0] || null;
            resolve({
              id,
              exists: Boolean(item),
              state: item?.state || null,
              filename: item?.filename || "",
              urlPrefix: String(item?.url || "").slice(0, 24),
            });
          });
        };
        const onChanged = (delta) => {
          if (delta.id !== downloadId || !delta.state) return;
          if (delta.state.current === "complete") {
            finish(downloadId);
          } else if (delta.state.current === "interrupted") {
            cleanup();
            reject(new Error("download-id-probe-interrupted"));
          }
        };
        let downloadId = null;
        chrome.downloads.download(
          {
            url: `data:text/plain;charset=utf-8,${encodeURIComponent(
              "SayLess local download id probe",
            )}`,
            filename,
            conflictAction: "overwrite",
            saveAs: false,
          },
          (id) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              cleanup();
              reject(new Error(lastError.message));
              return;
            }
            if (!Number.isInteger(id) || id <= 0) {
              cleanup();
              reject(new Error(`invalid-download-id:${id}`));
              return;
            }
            downloadId = id;
            chrome.downloads.onChanged.addListener(onChanged);
          },
        );
      }),
  );
};

const probePackagedWhisperAssets = async (context, extensionId) => {
  const worker = await ensureServiceWorker(context, extensionId);
  return worker.evaluate(
    async () => {
      const manifestUrl = chrome.runtime.getURL("assets/whisper/model-manifest.json");
      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) {
        throw new Error(`model-manifest:${manifestResponse.status}`);
      }
      const manifest = await manifestResponse.json();
      const requiredFiles = Array.isArray(manifest.requiredFiles)
        ? manifest.requiredFiles
        : [];
      const assetRoot = manifest.assetRoot || "assets/whisper/models/";
      const files = [];
      let totalBytes = 0;
      for (const relativePath of requiredFiles) {
        const url = chrome.runtime.getURL(`${assetRoot}${relativePath}`);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`${relativePath}:${response.status}`);
        }
        const bytes = (await response.arrayBuffer()).byteLength;
        totalBytes += bytes;
        files.push({ path: relativePath, bytes });
      }
      return {
        defaultModel: manifest.defaultModel || null,
        requiredCount: requiredFiles.length,
        fetchedCount: files.length,
        totalBytes,
        files,
      };
    },
  );
};

const collectSurfaceText = () => {
  const parts = [document.title, document.body?.innerText || ""];
  for (const node of document.querySelectorAll(
    "button,input,textarea,select,a,img,[aria-label],[title]",
  )) {
    for (const attr of ["aria-label", "title", "alt", "placeholder", "value"]) {
      const value = node.getAttribute?.(attr);
      if (value) parts.push(value);
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (href) parts.push(href);
    }
  }
  return parts.filter(Boolean).join("\n");
};

const collectContentScriptSurface = () => {
  const host = document.querySelector("#screenity-ui");
  const roots = [];
  const textParts = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) textParts.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (["STYLE", "SCRIPT", "NOSCRIPT"].includes(node.tagName)) return;
    roots.push(node);
    if (node.shadowRoot) visit(node.shadowRoot);
    for (const child of node.childNodes || []) {
      visit(child);
    }
  };
  const root = host?.shadowRoot || host;
  visit(root);
  const text = textParts.join("\n");
  const labels = [];
  for (const root of roots) {
    for (const node of root.querySelectorAll(
      "button,input,textarea,select,a,img,[aria-label],[title]",
    )) {
      for (const attr of ["aria-label", "title", "alt", "placeholder", "value"]) {
        const value = node.getAttribute?.(attr);
        if (value) labels.push(value);
      }
    }
  }
  return {
    hasHost: Boolean(host),
    hasContentRoot: Boolean(root),
    usedShadowRoot: Boolean(host?.shadowRoot),
    text,
    labels,
  };
};

const contentScriptTextMatches = (patternSource, flags = "i") => {
  const host = document.querySelector("#screenity-ui");
  const textParts = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) textParts.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (["STYLE", "SCRIPT", "NOSCRIPT"].includes(node.tagName)) return;
    if (node.shadowRoot) visit(node.shadowRoot);
    for (const child of node.childNodes || []) {
      visit(child);
    }
  };
  visit(host?.shadowRoot || host);
  const text = textParts.join("\n");
  return new RegExp(patternSource, flags).test(text);
};

const openVideosTab = () => {
  const host = document.querySelector("#screenity-ui");
  const roots = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    roots.push(node);
    if (node.shadowRoot) visit(node.shadowRoot);
    for (const child of node.children || []) {
      if (child.shadowRoot) visit(child.shadowRoot);
      visit(child);
    }
  };
  visit(host?.shadowRoot || host);
  const topLevelTab = roots
    .map((root) => root.querySelector(".TabsRoot.tl .TabsTrigger[value='videos']"))
    .find(Boolean);
  const candidates = roots.flatMap((root) => [
    ...root.querySelectorAll("button,[role='tab']"),
  ]);
  const videosTab = topLevelTab || candidates.find((node) =>
    /videos/i.test(node.textContent || node.getAttribute("aria-label") || ""),
  );
  if (!videosTab) return false;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    videosTab.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
      }),
    );
  }
  videosTab.click();
  return true;
};

const launchExtensionContext = async (userDataDir) => {
  const channel = process.env.SAYLESS_E2E_CHROME_CHANNEL || undefined;
  const launchOptions = {
    ...(channel ? { channel } : {}),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--disable-extensions-except=${BUILD_DIR}`,
      `--load-extension=${BUILD_DIR}`,
    ],
  };
  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    if (channel || !/Executable doesn't exist/.test(String(error?.message || error))) {
      throw error;
    }
    return chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
  }
};

(async () => {
  if (!fs.existsSync(path.join(BUILD_DIR, "manifest.json"))) {
    fail("build/manifest.json is missing. Run npm run build:release first.");
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-built-ext-"));
  const localPage = await startLocalPageServer();
  const context = await launchExtensionContext(userDataDir);

  const hits = [];
  const summaries = [];
  try {
    const extensionId = await getExtensionId(context, userDataDir);
    try {
      const whisperProbe = await probePackagedWhisperAssets(context, extensionId);
      if (
        whisperProbe.defaultModel !== "onnx-community/whisper-base_timestamped" ||
        whisperProbe.requiredCount !== 7 ||
        whisperProbe.fetchedCount !== 7 ||
        whisperProbe.totalBytes < MIN_EXPECTED_PACKAGED_WHISPER_BYTES
      ) {
        hits.push({
          pageName: "packaged-whisper-assets",
          pattern: "bundled-whisper-assets",
          match: JSON.stringify(whisperProbe),
        });
      }
      summaries.push({
        page: "packaged-whisper-assets",
        defaultModel: whisperProbe.defaultModel,
        requiredCount: whisperProbe.requiredCount,
        fetchedCount: whisperProbe.fetchedCount,
        totalBytes: whisperProbe.totalBytes,
      });
    } catch (error) {
      hits.push({
        pageName: "packaged-whisper-assets",
        pattern: "bundled-whisper-assets",
        match: String(error?.message || error),
      });
    }
    try {
      const downloadProbe = await exerciseDownloadId(context, extensionId);
      if (
        !Number.isInteger(downloadProbe.id) ||
        downloadProbe.id <= 0 ||
        !downloadProbe.exists ||
        downloadProbe.state !== "complete"
      ) {
        hits.push({
          pageName: "download-id-probe",
          pattern: "chrome-download-id",
          match: JSON.stringify(downloadProbe),
        });
      }
      summaries.push({
        page: "download-id-probe",
        id: downloadProbe.id,
        state: downloadProbe.state,
        exists: downloadProbe.exists,
        urlPrefix: downloadProbe.urlPrefix,
      });
    } catch (error) {
      hits.push({
        pageName: "download-id-probe",
        pattern: "chrome-download-id",
        match: String(error?.message || error),
      });
    }
    for (const pageName of PAGES) {
      const surface = await scanExtensionPage(context, extensionId, pageName);
      if (surface.chromeError) {
        hits.push({
          pageName,
          pattern: "chrome-error",
          match: surface.chromeError,
        });
      }
      for (const pattern of FORBIDDEN_SURFACE_PATTERNS) {
        const match = surface.text.match(pattern);
        if (match) {
          hits.push({ pageName, pattern: pattern.source, match: match[0] });
        }
      }
      recordPageErrors(hits, pageName, surface.pageErrors);
      recordConsoleErrors(hits, pageName, surface.consoleErrors);
      summaries.push({
        page: pageName,
        url: surface.url,
        textBytes: surface.textBytes,
        pageErrors: surface.pageErrors.slice(0, 3),
        consoleErrors: surface.consoleErrors.slice(0, 3),
      });
    }

    const contentPage = await context.newPage();
    const contentErrors = [];
    const contentConsoleErrors = [];
    contentPage.on("pageerror", (error) =>
      contentErrors.push(formatPageError(error)),
    );
    contentPage.on("console", (message) => {
      if (message.type() === "error") {
        contentConsoleErrors.push(formatConsoleError(message));
      }
    });
    await contentPage.goto(localPage.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await injectContentScriptIntoTab(context, extensionId, contentPage.url());
    let popupMounted = true;
    try {
      await contentPage.waitForFunction(
        () => Boolean(document.querySelector("#screenity-ui .screenity-shadow-dom")),
        { timeout: 10000 },
      );
    } catch (error) {
      const mountState = await contentPage.evaluate(() => {
        const host = document.querySelector("#screenity-ui");
        const root = host?.shadowRoot || host;
        return {
          hasHost: Boolean(host),
          hasContentRoot: Boolean(root),
        usedShadowRoot: Boolean(host?.shadowRoot),
        bodyText: document.body?.innerText || "",
        bodyHtmlStart: document.body?.innerHTML?.slice(0, 500) || "",
        };
      });
      hits.push({
        pageName: "content-script-popup",
        pattern: "content-script-mount",
        match: JSON.stringify({
          error: String(error?.message || error),
          mountState,
          pageErrors: contentErrors.slice(0, 5),
        }),
      });
      summaries.push({
        page: "content-script-popup",
        url: contentPage.url(),
        textBytes: 0,
        hasHost: mountState.hasHost,
        hasContentRoot: mountState.hasContentRoot,
        usedShadowRoot: mountState.usedShadowRoot,
        pageErrors: contentErrors.slice(0, 3),
        consoleErrors: contentConsoleErrors.slice(0, 3),
      });
      await contentPage.close();
      popupMounted = false;
    }
    if (popupMounted) {
      const toggleResponse = await sendMessageToTab(context, extensionId, contentPage.url(), {
        type: "toggle-popup",
      });
      try {
        await contentPage.waitForFunction(
          contentScriptTextMatches,
          "record",
          { timeout: 10000 },
        );
      } catch (error) {
        const postToggleSurface = await contentPage.evaluate(collectContentScriptSurface);
        const postToggleDom = await contentPage.evaluate(() => {
          const host = document.querySelector("#screenity-ui");
          const root = host?.shadowRoot || host;
          return {
            response: null,
            htmlStart: root?.innerHTML?.slice(0, 1200) || "",
            bodyHtmlStart: document.body?.innerHTML?.slice(0, 1200) || "",
          };
        });
        hits.push({
          pageName: "content-script-popup",
          pattern: "toggle-popup",
          match: JSON.stringify({
            error: String(error?.message || error),
            toggleResponse,
            postToggleDom,
            textStart: postToggleSurface.text.slice(0, 500),
            labels: postToggleSurface.labels.slice(0, 20),
            pageErrors: contentErrors.slice(0, 5),
            consoleErrors: contentConsoleErrors.slice(0, 5),
          }),
        });
      }
      const openedVideos = await contentPage.evaluate(openVideosTab);
      if (!openedVideos) {
        hits.push({
          pageName: "content-script-popup",
          pattern: "videos-tab",
          match: "Videos tab not found",
        });
      } else {
        try {
          await contentPage.waitForFunction(
            contentScriptTextMatches,
            "Search local recordings|local recordings",
            { timeout: 10000 },
          );
        } catch (error) {
          const postVideosSurface =
            await contentPage.evaluate(collectContentScriptSurface);
          hits.push({
            pageName: "content-script-popup",
            pattern: "videos-tab-local-library",
            match: JSON.stringify({
              error: String(error?.message || error),
              textStart: postVideosSurface.text.slice(0, 1000),
              labels: postVideosSurface.labels.slice(0, 30),
              pageErrors: contentErrors.slice(0, 5),
              consoleErrors: contentConsoleErrors.slice(0, 5),
            }),
          });
        }
      }
      const popupSurface = await contentPage.evaluate(collectContentScriptSurface);
      const popupText = [popupSurface.text, ...popupSurface.labels].join("\n");
      for (const pattern of FORBIDDEN_SURFACE_PATTERNS) {
        const match = popupText.match(pattern);
        if (match) {
          hits.push({
            pageName: "content-script-popup",
            pattern: pattern.source,
            match: match[0],
          });
        }
      }
      for (const required of [
        /Search local recordings/i,
        /\blocal recordings\b/i,
      ]) {
        if (!required.test(popupText)) {
          hits.push({
            pageName: "content-script-popup",
            pattern: required.source,
            match: "required local-library text missing",
          });
        }
      }
      recordPageErrors(hits, "content-script-popup", contentErrors);
      recordConsoleErrors(hits, "content-script-popup", contentConsoleErrors);
      summaries.push({
        page: "content-script-popup",
        url: contentPage.url(),
        textBytes: Buffer.byteLength(popupText, "utf8"),
        hasHost: popupSurface.hasHost,
        hasContentRoot: popupSurface.hasContentRoot,
        usedShadowRoot: popupSurface.usedShadowRoot,
        pageErrors: contentErrors.slice(0, 3),
        consoleErrors: contentConsoleErrors.slice(0, 3),
      });
      await contentPage.close();
    }
  } finally {
    await context.close();
    await localPage.close();
  }

  console.log("=== BUILT EXTENSION SURFACE SMOKE ===");
  console.log(JSON.stringify(summaries, null, 2));
  if (hits.length) {
    for (const hit of hits) {
      console.error(`${hit.pageName}: ${hit.match} (${hit.pattern})`);
    }
    fail(`${hits.length} forbidden rendered surface string(s) found.`);
  }
  console.log("BUILT EXTENSION SURFACE PASS");
})().catch((error) => {
  console.error("RUNNER ERROR", error);
  process.exit(2);
});
