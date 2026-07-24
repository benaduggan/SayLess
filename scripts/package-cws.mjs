#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.SAYLESS_PACKAGE_CWS_ROOT
  ? resolve(process.env.SAYLESS_PACKAGE_CWS_ROOT)
  : DEFAULT_ROOT;
const EXTENSION_ZIP_PATH = join(ROOT, "extension.zip");
const CWS_ZIP_PATH = join(ROOT, "build-cws.zip");
const EVIDENCE_DIR = join(ROOT, "release-artifacts");
const PACKAGE_EVIDENCE_PATH = join(EVIDENCE_DIR, "package-release.json");
const CWS_EVIDENCE_PATH = join(EVIDENCE_DIR, "cws-package.json");
const RELEASE_PACKAGER_PATH = join(DEFAULT_ROOT, "scripts", "package-release.mjs");
const CWS_PACKAGE_VERIFIER_PATH = join(DEFAULT_ROOT, "scripts", "verify-cws-package.mjs");

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const writeFileAtomic = (path, bytes) => {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, bytes);
  renameSync(tempPath, path);
};

const writeNonPassingCwsEvidence = ({ status, failedStep = null }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    kind: status === "failed" ? "sayless.cwsPackageFailed" : "sayless.cwsPackageIncomplete",
    status,
    generatedAt: new Date().toISOString(),
    remainingReleaseWork:
      "Chrome Web Store package has not passed. Rerun npm run build:cws after the release package gate passes.",
  };
  if (failedStep) {
    evidence.failedStep = failedStep;
  }
  writeFileAtomic(CWS_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const verifyWrittenCwsPackage = () => {
  const result = spawnSync(process.execPath, [CWS_PACKAGE_VERIFIER_PATH], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_CWS_VERIFY_ROOT: ROOT },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    writeNonPassingCwsEvidence({
      status: "failed",
      failedStep: {
        script: relative(ROOT, CWS_PACKAGE_VERIFIER_PATH),
        exitCode: result.status,
      },
    });
    console.error("CWS package verification failed after writing artifacts.");
    process.exit(result.status || 1);
  }
};

writeNonPassingCwsEvidence({ status: "running" });

const packageResult = spawnSync(process.execPath, [RELEASE_PACKAGER_PATH], {
  cwd: ROOT,
  env: { ...process.env, SAYLESS_PACKAGE_RELEASE_ROOT: ROOT },
  stdio: "inherit",
});
if (packageResult.status !== 0) {
  writeNonPassingCwsEvidence({
    status: "failed",
    failedStep: {
      script: relative(ROOT, RELEASE_PACKAGER_PATH),
      exitCode: packageResult.status,
    },
  });
  process.exit(packageResult.status || 1);
}

const packageEvidence = JSON.parse(readFileSync(PACKAGE_EVIDENCE_PATH, "utf8"));
const extensionSha256 = sha256File(EXTENSION_ZIP_PATH);
const extensionBytes = statSync(EXTENSION_ZIP_PATH).size;
if (packageEvidence?.zip?.sha256 !== extensionSha256) {
  writeNonPassingCwsEvidence({
    status: "failed",
    failedStep: {
      script: "package-cws",
      reason: "extension.zip does not match package-release evidence",
    },
  });
  console.error("CWS package failed: extension.zip does not match package-release evidence.");
  process.exit(1);
}

writeFileAtomic(CWS_ZIP_PATH, readFileSync(EXTENSION_ZIP_PATH));

const cwsBytes = statSync(CWS_ZIP_PATH).size;
const cwsSha256 = sha256File(CWS_ZIP_PATH);
if (cwsSha256 !== extensionSha256) {
  writeNonPassingCwsEvidence({
    status: "failed",
    failedStep: {
      script: "package-cws",
      reason: "build-cws.zip differs from extension.zip",
    },
  });
  console.error("CWS package failed: build-cws.zip differs from extension.zip.");
  process.exit(1);
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const cwsEvidence = {
  kind: "sayless.cwsPackage",
  status: "passed",
  releaseVersion: packageEvidence.releaseVersion,
  generatedAt: new Date().toISOString(),
  git: packageEvidence.git,
  packageEvidence: {
    path: relative(ROOT, PACKAGE_EVIDENCE_PATH),
    releaseVersion: packageEvidence.releaseVersion,
    generatedAt: packageEvidence.generatedAt,
    sha256: sha256File(PACKAGE_EVIDENCE_PATH),
  },
  automatedEvidence: packageEvidence.automatedEvidence,
  manualEvidence: packageEvidence.manualEvidence,
  sourceZip: {
    path: relative(ROOT, EXTENSION_ZIP_PATH),
    bytes: extensionBytes,
    formattedBytes: formatBytes(extensionBytes),
    sha256: extensionSha256,
  },
  cwsZip: {
    path: relative(ROOT, CWS_ZIP_PATH),
    bytes: cwsBytes,
    formattedBytes: formatBytes(cwsBytes),
    sha256: cwsSha256,
  },
};

writeFileAtomic(CWS_EVIDENCE_PATH, `${JSON.stringify(cwsEvidence, null, 2)}\n`);
verifyWrittenCwsPackage();

console.log("Chrome Web Store package created.");
console.log(`Zip: ${cwsEvidence.cwsZip.path}`);
console.log(`Size: ${cwsEvidence.cwsZip.formattedBytes}`);
console.log(`SHA-256: ${cwsEvidence.cwsZip.sha256}`);
console.log(`Evidence: ${relative(ROOT, CWS_EVIDENCE_PATH)}`);
