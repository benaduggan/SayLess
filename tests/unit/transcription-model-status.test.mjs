import assert from "node:assert/strict";
import test from "node:test";

import {
  checkLocalWhisperModelStatus,
  loadLocalWhisperManifest,
  MODEL_STATUS_MANIFEST_PATH,
  resolveExtensionAssetUrl,
} from "../../src/transcription/modelStatus.ts";

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const emptyResponse = (ok, status = ok ? 200 : 404, bytes = 0) => ({
  ok,
  status,
  headers: {
    get(name) {
      return name.toLowerCase() === "content-length" && bytes ? String(bytes) : null;
    },
  },
});

test("local whisper manifest resolves through chrome.runtime.getURL", async () => {
  const requested = [];
  const runtime = {
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
  };
  const manifest = await loadLocalWhisperManifest(runtime, async (url) => {
    requested.push(url);
    return jsonResponse({
      schemaVersion: 1,
      defaultModel: "test-model",
      assetRoot: "assets/whisper/models/",
      requiredFiles: ["model/config.json"],
    });
  });

  assert.equal(requested[0], `chrome-extension://test/${MODEL_STATUS_MANIFEST_PATH}`);
  assert.equal(manifest.defaultModel, "test-model");
  assert.deepEqual(manifest.requiredFiles, ["model/config.json"]);
});

test("local whisper status reports ready when all manifest assets exist", async () => {
  const runtime = {
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
  };
  const status = await checkLocalWhisperModelStatus({
    runtime,
    fetchImpl: async (url) => {
      if (url.endsWith("model-manifest.json")) {
        return jsonResponse({
          assetRoot: "assets/whisper/models/",
          requiredFiles: ["model/config.json", "model/encoder.onnx"],
        });
      }
      return emptyResponse(true, 200, url.endsWith(".onnx") ? 20 : 10);
    },
  });

  assert.equal(status.ready, true);
  assert.equal(status.state, "ready");
  assert.equal(status.requiredCount, 2);
  assert.equal(status.presentCount, 2);
  assert.equal(status.totalBytes, 30);
});

test("local whisper status reports missing files", async () => {
  const status = await checkLocalWhisperModelStatus({
    runtime: { runtime: { getURL: (assetPath) => assetPath } },
    fetchImpl: async (url) => {
      if (url.endsWith("model-manifest.json")) {
        return jsonResponse({
          assetRoot: "assets/whisper/models/",
          requiredFiles: ["model/config.json", "model/encoder.onnx"],
        });
      }
      return emptyResponse(!url.endsWith(".onnx"));
    },
  });

  assert.equal(status.ready, false);
  assert.equal(status.state, "missing");
  assert.deepEqual(status.missingFiles, ["model/encoder.onnx"]);
});

test("extension asset URLs fall back to raw paths outside chrome", () => {
  assert.equal(
    resolveExtensionAssetUrl("assets/whisper/model-manifest.json", null),
    "assets/whisper/model-manifest.json",
  );
});
