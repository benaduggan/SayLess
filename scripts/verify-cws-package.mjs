#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_CWS_VERIFY_ROOT
  ? resolve(process.env.SAYLESS_CWS_VERIFY_ROOT)
  : DEFAULT_ROOT;
const EXTENSION_ZIP_PATH = join(ROOT, "extension.zip");
const CWS_ZIP_PATH = join(ROOT, "build-cws.zip");
const PACKAGE_EVIDENCE_PATH = join(ROOT, "release-artifacts", "package-release.json");
const CWS_EVIDENCE_PATH = join(ROOT, "release-artifacts", "cws-package.json");
const RELEASE_PACKAGE_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-release-package.mjs");

const resolveRootPath = (path) => resolve(ROOT, path);
const isCanonicalRelativePath = (value, expected) => value === expected;
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const isIsoDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));
const timestampMs = (value) => (isIsoDate(value) ? Date.parse(value) : null);
const isGitCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const validateGitProvenance = (git, label, errors) => {
  if (!git || typeof git !== "object") {
    errors.push(`${label} git provenance is required.`);
    return;
  }
  if (typeof git.branch !== "string" || git.branch.trim().length === 0) {
    errors.push(`${label} git.branch is required.`);
  }
  if (!isGitCommit(git.commit)) {
    errors.push(`${label} git.commit must be a 40-character lowercase SHA.`);
  }
  if (typeof git.dirty !== "boolean") {
    errors.push(`${label} git.dirty must be a boolean.`);
  }
};

const validateGitWorkingTree = (workingTree, label, errors) => {
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
  if (typeof workingTree.statusSha256 !== "string" || workingTree.statusSha256.trim().length === 0) {
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
    const script = typeof evidence.failedStep.script === "string" ? evidence.failedStep.script : "unknown";
    const exitCode =
      typeof evidence.failedStep.exitCode === "number" ? ` exit code ${evidence.failedStep.exitCode}` : "";
    const reason =
      typeof evidence.failedStep.reason === "string" && evidence.failedStep.reason.trim()
        ? ` (${evidence.failedStep.reason.trim()})`
        : "";
    errors.push(`${label} failed step: ${script}${exitCode}${reason}.`);
  }
  return true;
};

const requireMatchingEvidenceSummary = ({
  cwsEvidence,
  errors,
  field,
  label,
  packageEvidence,
  requiredFields,
}) => {
  const cwsSummary = cwsEvidence?.[field];
  const packageSummary = packageEvidence?.[field];
  if (!cwsSummary || typeof cwsSummary !== "object") {
    errors.push(`CWS package evidence ${field} is required.`);
    return;
  }
  if (!packageSummary || typeof packageSummary !== "object") {
    errors.push(`package release evidence ${field} is required.`);
    return;
  }
  for (const key of requiredFields) {
    if (cwsSummary[key] !== packageSummary[key]) {
      errors.push(`CWS package evidence ${label} ${key} must match package release evidence.`);
    }
  }
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

const fail = (errors) => {
  for (const error of errors) {
    console.error(`CWS PACKAGE FAIL: ${error}`);
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

const errors = [];
const releasePackageResult = spawnSync(process.execPath, [RELEASE_PACKAGE_VERIFIER_PATH], {
  cwd: ROOT,
  env: { ...process.env, SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT: ROOT },
  encoding: "utf8",
});
if (releasePackageResult.status !== 0) {
  if (releasePackageResult.stderr) process.stderr.write(releasePackageResult.stderr);
  if (releasePackageResult.stdout) process.stdout.write(releasePackageResult.stdout);
  errors.push("release package evidence must pass before verifying CWS package evidence.");
}
const hasExtensionZip = requireFile(EXTENSION_ZIP_PATH, "extension.zip", errors);
const hasCwsZip = requireFile(CWS_ZIP_PATH, "build-cws.zip", errors);
const hasPackageEvidence = requireFile(PACKAGE_EVIDENCE_PATH, "package release evidence", errors);
const hasCwsEvidence = requireFile(CWS_EVIDENCE_PATH, "CWS package evidence", errors);

const packageEvidence = hasPackageEvidence
  ? readJson(PACKAGE_EVIDENCE_PATH, "package release evidence", errors)
  : null;
const cwsEvidence = hasCwsEvidence ? readJson(CWS_EVIDENCE_PATH, "CWS package evidence", errors) : null;

if (packageEvidence && packageEvidence.kind !== "sayless.releasePackage") {
  errors.push('package release evidence kind must be "sayless.releasePackage".');
}
if (cwsEvidence && cwsEvidence.kind !== "sayless.cwsPackage") {
  errors.push('CWS package evidence kind must be "sayless.cwsPackage".');
}
const packageEvidenceIsNonPassingMarker =
  appendNonPassingEvidenceDetails("package release evidence", packageEvidence, errors) === true;
const cwsEvidenceIsNonPassingMarker =
  appendNonPassingEvidenceDetails("CWS package evidence", cwsEvidence, errors) === true;
if (cwsEvidence) {
  if (cwsEvidence.status !== "passed") {
    errors.push('CWS package evidence status must be "passed".');
  }
}
if (cwsEvidence && !cwsEvidenceIsNonPassingMarker) {
  if (typeof cwsEvidence.releaseVersion !== "string" || cwsEvidence.releaseVersion.trim().length === 0) {
    errors.push("CWS package evidence releaseVersion is required.");
  }
  validateGitProvenance(cwsEvidence.git, "CWS package evidence", errors);
  validateGitWorkingTree(cwsEvidence.git?.workingTree, "CWS package evidence", errors);
  if (!isIsoDate(cwsEvidence.generatedAt)) {
    errors.push("CWS package evidence generatedAt must be an ISO UTC timestamp.");
  } else if (timestampMs(cwsEvidence.generatedAt) > Date.now() + 5 * 60 * 1000) {
    errors.push("CWS package evidence generatedAt must not be in the future.");
  }
}
if (packageEvidence && !packageEvidenceIsNonPassingMarker) {
  validateGitProvenance(packageEvidence.git, "package release evidence", errors);
  validateGitWorkingTree(packageEvidence.git?.workingTree, "package release evidence", errors);
}
if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker &&
  cwsEvidence.releaseVersion !== packageEvidence.releaseVersion
) {
  errors.push("CWS package evidence releaseVersion must match package release evidence.");
}
if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker &&
  cwsEvidence.packageEvidence?.releaseVersion !== packageEvidence.releaseVersion
) {
  errors.push("CWS package evidence packageEvidence.releaseVersion must match package release evidence.");
}
if (
  cwsEvidence?.git &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence?.git &&
  !packageEvidenceIsNonPassingMarker &&
  (cwsEvidence.git.branch !== packageEvidence.git.branch ||
    cwsEvidence.git.commit !== packageEvidence.git.commit ||
    cwsEvidence.git.dirty !== packageEvidence.git.dirty)
) {
  errors.push("CWS package evidence git provenance must match package release evidence.");
}
if (
  cwsEvidence?.git &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence?.git &&
  !packageEvidenceIsNonPassingMarker &&
  !workingTreesEqual(cwsEvidence.git.workingTree, packageEvidence.git.workingTree)
) {
  errors.push("CWS package evidence git workingTree fingerprint must match package release evidence.");
}
if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker &&
  timestampMs(cwsEvidence.generatedAt) !== null &&
  timestampMs(packageEvidence.generatedAt) !== null &&
  timestampMs(cwsEvidence.generatedAt) < timestampMs(packageEvidence.generatedAt)
) {
  errors.push("CWS package evidence generatedAt must be at or after package release evidence generatedAt.");
}
if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker &&
  cwsEvidence.packageEvidence?.generatedAt !== packageEvidence.generatedAt
) {
  errors.push("CWS package evidence packageEvidence.generatedAt must match package release evidence.");
}

if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker
) {
  requireMatchingEvidenceSummary({
    cwsEvidence,
    errors,
    field: "automatedEvidence",
    label: "automated QA evidence",
    packageEvidence,
    requiredFields: ["path", "releaseVersion", "generatedAt", "status", "sha256"],
  });
  requireMatchingEvidenceSummary({
    cwsEvidence,
    errors,
    field: "manualEvidence",
    label: "manual QA evidence",
    packageEvidence,
    requiredFields: [
      "path",
      "releaseVersion",
      "status",
      "testedAt",
      "automatedEvidenceGeneratedAt",
      "sha256",
    ],
  });
}

if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  hasPackageEvidence &&
  cwsEvidence.packageEvidence?.sha256 !== sha256File(PACKAGE_EVIDENCE_PATH)
) {
  errors.push("CWS package evidence does not match current package-release.json SHA-256.");
}
if (cwsEvidence && !cwsEvidenceIsNonPassingMarker) {
  if (!cwsEvidence.packageEvidence?.path) {
    errors.push("CWS package evidence packageEvidence.path is required.");
  } else if (
    !isCanonicalRelativePath(cwsEvidence.packageEvidence.path, "release-artifacts/package-release.json") ||
    resolveRootPath(cwsEvidence.packageEvidence.path) !== PACKAGE_EVIDENCE_PATH
  ) {
    errors.push("CWS package evidence packageEvidence.path must point to release-artifacts/package-release.json.");
  }
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
    errors.push("package release evidence formatted zip size must match current extension.zip size.");
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
    if (!requireFile(buildPath, "package release build path", errors)) {
      // Missing path already reported.
    } else {
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
    }
  }
  if (
    packageEvidence.build?.path &&
    (!isCanonicalRelativePath(packageEvidence.build.path, "build") ||
      resolveRootPath(packageEvidence.build.path) !== join(ROOT, "build"))
  ) {
    errors.push("package release evidence build path must point to build.");
  }
}

if (cwsEvidence && !cwsEvidenceIsNonPassingMarker && hasExtensionZip) {
  const extensionSha256 = sha256File(EXTENSION_ZIP_PATH);
  const extensionBytes = statSync(EXTENSION_ZIP_PATH).size;
  if (cwsEvidence.sourceZip?.sha256 !== extensionSha256) {
    errors.push("CWS package sourceZip does not match current extension.zip SHA-256.");
  }
  if (cwsEvidence.sourceZip?.bytes !== extensionBytes) {
    errors.push("CWS package sourceZip size must match current extension.zip size.");
  }
  if (cwsEvidence.sourceZip?.formattedBytes !== formatBytes(extensionBytes)) {
    errors.push("CWS package sourceZip formatted size must match current extension.zip size.");
  }
}
if (
  cwsEvidence &&
  !cwsEvidenceIsNonPassingMarker &&
  packageEvidence &&
  !packageEvidenceIsNonPassingMarker
) {
  if (cwsEvidence.sourceZip?.sha256 !== packageEvidence.zip?.sha256) {
    errors.push("CWS package sourceZip SHA-256 must match package release zip evidence.");
  }
  if (cwsEvidence.sourceZip?.bytes !== packageEvidence.zip?.bytes) {
    errors.push("CWS package sourceZip size must match package release zip evidence.");
  }
  if (cwsEvidence.sourceZip?.formattedBytes !== packageEvidence.zip?.formattedBytes) {
    errors.push("CWS package sourceZip formatted size must match package release zip evidence.");
  }
}
if (cwsEvidence && !cwsEvidenceIsNonPassingMarker) {
  if (!cwsEvidence.sourceZip?.path) {
    errors.push("CWS package sourceZip.path is required.");
  } else if (
    !isCanonicalRelativePath(cwsEvidence.sourceZip.path, "extension.zip") ||
    resolveRootPath(cwsEvidence.sourceZip.path) !== EXTENSION_ZIP_PATH
  ) {
    errors.push("CWS package sourceZip.path must point to extension.zip.");
  }
}

if (hasCwsZip) {
  const cwsSha256 = sha256File(CWS_ZIP_PATH);
  const cwsBytes = statSync(CWS_ZIP_PATH).size;
  if (cwsEvidence && !cwsEvidenceIsNonPassingMarker && cwsEvidence.cwsZip?.sha256 !== cwsSha256) {
    errors.push("CWS package evidence does not match current build-cws.zip SHA-256.");
  }
  if (cwsEvidence && !cwsEvidenceIsNonPassingMarker && cwsEvidence.cwsZip?.bytes !== cwsBytes) {
    errors.push("CWS package evidence does not match current build-cws.zip size.");
  }
  if (
    cwsEvidence &&
    !cwsEvidenceIsNonPassingMarker &&
    cwsEvidence.cwsZip?.formattedBytes !== formatBytes(cwsBytes)
  ) {
    errors.push("CWS package evidence formatted zip size must match current build-cws.zip size.");
  }
  if (hasExtensionZip && cwsSha256 !== sha256File(EXTENSION_ZIP_PATH)) {
    errors.push("build-cws.zip must match extension.zip SHA-256.");
  }
}
if (cwsEvidence && !cwsEvidenceIsNonPassingMarker) {
  if (!cwsEvidence.cwsZip?.path) {
    errors.push("CWS package evidence cwsZip.path is required.");
  } else if (
    !isCanonicalRelativePath(cwsEvidence.cwsZip.path, "build-cws.zip") ||
    resolveRootPath(cwsEvidence.cwsZip.path) !== CWS_ZIP_PATH
  ) {
    errors.push("CWS package evidence cwsZip.path must point to build-cws.zip.");
  }
}

if (packageEvidence && !packageEvidenceIsNonPassingMarker) {
  for (const [label, evidence] of [
    ["automated QA evidence", packageEvidence.automatedEvidence],
    ["manual QA evidence", packageEvidence.manualEvidence],
  ]) {
    if (!evidence?.path || !evidence?.sha256) {
      errors.push(`package release evidence is missing ${label} path or SHA-256.`);
      continue;
    }
    const evidencePath = resolveRootPath(evidence.path);
    const expectedPath =
      label === "automated QA evidence"
        ? join(ROOT, "release-artifacts", "release-qa-automated.json")
        : join(ROOT, "release-artifacts", "manual-qa-evidence.json");
    const expectedRelativePath = relative(ROOT, expectedPath);
    if (!isCanonicalRelativePath(evidence.path, expectedRelativePath) || evidencePath !== expectedPath) {
      errors.push(`package release evidence ${label} path must point to ${expectedRelativePath}.`);
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
      if (evidenceJson?.releaseVersion !== evidence.releaseVersion) {
        errors.push("package release evidence automated QA releaseVersion must match automated QA evidence.");
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
      if (evidenceJson?.automatedEvidenceGeneratedAt !== evidence.automatedEvidenceGeneratedAt) {
        errors.push(
          "manual QA evidence automatedEvidenceGeneratedAt must match package release evidence.",
        );
      }
      if (evidenceJson?.releaseVersion !== evidence.releaseVersion) {
        errors.push("package release evidence manual QA releaseVersion must match manual QA evidence.");
      }
    }
  }
}

if (errors.length) {
  fail(errors);
}

console.log("CWS package evidence passed.");
console.log(`Zip: ${relative(ROOT, CWS_ZIP_PATH)}`);
console.log(`SHA-256: ${sha256File(CWS_ZIP_PATH)}`);
