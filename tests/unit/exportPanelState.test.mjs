import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExportCompletionFromSaveResult,
  buildExportJobDescription,
  buildExportRetrySnapshot,
  buildExportJobTitle,
  buildRetryExportSettings,
  canRetryExportJob,
  canRevealExportJob,
} from "../../src/pages/EditorApp/layout/player/exportPanelState.js";

test("export job title reflects terminal states", () => {
  assert.equal(buildExportJobTitle(null), "Export");
  assert.equal(
    buildExportJobTitle({ label: "MP4 export", status: "running" }),
    "MP4 export",
  );
  assert.equal(
    buildExportJobTitle({ label: "MP4 export", status: "completed" }),
    "MP4 export complete",
  );
  assert.equal(
    buildExportJobTitle({ label: "WebM export", status: "failed" }),
    "WebM export failed",
  );
  assert.equal(
    buildExportJobTitle({ label: "GIF export", status: "cancelled" }),
    "GIF export cancelled",
  );
});

test("export job description covers progress and terminal copy", () => {
  assert.equal(buildExportJobDescription(null), "");
  assert.equal(
    buildExportJobDescription({ status: "running", progress: 0 }, 0),
    "Rendering locally.",
  );
  assert.equal(
    buildExportJobDescription({ status: "running", progress: 0 }, 24.6),
    "Rendering locally (25%)",
  );
  assert.equal(
    buildExportJobDescription({ status: "running", progress: 49.4 }, 10),
    "Rendering locally (49%)",
  );
  assert.equal(
    buildExportJobDescription({ status: "completed" }),
    "Export finished.",
  );
  assert.equal(
    buildExportJobDescription({ status: "failed", error: "No disk space." }),
    "No disk space.",
  );
  assert.equal(
    buildExportJobDescription({ status: "failed" }),
    "Export failed.",
  );
  assert.equal(
    buildExportJobDescription({ status: "cancelled" }),
    "Export cancelled.",
  );
});

test("export job actions expose reveal only for completed downloads", () => {
  assert.equal(canRevealExportJob({ status: "completed" }, 42), true);
  assert.equal(canRevealExportJob({ status: "completed" }, null), false);
  assert.equal(canRevealExportJob({ status: "failed" }, 42), false);
  assert.equal(canRevealExportJob(null, 42), false);
});

test("export job actions expose retry only for failed and cancelled jobs", () => {
  assert.equal(canRetryExportJob({ status: "failed" }), true);
  assert.equal(canRetryExportJob({ status: "cancelled" }), true);
  assert.equal(canRetryExportJob({ status: "completed" }), false);
  assert.equal(canRetryExportJob({ status: "running" }), false);
  assert.equal(canRetryExportJob(null), false);
});

test("buildExportCompletionFromSaveResult preserves save and cancellation outcomes", () => {
  assert.deepEqual(
    buildExportCompletionFromSaveResult({
      saved: true,
      downloadId: 42,
      fileName: "clip.mp4",
    }),
    { status: "completed", downloadId: 42 },
  );
  assert.deepEqual(
    buildExportCompletionFromSaveResult({
      saved: true,
      fileName: "clip.mp4",
    }),
    { status: "completed", downloadId: null },
  );
  assert.deepEqual(
    buildExportCompletionFromSaveResult({
      saved: false,
      reason: "cancelled",
    }),
    { status: "cancelled" },
  );
  assert.deepEqual(buildExportCompletionFromSaveResult(null), {
    status: "failed",
    error: "Export could not be saved.",
  });
});

test("buildRetryExportSettings normalizes previous export settings", () => {
  assert.deepEqual(
    buildRetryExportSettings(
      {
        format: "gif",
        qualityPreset: "compressed",
        includeProjectSidecar: false,
        includeTranscriptSidecar: true,
        includeCaptionSidecar: true,
        audioOnly: false,
        audioFormat: "m4a",
        captionStyle: { preset: "high-contrast", burnIn: true },
        gif: { startSeconds: 1.25, durationSeconds: 4, fps: 12, width: 640 },
      },
      { status: "failed" },
    ),
    {
      format: "gif",
      qualityPreset: "compressed",
      includeProjectSidecar: false,
      includeTranscriptSidecar: true,
      includeCaptionSidecar: true,
      audioOnly: false,
      audioFormat: "m4a",
      captionStyle: { preset: "high-contrast", burnIn: true },
      gif: { startSeconds: 1.25, durationSeconds: 4, fps: 12, width: 640 },
    },
  );
  assert.deepEqual(
    buildRetryExportSettings({}, { status: "cancelled" }),
    {
      format: "mp4",
      qualityPreset: "original",
      includeProjectSidecar: true,
      includeTranscriptSidecar: false,
      includeCaptionSidecar: false,
      audioOnly: false,
      audioFormat: "wav",
      captionStyle: {},
      gif: {},
    },
  );
});

test("buildExportRetrySnapshot applies explicit overrides without dropping local export options", () => {
  const snapshot = buildExportRetrySnapshot(
    {
      format: "mp4",
      qualityPreset: "compressed",
      includeProjectSidecar: true,
      includeTranscriptSidecar: true,
      includeCaptionSidecar: false,
      audioOnly: true,
      audioFormat: "m4a",
      captionStyle: { preset: "large", burnIn: true },
      gif: { fps: 24, width: 1280 },
    },
    { format: "webm", audioOnly: false },
  );

  assert.deepEqual(snapshot, {
    format: "webm",
    qualityPreset: "compressed",
    includeProjectSidecar: true,
    includeTranscriptSidecar: true,
    includeCaptionSidecar: false,
    audioOnly: false,
    audioFormat: "m4a",
    captionStyle: { preset: "large", burnIn: true },
    gif: { fps: 24, width: 1280 },
  });
});

test("buildRetryExportSettings blocks retries while another export is running", () => {
  assert.equal(
    buildRetryExportSettings(
      { format: "webm", audioFormat: "wav", gif: {} },
      { status: "running" },
    ),
    null,
  );
  assert.equal(buildRetryExportSettings(null, { status: "failed" }), null);
});
