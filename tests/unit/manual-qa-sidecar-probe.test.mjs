import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const PROBE = join(ROOT, "scripts", "manual-qa-sidecar-probe.mjs");

const runProbe = (...args) =>
  spawnSync(process.execPath, [PROBE, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const makeFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-sidecar-probe-"));
  const vttPath = join(dir, "Real recording.vtt");
  const transcriptPath = join(dir, "Real recording.transcript.json");
  const projectPath = join(dir, "Real recording.sayless-project.json");
  writeFileSync(
    vttPath,
    "WEBVTT\n\n00:00:00.100 --> 00:00:00.400\nhello\n\n00:00:01.200 --> 00:00:01.700\noffline recording\n",
  );
  writeJson(transcriptPath, {
    kind: "sayless.localRecordingTranscript",
    schemaVersion: 1,
    exportedAt: 1_784_000_000_000,
    recording: {
      id: "real-recording",
      title: "Real recording",
      durationMs: 2_000,
      mimeType: "video/mp4",
    },
    transcript: {
      version: 1,
      language: "en",
      providerId: "local-whisper",
      words: [
        { text: "hello", start: 0.1, end: 0.4 },
        { text: "offline", start: 1.2, end: 1.7 },
      ],
    },
    timelineAwareWords: [{ text: "hello", start: 0.1, end: 0.4 }],
  });
  writeJson(projectPath, {
    kind: "sayless.localRecordingProject",
    schemaVersion: 1,
    exportedAt: 1_784_000_000_000,
    recording: {
      id: "real-recording",
      title: "Real recording",
      durationMs: 2_000,
      byteSize: 50_000,
      mimeType: "video/mp4",
    },
    project: {
      version: 4,
      recordingId: "real-recording",
      source: { duration: 2 },
      timeline: {
        version: 2,
        source: { duration: 2 },
        clips: [
          { id: "clip-a", sourceStart: 0, sourceEnd: 0.8, muted: false },
          { id: "clip-b", sourceStart: 1.1, sourceEnd: 2, muted: true },
        ],
      },
      transcript: {
        words: [
          { text: "hello", start: 0.1, end: 0.4 },
          { text: "offline", start: 1.2, end: 1.7 },
        ],
      },
      chapterMarkers: [{ id: "chapter", time: 0, label: "Hello" }],
      zoomKeyframes: [{ id: "zoom", time: 0.5, durationSeconds: 1 }],
      crop: { xRatio: 0, yRatio: 0, widthRatio: 0.75, heightRatio: 1 },
      audioTrack: { assetId: "sha256-audio" },
      exportSettings: { format: "mp4" },
    },
  });
  return { dir, vttPath, transcriptPath, projectPath };
};

test("manual QA sidecar probe validates a complete export set", () => {
  const fixture = makeFixture();
  try {
    const result = runProbe(
      "--json",
      "--require-complete",
      fixture.vttPath,
      fixture.transcriptPath,
      fixture.projectPath,
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "sayless.manualQaSidecarProbe");
    assert.equal(report.status, "inspected");
    assert.equal(report.fileCount, 3);
    assert.equal(report.requireComplete, true);
    assert.equal(report.reportPath, null);
    assert.equal(report.coverage.status, "structurally-complete");
    assert.deepEqual(report.coverage.observedFormats, [
      "sayless-project-json",
      "transcript-json",
      "vtt",
    ]);
    assert.deepEqual(report.coverage.remainingFormats, []);
    assert.equal(report.coverage.passedFormatCount, 3);
    assert.equal(report.coverage.totalFormatCount, 3);
    assert.equal(report.coverage.completeSetCount, 1);
    assert.deepEqual(report.coverage.sidecarSets, [
      {
        name: "Real recording",
        status: "structurally-complete",
        observedFormats: ["sayless-project-json", "transcript-json", "vtt"],
        remainingFormats: [],
        recordingIds: ["real-recording"],
      },
    ]);
    assert.match(report.reminder, /import the project sidecar/i);

    const files = new Map(report.files.map((file) => [file.format, file]));
    const vtt = files.get("vtt");
    assert.equal(vtt.fileName, "Real recording.vtt");
    assert.equal(vtt.sidecarSetName, "Real recording");
    assert.equal(vtt.sourcePath, "Real recording.vtt");
    assert.equal(vtt.sha256, sha256(fixture.vttPath));
    assert.equal(vtt.cueCount, 2);
    assert.equal(vtt.firstCueStartSeconds, 0.1);
    assert.equal(vtt.lastCueEndSeconds, 1.7);
    assert.deepEqual(vtt.exportFields, {
      format: "vtt",
      fileName: "Real recording.vtt",
      byteSize: readFileSync(fixture.vttPath).byteLength,
      sha256: sha256(fixture.vttPath),
    });

    const transcript = files.get("transcript-json");
    assert.equal(transcript.kind, "sayless.localRecordingTranscript");
    assert.equal(transcript.schemaVersion, 1);
    assert.equal(transcript.recordingId, "real-recording");
    assert.equal(transcript.transcriptWordCount, 2);
    assert.equal(transcript.timelineAwareWordCount, 1);
    assert.equal(transcript.language, "en");
    assert.equal(transcript.providerId, "local-whisper");

    const project = files.get("sayless-project-json");
    assert.equal(project.kind, "sayless.localRecordingProject");
    assert.equal(project.schemaVersion, 1);
    assert.equal(project.projectVersion, 4);
    assert.equal(project.recordingId, "real-recording");
    assert.equal(project.clipCount, 2);
    assert.equal(project.transcriptWordCount, 2);
    assert.equal(project.chapterCount, 1);
    assert.equal(project.zoomCount, 1);
    assert.equal(project.hasCrop, true);
    assert.equal(project.hasProjectAudioReference, true);
    assert.equal(project.exportFormat, "mp4");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA sidecar probe prints read-only human guidance", () => {
  const fixture = makeFixture();
  try {
    const result = runProbe(fixture.vttPath, fixture.transcriptPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Manual QA sidecar probe: 2 files/);
    assert.match(result.stdout, /Cues: 2/);
    assert.match(result.stdout, /Timeline-aware words: 1/);
    assert.match(
      result.stdout,
      /Sidecar coverage: incomplete \(2\/3 formats, 0 matched complete sets\)/,
    );
    assert.match(result.stdout, /TODO: sayless-project-json/);
    assert.match(result.stdout, /Structural checks are read-only/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA sidecar probe requires one matched three-format export set", () => {
  const fixture = makeFixture();
  try {
    const otherProjectPath = join(fixture.dir, "Other recording.sayless-project.json");
    writeFileSync(otherProjectPath, readFileSync(fixture.projectPath));
    const splitSetResult = runProbe(
      "--json",
      "--require-complete",
      fixture.vttPath,
      fixture.transcriptPath,
      otherProjectPath,
    );
    assert.equal(splitSetResult.status, 1);
    assert.match(splitSetResult.stderr, /no filename-matched structurally complete/);
    const splitSetReport = JSON.parse(splitSetResult.stdout);
    assert.equal(splitSetReport.coverage.passedFormatCount, 3);
    assert.equal(splitSetReport.coverage.completeSetCount, 0);
    assert.equal(splitSetReport.coverage.status, "incomplete");
    assert.deepEqual(
      splitSetReport.coverage.sidecarSets.map((set) => [set.name, set.status]),
      [
        ["Other recording", "incomplete"],
        ["Real recording", "incomplete"],
      ],
    );

    const mismatchedProject = JSON.parse(readFileSync(fixture.projectPath, "utf8"));
    mismatchedProject.recording.id = "different-recording";
    mismatchedProject.project.recordingId = "different-recording";
    writeJson(fixture.projectPath, mismatchedProject);
    const mismatchedIdResult = runProbe(
      "--json",
      "--require-complete",
      fixture.vttPath,
      fixture.transcriptPath,
      fixture.projectPath,
    );
    assert.equal(mismatchedIdResult.status, 1);
    assert.match(mismatchedIdResult.stderr, /no filename-matched structurally complete/);
    const mismatchedIdReport = JSON.parse(mismatchedIdResult.stdout);
    assert.equal(mismatchedIdReport.coverage.status, "incomplete");
    assert.equal(mismatchedIdReport.coverage.completeSetCount, 0);
    assert.equal(mismatchedIdReport.coverage.sidecarSets[0].status, "recording-id-mismatch");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA sidecar probe atomically preserves strict diagnostic reports", () => {
  const fixture = makeFixture();
  try {
    const reportPath = join(fixture.dir, "sidecar-report.json");
    const result = runProbe(
      "--json",
      "--require-complete",
      `--output=${reportPath}`,
      fixture.vttPath,
      fixture.transcriptPath,
    );
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.reportPath, "sidecar-report.json");
    assert.equal(report.coverage.status, "incomplete");
    assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")), report);

    const originalVtt = readFileSync(fixture.vttPath);
    const overwriteResult = runProbe(`--output=${fixture.vttPath}`, fixture.vttPath);
    assert.equal(overwriteResult.status, 1);
    assert.match(overwriteResult.stderr, /must not overwrite an inspected input/);
    assert.deepEqual(readFileSync(fixture.vttPath), originalVtt);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("manual QA sidecar probe rejects malformed or substituted exports", () => {
  const fixture = makeFixture();
  try {
    const badVtt = join(fixture.dir, "bad.vtt");
    writeFileSync(badVtt, "WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nbad\n");
    const badVttResult = runProbe(badVtt);
    assert.equal(badVttResult.status, 1);
    assert.match(badVttResult.stderr, /cue 1 range is invalid/);

    const wrongTranscriptName = join(fixture.dir, "transcript.json");
    writeFileSync(wrongTranscriptName, readFileSync(fixture.transcriptPath));
    const wrongNameResult = runProbe(wrongTranscriptName);
    assert.equal(wrongNameResult.status, 1);
    assert.match(wrongNameResult.stderr, /must end in \.transcript\.json/);

    const oldProject = JSON.parse(readFileSync(fixture.projectPath, "utf8"));
    oldProject.project.version = 3;
    const oldProjectPath = join(fixture.dir, "old.sayless-project.json");
    writeJson(oldProjectPath, oldProject);
    const oldProjectResult = runProbe(oldProjectPath);
    assert.equal(oldProjectResult.status, 1);
    assert.match(oldProjectResult.stderr, /project\.version must be 4/);

    const invalidClipProject = JSON.parse(readFileSync(fixture.projectPath, "utf8"));
    invalidClipProject.project.timeline.clips[0].sourceEnd = 3;
    const invalidClipPath = join(fixture.dir, "invalid-clip.sayless-project.json");
    writeJson(invalidClipPath, invalidClipProject);
    const invalidClipResult = runProbe(invalidClipPath);
    assert.equal(invalidClipResult.status, 1);
    assert.match(invalidClipResult.stderr, /project\.timeline\.clips\[0\] is invalid/);

    const unknownJson = join(fixture.dir, "unknown.json");
    writeJson(unknownJson, { kind: "not-sayless" });
    const unknownResult = runProbe(unknownJson);
    assert.equal(unknownResult.status, 1);
    assert.match(unknownResult.stderr, /JSON sidecar kind is unsupported/);

    const missingResult = runProbe(join(fixture.dir, "missing.vtt"));
    assert.equal(missingResult.status, 1);
    assert.match(missingResult.stderr, /missing\.vtt/);

    const noArgsResult = runProbe();
    assert.equal(noArgsResult.status, 1);
    assert.match(noArgsResult.stderr, /provide at least one exported WebVTT/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
