#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, openAsBlob, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { buildReleaseCoverage, buildReleaseThresholds } from "./manual-qa-media-coverage.mjs";
import {
  displayReportPath,
  parseReportOutputOption,
  writeReportAtomically,
} from "./manual-qa-report-output.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const requireComplete = args.includes("--require-complete");
const help = args.includes("--help") || args.includes("-h");
let outputPath;
try {
  outputPath = parseReportOutputOption(args);
} catch (error) {
  console.error(`MANUAL QA MEDIA PROBE FAIL: ${error.message}`);
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
    "Usage: npm run qa:release:manual:media -- [--json] [--require-complete] [--output=<report.json>] <media-file> [media-file ...]",
  );
  console.log(
    "Reads local media metadata only; playback, audibility, sync, and visual checks remain manual.",
  );
};

const fail = (message) => {
  console.error(`MANUAL QA MEDIA PROBE FAIL: ${message}`);
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
  fail("provide at least one local media file.");
}

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const roundedSeconds = (value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : null);

const canonicalFormat = ({ formatName, mimeType, extension }) => {
  const value = `${formatName} ${mimeType} ${extension}`.toLowerCase();
  if (/\bwebm\b/.test(value)) return "webm";
  if (/\bgif\b/.test(value)) return "gif";
  if (/\bwave?\b|audio\/wav|\.wav\b/.test(value)) return "wav";
  if (/\bmp3\b|audio\/mpeg|\.mp3\b/.test(value)) return "mp3";
  if (/\bm4a\b|audio\/mp4|\.m4a\b/.test(value)) return "m4a";
  if (/\b(?:mp4|mpeg-4|isobmff)\b/.test(value)) return "mp4";
  return formatName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
};

const sha256File = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const safeDisplayPath = (absolutePath) => {
  const rootRelative = relative(ROOT, absolutePath);
  return rootRelative && !rootRelative.startsWith("..") ? rootRelative : basename(absolutePath);
};

const probeFile = async (path) => {
  const absolutePath = resolve(path);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
  if (!stats.isFile()) throw new Error(`${path}: path is not a regular file.`);
  if (!Number.isSafeInteger(stats.size) || stats.size < 1) {
    throw new Error(`${path}: file must contain at least one byte.`);
  }

  const blob = await openAsBlob(absolutePath);
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  try {
    if (!(await input.canRead())) {
      throw new Error(`${path}: media container is unsupported or unreadable.`);
    }
    const [format, mimeType, durationSeconds, videoTrack, audioTrack, sha256] = await Promise.all([
      input.getFormat(),
      input.getMimeType(),
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      sha256File(absolutePath),
    ]);
    const [width, height, videoCodec, channels, sampleRate, audioCodec] = await Promise.all([
      videoTrack?.getDisplayWidth() ?? null,
      videoTrack?.getDisplayHeight() ?? null,
      videoTrack?.getCodec() ?? null,
      audioTrack?.getNumberOfChannels() ?? null,
      audioTrack?.getSampleRate() ?? null,
      audioTrack?.getCodec() ?? null,
    ]);
    const fileName = basename(absolutePath);
    const formatName = format.name;
    const mediaFormat = canonicalFormat({
      formatName,
      mimeType,
      extension: extname(fileName),
    });
    const result = {
      fileName,
      sourcePath: safeDisplayPath(absolutePath),
      byteSize: stats.size,
      formattedByteSize: formatBytes(stats.size),
      sha256,
      format: mediaFormat,
      detectedFormat: formatName,
      mimeType,
      durationSeconds: roundedSeconds(durationSeconds),
      video: videoTrack
        ? {
            width,
            height,
            codec: videoCodec,
          }
        : null,
      audio: audioTrack
        ? {
            channels,
            sampleRate,
            codec: audioCodec,
          }
        : null,
    };
    if (videoTrack && ["mp4", "webm"].includes(mediaFormat)) {
      result.recordingFields = {
        fileName,
        sha256,
        durationSeconds: result.durationSeconds,
        byteSize: result.byteSize,
        width,
        height,
        container: mediaFormat,
      };
      result.releaseThresholds = buildReleaseThresholds(result);
    }
    if (audioTrack && ["wav", "m4a", "mp3"].includes(mediaFormat)) {
      result.projectAudioInputFields = {
        format: mediaFormat,
        fileName,
        sha256,
        byteSize: result.byteSize,
        durationSeconds: result.durationSeconds,
        channels,
        sampleRate,
      };
    }
    return result;
  } finally {
    input.dispose();
  }
};

const files = [];
for (const path of inputPaths) {
  try {
    files.push(await probeFile(path));
  } catch (error) {
    fail(error.message);
  }
}

const report = {
  kind: "sayless.manualQaMediaProbe",
  status: "measured",
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  requireComplete,
  reportPath: displayReportPath(ROOT, outputPath),
  reminder:
    "Measured fields are read-only metadata. Record playback, audibility, synchronization, visual quality, and other observations manually.",
  releaseCoverage: buildReleaseCoverage(files),
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
  console.log(`Manual QA media probe: ${files.length} file${files.length === 1 ? "" : "s"}`);
  for (const file of files) {
    console.log(`\n${file.fileName}`);
    console.log(`  Format: ${file.format} (${file.mimeType})`);
    console.log(`  Size: ${file.byteSize} bytes (${file.formattedByteSize})`);
    console.log(`  Duration: ${file.durationSeconds} seconds`);
    if (file.video) {
      console.log(
        `  Video: ${file.video.width}x${file.video.height}, ${file.video.codec || "unknown codec"}`,
      );
    }
    if (file.audio) {
      console.log(
        `  Audio: ${file.audio.channels} channel${
          file.audio.channels === 1 ? "" : "s"
        }, ${file.audio.sampleRate} Hz, ${file.audio.codec || "unknown codec"}`,
      );
    }
    console.log(`  SHA-256: ${file.sha256}`);
  }
  console.log(
    `\nMeasurable release media coverage: ${report.releaseCoverage.status} (${report.releaseCoverage.passedCheckCount}/${report.releaseCoverage.totalCheckCount} checks)`,
  );
  for (const check of report.releaseCoverage.checks) {
    console.log(`  ${check.passed ? "PASS" : "TODO"}: ${check.label}`);
  }
  console.log("  Manual limits:");
  for (const limitation of report.releaseCoverage.limitations) {
    console.log(`    - ${limitation}`);
  }
  if (report.reportPath) console.log(`  Report: ${report.reportPath}`);
  console.log(`\n${report.reminder}`);
}

if (requireComplete && report.releaseCoverage.status !== "measurable-set-complete") {
  console.error(
    `MANUAL QA MEDIA PROBE FAIL: measurable release media coverage is incomplete (${report.releaseCoverage.passedCheckCount}/${report.releaseCoverage.totalCheckCount} checks).`,
  );
  process.exitCode = 1;
}
