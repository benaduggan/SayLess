#!/usr/bin/env node

import JSZip from "jszip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT
  ? resolve(process.env.SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT)
  : DEFAULT_ROOT;
const EXTENSION_ZIP_PATH = join(ROOT, "extension.zip");
const PACKAGE_EVIDENCE_PATH = join(ROOT, "release-artifacts", "package-release.json");
const AUTOMATED_EVIDENCE_PATH = join(ROOT, "release-artifacts", "release-qa-automated.json");
const MANUAL_EVIDENCE_PATH = join(ROOT, "release-artifacts", "manual-qa-evidence.json");
const MANUAL_QA_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-manual-qa-evidence.mjs");

const resolveRootPath = (path) => resolve(ROOT, path);
const isCanonicalRelativePath = (value, expected) => value === expected;
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));
const timestampMs = (value) => (isIsoDate(value) ? Date.parse(value) : null);
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const walkFiles = (dir, root = dir) => {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path, root));
    } else if (stat.isFile()) {
      files.push({ path, relativePath: relative(root, path), size: stat.size });
    }
  }
  return files;
};

const dirFingerprint = (dir) => {
  const hash = createHash("sha256");
  const files = walkFiles(dir);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(readFileSync(file.path));
    hash.update("\0");
  }
  return { fileCount: files.length, sha256: hash.digest("hex") };
};

const dirSize = (dir) => walkFiles(dir).reduce((total, file) => total + file.size, 0);

const zipFingerprint = async (zipPath, errors) => {
  let zip;
  try {
    zip = await JSZip.loadAsync(readFileSync(zipPath));
  } catch (error) {
    errors.push(`extension.zip is not a readable zip archive: ${error.message}`);
    return null;
  }

  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((a, b) => a.name.localeCompare(b.name));
  const hash = createHash("sha256");
  for (const entry of entries) {
    const bytes = await entry.async("nodebuffer");
    hash.update(entry.name);
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return { fileCount: entries.length, sha256: hash.digest("hex") };
};

const fail = (errors) => {
  for (const error of errors) {
    console.error(`RELEASE PACKAGE FAIL: ${error}`);
  }
  process.exit(1);
};

const readJson = (path, label, errors) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
};

const requireFile = (path, label, errors) => {
  if (!existsSync(path)) {
    errors.push(`${label} is missing: ${relative(ROOT, path)}`);
    return false;
  }
  return true;
};

const validateGitProvenance = (label, git, errors) => {
  if (!git || typeof git !== "object") {
    errors.push(`${label} git provenance is required.`);
    return;
  }
  if (typeof git.branch !== "string" || git.branch.trim().length === 0) {
    errors.push(`${label} git.branch is required.`);
  }
  if (typeof git.commit !== "string" || !/^[0-9a-f]{40}$/i.test(git.commit)) {
    errors.push(`${label} git.commit must be a 40-character SHA-1 commit.`);
  }
  if (typeof git.dirty !== "boolean") {
    errors.push(`${label} git.dirty must be a boolean.`);
  }
};

const validateGitWorkingTree = (label, workingTree, errors) => {
  if (!workingTree || typeof workingTree !== "object") {
    errors.push(`${label} git.workingTree is required.`);
    return;
  }
  if (typeof workingTree.sha256 !== "string" || workingTree.sha256.trim().length === 0) {
    errors.push(`${label} git.workingTree.sha256 is required.`);
  }
  if (!Number.isFinite(workingTree.fileCount) || workingTree.fileCount < 0) {
    errors.push(`${label} git.workingTree.fileCount must be a non-negative number.`);
  }
  if (
    typeof workingTree.statusSha256 !== "string" ||
    workingTree.statusSha256.trim().length === 0
  ) {
    errors.push(`${label} git.workingTree.statusSha256 is required.`);
  }
};

const workingTreesEqual = (left, right) =>
  left?.sha256 === right?.sha256 &&
  left?.fileCount === right?.fileCount &&
  left?.statusSha256 === right?.statusSha256;

const appendNonPassingEvidenceDetails = (label, evidence, errors) => {
  if (!evidence || typeof evidence !== "object") return;
  const isNonPassingMarker = /(?:Failed|Incomplete)$/.test(String(evidence.kind || ""));
  if (!isNonPassingMarker) return;
  if (typeof evidence.remainingReleaseWork === "string" && evidence.remainingReleaseWork.trim()) {
    errors.push(`${label} is non-passing: ${evidence.remainingReleaseWork.trim()}`);
  }
  if (evidence.failedStep && typeof evidence.failedStep === "object") {
    const script =
      typeof evidence.failedStep.script === "string" ? evidence.failedStep.script : "unknown";
    const exitCode =
      typeof evidence.failedStep.exitCode === "number"
        ? ` exit code ${evidence.failedStep.exitCode}`
        : "";
    const reason =
      typeof evidence.failedStep.reason === "string" && evidence.failedStep.reason.trim()
        ? ` (${evidence.failedStep.reason.trim()})`
        : "";
    errors.push(`${label} failed step: ${script}${exitCode}${reason}.`);
  }
  return true;
};

const verifyManualQaEvidence = (errors) => {
  const result = spawnSync(process.execPath, [MANUAL_QA_VERIFIER_PATH], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_MANUAL_QA_ROOT: ROOT },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    errors.push(
      output
        ? `manual QA evidence verifier failed:\n${output}`
        : `manual QA evidence verifier failed with exit code ${result.status}`,
    );
  }
};

const errors = [];
const hasExtensionZip = requireFile(EXTENSION_ZIP_PATH, "extension.zip", errors);
const hasPackageEvidence = requireFile(PACKAGE_EVIDENCE_PATH, "package release evidence", errors);
verifyManualQaEvidence(errors);
const packageEvidence = hasPackageEvidence
  ? readJson(PACKAGE_EVIDENCE_PATH, "package release evidence", errors)
  : null;

if (packageEvidence && packageEvidence.kind !== "sayless.releasePackage") {
  errors.push('package release evidence kind must be "sayless.releasePackage".');
}
const packageEvidenceIsNonPassingMarker =
  appendNonPassingEvidenceDetails("package release evidence", packageEvidence, errors) === true;
if (packageEvidence) {
  if (packageEvidence.status !== "passed") {
    errors.push('package release evidence status must be "passed".');
  }
}
if (packageEvidence && !packageEvidenceIsNonPassingMarker) {
  if (
    typeof packageEvidence.releaseVersion !== "string" ||
    packageEvidence.releaseVersion.trim().length === 0
  ) {
    errors.push("package release evidence releaseVersion is required.");
  }
  if (!isIsoDate(packageEvidence.generatedAt)) {
    errors.push("package release evidence generatedAt must be an ISO UTC timestamp.");
  } else if (timestampMs(packageEvidence.generatedAt) > Date.now() + 5 * 60 * 1000) {
    errors.push("package release evidence generatedAt must not be in the future.");
  }
  validateGitProvenance("package release evidence", packageEvidence.git, errors);
}

if (packageEvidence && !packageEvidenceIsNonPassingMarker && hasExtensionZip) {
  const extensionSha256 = sha256File(EXTENSION_ZIP_PATH);
  const extensionBytes = statSync(EXTENSION_ZIP_PATH).size;
  if (packageEvidence.zip?.sha256 !== extensionSha256) {
    errors.push("package release evidence does not match current extension.zip SHA-256.");
  }
  if (packageEvidence.zip?.bytes !== extensionBytes) {
    errors.push("package release evidence does not match current extension.zip size.");
  }
  if (packageEvidence.zip?.formattedBytes !== formatBytes(extensionBytes)) {
    errors.push(
      "package release evidence formatted zip size must match current extension.zip size.",
    );
  }
}
if (packageEvidence && !packageEvidenceIsNonPassingMarker) {
  if (!packageEvidence.zip?.path) {
    errors.push("package release evidence zip.path is required.");
  } else if (
    !isCanonicalRelativePath(packageEvidence.zip.path, "extension.zip") ||
    resolveRootPath(packageEvidence.zip.path) !== EXTENSION_ZIP_PATH
  ) {
    errors.push("package release evidence zip.path must point to extension.zip.");
  }
}

if (packageEvidence && !packageEvidenceIsNonPassingMarker) {
  if (!packageEvidence.build?.path || !packageEvidence.build?.sha256) {
    errors.push("package release evidence is missing build path or SHA-256.");
  } else {
    const buildPath = resolveRootPath(packageEvidence.build.path);
    if (requireFile(buildPath, "package release build path", errors)) {
      const currentBuild = dirFingerprint(buildPath);
      const currentBuildBytes = dirSize(buildPath);
      if (packageEvidence.build.fileCount !== currentBuild.fileCount) {
        errors.push(
          `package release evidence build file count (${packageEvidence.build.fileCount}) does not match current build (${currentBuild.fileCount}).`,
        );
      }
      if (packageEvidence.build.bytes !== currentBuildBytes) {
        errors.push(
          `package release evidence build byte size (${packageEvidence.build.bytes}) does not match current build (${currentBuildBytes}).`,
        );
      }
      if (packageEvidence.build.formattedBytes !== formatBytes(currentBuildBytes)) {
        errors.push("package release evidence formatted build size must match current build size.");
      }
      if (packageEvidence.build.sha256 !== currentBuild.sha256) {
        errors.push("package release evidence build fingerprint does not match current build.");
      }
      if (hasExtensionZip) {
        const zippedBuild = await zipFingerprint(EXTENSION_ZIP_PATH, errors);
        if (zippedBuild) {
          if (zippedBuild.fileCount !== packageEvidence.build.fileCount) {
            errors.push(
              `extension.zip file count (${zippedBuild.fileCount}) does not match package release build evidence (${packageEvidence.build.fileCount}).`,
            );
          }
          if (zippedBuild.sha256 !== packageEvidence.build.sha256) {
            errors.push("extension.zip contents do not match package release build fingerprint.");
          }
          if (zippedBuild.fileCount !== currentBuild.fileCount) {
            errors.push(
              `extension.zip file count (${zippedBuild.fileCount}) does not match current build (${currentBuild.fileCount}).`,
            );
          }
          if (zippedBuild.sha256 !== currentBuild.sha256) {
            errors.push("extension.zip contents do not match current build fingerprint.");
          }
        }
      }
    }
  }
  if (
    packageEvidence.build?.path &&
    (!isCanonicalRelativePath(packageEvidence.build.path, "build") ||
      resolveRootPath(packageEvidence.build.path) !== join(ROOT, "build"))
  ) {
    errors.push("package release evidence build path must point to build.");
  }

  for (const [label, evidence, expectedPath] of [
    ["automated QA evidence", packageEvidence.automatedEvidence, AUTOMATED_EVIDENCE_PATH],
    ["manual QA evidence", packageEvidence.manualEvidence, MANUAL_EVIDENCE_PATH],
  ]) {
    if (!evidence?.path || !evidence?.sha256) {
      errors.push(`package release evidence is missing ${label} path or SHA-256.`);
      continue;
    }
    const evidencePath = resolveRootPath(evidence.path);
    const expectedRelativePath = relative(ROOT, expectedPath);
    if (
      !isCanonicalRelativePath(evidence.path, expectedRelativePath) ||
      evidencePath !== expectedPath
    ) {
      errors.push(
        `package release evidence ${label} path must point to ${relative(ROOT, expectedPath)}.`,
      );
    }
    if (!requireFile(evidencePath, label, errors)) continue;
    if (sha256File(evidencePath) !== evidence.sha256) {
      errors.push(`package release evidence ${label} hash does not match current file.`);
      continue;
    }
    const evidenceJson = readJson(evidencePath, label, errors);
    if (label === "automated QA evidence") {
      if (evidenceJson?.kind !== "sayless.releaseQaAutomated") {
        errors.push('automated QA evidence kind must be "sayless.releaseQaAutomated".');
      }
      if (evidenceJson?.status !== "passed") {
        errors.push('automated QA evidence status must be "passed".');
      }
      if (evidence.status !== "passed") {
        errors.push('package release evidence automated QA status must be "passed".');
      }
      if (evidenceJson?.status !== evidence.status) {
        errors.push("automated QA evidence status must match package release evidence.");
      }
      if (evidenceJson?.generatedAt !== evidence.generatedAt) {
        errors.push("automated QA evidence generatedAt must match package release evidence.");
      }
      if (packageEvidence.releaseVersion !== evidenceJson?.releaseVersion) {
        errors.push("package release evidence releaseVersion must match automated QA evidence.");
      }
      if (evidence.releaseVersion !== evidenceJson?.releaseVersion) {
        errors.push(
          "package release evidence automated QA releaseVersion must match automated QA evidence.",
        );
      }
      if (
        timestampMs(packageEvidence.generatedAt) !== null &&
        timestampMs(evidenceJson?.generatedAt) !== null &&
        timestampMs(packageEvidence.generatedAt) < timestampMs(evidenceJson.generatedAt)
      ) {
        errors.push(
          "package release evidence generatedAt must be at or after automated QA evidence generatedAt.",
        );
      }
      validateGitProvenance("automated QA evidence", evidenceJson?.git, errors);
      validateGitWorkingTree("automated QA evidence", evidenceJson?.git?.workingTree, errors);
      validateGitWorkingTree("package release evidence", packageEvidence.git?.workingTree, errors);
      if (
        packageEvidence.git?.branch !== evidenceJson?.git?.branch ||
        packageEvidence.git?.commit !== evidenceJson?.git?.commit ||
        packageEvidence.git?.dirty !== evidenceJson?.git?.dirty
      ) {
        errors.push("package release evidence git provenance must match automated QA evidence.");
      }
      if (!workingTreesEqual(packageEvidence.git?.workingTree, evidenceJson?.git?.workingTree)) {
        errors.push(
          "package release evidence git workingTree fingerprint must match automated QA evidence.",
        );
      }
    } else if (label === "manual QA evidence") {
      if (evidenceJson?.kind !== "sayless.manualQaEvidence") {
        errors.push('manual QA evidence kind must be "sayless.manualQaEvidence".');
      }
      if (evidenceJson?.status !== "passed") {
        errors.push('manual QA evidence status must be "passed".');
      }
      if (evidence.status !== "passed") {
        errors.push('package release evidence manual QA status must be "passed".');
      }
      if (evidenceJson?.status !== evidence.status) {
        errors.push("manual QA evidence status must match package release evidence.");
      }
      if (evidenceJson?.testedAt !== evidence.testedAt) {
        errors.push("manual QA evidence testedAt must match package release evidence.");
      }
      if (packageEvidence.releaseVersion !== evidenceJson?.releaseVersion) {
        errors.push("package release evidence releaseVersion must match manual QA evidence.");
      }
      if (evidence.releaseVersion !== evidenceJson?.releaseVersion) {
        errors.push(
          "package release evidence manual QA releaseVersion must match manual QA evidence.",
        );
      }
      if (
        timestampMs(packageEvidence.generatedAt) !== null &&
        timestampMs(evidenceJson?.testedAt) !== null &&
        timestampMs(packageEvidence.generatedAt) < timestampMs(evidenceJson.testedAt)
      ) {
        errors.push(
          "package release evidence generatedAt must be at or after manual QA evidence testedAt.",
        );
      }
      if (evidenceJson?.automatedEvidenceGeneratedAt !== evidence.automatedEvidenceGeneratedAt) {
        errors.push(
          "manual QA evidence automatedEvidenceGeneratedAt must match package release evidence.",
        );
      }
    }
  }
}

if (errors.length) {
  fail(errors);
}

console.log("Release package evidence passed.");
console.log(`Zip: ${relative(ROOT, EXTENSION_ZIP_PATH)}`);
console.log(`SHA-256: ${sha256File(EXTENSION_ZIP_PATH)}`);
