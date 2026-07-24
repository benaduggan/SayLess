import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildManualQaMeasurementImport } from "../../scripts/manual-qa-measurement-import.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const generatedAt = "2026-07-23T04:10:00.000Z";
const sha = (character) => character.repeat(64);

const mediaFile = (fileName, format, character, extra = {}) => ({
  fileName,
  format,
  byteSize: 1000 + character.charCodeAt(0),
  sha256: sha(character),
  ...extra,
});

const makeFixture = () => {
  const recordingOne = mediaFile("source-one.mp4", "mp4", "a", {
    durationSeconds: 181,
    video: { width: 1920, height: 1080 },
    recordingFields: {
      fileName: "source-one.mp4",
      sha256: sha("a"),
      durationSeconds: 181,
      byteSize: 1097,
      width: 1920,
      height: 1080,
      container: "mp4",
    },
  });
  const recordingTwo = mediaFile("source-two.webm", "webm", "b", {
    durationSeconds: 90,
    video: { width: 1280, height: 720 },
    recordingFields: {
      fileName: "source-two.webm",
      sha256: sha("b"),
      durationSeconds: 90,
      byteSize: 1098,
      width: 1280,
      height: 720,
      container: "webm",
    },
  });
  const mediaExports = [
    ["export.mp4", "mp4", "c"],
    ["export.webm", "webm", "d"],
    ["export.gif", "gif", "e"],
    ["export.wav", "wav", "f"],
    ["export.m4a", "m4a", "1"],
  ].map(([fileName, format, character]) => mediaFile(fileName, format, character));
  const audioInputs = [
    ["input.wav", "wav", "2", 2, 48000],
    ["input.m4a", "m4a", "3", 2, 48000],
    ["input.mp3", "mp3", "4", 1, 44100],
  ].map(([fileName, format, character, channels, sampleRate]) => {
    const file = mediaFile(fileName, format, character, {
      durationSeconds: 12.5,
      audio: { channels, sampleRate },
    });
    file.projectAudioInputFields = {
      format,
      fileName,
      sha256: file.sha256,
      byteSize: file.byteSize,
      durationSeconds: file.durationSeconds,
      channels,
      sampleRate,
    };
    return file;
  });
  const sidecarFiles = [
    ["export.vtt", "vtt", "5"],
    ["export.transcript.json", "transcript-json", "6"],
    ["export.sayless-project.json", "sayless-project-json", "7"],
  ].map(([fileName, format, character]) =>
    mediaFile(fileName, format, character, {
      exportFields: {
        format,
        fileName,
        byteSize: 1000 + character.charCodeAt(0),
        sha256: sha(character),
      },
    }),
  );
  const evidence = {
    kind: "sayless.manualQaEvidence",
    status: "template",
    automatedEvidenceGeneratedAt: "2026-07-23T04:00:00.000Z",
    probeReports: {
      media: "release-artifacts/manual-qa-media-probe.json",
      sidecars: "release-artifacts/manual-qa-sidecar-probe.json",
    },
    recordings: [
      {
        id: "recording-one",
        fileName: "source-one.mp4",
        notes: "Tester-owned source observation.",
      },
      {
        id: "recording-two",
        fileName: "source-two.webm",
        notes: "Second tester-owned source observation.",
      },
    ],
    exports: {
      files: [
        ...mediaExports.map((file) => ({
          format: file.format,
          fileName: file.fileName,
          notes: `Opened ${file.fileName} manually.`,
        })),
        ...sidecarFiles.map((file) => ({
          format: file.format,
          fileName: file.fileName,
          notes: `Opened ${file.fileName} manually.`,
        })),
      ],
      workflow: { captionBurnInVerified: false },
    },
    projectAudio: {
      inputs: audioInputs.map((file) => ({
        format: file.format,
        fileName: file.fileName,
        previewNotes: `Listened to ${file.fileName}.`,
      })),
      syncNotes: "Tester-owned synchronization observation.",
    },
  };
  return {
    evidence,
    mediaReport: {
      kind: "sayless.manualQaMediaProbe",
      status: "measured",
      generatedAt,
      requireComplete: true,
      reportPath: "release-artifacts/manual-qa-media-probe.json",
      releaseCoverage: { status: "measurable-set-complete" },
      files: [recordingOne, recordingTwo, ...mediaExports, ...audioInputs],
      fileCount: 10,
    },
    sidecarReport: {
      kind: "sayless.manualQaSidecarProbe",
      status: "inspected",
      generatedAt,
      requireComplete: true,
      reportPath: "release-artifacts/manual-qa-sidecar-probe.json",
      coverage: { status: "structurally-complete" },
      files: sidecarFiles,
      fileCount: 3,
    },
  };
};

test("measurement import copies only exact probe fields and preserves observations", () => {
  const fixture = makeFixture();
  const result = buildManualQaMeasurementImport(fixture);

  assert.deepEqual(result.matched, {
    recordings: 2,
    exports: 8,
    projectAudioInputs: 3,
  });
  assert.equal(result.changes.length, 43);
  assert.equal(result.evidence.recordings[0].byteSize, 1097);
  assert.equal(result.evidence.recordings[0].width, 1920);
  assert.equal(result.evidence.exports.files[0].sha256, sha("c"));
  assert.equal(result.evidence.exports.files[5].sha256, sha("5"));
  assert.equal(result.evidence.projectAudio.inputs[2].channels, 1);
  assert.equal(result.evidence.recordings[0].notes, "Tester-owned source observation.");
  assert.equal(result.evidence.projectAudio.syncNotes, "Tester-owned synchronization observation.");
  assert.equal(result.evidence.exports.workflow.captionBurnInVerified, false);
  assert.equal("testedAt" in result.evidence, false);
  assert.equal(result.evidence.status, "template");

  const repeated = buildManualQaMeasurementImport({
    ...fixture,
    evidence: result.evidence,
  });
  assert.deepEqual(repeated.changes, []);
});

test("measurement import fails closed on role, format, freshness, or status drift", () => {
  const fixture = makeFixture();
  assert.throws(
    () =>
      buildManualQaMeasurementImport({
        ...fixture,
        evidence: {
          ...fixture.evidence,
          recordings: [
            {
              ...fixture.evidence.recordings[0],
              fileName: "export.gif",
            },
          ],
        },
      }),
    /must identify a measured MP4\/WebM source/,
  );
  assert.throws(
    () =>
      buildManualQaMeasurementImport({
        ...fixture,
        mediaReport: {
          ...fixture.mediaReport,
          requireComplete: false,
        },
      }),
    /strict, measurably complete/,
  );
  assert.throws(
    () =>
      buildManualQaMeasurementImport({
        ...fixture,
        sidecarReport: {
          ...fixture.sidecarReport,
          generatedAt: "2026-07-23T03:00:00.000Z",
        },
      }),
    /sidecar report must be generated after automated QA evidence/,
  );
  assert.throws(
    () =>
      buildManualQaMeasurementImport({
        ...fixture,
        evidence: { ...fixture.evidence, status: "passed" },
      }),
    /passed evidence is never rewritten/,
  );
  assert.throws(
    () =>
      buildManualQaMeasurementImport({
        ...fixture,
        mediaReport: {
          ...fixture.mediaReport,
          fileCount: 9,
          files: fixture.mediaReport.files.map((file, index) =>
            index === 0
              ? {
                  ...file,
                  recordingFields: {
                    ...file.recordingFields,
                    width: 0,
                  },
                }
              : file,
          ),
        },
      }),
    /fileCount must match files\.length[\s\S]*width and height must be positive/,
  );
});

test("measurement import CLI previews by default and writes atomically only with --write", () => {
  const fixture = makeFixture();
  const root = mkdtempSync(join(tmpdir(), "sayless-measurement-import-"));
  const artifacts = join(root, "release-artifacts");
  mkdirSync(artifacts, { recursive: true });
  const evidencePath = join(artifacts, "manual-qa-evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify(fixture.evidence, null, 2)}\n`);
  writeFileSync(
    join(artifacts, "manual-qa-media-probe.json"),
    `${JSON.stringify(fixture.mediaReport, null, 2)}\n`,
  );
  writeFileSync(
    join(artifacts, "manual-qa-sidecar-probe.json"),
    `${JSON.stringify(fixture.sidecarReport, null, 2)}\n`,
  );
  try {
    const before = readFileSync(evidencePath, "utf8");
    const preview = spawnSync(
      process.execPath,
      ["scripts/apply-manual-qa-measurements.mjs", "--json"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_MEASUREMENTS_ROOT: root,
        },
      },
    );
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).status, "preview");
    assert.equal(readFileSync(evidencePath, "utf8"), before);

    const applied = spawnSync(
      process.execPath,
      ["scripts/apply-manual-qa-measurements.mjs", "--json", "--write"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          SAYLESS_MANUAL_QA_MEASUREMENTS_ROOT: root,
        },
      },
    );
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(JSON.parse(applied.stdout).status, "applied");
    assert.equal(JSON.parse(readFileSync(evidencePath)).recordings[0].width, 1920);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
