import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_SCHEMA_VERSION,
  normalizeExportSettings,
  normalizeProjectSchema,
} from "../../src/pages/localRecordings/projectSchema.ts";

test("export settings normalize legacy format-only projects", () => {
  const settings = normalizeExportSettings({ format: "webm" }, { duration: 30 });

  assert.equal(settings.format, "webm");
  assert.equal(settings.qualityPreset, "original");
  assert.equal(settings.includeProjectSidecar, true);
  assert.equal(settings.includeTranscriptSidecar, false);
  assert.equal(settings.includeCaptionSidecar, false);
  assert.equal(settings.audioOnly, false);
});

test("export settings clamp gif snippet values for the source duration", () => {
  const settings = normalizeExportSettings(
    {
      format: "gif",
      qualityPreset: "compressed",
      includeCaptionSidecar: true,
      captionStyle: { preset: "high-contrast", burnIn: true },
      gif: {
        startSeconds: 50,
        durationSeconds: 999,
        fps: 120,
        width: 9999,
      },
    },
    { duration: 52 },
  );

  assert.equal(settings.format, "gif");
  assert.equal(settings.qualityPreset, "compressed");
  assert.equal(settings.includeCaptionSidecar, true);
  assert.equal(settings.captionStyle.preset, "high-contrast");
  assert.equal(settings.captionStyle.burnIn, true);
  assert.equal(settings.gif.startSeconds, 50);
  assert.equal(settings.gif.durationSeconds, 2);
  assert.equal(settings.gif.fps, 30);
  assert.equal(settings.gif.width, 1920);
});

test("export settings normalize audio-only exports", () => {
  const settings = normalizeExportSettings({
    format: "audio",
    audioFormat: "m4a",
    audioOnly: true,
    includeProjectSidecar: false,
    includeTranscriptSidecar: true,
  });

  assert.equal(settings.format, "audio");
  assert.equal(settings.audioOnly, true);
  assert.equal(settings.audioFormat, "m4a");
  assert.equal(settings.includeProjectSidecar, false);
  assert.equal(settings.includeTranscriptSidecar, true);
});

test("project schema migrates old project shapes to the current version", () => {
  const project = normalizeProjectSchema({
    version: 1,
    recordingId: "rec-a",
    source: { duration: 12 },
    chapterMarkers: [
      { id: "bad-late", time: 99, label: "Late", source: "manual" },
      { id: "intro", time: 0, label: "Intro", source: "start" },
    ],
    zoomKeyframes: [
      {
        id: "zoom-late",
        time: 20,
        durationSeconds: 20,
        scale: 4,
        xRatio: 0.25,
        yRatio: 0.75,
        label: "Zoom",
        source: "click",
      },
    ],
    exportSettings: {
      format: "bad-format",
      qualityPreset: "bad-quality",
      gif: { startSeconds: -10, durationSeconds: 1000 },
    },
  });

  assert.equal(project.version, PROJECT_SCHEMA_VERSION);
  assert.equal(project.recordingId, "rec-a");
  assert.equal(project.exportSettings.format, "mp4");
  assert.equal(project.exportSettings.qualityPreset, "original");
  assert.equal(project.exportSettings.gif.startSeconds, 0);
  assert.equal(project.exportSettings.gif.durationSeconds, 12);
  assert.deepEqual(
    project.chapterMarkers.map((marker) => [marker.id, marker.time, marker.label]),
    [
      ["intro", 0, "Intro"],
      ["bad-late", 12, "Late"],
    ],
  );
  assert.deepEqual(
    project.zoomKeyframes.map((keyframe) => [
      keyframe.id,
      keyframe.time,
      keyframe.durationSeconds,
      keyframe.scale,
      keyframe.xRatio,
      keyframe.yRatio,
    ]),
    [["zoom-late", 12, 12, 3, 0.25, 0.75]],
  );
});
