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
const PROJECT_AUDIO_MP3_PATH = path.join(
  ROOT,
  "src",
  "assets",
  "sounds",
  "beep.mp3"
);
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
            {
              type: "click",
              time: 0.4,
              x: 180,
              y: 140,
              xRatio: 0.28125,
              yRatio: 0.38889,
            },
            {
              type: "click",
              time: 2.2,
              x: 410,
              y: 210,
              xRatio: 0.640625,
              yRatio: 0.58333,
            },
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
    await page.addInitScript(() => {
      globalThis.__saylessSavePickerMode = "save";
      globalThis.__saylessSavePickerWrites = [];
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async (options) => {
          if (globalThis.__saylessSavePickerMode === "cancel") {
            throw new DOMException(
              "Save picker cancelled by proof",
              "AbortError"
            );
          }
          const record = {
            suggestedName: options?.suggestedName || "",
            types: options?.types || [],
            byteSize: 0,
            mimeType: "",
            closed: false,
          };
          globalThis.__saylessSavePickerWrites.push(record);
          return {
            createWritable: async () => ({
              write: async (blob) => {
                record.byteSize = Number(blob?.size) || 0;
                record.mimeType = String(blob?.type || "");
              },
              close: async () => {
                record.closed = true;
              },
            }),
          };
        },
      });
    });
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
    const zoomKeepButtons = page.getByTestId("zoom-suggestion-keep");
    await visibleBox(zoomKeepButtons.last(), "zoom suggestion keep");
    await zoomKeepButtons.last().click();
    await page.getByTestId("zoom-keyframe-remove").waitFor({
      state: "visible",
      timeout: 10000,
    });
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

    await page.getByTestId("player-crop-action").click();
    const cropWidthInput = page.getByTestId("project-crop-width");
    await cropWidthInput.waitFor({ state: "visible", timeout: 20000 });
    const cropInputs = {
      width: cropWidthInput,
      height: page.getByTestId("project-crop-height"),
      left: page.getByTestId("project-crop-left"),
      top: page.getByTestId("project-crop-top"),
    };
    const desiredCropInputs = {
      width: "512",
      height: "288",
      left: "64",
      top: "36",
    };
    let confirmedCropInputs = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await cropInputs.width.fill(desiredCropInputs.width);
      await cropInputs.height.fill(desiredCropInputs.height);
      // The cropper may asynchronously constrain position after a size change.
      // Let that settle before applying the explicit position values.
      await page.waitForTimeout(200);
      await cropInputs.left.fill(desiredCropInputs.left);
      await cropInputs.top.fill(desiredCropInputs.top);
      await page.waitForTimeout(300);
      confirmedCropInputs = Object.fromEntries(
        await Promise.all(
          Object.entries(cropInputs).map(async ([key, input]) => [
            key,
            await input.inputValue(),
          ])
        )
      );
      if (
        Object.entries(desiredCropInputs).every(
          ([key, value]) => confirmedCropInputs[key] === value
        )
      ) {
        break;
      }
    }
    assert(
      confirmedCropInputs &&
        Object.entries(desiredCropInputs).every(
          ([key, value]) => confirmedCropInputs[key] === value
        ),
      "crop inputs did not settle on the requested pixel bounds",
      { desiredCropInputs, confirmedCropInputs }
    );
    await screenshot(page, "08-project-crop-selected.png");
    await page.getByTestId("project-crop-save").click();
    await visibleBox(
      page.getByTestId("player-crop-action"),
      "player crop action after save"
    );
    await page.waitForFunction(
      (recordingId) =>
        chrome.storage.local
          .get(["localRecordingLibraryIndex"])
          .then(({ localRecordingLibraryIndex }) =>
            Boolean(localRecordingLibraryIndex?.[recordingId]?.project?.crop)
          ),
      seed.recordingId,
      { timeout: 10000 }
    );
    await page.waitForTimeout(750);
    const cropSummary = await page.evaluate(async (recordingId) => {
      const { localRecordingLibraryIndex } = await chrome.storage.local.get([
        "localRecordingLibraryIndex",
      ]);
      const entry = localRecordingLibraryIndex?.[recordingId];
      return {
        crop: entry?.project?.crop || null,
        zoomKeyframes: entry?.project?.zoomKeyframes || [],
        editedBlobKey: entry?.editedBlobKey || null,
      };
    }, seed.recordingId);
    assert(
      cropSummary.crop &&
        Math.abs(cropSummary.crop.xRatio - 0.1) < 0.02 &&
        Math.abs(cropSummary.crop.yRatio - 0.1) < 0.02 &&
        Math.abs(cropSummary.crop.widthRatio - 0.8) < 0.02 &&
        Math.abs(cropSummary.crop.heightRatio - 0.8) < 0.02 &&
        cropSummary.zoomKeyframes.length === 1 &&
        cropSummary.zoomKeyframes[0].source === "click" &&
        cropSummary.editedBlobKey === null,
      "crop was not saved as non-destructive normalized project state",
      cropSummary
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleBox(
      page.getByTestId("player-crop-action"),
      "player crop action after reopen"
    );
    await page.waitForFunction(
      () =>
        document.body?.innerText?.includes("Crop") &&
        document.body?.innerText?.includes("Yes"),
      null,
      { timeout: 10000 }
    );
    await screenshot(page, "09-project-crop-persisted-after-reopen.png");

    await page.getByTestId("player-audio-action").click();
    const audioInput = page.getByTestId("project-audio-file-input");
    await audioInput.waitFor({ state: "attached", timeout: 10000 });
    await audioInput.setInputFiles({
      name: "Broken project audio.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("not encoded audio"),
    });
    await page.getByTestId("project-audio-save").click();
    await page.waitForFunction(
      () =>
        document.body?.innerText?.includes("Audio file could not be decoded"),
      null,
      { timeout: 10000 }
    );
    const corruptAudioTrack = await page.evaluate(async (recordingId) => {
      const { localRecordingLibraryIndex } = await chrome.storage.local.get([
        "localRecordingLibraryIndex",
      ]);
      return (
        localRecordingLibraryIndex?.[recordingId]?.project?.audioTrack || null
      );
    }, seed.recordingId);
    assert(
      corruptAudioTrack === null,
      "corrupt encoded project audio was persisted",
      corruptAudioTrack
    );
    await screenshot(page, "10a-corrupt-project-audio-rejected.png");
    const projectAudioMp3 = fs.readFileSync(PROJECT_AUDIO_MP3_PATH);
    await audioInput.setInputFiles({
      name: "SayLess project audio.mp3",
      mimeType: "audio/mpeg",
      buffer: projectAudioMp3,
    });
    await page.getByTestId("project-audio-loop").click();
    await visibleBox(
      page.getByTestId("project-audio-details"),
      "project audio details"
    );
    await screenshot(page, "10-project-audio-selected.png");
    await page.getByTestId("project-audio-save").click();
    await visibleBox(
      page.getByTestId("player-audio-action"),
      "player audio action after save"
    );
    await page.waitForFunction(
      (recordingId) => {
        const raw = localStorage.getItem("unused");
        void raw;
        return chrome.storage.local
          .get(["localRecordingLibraryIndex"])
          .then(({ localRecordingLibraryIndex }) =>
            Boolean(
              localRecordingLibraryIndex?.[recordingId]?.project?.audioTrack
                ?.assetId
            )
          );
      },
      seed.recordingId,
      { timeout: 10000 }
    );
    const projectAudioSummary = await page.evaluate(async (recordingId) => {
      const { localRecordingLibraryIndex } = await chrome.storage.local.get([
        "localRecordingLibraryIndex",
      ]);
      const entry = localRecordingLibraryIndex?.[recordingId];
      const track = entry?.project?.audioTrack;
      const key = track
        ? `project-audio:${recordingId}:${track.assetId}`
        : null;
      const audioBlob = key
        ? await new Promise((resolve, reject) => {
            const request = indexedDB.open("local-recordings", 1);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction("blobs", "readonly");
              const get = tx.objectStore("blobs").get(key);
              get.onsuccess = () => {
                db.close();
                resolve(get.result || null);
              };
              get.onerror = () => reject(get.error);
            };
            request.onerror = () => reject(request.error);
          })
        : null;
      return {
        track,
        audioBytes: audioBlob?.size || 0,
        originalBytes: entry?.byteSize || 0,
        editedBlobKey: entry?.editedBlobKey || null,
      };
    }, seed.recordingId);
    assert(
      projectAudioSummary.track?.fileName === "SayLess project audio.mp3" &&
        projectAudioSummary.track?.mimeType === "audio/mpeg" &&
        projectAudioSummary.track?.byteSize === projectAudioMp3.length &&
        projectAudioSummary.track?.mode === "mix" &&
        projectAudioSummary.track?.loop === true &&
        projectAudioSummary.audioBytes === projectAudioMp3.length &&
        projectAudioSummary.editedBlobKey === null,
      "project audio was not saved non-destructively",
      projectAudioSummary
    );
    await page.waitForTimeout(750);
    const audioOnlyProjectCheckpoint = await page.evaluate(
      async (recordingId) => {
        const { localRecordingLibraryIndex } = await chrome.storage.local.get([
          "localRecordingLibraryIndex",
        ]);
        return localRecordingLibraryIndex?.[recordingId]?.editedBlobKey || null;
      },
      seed.recordingId
    );
    assert(
      audioOnlyProjectCheckpoint === null,
      "project-only edit created an implicit edited-media checkpoint",
      { editedBlobKey: audioOnlyProjectCheckpoint }
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleBox(
      page.getByTestId("player-audio-action"),
      "player audio action after reopen"
    );
    await page.waitForFunction(
      () =>
        document.body?.innerText?.includes("Audio") &&
        document.body?.innerText?.includes("Added"),
      null,
      { timeout: 10000 }
    );
    await screenshot(page, "11-project-audio-persisted-after-reopen.png");

    const playerSummary = await page.evaluate(() => ({
      bodyText: document.body.innerText,
      hasEditAction: Boolean(
        document.querySelector('[data-testid="player-edit-action"]')
      ),
      hasExportAction: Boolean(
        document.querySelector('[data-testid="export-selected-action"]')
      ),
    }));

    await page.waitForFunction(
      () => {
        const action = document.querySelector(
          '[data-testid="player-edit-action"]'
        );
        return (
          action &&
          action.getAttribute("aria-disabled") !== "true" &&
          action.getAttribute("data-disabled") !== "true"
        );
      },
      null,
      { timeout: 60000 }
    );
    await page.getByTestId("player-edit-action").click();
    await visibleBox(
      page.getByTestId("timeline-apply-edits"),
      "apply edits before durable bake"
    );
    await screenshot(page, "12-apply-edits-before-durable-bake.png");
    await page.getByTestId("timeline-apply-edits").click();
    await page.waitForFunction(
      (recordingId) =>
        chrome.storage.local
          .get(["localRecordingLibraryIndex"])
          .then(({ localRecordingLibraryIndex }) => {
            const entry = localRecordingLibraryIndex?.[recordingId];
            const clips = entry?.project?.timeline?.clips;
            return Boolean(
              entry?.editedBlobKey === `edited:${recordingId}` &&
                Array.isArray(clips) &&
                clips.length === 1 &&
                entry.project?.transcript == null &&
                entry.project?.audioTrack == null
            );
          }),
      seed.recordingId,
      { timeout: 20000 }
    );
    await page.getByTestId("timeline-apply-edits").waitFor({
      state: "detached",
      timeout: 20000,
    });
    await page.getByTestId("editor-save").click();
    await visibleBox(
      page.getByTestId("player-edit-action"),
      "player after durable apply"
    );

    const appliedSummary = await page.evaluate(
      async ({ recordingId, audioAssetId }) => {
        const { localRecordingLibraryIndex } = await chrome.storage.local.get([
          "localRecordingLibraryIndex",
        ]);
        const entry = localRecordingLibraryIndex?.[recordingId];
        const readBlob = (key) =>
          key
            ? new Promise((resolve, reject) => {
                const request = indexedDB.open("local-recordings", 1);
                request.onsuccess = () => {
                  const db = request.result;
                  const tx = db.transaction("blobs", "readonly");
                  const get = tx.objectStore("blobs").get(key);
                  get.onsuccess = () => {
                    db.close();
                    resolve(get.result || null);
                  };
                  get.onerror = () => reject(get.error);
                };
                request.onerror = () => reject(request.error);
              })
            : Promise.resolve(null);
        const [originalBlob, editedBlob, oldAudioBlob] = await Promise.all([
          readBlob(entry?.blobKey),
          readBlob(entry?.editedBlobKey),
          readBlob(
            audioAssetId ? `project-audio:${recordingId}:${audioAssetId}` : null
          ),
        ]);
        const storedBlobBytes = (value) => {
          if (!value) return 0;
          if (Number(value.size) > 0) return Number(value.size);
          if (Number(value.byteLength) > 0) return Number(value.byteLength);
          if (
            value.__local_forage_encoded_blob === true &&
            typeof value.data === "string"
          ) {
            return atob(value.data).length;
          }
          return 0;
        };
        return {
          editedBlobKey: entry?.editedBlobKey || null,
          originalBytes: originalBlob?.size || 0,
          editedBytes: storedBlobBytes(editedBlob),
          editedStoredAsEncodedBlob:
            editedBlob?.__local_forage_encoded_blob === true,
          indexedBytes: entry?.byteSize || 0,
          project: entry?.project || null,
          oldAudioBytes: oldAudioBlob?.size || 0,
        };
      },
      {
        recordingId: seed.recordingId,
        audioAssetId: projectAudioSummary.track?.assetId || null,
      }
    );
    const appliedClip = appliedSummary.project?.timeline?.clips?.[0];
    assert(
      appliedSummary.editedBlobKey === `edited:${seed.recordingId}` &&
        appliedSummary.originalBytes === seed.bytes &&
        appliedSummary.editedBytes > 0 &&
        appliedSummary.indexedBytes === appliedSummary.editedBytes &&
        appliedSummary.project?.transcript == null &&
        appliedSummary.project?.audioTrack == null &&
        appliedSummary.project?.crop == null &&
        appliedSummary.project?.zoomKeyframes?.length === 0 &&
        appliedSummary.project?.source?.width < 640 &&
        appliedSummary.project?.source?.height < 360 &&
        appliedSummary.project?.timeline?.clips?.length === 1 &&
        appliedClip?.sourceStart === 0 &&
        appliedClip?.sourceEnd < seed.duration &&
        appliedSummary.oldAudioBytes === 0,
      "Apply edits did not durably checkpoint the baked media and reset project",
      appliedSummary
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleBox(
      page.getByTestId("player-edit-action"),
      "player after applied project reopen"
    );
    await page.waitForFunction(
      () =>
        document.body?.innerText?.includes("Clips") &&
        document.body?.innerText?.includes("1") &&
        !document.body?.innerText?.includes("Audio\nAdded"),
      null,
      { timeout: 10000 }
    );
    await screenshot(page, "13-applied-project-persisted-after-reopen.png");

    const projectSidecarToggle = page.getByTestId("export-project-sidecar");
    await projectSidecarToggle.waitFor({ state: "visible", timeout: 10000 });
    if (await projectSidecarToggle.isChecked()) {
      await projectSidecarToggle.uncheck();
    }
    const saveToFileToggle = page.getByTestId("export-save-to-file");
    await saveToFileToggle.waitFor({ state: "visible", timeout: 10000 });
    await saveToFileToggle.check();
    await page.evaluate(() => {
      globalThis.__saylessSavePickerMode = "cancel";
      globalThis.__saylessSavePickerWrites = [];
    });
    await page.getByTestId("export-selected-action").click();
    await visibleBox(
      page.getByTestId("export-retry-action"),
      "retry after save picker cancellation"
    );
    await page.waitForFunction(
      () => document.body?.innerText?.includes("MP4 export cancelled"),
      null,
      { timeout: 60000 }
    );
    const cancelledSaveSummary = await page.evaluate(() => ({
      writes: globalThis.__saylessSavePickerWrites,
      bodyText: document.body?.innerText || "",
    }));
    assert(
      cancelledSaveSummary.writes.length === 0 &&
        cancelledSaveSummary.bodyText.includes("MP4 export cancelled") &&
        (await page.getByTestId("export-reveal-action").count()) === 0,
      "save picker cancellation was misreported as a completed export",
      cancelledSaveSummary
    );
    await screenshot(page, "14-save-picker-cancelled-retry-visible.png");

    await page.evaluate(() => {
      globalThis.__saylessSavePickerMode = "save";
    });
    await page.getByTestId("export-retry-action").click();
    await page.waitForFunction(
      () => document.body?.innerText?.includes("MP4 export complete"),
      null,
      { timeout: 60000 }
    );
    await page.getByTestId("export-retry-action").waitFor({
      state: "detached",
      timeout: 10000,
    });
    const savePickerSummary = await page.evaluate(() => ({
      writes: globalThis.__saylessSavePickerWrites,
      bodyText: document.body?.innerText || "",
    }));
    assert(
      savePickerSummary.writes.length === 1 &&
        /\.mp4$/i.test(savePickerSummary.writes[0].suggestedName) &&
        savePickerSummary.writes[0].byteSize > 0 &&
        savePickerSummary.writes[0].mimeType === "video/mp4" &&
        savePickerSummary.writes[0].closed === true &&
        savePickerSummary.bodyText.includes("MP4 export complete") &&
        (await page.getByTestId("export-reveal-action").count()) === 0,
      "retry did not save the packaged MP4 through the File System Access path",
      savePickerSummary
    );
    await screenshot(page, "15-save-picker-retry-complete.png");

    await page.getByTestId("export-dismiss-action").click();
    await page.getByTestId("export-dismiss-action").waitFor({
      state: "detached",
      timeout: 10000,
    });
    await saveToFileToggle.uncheck();
    const chromeDownloadIdsBefore = await page.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.downloads.search({}, (items) =>
            resolve(items.map((item) => item.id))
          )
        )
    );
    const browserDownloadPromise = page.waitForEvent("download", {
      timeout: 60000,
    });
    await page.getByTestId("export-selected-action").click();
    const browserDownload = await browserDownloadPromise;
    await visibleBox(
      page.getByTestId("export-reveal-action"),
      "reveal action after Chrome download"
    );
    await page.waitForFunction(
      () => document.body?.innerText?.includes("MP4 export complete"),
      null,
      { timeout: 60000 }
    );
    const browserDownloadPath = await browserDownload.path();
    const browserDownloadBytes = browserDownloadPath
      ? fs.statSync(browserDownloadPath).size
      : 0;
    const chromeDownloadSummary = await page.evaluate(
      (idsBefore) =>
        new Promise((resolve) =>
          chrome.downloads.search({}, (items) =>
            resolve(
              items
                .filter((item) => !idsBefore.includes(item.id))
                .map((item) => ({
                  id: item.id,
                  filename: item.filename,
                  state: item.state,
                  bytesReceived: item.bytesReceived,
                  totalBytes: item.totalBytes,
                  exists: item.exists,
                }))
            )
          )
        ),
      chromeDownloadIdsBefore
    );
    assert(
      chromeDownloadSummary.length === 1 &&
        Number.isSafeInteger(chromeDownloadSummary[0].id) &&
        chromeDownloadSummary[0].id >= 0 &&
        chromeDownloadSummary[0].state === "complete" &&
        chromeDownloadSummary[0].exists === true &&
        chromeDownloadSummary[0].bytesReceived > 0 &&
        chromeDownloadSummary[0].totalBytes > 0 &&
        browserDownloadBytes > 0 &&
        /\.mp4$/i.test(browserDownload.suggestedFilename()),
      "packaged editor export did not expose reveal for its completed Chrome download",
      {
        chromeDownloadSummary,
        browserDownloadBytes,
        suggestedFilename: browserDownload.suggestedFilename(),
      }
    );
    await screenshot(page, "16-chrome-download-reveal-visible.png");
    await browserDownload.delete();

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
          cropSummary,
          projectAudioSummary,
          playerSummary,
          appliedSummary,
          cancelledSaveSummary,
          savePickerSummary,
          chromeDownloadSummary,
          browserDownloadBytes,
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
