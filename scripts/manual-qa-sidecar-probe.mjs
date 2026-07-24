#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayReportPath,
  parseReportOutputOption,
  writeReportAtomically,
} from "./manual-qa-report-output.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_SIDECAR_BYTES = 25 * 1024 * 1024;
const PROJECT_SIDECAR_KIND = "sayless.localRecordingProject";
const TRANSCRIPT_SIDECAR_KIND = "sayless.localRecordingTranscript";
const SIDECAR_SCHEMA_VERSION = 1;
const PROJECT_SCHEMA_VERSION = 4;
const REQUIRED_FORMATS = ["vtt", "transcript-json", "sayless-project-json"];
const EXPORT_FORMATS = new Set(["mp4", "webm", "gif", "audio"]);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const requireComplete = args.includes("--require-complete");
const help = args.includes("--help") || args.includes("-h");
let outputPath;
try {
  outputPath = parseReportOutputOption(args);
} catch (error) {
  console.error(`MANUAL QA SIDECAR PROBE FAIL: ${error.message}`);
  process.exit(1);
}
const unknownOptions = args.filter(
  (arg) =>
    arg.startsWith("-") &&
    !arg.startsWith("--output=") &&
    !["--json", "--require-complete", "--help", "-h"].includes(arg),
);
const inputPaths = args.filter((arg) => !arg.startsWith("-"));

const usage = () => {
  console.log(
    "Usage: npm run qa:release:manual:sidecars -- [--json] [--require-complete] [--output=<report.json>] <vtt-or-json-file> [file ...]",
  );
  console.log(
    "Validates exported structure only; opening, viewing, and importing remain manual observations.",
  );
};

const fail = (message) => {
  console.error(`MANUAL QA SIDECAR PROBE FAIL: ${message}`);
  process.exit(1);
};

if (help) {
  usage();
  process.exit(0);
}
if (unknownOptions.length) {
  fail(`unknown option${unknownOptions.length === 1 ? "" : "s"}: ${unknownOptions.join(", ")}`);
}
if (!inputPaths.length) {
  usage();
  fail("provide at least one exported WebVTT or SayLess JSON sidecar.");
}

const safeDisplayPath = (absolutePath) => {
  const rootRelative = relative(ROOT, absolutePath);
  return rootRelative && !rootRelative.startsWith("..") ? rootRelative : basename(absolutePath);
};

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const positiveNumber = (value) => finiteNumber(value) && value > 0;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sidecarSetName = (fileName) =>
  fileName.replace(/(?:\.sayless-project\.json|\.transcript\.json|\.vtt)$/i, "");

const parseVttTimestamp = (value) => {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) return null;
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
  );
};

const probeVtt = ({ fileName, text }) => {
  if (!/\.vtt$/i.test(fileName)) {
    throw new Error(`${fileName}: WebVTT export file name must end in .vtt.`);
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "WEBVTT") {
    throw new Error(`${fileName}: WebVTT header is missing.`);
  }
  const cues = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].includes("-->")) continue;
    const timing = /^(\S+)\s+-->\s+(\S+)\s*$/.exec(lines[index].trim());
    if (!timing) {
      throw new Error(`${fileName}: cue ${cues.length + 1} timing is malformed.`);
    }
    const startSeconds = parseVttTimestamp(timing[1]);
    const endSeconds = parseVttTimestamp(timing[2]);
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
      throw new Error(`${fileName}: cue ${cues.length + 1} range is invalid.`);
    }
    const textLines = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!lines[cursor].trim()) break;
      textLines.push(lines[cursor].trim());
    }
    const cueText = textLines.join(" ").trim();
    if (!cueText) {
      throw new Error(`${fileName}: cue ${cues.length + 1} text is empty.`);
    }
    cues.push({ startSeconds, endSeconds, text: cueText });
  }
  if (!cues.length) throw new Error(`${fileName}: WebVTT has no caption cues.`);
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startSeconds < cues[index - 1].startSeconds) {
      throw new Error(`${fileName}: WebVTT cue starts are not monotonic.`);
    }
  }
  return {
    format: "vtt",
    mimeType: "text/vtt",
    cueCount: cues.length,
    firstCueStartSeconds: cues[0].startSeconds,
    lastCueEndSeconds: cues.at(-1).endSeconds,
    textCharacterCount: cues.reduce((total, cue) => total + cue.text.length, 0),
  };
};

const validateWords = (words, label, fileName) => {
  if (!Array.isArray(words) || !words.length) {
    throw new Error(`${fileName}: ${label} must contain at least one word.`);
  }
  for (const [index, word] of words.entries()) {
    if (
      !nonEmptyString(word?.text) ||
      !finiteNumber(word?.start) ||
      !finiteNumber(word?.end) ||
      word.start < 0 ||
      word.end <= word.start
    ) {
      throw new Error(`${fileName}: ${label}[${index}] is invalid.`);
    }
  }
};

const validateCommonJsonSidecar = (value, fileName, expectedKind) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: sidecar root must be a JSON object.`);
  }
  if (value.kind !== expectedKind) {
    throw new Error(`${fileName}: sidecar kind must be ${expectedKind}.`);
  }
  if (value.schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    throw new Error(`${fileName}: sidecar schemaVersion must be ${SIDECAR_SCHEMA_VERSION}.`);
  }
  if (!Number.isSafeInteger(value.exportedAt) || value.exportedAt <= 0) {
    throw new Error(`${fileName}: exportedAt must be a positive integer.`);
  }
  if (!nonEmptyString(value.recording?.id)) {
    throw new Error(`${fileName}: recording.id is required.`);
  }
  if (!nonEmptyString(value.recording?.title)) {
    throw new Error(`${fileName}: recording.title is required.`);
  }
  if (!positiveNumber(value.recording?.durationMs)) {
    throw new Error(`${fileName}: recording.durationMs must be positive.`);
  }
};

const probeTranscriptJson = ({ fileName, value }) => {
  if (!/\.transcript\.json$/i.test(fileName)) {
    throw new Error(`${fileName}: transcript export file name must end in .transcript.json.`);
  }
  validateCommonJsonSidecar(value, fileName, TRANSCRIPT_SIDECAR_KIND);
  validateWords(value.transcript?.words, "transcript.words", fileName);
  validateWords(value.timelineAwareWords, "timelineAwareWords", fileName);
  return {
    format: "transcript-json",
    mimeType: "application/json",
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    recordingId: value.recording.id,
    transcriptWordCount: value.transcript.words.length,
    timelineAwareWordCount: value.timelineAwareWords.length,
    language: nonEmptyString(value.transcript.language) ? value.transcript.language : null,
    providerId: nonEmptyString(value.transcript.providerId) ? value.transcript.providerId : null,
  };
};

const probeProjectJson = ({ fileName, value }) => {
  if (!/\.sayless-project\.json$/i.test(fileName)) {
    throw new Error(`${fileName}: project export file name must end in .sayless-project.json.`);
  }
  validateCommonJsonSidecar(value, fileName, PROJECT_SIDECAR_KIND);
  if (!value.project || typeof value.project !== "object") {
    throw new Error(`${fileName}: project object is required.`);
  }
  if (value.project.version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`${fileName}: project.version must be ${PROJECT_SCHEMA_VERSION}.`);
  }
  if (!value.project.source || typeof value.project.source !== "object") {
    throw new Error(`${fileName}: project.source is required.`);
  }
  if (!positiveNumber(value.project.source.duration)) {
    throw new Error(`${fileName}: project.source.duration must be positive.`);
  }
  if (value.project.recordingId !== value.recording.id) {
    throw new Error(`${fileName}: project.recordingId must match recording.id.`);
  }
  if (value.project.timeline?.version !== 2) {
    throw new Error(`${fileName}: project.timeline.version must be 2.`);
  }
  if (!Array.isArray(value.project.timeline?.clips)) {
    throw new Error(`${fileName}: project.timeline.clips must be an array.`);
  }
  const clipIds = new Set();
  for (const [index, clip] of value.project.timeline.clips.entries()) {
    if (
      !nonEmptyString(clip?.id) ||
      !finiteNumber(clip?.sourceStart) ||
      !finiteNumber(clip?.sourceEnd) ||
      clip.sourceStart < 0 ||
      clip.sourceEnd <= clip.sourceStart ||
      clip.sourceEnd > value.project.source.duration + 0.001 ||
      typeof clip.muted !== "boolean"
    ) {
      throw new Error(`${fileName}: project.timeline.clips[${index}] is invalid.`);
    }
    if (clipIds.has(clip.id)) {
      throw new Error(`${fileName}: project timeline clip ids must be unique.`);
    }
    clipIds.add(clip.id);
  }
  if (
    !positiveNumber(value.project.timeline?.source?.duration) ||
    Math.abs(value.project.timeline.source.duration - value.project.source.duration) > 0.001
  ) {
    throw new Error(`${fileName}: project timeline/source durations must match.`);
  }
  if (!value.project.exportSettings || typeof value.project.exportSettings !== "object") {
    throw new Error(`${fileName}: project.exportSettings is required.`);
  }
  if (!EXPORT_FORMATS.has(value.project.exportSettings.format)) {
    throw new Error(`${fileName}: project export format is invalid.`);
  }
  if (value.project.transcript != null) {
    validateWords(value.project.transcript.words, "project.transcript.words", fileName);
  }
  return {
    format: "sayless-project-json",
    mimeType: "application/json",
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    projectVersion: value.project.version,
    recordingId: value.recording.id,
    clipCount: value.project.timeline.clips.length,
    transcriptWordCount: Array.isArray(value.project.transcript?.words)
      ? value.project.transcript.words.length
      : 0,
    chapterCount: Array.isArray(value.project.chapterMarkers)
      ? value.project.chapterMarkers.length
      : 0,
    zoomCount: Array.isArray(value.project.zoomKeyframes) ? value.project.zoomKeyframes.length : 0,
    hasCrop: Boolean(value.project.crop),
    hasProjectAudioReference: Boolean(value.project.audioTrack),
    exportFormat: value.project.exportSettings.format ?? null,
  };
};

const probeFile = (path) => {
  const absolutePath = resolve(path);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
  if (!stats.isFile()) throw new Error(`${path}: path is not a regular file.`);
  if (!Number.isSafeInteger(stats.size) || stats.size < 1) {
    throw new Error(`${path}: sidecar must contain at least one byte.`);
  }
  if (stats.size > MAX_SIDECAR_BYTES) {
    throw new Error(`${path}: sidecar exceeds the 25 MiB inspection limit.`);
  }
  const bytes = readFileSync(absolutePath);
  const text = bytes.toString("utf8");
  const fileName = basename(absolutePath);
  let details;
  if (/\.vtt$/i.test(fileName)) {
    details = probeVtt({ fileName, text });
  } else if (/\.json$/i.test(fileName)) {
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`${fileName}: JSON is invalid: ${error.message}`);
    }
    if (value?.kind === TRANSCRIPT_SIDECAR_KIND) {
      details = probeTranscriptJson({ fileName, value });
    } else if (value?.kind === PROJECT_SIDECAR_KIND) {
      details = probeProjectJson({ fileName, value });
    } else {
      throw new Error(`${fileName}: JSON sidecar kind is unsupported.`);
    }
  } else {
    throw new Error(`${fileName}: expected a .vtt or .json sidecar.`);
  }
  return {
    fileName,
    sidecarSetName: sidecarSetName(fileName),
    sourcePath: safeDisplayPath(absolutePath),
    byteSize: stats.size,
    sha256: sha256(bytes),
    ...details,
    exportFields: {
      format: details.format,
      fileName,
      byteSize: stats.size,
      sha256: sha256(bytes),
    },
  };
};

const files = [];
for (const path of inputPaths) {
  try {
    files.push(probeFile(path));
  } catch (error) {
    fail(error.message);
  }
}

const observedFormats = [...new Set(files.map((file) => file.format))].sort();
const remainingFormats = REQUIRED_FORMATS.filter((format) => !observedFormats.includes(format));
const sidecarSets = [...new Set(files.map((file) => file.sidecarSetName))]
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const setFiles = files.filter((file) => file.sidecarSetName === name);
    const formats = [...new Set(setFiles.map((file) => file.format))].sort();
    const setRemainingFormats = REQUIRED_FORMATS.filter((format) => !formats.includes(format));
    const recordingIds = [
      ...new Set(setFiles.map((file) => file.recordingId).filter(Boolean)),
    ].sort();
    const recordingIdsMatch = recordingIds.length <= 1;
    return {
      name,
      status:
        !setRemainingFormats.length && recordingIdsMatch
          ? "structurally-complete"
          : recordingIdsMatch
            ? "incomplete"
            : "recording-id-mismatch",
      observedFormats: formats,
      remainingFormats: setRemainingFormats,
      recordingIds,
    };
  });
const completeSetCount = sidecarSets.filter((set) => set.status === "structurally-complete").length;
const coverage = {
  status: completeSetCount ? "structurally-complete" : "incomplete",
  observedFormats,
  remainingFormats,
  passedFormatCount: REQUIRED_FORMATS.length - remainingFormats.length,
  totalFormatCount: REQUIRED_FORMATS.length,
  completeSetCount,
  sidecarSets,
};
const report = {
  kind: "sayless.manualQaSidecarProbe",
  status: "inspected",
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  requireComplete,
  reportPath: displayReportPath(ROOT, outputPath),
  coverage,
  reminder:
    "Structural checks are read-only. Open the VTT/transcript and import the project sidecar in the tested extension before recording manual evidence.",
  files,
};

try {
  writeReportAtomically({ outputPath, inputPaths, report });
} catch (error) {
  fail(`could not write report: ${error.message}`);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Manual QA sidecar probe: ${files.length} file${files.length === 1 ? "" : "s"}`);
  for (const file of files) {
    console.log(`\n${file.fileName}`);
    console.log(`  Format: ${file.format}`);
    console.log(`  Size: ${file.byteSize} bytes`);
    console.log(`  SHA-256: ${file.sha256}`);
    if (file.format === "vtt") console.log(`  Cues: ${file.cueCount}`);
    if (file.format === "transcript-json") {
      console.log(`  Timeline-aware words: ${file.timelineAwareWordCount}`);
    }
    if (file.format === "sayless-project-json") {
      console.log(
        `  Project v${file.projectVersion}: ${file.clipCount} clips, ${file.zoomCount} zooms, ${file.chapterCount} chapters`,
      );
    }
  }
  console.log(
    `\nSidecar coverage: ${coverage.status} (${coverage.passedFormatCount}/${
      coverage.totalFormatCount
    } formats, ${coverage.completeSetCount} matched complete set${
      coverage.completeSetCount === 1 ? "" : "s"
    })`,
  );
  for (const format of coverage.remainingFormats) console.log(`  TODO: ${format}`);
  for (const set of coverage.sidecarSets) {
    if (set.status === "structurally-complete") continue;
    console.log(
      `  SET ${set.name}: ${set.status}; missing ${set.remainingFormats.join(", ") || "none"}`,
    );
  }
  if (report.reportPath) console.log(`  Report: ${report.reportPath}`);
  console.log(`\n${report.reminder}`);
}

if (requireComplete && coverage.status !== "structurally-complete") {
  console.error(
    "MANUAL QA SIDECAR PROBE FAIL: no filename-matched structurally complete sidecar set was found.",
  );
  process.exitCode = 1;
}
