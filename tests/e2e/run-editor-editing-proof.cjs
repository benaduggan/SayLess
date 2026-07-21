/**
 * Extension editor proof harness.
 *
 * Loads build/ as an unpacked extension, seeds a tiny local recording plus a
 * transcript/project into the extension origin, then clicks through the real
 * player -> editor -> timeline -> transcript editing path. Screenshots are
 * written after each user-visible step so regressions are diagnosable by sight.
 */
const { chromium } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BUILD_DIR = path.join(ROOT, "build");
const OUT_DIR =
  process.env.SAYLESS_EDITOR_PROOF_DIR ||
  path.join(ROOT, "test-artifacts", "editor-editing-proof");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fail = (message, detail = null) => {
  console.error(`EDITOR EDITING PROOF FAIL: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
};

const assert = (condition, message, detail = null) => {
  if (!condition) fail(message, detail);
};

const launchExtension = async () => {
  if (!fs.existsSync(path.join(BUILD_DIR, "manifest.json"))) {
    fail("build/manifest.json is missing; run npm run build:release first");
  }
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sayless-editor-proof-")
  );
  const channel = process.env.SAYLESS_E2E_CHROME_CHANNEL || undefined;
  const options = {
    ...(channel ? { channel } : {}),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--disable-extensions-except=${BUILD_DIR}`,
      `--load-extension=${BUILD_DIR}`,
    ],
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, options);
  } catch (error) {
    if (
      channel ||
      !/Executable doesn't exist/.test(String(error?.message || error))
    ) {
      throw error;
    }
    context = await chromium.launchPersistentContext(userDataDir, {
      ...options,
      channel: "chrome",
    });
  }
  return { context, userDataDir };
};

const extensionIdFromPreferences = async (userDataDir) => {
  const preferencesPath = path.join(userDataDir, "Default", "Preferences");
  const expectedBuildDir = fs.realpathSync(BUILD_DIR);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      const settings = preferences?.extensions?.settings || {};
      for (const [id, entry] of Object.entries(settings)) {
        const entryPath = entry?.path ? path.resolve(entry.path) : "";
        const realEntryPath =
          entryPath && fs.existsSync(entryPath)
            ? fs.realpathSync(entryPath)
            : entryPath;
        if (
          realEntryPath === expectedBuildDir ||
          (entry?.manifest?.name === "__MSG_extName__" &&
            entry?.manifest?.background?.service_worker ===
              "background.bundle.js")
        ) {
          return id;
        }
      }
    } catch {}
    await sleep(250);
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
  const id = await extensionIdFromPreferences(userDataDir);
  if (id) return id;
  throw new Error(
    "Unable to derive extension id from service worker or Chrome Preferences"
  );
};

const collectConsole = (page, label, bucket) => {
  page.on("pageerror", (error) => {
    bucket.push(`${label}: pageerror: ${error?.stack || error}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      bucket.push(`${label}: console.error: ${message.text()}`);
    }
  });
};

const screenshot = async (page, name) => {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
};

const visibleBox = async (locator, name) => {
  await locator.waitFor({ state: "visible", timeout: 30000 });
  const box = await locator.boundingBox();
  assert(
    box && box.width > 0 && box.height > 0,
    `${name} has no clickable box`,
    box
  );
  return box;
};

const seedRecording = async (page) => {
  return page.evaluate(async () => {
    const duration = 3.2;
    const recordingId = "proof-editor-recording";
    const blobKey = `original:${recordingId}`;

    const makeBlob = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const stream = canvas.captureStream(15);
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8",
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.start(100);
      const startedAt = performance.now();
      while (performance.now() - startedAt < duration * 1000) {
        const elapsed = (performance.now() - startedAt) / 1000;
        const hue = Math.round((elapsed / duration) * 220);
        ctx.fillStyle = `hsl(${hue}, 70%, 42%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(48, 92, 544, 176);
        ctx.fillStyle = "#172033";
        ctx.font = "700 42px sans-serif";
        ctx.fillText("SayLess edit proof", 82, 162);
        ctx.font = "26px sans-serif";
        ctx.fillText(`local timeline ${elapsed.toFixed(1)}s`, 82, 210);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      recorder.stop();
      await new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      return new Blob(chunks, { type: "video/webm" });
    };

    const putLocalForageBlob = async (key, value) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("local-recordings", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("blobs")) {
            db.createObjectStore("blobs");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("blobs", "readwrite");
          tx.objectStore("blobs").put(value, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    };

    const blob = await makeBlob();
    await putLocalForageBlob(blobKey, blob);

    const now = Date.now();
    const timeline = {
      version: 2,
      source: { duration },
      clips: [
        {
          id: "clip-full",
          sourceStart: 0,
          sourceEnd: duration,
          muted: false,
        },
      ],
    };
    const transcript = {
      version: 1,
      text: "keep remove tail",
      language: "en",
      providerId: "local-whisper",
      words: [
        { text: "keep", start: 0.25, end: 0.75 },
        { text: "remove", start: 1.05, end: 1.65 },
        { text: "tail", start: 2.2, end: 2.85 },
      ],
    };
    const index = {
      [recordingId]: {
        id: recordingId,
        title: "Editor proof recording",
        createdAt: now,
        updatedAt: now,
        durationMs: Math.round(duration * 1000),
        byteSize: blob.size,
        mimeType: "video/webm",
        backendRef: null,
        blobKey,
        editedBlobKey: null,
        editedAt: null,
        thumbnailDataUrl: null,
        thumbnailUpdatedAt: null,
        recordingMeta: {
          source: "editor-proof",
          activityEvents: [
            { type: "click", time: 0.4, x: 180, y: 140 },
            { type: "click", time: 2.2, x: 410, y: 210 },
          ],
        },
        project: {
          version: 1,
          recordingId,
          updatedAt: now,
          source: {
            duration,
            mimeType: "video/webm",
            byteSize: blob.size,
          },
          timeline,
          transcript,
          chapterMarkers: [],
          zoomKeyframes: [],
          selectedClipId: null,
          exportSettings: {
            format: "mp4",
            qualityPreset: "original",
            includeProjectSidecar: true,
            includeTranscriptSidecar: true,
            includeCaptionSidecar: false,
            captionStyle: { preset: "clean", burnIn: false },
            audioFormat: "wav",
            gif: {},
          },
        },
      },
    };
    await chrome.storage.local.set({
      localRecordingLibraryIndex: index,
      lastRecordingBackendRef: {
        backend: "opfs",
        fileName: `${recordingId}.webm`,
      },
      recordingDuration: Math.round(duration * 1000),
    });
    return { recordingId, duration, bytes: blob.size };
  });
};

(async () => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { context, userDataDir } = await launchExtension();
  const consoleErrors = [];
  let activePage = null;
  try {
    const extensionId = await getExtensionId(context, userDataDir);
    const seedPage = await context.newPage();
    collectConsole(seedPage, "seed", consoleErrors);
    await seedPage.goto(`chrome-extension://${extensionId}/setup.html`, {
      waitUntil: "domcontentloaded",
    });
    const seed = await seedRecording(seedPage);
    await seedPage.close();

    const page = await context.newPage();
    activePage = page;
    collectConsole(page, "editor", consoleErrors);
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(
      `chrome-extension://${extensionId}/editor.html?localRecordingId=${encodeURIComponent(
        seed.recordingId
      )}`,
      { waitUntil: "domcontentloaded" }
    );

    await visibleBox(
      page.getByTestId("player-edit-action"),
      "player edit action"
    );
    await screenshot(page, "01-player-edit-entry-visible.png");

    await page.getByTestId("player-edit-action").click();
    await page.getByTestId("editor-layout").waitFor({
      state: "visible",
      timeout: 30000,
    });
    await page.getByTestId("timeline-editor").waitFor({
      state: "visible",
      timeout: 30000,
    });
    const initialEditorGeometry = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          height: box.height,
        };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentHeight: document.documentElement.scrollHeight,
        editor: rect('[data-testid="editor-layout"]'),
        workspace: rect(".saylessEditor__workspace"),
        media: rect(".saylessEditor__mediaColumn"),
        timeline: rect(".trimWrap"),
        transcript: rect(".saylessEditor__transcriptPanel"),
      };
    });
    const { viewport, documentHeight, workspace, media, timeline, transcript } =
      initialEditorGeometry;
    assert(
      workspace?.top === 80,
      "editor workspace is not anchored directly below the navigation",
      initialEditorGeometry
    );
    assert(
      timeline?.height >= 176 && timeline.bottom <= viewport.height + 1,
      "timeline is collapsed or below the initial viewport",
      initialEditorGeometry
    );
    assert(
      transcript?.top === workspace.top &&
        transcript.bottom <= viewport.height + 1,
      "transcript is not anchored to the workspace top",
      initialEditorGeometry
    );
    assert(
      media?.bottom <= viewport.height + 1 &&
        documentHeight <= viewport.height + 1,
      "desktop editor creates unexpected document overflow",
      initialEditorGeometry
    );
    await visibleBox(page.getByTestId("timeline-editor"), "timeline editor");
    await visibleBox(page.getByTestId("transcript-panel"), "transcript panel");
    await visibleBox(
      page.getByTestId("transcript-word").first(),
      "transcript word"
    );
    await screenshot(page, "02-editor-timeline-and-transcript-visible.png");

    const firstClip = page.getByTestId("timeline-clip").first();
    const firstClipBox = await visibleBox(firstClip, "timeline clip");
    await firstClip.click({
      position: {
        x: Math.round(firstClipBox.width * 0.45),
        y: Math.round(firstClipBox.height / 2),
      },
    });
    await page.getByTestId("timeline-split").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="timeline-clip"]').length >= 2,
      null,
      { timeout: 10000 }
    );
    await page.getByTestId("timeline-clip").first().click();
    await visibleBox(page.getByTestId("timeline-delete"), "timeline delete");
    await visibleBox(page.getByTestId("timeline-mute"), "timeline mute");
    await screenshot(page, "03-timeline-split-and-clip-actions-visible.png");

    await page.getByTestId("timeline-mute").click();
    await page.getByTestId("timeline-move-right").click();
    await screenshot(page, "04-timeline-mute-and-reorder-clicked.png");

    const words = page.getByTestId("transcript-word");
    await words.nth(0).click();
    await words.nth(1).click({ modifiers: ["Shift"] });
    await visibleBox(
      page.getByTestId("transcript-delete-words"),
      "transcript delete words"
    );
    await screenshot(page, "05-transcript-word-selection-visible.png");

    await page.getByTestId("transcript-delete-words").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="timeline-clip"]').length >= 1,
      null,
      { timeout: 10000 }
    );
    await visibleBox(page.getByTestId("timeline-apply-edits"), "apply edits");
    await screenshot(
      page,
      "06-transcript-delete-updates-timeline-apply-visible.png"
    );
    const editorSummary = await page.evaluate(() => ({
      timelineClipCount: document.querySelectorAll(
        '[data-testid="timeline-clip"]'
      ).length,
      transcriptWords: Array.from(
        document.querySelectorAll('[data-testid="transcript-word"]')
      ).map((node) => node.textContent.trim()),
      hasApplyEditsButton: Boolean(
        document.querySelector('[data-testid="timeline-apply-edits"]')
      ),
      hasTranscriptDeleteButton: Boolean(
        document.querySelector('[data-testid="transcript-delete-words"]')
      ),
    }));

    await page.getByTestId("editor-save").click();
    await visibleBox(
      page.getByTestId("export-selected-action"),
      "export selected action"
    );
    await screenshot(page, "07-player-export-after-edit-visible.png");

    const playerSummary = await page.evaluate(() => ({
      bodyText: document.body.innerText,
      hasEditAction: Boolean(
        document.querySelector('[data-testid="player-edit-action"]')
      ),
      hasExportAction: Boolean(
        document.querySelector('[data-testid="export-selected-action"]')
      ),
    }));

    fs.writeFileSync(
      path.join(OUT_DIR, "summary.json"),
      JSON.stringify(
        {
          extensionId,
          recording: seed,
          initialEditorGeometry,
          screenshots: fs
            .readdirSync(OUT_DIR)
            .filter((name) => name.endsWith(".png"))
            .sort(),
          editorSummary,
          playerSummary,
          consoleErrors,
        },
        null,
        2
      )
    );

    const filteredConsoleErrors = consoleErrors.filter(
      (line) => !/ResizeObserver loop completed/i.test(line)
    );
    assert(
      filteredConsoleErrors.length === 0,
      "page emitted console/page errors",
      filteredConsoleErrors.join("\n")
    );

    console.log("=== EDITOR EDITING PROOF PASS ===");
    console.log(
      JSON.stringify(
        { outDir: OUT_DIR, screenshots: fs.readdirSync(OUT_DIR).sort() },
        null,
        2
      )
    );
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage
        .screenshot({
          path: path.join(OUT_DIR, "failure-current-page.png"),
          fullPage: true,
        })
        .catch(() => {});
      const debug = await activePage
        .evaluate(() => ({
          url: location.href,
          title: document.title,
          text: document.body?.innerText || "",
          html: document.body?.innerHTML?.slice(0, 5000) || "",
        }))
        .catch((debugError) => ({ debugError: String(debugError) }));
      fs.writeFileSync(
        path.join(OUT_DIR, "failure-debug.json"),
        JSON.stringify({ debug, consoleErrors }, null, 2)
      );
    }
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
})().catch((error) => {
  fail(error?.stack || String(error));
});
