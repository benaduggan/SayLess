import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectSaveStatus,
  buildProjectSummary,
} from "../../src/pages/EditorApp/layout/player/projectPanelState.ts";

test("project summary reports local project counts and export sidecars", () => {
  const summary = buildProjectSummary({
    recordingId: "rec-1",
    saveStatus: "saved",
    timeline: { clips: [{ id: "a" }, { id: "b" }] },
    transcript: { words: [{ text: "hello" }, { text: "offline" }] },
    chapterMarkers: [{ id: "ch-1" }],
    zoomKeyframes: [{ id: "zoom-1" }, { id: "zoom-2" }],
    exportSettings: {
      format: "gif",
      includeProjectSidecar: true,
      includeTranscriptSidecar: true,
      includeCaptionSidecar: true,
    },
  });

  assert.equal(summary.title, "Local project");
  assert.equal(summary.status, "Project autosaved locally.");
  assert.deepEqual(
    summary.stats.map((stat) => [stat.label, stat.value]),
    [
      ["Clips", 2],
      ["Words", 2],
      ["Chapters", 1],
      ["Zooms", 2],
    ],
  );
  assert.equal(summary.exportLabel, "GIF export");
  assert.equal(summary.sidecarLabel, "project, transcript, captions sidecars");
});

test("project summary reports missing recording id and no sidecars", () => {
  const summary = buildProjectSummary({
    recordingId: "",
    saveStatus: "idle",
    exportSettings: {
      format: "audio",
      audioFormat: "m4a",
      includeProjectSidecar: false,
    },
  });

  assert.equal(summary.title, "Local project not saved yet");
  assert.equal(
    summary.status,
    "Open this recording from the Videos tab to autosave project data.",
  );
  assert.equal(summary.exportLabel, "M4A export");
  assert.equal(summary.sidecarLabel, "no sidecars selected");
});

test("project save status covers queued and failed autosave states", () => {
  assert.equal(
    buildProjectSaveStatus("pending"),
    "Project changes queued for autosave.",
  );
  assert.equal(buildProjectSaveStatus("saving"), "Saving local project...");
  assert.equal(
    buildProjectSaveStatus("error"),
    "Project autosave failed; export a project sidecar before closing.",
  );
});
