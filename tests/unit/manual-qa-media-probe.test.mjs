import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildReleaseCoverage,
  buildReleaseThresholds,
  MIN_LARGE_RECORDING_BYTE_SIZE,
} from "../../scripts/manual-qa-media-coverage.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROBE = join(ROOT, "scripts", "manual-qa-media-probe.mjs");
const MP4 = join(ROOT, "src", "assets", "blank.mp4");
const MP3 = join(ROOT, "src", "assets", "sounds", "beep.mp3");

const runProbe = (...args) =>
  spawnSync(process.execPath, [PROBE, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("manual QA media probe measures video recording fields exactly", () => {
  const result = runProbe("--json", MP4);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, "sayless.manualQaMediaProbe");
  assert.equal(report.status, "measured");
  assert.equal(report.fileCount, 1);
  assert.equal(report.requireComplete, false);
  assert.equal(report.reportPath, null);
  assert.match(report.reminder, /observations manually/i);

  const [file] = report.files;
  assert.equal(file.fileName, "blank.mp4");
  assert.equal(file.sourcePath, "src/assets/blank.mp4");
  assert.equal(file.byteSize, readFileSync(MP4).byteLength);
  assert.equal(file.sha256, sha256(MP4));
  assert.equal(file.format, "mp4");
  assert.match(file.mimeType, /^video\/mp4/);
  assert.deepEqual(file.video, { width: 32, height: 20, codec: "avc" });
  assert.equal(file.audio, null);
  assert.deepEqual(file.recordingFields, {
    fileName: "blank.mp4",
    sha256: sha256(MP4),
    durationSeconds: 1,
    byteSize: 1777,
    width: 32,
    height: 20,
    container: "mp4",
  });
  assert.deepEqual(file.releaseThresholds, {
    durationAtLeast180Seconds: false,
    byteSizeAtLeast25MiB: false,
    longAndLarge: false,
  });
  assert.equal(file.projectAudioInputFields, undefined);
  assert.equal(report.releaseCoverage.status, "incomplete");
  assert.equal(report.releaseCoverage.passedCheckCount, 0);
  assert.equal(report.releaseCoverage.totalCheckCount, 5);
  assert.equal(report.releaseCoverage.recordingCandidateCount, 1);
  assert.deepEqual(report.releaseCoverage.recordingFormats, ["mp4"]);
  assert.deepEqual(report.releaseCoverage.dimensionPairs, ["32x20"]);
  assert.deepEqual(report.releaseCoverage.aspectRatios, [1.6]);
  assert.deepEqual(report.releaseCoverage.longAndLargeCandidates, []);
  assert.equal(report.releaseCoverage.projectAudioCandidateCount, 0);
  assert.deepEqual(report.releaseCoverage.projectAudioFormats, []);
  assert.equal(report.releaseCoverage.remainingMeasurableRequirements.length, 5);
  assert.equal(report.releaseCoverage.limitations.length, 2);
});

test("manual QA media probe measures project-audio input fields", () => {
  const result = runProbe("--json", MP3);
  assert.equal(result.status, 0, result.stderr);
  const [file] = JSON.parse(result.stdout).files;
  assert.equal(file.fileName, "beep.mp3");
  assert.equal(file.sourcePath, "src/assets/sounds/beep.mp3");
  assert.equal(file.byteSize, readFileSync(MP3).byteLength);
  assert.equal(file.sha256, sha256(MP3));
  assert.equal(file.format, "mp3");
  assert.equal(file.mimeType, "audio/mpeg");
  assert.equal(file.video, null);
  assert.deepEqual(file.audio, {
    channels: 2,
    sampleRate: 48000,
    codec: "mp3",
  });
  assert.deepEqual(file.projectAudioInputFields, {
    format: "mp3",
    fileName: "beep.mp3",
    sha256: sha256(MP3),
    byteSize: 39815,
    durationSeconds: 1.344,
    channels: 2,
    sampleRate: 48000,
  });
  assert.equal(file.recordingFields, undefined);
  assert.equal(file.releaseThresholds, undefined);
});

test("manual QA media probe remains read-only guidance in human output", () => {
  const result = runProbe(MP4, MP3);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Manual QA media probe: 2 files/);
  assert.match(result.stdout, /blank\.mp4/);
  assert.match(result.stdout, /1777 bytes/);
  assert.match(result.stdout, /32x20/);
  assert.match(result.stdout, /beep\.mp3/);
  assert.match(result.stdout, /48000 Hz/);
  assert.match(result.stdout, /Measurable release media coverage: incomplete \(0\/5 checks\)/);
  assert.match(result.stdout, /TODO: MP4 and WebM source-container candidates/);
  assert.match(result.stdout, /Manual limits:/);
  assert.match(result.stdout, /observations manually/i);
});

test("manual QA media probe summarizes only measurable release coverage", () => {
  const result = runProbe("--json", MP4, MP3);
  assert.equal(result.status, 0, result.stderr);
  const coverage = JSON.parse(result.stdout).releaseCoverage;
  assert.equal(coverage.status, "incomplete");
  assert.equal(coverage.recordingCandidateCount, 1);
  assert.deepEqual(coverage.recordingFormats, ["mp4"]);
  assert.equal(coverage.projectAudioCandidateCount, 1);
  assert.deepEqual(coverage.projectAudioFormats, ["mp3"]);
  assert.deepEqual(coverage.longAndLargeCandidates, []);
  assert.ok(
    coverage.checks.every(
      (check) =>
        typeof check.id === "string" &&
        typeof check.label === "string" &&
        typeof check.passed === "boolean",
    ),
  );
  assert.match(coverage.limitations.join(" "), /original source recordings/i);
  assert.match(coverage.limitations.join(" "), /playback or perceptual observations manually/i);
});

test("manual QA media probe can require complete measurable coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-media-probe-report-"));
  try {
    const outputPath = join(dir, "media-report.json");
    const result = runProbe("--json", "--require-complete", `--output=${outputPath}`, MP4, MP3);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.requireComplete, true);
    assert.equal(report.reportPath, "media-report.json");
    assert.equal(report.releaseCoverage.status, "incomplete");
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), report);
    assert.match(result.stderr, /measurable release media coverage is incomplete \(0\/5 checks\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manual QA media coverage recognizes a complete measurable candidate set", () => {
  const longLargeThresholds = buildReleaseThresholds({
    durationSeconds: 180,
    byteSize: MIN_LARGE_RECORDING_BYTE_SIZE,
  });
  assert.deepEqual(longLargeThresholds, {
    durationAtLeast180Seconds: true,
    byteSizeAtLeast25MiB: true,
    longAndLarge: true,
  });

  const recording = ({ fileName, format, width, height, thresholds }) => ({
    fileName,
    format,
    video: { width, height },
    recordingFields: {
      durationSeconds: 180,
      byteSize: MIN_LARGE_RECORDING_BYTE_SIZE,
      width,
      height,
      container: format,
    },
    releaseThresholds: thresholds,
  });
  const projectAudio = (format) => ({
    fileName: `input.${format}`,
    format,
    projectAudioInputFields: { format },
  });
  const coverage = buildReleaseCoverage([
    recording({
      fileName: "long.mp4",
      format: "mp4",
      width: 1920,
      height: 1080,
      thresholds: longLargeThresholds,
    }),
    recording({
      fileName: "varied.webm",
      format: "webm",
      width: 1024,
      height: 768,
      thresholds: buildReleaseThresholds({
        durationSeconds: 90,
        byteSize: 10_000_000,
      }),
    }),
    ...["wav", "m4a", "mp3"].map(projectAudio),
  ]);

  assert.equal(coverage.status, "measurable-set-complete");
  assert.equal(coverage.passedCheckCount, coverage.totalCheckCount);
  assert.equal(coverage.recordingCandidateCount, 2);
  assert.deepEqual(coverage.recordingFormats, ["mp4", "webm"]);
  assert.deepEqual(coverage.dimensionPairs, ["1024x768", "1920x1080"]);
  assert.deepEqual(coverage.aspectRatios, [1.3333, 1.7778]);
  assert.deepEqual(coverage.longAndLargeCandidates, ["long.mp4"]);
  assert.deepEqual(coverage.projectAudioFormats, ["m4a", "mp3", "wav"]);
  assert.deepEqual(coverage.remainingMeasurableRequirements, []);
  assert.ok(coverage.checks.every((check) => check.passed));
});

test("manual QA media probe fails closed for missing or unsupported inputs", () => {
  const missingArgs = runProbe();
  assert.equal(missingArgs.status, 1);
  assert.match(missingArgs.stderr, /provide at least one local media file/);

  const missingFile = runProbe("does-not-exist.mp4");
  assert.equal(missingFile.status, 1);
  assert.match(missingFile.stderr, /does-not-exist\.mp4/);

  const unsupported = runProbe("package.json");
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /unsupported or unreadable/);

  const unknownOption = runProbe("--write", MP4);
  assert.equal(unknownOption.status, 1);
  assert.match(unknownOption.stderr, /unknown option: --write/);

  const missingOutputPath = runProbe("--output=", MP4);
  assert.equal(missingOutputPath.status, 1);
  assert.match(missingOutputPath.stderr, /--output requires a file path/);
});
