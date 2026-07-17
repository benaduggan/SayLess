import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLocalBlobUrl,
  buildSavePickerOptions,
  downloadBlobWithChrome,
  hasFileSystemSavePicker,
  saveBlobWithPicker,
  saveOrDownloadBlob,
} from "../../src/pages/utils/localFileExport.js";

test("assertLocalBlobUrl rejects remote and extension URLs", () => {
  assert.equal(assertLocalBlobUrl("blob:test"), "blob:test");
  assert.throws(
    () => assertLocalBlobUrl("https://example.com/video.webm"),
    /Expected local blob URL/,
  );
  assert.throws(
    () => assertLocalBlobUrl("chrome-extension://abc/video.webm"),
    /Expected local blob URL/,
  );
});

test("buildSavePickerOptions maps known extensions to picker accept types", () => {
  assert.deepEqual(buildSavePickerOptions("Demo.vtt", ""), {
    suggestedName: "Demo.vtt",
    types: [
      {
        description: "SayLess export",
        accept: {
          "text/vtt": [".vtt"],
        },
      },
    ],
  });

  assert.equal(
    buildSavePickerOptions("clip.m4a", "audio/mp4").types[0].accept[
      "audio/mp4"
    ][0],
    ".m4a",
  );
});

test("hasFileSystemSavePicker reports unsupported outside browser picker contexts", () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(hasFileSystemSavePicker(), false);
    globalThis.window = { showSaveFilePicker: async () => {} };
    assert.equal(hasFileSystemSavePicker(), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("saveBlobWithPicker returns cancelled for AbortError", async () => {
  const originalWindow = globalThis.window;
  try {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    globalThis.window = {
      showSaveFilePicker: async () => {
        throw abort;
      },
    };
    assert.deepEqual(await saveBlobWithPicker(new Blob(["x"]), "x.txt"), {
      saved: false,
      reason: "cancelled",
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("saveOrDownloadBlob stops after picker cancellation", async () => {
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  try {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    let downloadCalled = false;
    globalThis.window = {
      showSaveFilePicker: async () => {
        throw abort;
      },
    };
    globalThis.chrome = {
      downloads: {
        download: () => {
          downloadCalled = true;
        },
      },
      runtime: {},
    };

    assert.deepEqual(
      await saveOrDownloadBlob(new Blob(["x"]), "x.txt", { preferPicker: true }),
      { saved: false, reason: "cancelled" },
    );
    assert.equal(downloadCalled, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("saveOrDownloadBlob falls back to Chrome download after picker failure", async () => {
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const originalUrl = globalThis.URL;
  const originalWarn = console.warn;
  try {
    let downloadOptions = null;
    let revokedUrl = null;
    globalThis.window = {
      showSaveFilePicker: async () => {
        throw new Error("write failed");
      },
    };
    globalThis.URL = {
      createObjectURL: () => "blob:test",
      revokeObjectURL: (url) => {
        revokedUrl = url;
      },
    };
    globalThis.chrome = {
      downloads: {
        download: (options, cb) => {
          downloadOptions = options;
          cb(42);
        },
      },
      runtime: {},
    };
    console.warn = () => {};

    assert.deepEqual(
      await saveOrDownloadBlob(new Blob(["x"]), "x.txt", { preferPicker: true }),
      { saved: true, downloadId: 42, fileName: "x.txt" },
    );
    assert.deepEqual(downloadOptions, {
      url: "blob:test",
      filename: "x.txt",
      saveAs: true,
    });
    assert.equal(revokedUrl, "blob:test");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.URL = originalUrl;
    console.warn = originalWarn;
  }
});

test("downloadBlobWithChrome returns null for user-cancelled Save As", async () => {
  const originalChrome = globalThis.chrome;
  const originalUrl = globalThis.URL;
  try {
    let revokedUrl = null;
    globalThis.URL = {
      createObjectURL: () => "blob:cancel",
      revokeObjectURL: (url) => {
        revokedUrl = url;
      },
    };
    globalThis.chrome = {
      downloads: {
        download: (_options, cb) => {
          globalThis.chrome.runtime.lastError = { message: "USER_CANCELED" };
          cb(null);
        },
      },
      runtime: {},
    };

    assert.equal(await downloadBlobWithChrome(new Blob(["x"]), "x.txt"), null);
    assert.equal(revokedUrl, "blob:cancel");
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    globalThis.URL = originalUrl;
  }
});
