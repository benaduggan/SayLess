import assert from "node:assert/strict";
import JSZip from "jszip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { writeCompleteReleaseEvidence } from "./releaseEvidenceFixtures.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const VERIFIER = join(ROOT, "scripts", "verify-cws-package.mjs");

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

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

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const writeBuildZip = async (zipPath, buildDir) => {
  const zip = new JSZip();
  for (const file of walkFiles(buildDir)) {
    zip.file(file.relativePath, readFileSync(file.path));
  }
  writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
};

const makeFixture = async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-cws-package-"));
  const artifactsDir = join(dir, "release-artifacts");
  const buildDir = join(dir, "build");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  const extensionZipPath = join(dir, "extension.zip");
  const cwsZipPath = join(dir, "build-cws.zip");
  const automatedEvidencePath = join(artifactsDir, "release-qa-automated.json");
  const manualEvidencePath = join(artifactsDir, "manual-qa-evidence.json");
  const packageEvidencePath = join(artifactsDir, "package-release.json");
  const cwsEvidencePath = join(artifactsDir, "cws-package.json");

  writeFileSync(join(buildDir, "manifest.json"), '{"version":"9.9.9"}\n');
  writeFileSync(join(buildDir, "editor.html"), "<html>SayLess</html>");
  writeCompleteReleaseEvidence({
    artifactsDir,
    automatedEvidencePath,
    buildDir,
    dir,
    manualEvidencePath,
  });
  await writeBuildZip(extensionZipPath, buildDir);
  writeFileSync(cwsZipPath, readFileSync(extensionZipPath));
  const automatedEvidence = JSON.parse(readFileSync(automatedEvidencePath, "utf8"));
  const manualEvidence = JSON.parse(readFileSync(manualEvidencePath, "utf8"));
  const packageGeneratedAt = new Date(Date.parse(manualEvidence.testedAt) + 1_000).toISOString();
  const cwsGeneratedAt = new Date(Date.parse(packageGeneratedAt) + 1_000).toISOString();

  const extensionSha256 = sha256File(extensionZipPath);
  const buildFingerprint = dirFingerprint(buildDir);
  const packageEvidence = {
    kind: "sayless.releasePackage",
    status: "passed",
    releaseVersion: automatedEvidence.releaseVersion,
    generatedAt: packageGeneratedAt,
    automatedEvidence: {
      path: "release-artifacts/release-qa-automated.json",
      releaseVersion: automatedEvidence.releaseVersion,
      generatedAt: automatedEvidence.generatedAt,
      status: automatedEvidence.status,
      sha256: sha256File(automatedEvidencePath),
    },
    manualEvidence: {
      path: "release-artifacts/manual-qa-evidence.json",
      releaseVersion: manualEvidence.releaseVersion,
      status: manualEvidence.status,
      testedAt: manualEvidence.testedAt,
      automatedEvidenceGeneratedAt: manualEvidence.automatedEvidenceGeneratedAt,
      sha256: sha256File(manualEvidencePath),
    },
    zip: {
      path: "extension.zip",
      bytes: statSync(extensionZipPath).size,
      formattedBytes: formatBytes(statSync(extensionZipPath).size),
      sha256: extensionSha256,
    },
    build: {
      path: "build",
      bytes: dirSize(buildDir),
      formattedBytes: formatBytes(dirSize(buildDir)),
      fileCount: buildFingerprint.fileCount,
      sha256: buildFingerprint.sha256,
    },
    git: automatedEvidence.git,
  };
  writeJson(packageEvidencePath, packageEvidence);

  writeJson(cwsEvidencePath, {
    kind: "sayless.cwsPackage",
    status: "passed",
    releaseVersion: packageEvidence.releaseVersion,
    generatedAt: cwsGeneratedAt,
    git: packageEvidence.git,
    packageEvidence: {
      path: "release-artifacts/package-release.json",
      releaseVersion: packageEvidence.releaseVersion,
      generatedAt: packageEvidence.generatedAt,
      sha256: sha256File(packageEvidencePath),
    },
    automatedEvidence: packageEvidence.automatedEvidence,
    manualEvidence: packageEvidence.manualEvidence,
    sourceZip: {
      path: "extension.zip",
      bytes: statSync(extensionZipPath).size,
      formattedBytes: formatBytes(statSync(extensionZipPath).size),
      sha256: extensionSha256,
    },
    cwsZip: {
      path: "build-cws.zip",
      bytes: statSync(cwsZipPath).size,
      formattedBytes: formatBytes(statSync(cwsZipPath).size),
      sha256: sha256File(cwsZipPath),
    },
  });

  return {
    buildDir,
    dir,
    automatedEvidencePath,
    cwsEvidencePath,
    cwsZipPath,
    extensionZipPath,
    manualEvidencePath,
    packageEvidencePath,
  };
};

const runVerifier = (root) =>
  spawnSync(process.execPath, [VERIFIER], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_CWS_VERIFY_ROOT: root },
    encoding: "utf8",
  });

test("CWS package verifier accepts matching zip and evidence hashes", async () => {
  const fixture = await makeFixture();
  try {
    const result = runVerifier(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /CWS package evidence passed/);
    assert.match(result.stdout, /build-cws\.zip/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects tampered zip and evidence files", async () => {
  const fixture = await makeFixture();
  try {
    writeFileSync(fixture.cwsZipPath, "tampered cws zip bytes");
    writeFileSync(fixture.manualEvidencePath, '{"kind":"tampered"}\n');

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package evidence does not match current build-cws\.zip SHA-256/);
    assert.match(result.stderr, /build-cws\.zip must match extension\.zip SHA-256/);
    assert.match(result.stderr, /package release evidence manual QA evidence hash does not match/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects stale package build evidence", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.build.fileCount += 1;
    packageEvidence.build.bytes += 1;
    packageEvidence.build.formattedBytes = "1.0 TB";
    packageEvidence.build.sha256 = "0".repeat(64);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence build file count/);
    assert.match(result.stderr, /package release evidence build byte size/);
    assert.match(result.stderr, /package release evidence formatted build size must match current build size/);
    assert.match(result.stderr, /package release evidence build fingerprint does not match current build/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects stale CWS evidence timestamp", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.generatedAt = "2020-01-01T00:00:00.000Z";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence generatedAt must be at or after package release evidence generatedAt/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects release version drift", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.releaseVersion = "0.0.0";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence releaseVersion must match package release evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects nested QA evidence release version drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.releaseVersion = "0.0.0";
    packageEvidence.manualEvidence.releaseVersion = "0.0.0";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence automated QA releaseVersion must match automated QA evidence/,
    );
    assert.match(
      result.stderr,
      /package release evidence manual QA releaseVersion must match manual QA evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects package manual evidence status drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.manualEvidence.status = "failed";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence manual QA status must be "passed"/);
    assert.match(result.stderr, /manual QA evidence status must match package release evidence/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects non-passing CWS evidence status", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.kind = "sayless.cwsPackageFailed";
    cwsEvidence.status = "failed";
    cwsEvidence.remainingReleaseWork =
      "Chrome Web Store package has not passed. Rerun npm run build:cws after the release package gate passes.";
    cwsEvidence.failedStep = {
      script: "scripts/package-release.mjs",
      exitCode: 1,
    };
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package evidence is non-passing: Chrome Web Store package has not passed/);
    assert.match(
      result.stderr,
      /CWS package evidence failed step: scripts\/package-release\.mjs exit code 1/,
    );
    assert.match(result.stderr, /CWS package evidence kind must be "sayless\.cwsPackage"/);
    assert.match(result.stderr, /CWS package evidence status must be "passed"/);
    assert.doesNotMatch(result.stderr, /CWS package evidence releaseVersion is required/);
    assert.doesNotMatch(result.stderr, /CWS package evidence git provenance is required/);
    assert.doesNotMatch(result.stderr, /CWS package evidence packageEvidence\.path is required/);
    assert.doesNotMatch(result.stderr, /CWS package evidence cwsZip\.path is required/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects nested package evidence metadata drift", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.releaseVersion = "0.0.0";
    cwsEvidence.packageEvidence.generatedAt = "2020-01-01T00:00:00.000Z";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence packageEvidence\.releaseVersion must match package release evidence/,
    );
    assert.match(
      result.stderr,
      /CWS package evidence packageEvidence\.generatedAt must match package release evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects CWS QA evidence summary drift", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.automatedEvidence.status = "failed";
    cwsEvidence.manualEvidence.sha256 = "0".repeat(64);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence automated QA evidence status must match package release evidence/,
    );
    assert.match(
      result.stderr,
      /CWS package evidence manual QA evidence sha256 must match package release evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects stale formatted zip size", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.cwsZip.formattedBytes = "1.0 TB";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence formatted zip size must match current build-cws\.zip size/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects stale source zip size evidence", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.sourceZip.bytes += 1;
    cwsEvidence.sourceZip.formattedBytes = "1.0 TB";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package sourceZip size must match current extension\.zip size/);
    assert.match(
      result.stderr,
      /CWS package sourceZip formatted size must match current extension\.zip size/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects missing or alternate CWS evidence paths", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    delete cwsEvidence.packageEvidence.path;
    cwsEvidence.sourceZip.path = "dist/extension.zip";
    delete cwsEvidence.cwsZip.path;
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package evidence packageEvidence\.path is required/);
    assert.match(result.stderr, /CWS package sourceZip\.path must point to extension\.zip/);
    assert.match(result.stderr, /CWS package evidence cwsZip\.path is required/);

    cwsEvidence.packageEvidence.path = fixture.packageEvidencePath;
    cwsEvidence.sourceZip.path = fixture.extensionZipPath;
    cwsEvidence.cwsZip.path = fixture.cwsZipPath;
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const absoluteResult = runVerifier(fixture.dir);

    assert.notEqual(absoluteResult.status, 0);
    assert.match(
      absoluteResult.stderr,
      /CWS package evidence packageEvidence\.path must point to release-artifacts\/package-release\.json/,
    );
    assert.match(absoluteResult.stderr, /CWS package sourceZip\.path must point to extension\.zip/);
    assert.match(absoluteResult.stderr, /CWS package evidence cwsZip\.path must point to build-cws\.zip/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects source zip drift from package evidence", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.sourceZip.sha256 = "0".repeat(64);
    cwsEvidence.sourceZip.bytes += 1;
    cwsEvidence.sourceZip.formattedBytes = "1.0 TB";
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package sourceZip SHA-256 must match package release zip evidence/);
    assert.match(result.stderr, /CWS package sourceZip size must match package release zip evidence/);
    assert.match(
      result.stderr,
      /CWS package sourceZip formatted size must match package release zip evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects missing git provenance", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    delete cwsEvidence.git;
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CWS package evidence git provenance is required/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects git provenance drift", async () => {
  const fixture = await makeFixture();
  try {
    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.git = {
      branch: "release-drift",
      commit: "0".repeat(40),
      dirty: false,
      workingTree: {
        ...cwsEvidence.git.workingTree,
        sha256: "f".repeat(64),
      },
    };
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /CWS package evidence git provenance must match package release evidence/,
    );
    assert.match(
      result.stderr,
      /CWS package evidence git workingTree fingerprint must match package release evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects wrong evidence kind even when hashes are refreshed", async () => {
  const fixture = await makeFixture();
  try {
    writeJson(fixture.automatedEvidencePath, {
      kind: "sayless.manualQaEvidence",
      generatedAt: "2026-07-16T22:18:30.541Z",
    });

    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.sha256 = sha256File(fixture.automatedEvidencePath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence kind must be "sayless\.releaseQaAutomated"/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects non-passing automated evidence status", async () => {
  const fixture = await makeFixture();
  try {
    const automatedEvidence = JSON.parse(readFileSync(fixture.automatedEvidencePath, "utf8"));
    automatedEvidence.status = "failed";
    writeJson(fixture.automatedEvidencePath, automatedEvidence);

    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.sha256 = sha256File(fixture.automatedEvidencePath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence status must be "passed"/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS package verifier rejects package automated evidence status drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.status = "failed";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const cwsEvidence = JSON.parse(readFileSync(fixture.cwsEvidencePath, "utf8"));
    cwsEvidence.packageEvidence.sha256 = sha256File(fixture.packageEvidencePath);
    writeJson(fixture.cwsEvidencePath, cwsEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence automated QA status must be "passed"/);
    assert.match(result.stderr, /automated QA evidence status must match package release evidence/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
