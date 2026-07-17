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
const VERIFIER = join(ROOT, "scripts", "verify-release-package.mjs");

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
  const dir = mkdtempSync(join(tmpdir(), "sayless-release-package-"));
  const artifactsDir = join(dir, "release-artifacts");
  const buildDir = join(dir, "build");
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  const extensionZipPath = join(dir, "extension.zip");
  const automatedEvidencePath = join(artifactsDir, "release-qa-automated.json");
  const manualEvidencePath = join(artifactsDir, "manual-qa-evidence.json");
  const packageEvidencePath = join(artifactsDir, "package-release.json");

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
  const automatedEvidence = JSON.parse(readFileSync(automatedEvidencePath, "utf8"));
  const manualEvidence = JSON.parse(readFileSync(manualEvidencePath, "utf8"));
  const packageGeneratedAt = new Date(Date.parse(manualEvidence.testedAt) + 1_000).toISOString();

  const buildFingerprint = dirFingerprint(buildDir);
  writeJson(packageEvidencePath, {
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
      sha256: sha256File(extensionZipPath),
    },
    build: {
      path: "build",
      bytes: dirSize(buildDir),
      formattedBytes: formatBytes(dirSize(buildDir)),
      fileCount: buildFingerprint.fileCount,
      sha256: buildFingerprint.sha256,
    },
    git: automatedEvidence.git,
  });

  return {
    automatedEvidencePath,
    buildDir,
    dir,
    extensionZipPath,
    manualEvidencePath,
    packageEvidencePath,
  };
};

const runVerifier = (root) =>
  spawnSync(process.execPath, [VERIFIER], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_RELEASE_PACKAGE_VERIFY_ROOT: root },
    encoding: "utf8",
  });

test("release package verifier accepts matching zip and evidence hashes", async () => {
  const fixture = await makeFixture();
  try {
    const result = runVerifier(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release package evidence passed/);
    assert.match(result.stdout, /extension\.zip/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects tampered zip and manual evidence", async () => {
  const fixture = await makeFixture();
  try {
    writeFileSync(fixture.extensionZipPath, "tampered zip bytes");
    writeFileSync(fixture.manualEvidencePath, '{"kind":"tampered"}\n');

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence does not match current extension\.zip SHA-256/);
    assert.match(result.stderr, /package release evidence manual QA evidence hash does not match/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects stale build evidence", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.build.fileCount += 1;
    packageEvidence.build.bytes += 1;
    packageEvidence.build.formattedBytes = "1.0 TB";
    packageEvidence.build.sha256 = "0".repeat(64);
    writeJson(fixture.packageEvidencePath, packageEvidence);

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

test("release package verifier rejects git provenance drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.git = {
      branch: "different-release-branch",
      commit: "0".repeat(40),
      dirty: false,
      workingTree: {
        ...packageEvidence.git.workingTree,
        sha256: "f".repeat(64),
      },
    };
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence git provenance must match automated QA evidence/,
    );
    assert.match(
      result.stderr,
      /package release evidence git workingTree fingerprint must match automated QA evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects missing package git provenance", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    delete packageEvidence.git;
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence git provenance is required/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects stale package evidence timestamp", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.generatedAt = "2020-01-01T00:00:00.000Z";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence generatedAt must be at or after automated QA evidence generatedAt/,
    );
    assert.match(
      result.stderr,
      /package release evidence generatedAt must be at or after manual QA evidence testedAt/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects release version drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.releaseVersion = "0.0.0";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence releaseVersion must match automated QA evidence/,
    );
    assert.match(
      result.stderr,
      /package release evidence releaseVersion must match manual QA evidence/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects nested evidence release version drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.releaseVersion = "0.0.0";
    packageEvidence.manualEvidence.releaseVersion = "0.0.0";
    writeJson(fixture.packageEvidencePath, packageEvidence);

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

test("release package verifier rejects package manual evidence status drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.manualEvidence.status = "failed";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence manual QA status must be "passed"/);
    assert.match(result.stderr, /manual QA evidence status must match package release evidence/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects non-passing package evidence status", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.kind = "sayless.releasePackageFailed";
    packageEvidence.status = "failed";
    packageEvidence.remainingReleaseWork =
      "Release package has not passed. Rerun npm run package:release after automated and manual release QA pass.";
    packageEvidence.failedStep = {
      script: "scripts/verify-manual-qa-evidence.mjs",
      exitCode: 1,
    };
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence is non-passing: Release package has not passed/);
    assert.match(
      result.stderr,
      /package release evidence failed step: scripts\/verify-manual-qa-evidence\.mjs exit code 1/,
    );
    assert.match(result.stderr, /package release evidence kind must be "sayless\.releasePackage"/);
    assert.match(result.stderr, /package release evidence status must be "passed"/);
    assert.doesNotMatch(result.stderr, /package release evidence releaseVersion is required/);
    assert.doesNotMatch(result.stderr, /package release evidence git provenance is required/);
    assert.doesNotMatch(result.stderr, /package release evidence zip\.path is required/);
    assert.doesNotMatch(result.stderr, /package release evidence is missing build path or SHA-256/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects non-passing automated evidence status", async () => {
  const fixture = await makeFixture();
  try {
    const automatedEvidence = JSON.parse(readFileSync(fixture.automatedEvidencePath, "utf8"));
    automatedEvidence.status = "failed";
    writeJson(fixture.automatedEvidencePath, automatedEvidence);

    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.sha256 = sha256File(fixture.automatedEvidencePath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /automated QA evidence status must be "passed"/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects package automated evidence status drift", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.automatedEvidence.status = "failed";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence automated QA status must be "passed"/);
    assert.match(result.stderr, /automated QA evidence status must match package release evidence/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects stale formatted zip size", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.zip.formattedBytes = "1.0 TB";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence formatted zip size must match current extension\.zip size/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects missing or alternate zip path evidence", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    delete packageEvidence.zip.path;
    writeJson(fixture.packageEvidencePath, packageEvidence);

    let result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence zip\.path is required/);

    packageEvidence.zip.path = "alternate-extension.zip";
    writeJson(fixture.packageEvidencePath, packageEvidence);

    result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence zip\.path must point to extension\.zip/);

    packageEvidence.zip.path = fixture.extensionZipPath;
    writeJson(fixture.packageEvidencePath, packageEvidence);

    result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence zip\.path must point to extension\.zip/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects alternate or absolute QA evidence paths even with matching hashes", async () => {
  const fixture = await makeFixture();
  try {
    const alternateManualPath = join(fixture.dir, "release-artifacts", "alternate-manual.json");
    writeFileSync(alternateManualPath, readFileSync(fixture.manualEvidencePath));

    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.manualEvidence.path = "release-artifacts/alternate-manual.json";
    packageEvidence.manualEvidence.sha256 = sha256File(alternateManualPath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    let result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence manual QA evidence path must point to release-artifacts\/manual-qa-evidence\.json/,
    );

    packageEvidence.manualEvidence.path = fixture.manualEvidencePath;
    packageEvidence.manualEvidence.sha256 = sha256File(fixture.manualEvidencePath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /package release evidence manual QA evidence path must point to release-artifacts\/manual-qa-evidence\.json/,
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects absolute build path evidence", async () => {
  const fixture = await makeFixture();
  try {
    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.build.path = fixture.buildDir;
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package release evidence build path must point to build/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("release package verifier rejects a zip that does not contain the fingerprinted build", async () => {
  const fixture = await makeFixture();
  try {
    const zip = new JSZip();
    zip.file("manifest.json", '{"version":"9.9.9"}\n');
    zip.file("unexpected.txt", "not part of build");
    writeFileSync(fixture.extensionZipPath, await zip.generateAsync({ type: "nodebuffer" }));

    const packageEvidence = JSON.parse(readFileSync(fixture.packageEvidencePath, "utf8"));
    packageEvidence.zip.bytes = statSync(fixture.extensionZipPath).size;
    packageEvidence.zip.sha256 = sha256File(fixture.extensionZipPath);
    writeJson(fixture.packageEvidencePath, packageEvidence);

    const result = runVerifier(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /extension\.zip contents do not match package release build fingerprint/);
    assert.match(result.stderr, /extension\.zip contents do not match current build fingerprint/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
