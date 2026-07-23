#!/usr/bin/env node

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManualQaMeasurementImport } from "./manual-qa-measurement-import.mjs";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = process.env.SAYLESS_MANUAL_QA_MEASUREMENTS_ROOT
  ? resolve(process.env.SAYLESS_MANUAL_QA_MEASUREMENTS_ROOT)
  : DEFAULT_ROOT;
const EVIDENCE_PATH = join(
  ROOT,
  "release-artifacts",
  "manual-qa-evidence.json"
);
const MEDIA_REPORT_PATH = join(
  ROOT,
  "release-artifacts",
  "manual-qa-media-probe.json"
);
const SIDECAR_REPORT_PATH = join(
  ROOT,
  "release-artifacts",
  "manual-qa-sidecar-probe.json"
);

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");
const asJson = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const unknown = args.filter(
  (arg) => !["--write", "--json", "--help", "-h"].includes(arg)
);

const usage = () => {
  console.log(
    "Usage: npm run qa:release:manual:measurements -- [--json] [--write]"
  );
  console.log(
    "Previews or atomically applies probe-measured fields to exact filename matches in the manual QA template."
  );
};

const fail = (message) => {
  console.error(`MANUAL QA MEASUREMENT IMPORT FAIL: ${message}`);
  process.exit(1);
};

const readJson = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} is missing.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
};

if (help) {
  usage();
  process.exit(0);
}
if (unknown.length) fail(`unknown option: ${unknown[0]}`);

try {
  const evidence = readJson(EVIDENCE_PATH, "manual QA evidence");
  const mediaReport = readJson(MEDIA_REPORT_PATH, "manual QA media report");
  const sidecarReport = readJson(
    SIDECAR_REPORT_PATH,
    "manual QA sidecar report"
  );
  const result = buildManualQaMeasurementImport({
    evidence,
    mediaReport,
    sidecarReport,
  });
  if (shouldWrite && result.changes.length) {
    const temporaryPath = `${EVIDENCE_PATH}.tmp-${process.pid}`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(result.evidence, null, 2)}\n`
    );
    renameSync(temporaryPath, EVIDENCE_PATH);
  }
  const report = {
    kind: "sayless.manualQaMeasurementImport",
    status: shouldWrite
      ? result.changes.length
        ? "applied"
        : "unchanged"
      : "preview",
    evidencePath: "release-artifacts/manual-qa-evidence.json",
    mediaReportPath: "release-artifacts/manual-qa-media-probe.json",
    sidecarReportPath: "release-artifacts/manual-qa-sidecar-probe.json",
    matched: result.matched,
    changedFieldCount: result.changes.length,
    changes: result.changes,
    reminder:
      "Only measured fields are copied. File roles, playback, audibility, synchronization, visual quality, reveal, import, and all other observations remain tester-owned.",
  };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Manual QA measurement import ${report.status}: ${report.changedFieldCount} field change(s).`
    );
    console.log(
      `Matched ${report.matched.recordings} recording(s), ${report.matched.exports} export(s), and ${report.matched.projectAudioInputs} project-audio input(s).`
    );
    if (!shouldWrite) {
      console.log(
        "Preview only. Rerun with --write to update the template atomically."
      );
    }
    console.log(report.reminder);
  }
} catch (error) {
  fail(error.message);
}
