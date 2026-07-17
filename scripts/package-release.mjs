#!/usr/bin/env node

import JSZip from "jszip";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_PACKAGE_RELEASE_ROOT
  ? resolve(process.env.SAYLESS_PACKAGE_RELEASE_ROOT)
  : DEFAULT_ROOT;
const BUILD_DIR = join(ROOT, "build");
const EXTENSION_ZIP_PATH = join(ROOT, "extension.zip");
const EVIDENCE_DIR = join(ROOT, "release-artifacts");
const PACKAGE_EVIDENCE_PATH = join(EVIDENCE_DIR, "package-release.json");
const AUTOMATED_EVIDENCE_PATH = join(EVIDENCE_DIR, "release-qa-automated.json");
const MANUAL_EVIDENCE_PATH = join(EVIDENCE_DIR, "manual-qa-evidence.json");
const MANUAL_QA_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-manual-qa-evidence.mjs");
const NO_SECRETS_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-no-secrets.mjs");
const RELEASE_PACKAGE_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-release-package.mjs");

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const walkFiles = (dir, root = dir) => {
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

const fingerprintFiles = (files) => {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(readFileSync(file.path));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), fileCount: files.length };
};

const readJsonEvidence = (path) => {
  const bytes = readFileSync(path);
  return {
    json: JSON.parse(bytes.toString("utf8")),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

const writeFileAtomic = (path, bytes) => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const writeNonPassingPackageEvidence = ({ status, failedStep = null }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    kind:
      status === "failed"
        ? "sayless.releasePackageFailed"
        : "sayless.releasePackageIncomplete",
    status,
    generatedAt: new Date().toISOString(),
    remainingReleaseWork:
      "Release package has not passed. Rerun npm run package:release after automated and manual release QA pass.",
  };
  if (failedStep) {
    evidence.failedStep = failedStep;
  }
  writeFileAtomic(PACKAGE_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
};

const warnExistingPackageArtifact = () => {
  if (!existsSync(EXTENSION_ZIP_PATH)) return;
  const hasPackageEvidence = existsSync(PACKAGE_EVIDENCE_PATH);
  console.error(
    `Existing ${relative(ROOT, EXTENSION_ZIP_PATH)} was not updated and must not be used as a release artifact without fresh ${relative(
      ROOT,
      PACKAGE_EVIDENCE_PATH,
    )}${hasPackageEvidence ? " from this run" : ""}.`,
  );
};

const runNodeScript = (scriptPath, args = [], env = {}) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    writeNonPassingPackageEvidence({
      status: "failed",
      failedStep: {
        script: relative(ROOT, scriptPath),
        exitCode: result.status,
      },
    });
    warnExistingPackageArtifact();
    process.exit(result.status || 1);
  }
};

const verifyWrittenPackage = () => {
  const result = spawnSync(process.execPath, [RELEASE_PACKAGE_VERIFIER_PATH], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT: ROOT },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("Release package verification failed after writing artifacts.");
    process.exit(result.status || 1);
  }
};

const gitValue = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

const gitStatus = gitValue(["status", "--porcelain"]);

writeNonPassingPackageEvidence({ status: "running" });

if (!existsSync(BUILD_DIR)) {
  writeNonPassingPackageEvidence({
    status: "failed",
    failedStep: {
      script: "package-release",
      reason: "release build missing",
    },
  });
  console.error("Release build is missing. Run npm run qa:release:auto first.");
  process.exit(1);
}

runNodeScript(MANUAL_QA_VERIFIER_PATH, [], { SAYLESS_MANUAL_QA_ROOT: ROOT });
runNodeScript(NO_SECRETS_VERIFIER_PATH, [BUILD_DIR]);

const files = walkFiles(BUILD_DIR);
const buildFingerprint = fingerprintFiles(files);
const buildBytes = files.reduce((total, file) => total + file.size, 0);
const automatedEvidence = readJsonEvidence(AUTOMATED_EVIDENCE_PATH);
const manualEvidence = readJsonEvidence(MANUAL_EVIDENCE_PATH);
const zip = new JSZip();

for (const file of files) {
  zip.file(file.relativePath, readFileSync(file.path), {
    date: new Date("1980-01-01T00:00:00.000Z"),
  });
}

const zipBuffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});

writeFileAtomic(EXTENSION_ZIP_PATH, zipBuffer);

mkdirSync(EVIDENCE_DIR, { recursive: true });
const packageEvidence = {
  kind: "sayless.releasePackage",
  status: "passed",
  releaseVersion: automatedEvidence.json.releaseVersion,
  generatedAt: new Date().toISOString(),
  automatedEvidence: {
    path: relative(ROOT, AUTOMATED_EVIDENCE_PATH),
    releaseVersion: automatedEvidence.json.releaseVersion,
    generatedAt: automatedEvidence.json.generatedAt,
    status: automatedEvidence.json.status,
    sha256: automatedEvidence.sha256,
  },
  manualEvidence: {
    path: relative(ROOT, MANUAL_EVIDENCE_PATH),
    releaseVersion: manualEvidence.json.releaseVersion,
    status: manualEvidence.json.status,
    testedAt: manualEvidence.json.testedAt,
    automatedEvidenceGeneratedAt: manualEvidence.json.automatedEvidenceGeneratedAt,
    sha256: manualEvidence.sha256,
  },
  zip: {
    path: relative(ROOT, EXTENSION_ZIP_PATH),
    bytes: zipBuffer.length,
    formattedBytes: formatBytes(zipBuffer.length),
    sha256: createHash("sha256").update(zipBuffer).digest("hex"),
  },
  build: {
    path: relative(ROOT, BUILD_DIR),
    bytes: buildBytes,
    formattedBytes: formatBytes(buildBytes),
    fileCount: buildFingerprint.fileCount,
    sha256: buildFingerprint.sha256,
  },
  git: {
    branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]) || automatedEvidence.json.git?.branch,
    commit: gitValue(["rev-parse", "HEAD"]) || automatedEvidence.json.git?.commit,
    dirty: gitStatus == null ? automatedEvidence.json.git?.dirty : Boolean(gitStatus),
    workingTree: automatedEvidence.json.git?.workingTree,
  },
};

writeFileAtomic(PACKAGE_EVIDENCE_PATH, `${JSON.stringify(packageEvidence, null, 2)}\n`);
verifyWrittenPackage();

console.log("Release package created.");
console.log(`Zip: ${packageEvidence.zip.path}`);
console.log(`Size: ${packageEvidence.zip.formattedBytes}`);
console.log(`SHA-256: ${packageEvidence.zip.sha256}`);
console.log(`Evidence: ${relative(ROOT, PACKAGE_EVIDENCE_PATH)}`);
