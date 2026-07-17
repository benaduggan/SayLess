import assert from "node:assert/strict";
import JSZip from "jszip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
const PACKAGER = join(ROOT, "scripts", "package-release.mjs");

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
  return { fileCount: files.length, sha256: hash.digest("hex") };
};

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const writeScript = (path, body) => {
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
};

const makeFixture = ({ invalidManualEvidence = false, leakedSecret = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-package-release-"));
  const buildDir = join(dir, "build");
  const scriptsDir = join(dir, "scripts");
  const artifactsDir = join(dir, "release-artifacts");
  mkdirSync(join(buildDir, "nested"), { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  writeFileSync(join(buildDir, "manifest.json"), '{"version":"9.9.9"}\n');
  writeFileSync(join(buildDir, "nested", "asset.txt"), "offline asset bytes");
  if (leakedSecret) {
    writeFileSync(join(buildDir, "nested", "secret.js"), 'const token = "sk_live_1234567890abcdef";\n');
  }
  writeCompleteReleaseEvidence({
    artifactsDir,
    automatedEvidencePath: join(artifactsDir, "release-qa-automated.json"),
    buildDir,
    dir,
    manualEvidencePath: join(artifactsDir, "manual-qa-evidence.json"),
  });
  if (invalidManualEvidence) {
    const manualEvidencePath = join(artifactsDir, "manual-qa-evidence.json");
    const manualEvidence = JSON.parse(readFileSync(manualEvidencePath, "utf8"));
    manualEvidence.tester.name = "Manual tester name";
    writeJson(manualEvidencePath, manualEvidence);
  }

  writeScript(join(scriptsDir, "verify-manual-qa-evidence.mjs"), "process.exit(0);");
  writeScript(join(scriptsDir, "verify-no-secrets.mjs"), "process.exit(0);");

  return { artifactsDir, buildDir, dir };
};

const runPackager = (root) =>
  spawnSync(process.execPath, [PACKAGER], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_PACKAGE_RELEASE_ROOT: root },
    encoding: "utf8",
  });

test("package release writes zip and traceable package evidence for a verified fixture", async () => {
  const fixture = makeFixture();
  try {
    const result = runPackager(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release package created/);

    const zipPath = join(fixture.dir, "extension.zip");
    const evidencePath = join(fixture.artifactsDir, "package-release.json");
    assert.ok(existsSync(zipPath));
    assert.ok(existsSync(evidencePath));
    assert.ok(!existsSync(`${zipPath}.tmp`));
    assert.ok(!existsSync(`${evidencePath}.tmp`));

    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const zipFilePaths = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(zipFilePaths, ["assets/whisper/model.bin", "manifest.json", "nested/asset.txt"]);
    assert.equal(await zip.file("manifest.json").async("string"), '{"version":"9.9.9"}\n');
    assert.equal(await zip.file("assets/whisper/model.bin").async("string"), "bundled local whisper bytes");
    assert.equal(await zip.file("nested/asset.txt").async("string"), "offline asset bytes");

    const buildFingerprint = fingerprintFiles(walkFiles(fixture.buildDir));
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.kind, "sayless.releasePackage");
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.zip.path, "extension.zip");
    assert.equal(evidence.zip.bytes, statSync(zipPath).size);
    assert.equal(evidence.zip.formattedBytes, formatBytes(statSync(zipPath).size));
    assert.equal(evidence.zip.sha256, sha256File(zipPath));
    assert.equal(evidence.automatedEvidence.path, "release-artifacts/release-qa-automated.json");
    assert.equal(evidence.manualEvidence.path, "release-artifacts/manual-qa-evidence.json");
    const automatedEvidence = JSON.parse(
      readFileSync(join(fixture.artifactsDir, "release-qa-automated.json"), "utf8"),
    );
    const manualEvidence = JSON.parse(
      readFileSync(join(fixture.artifactsDir, "manual-qa-evidence.json"), "utf8"),
    );
    assert.equal(evidence.automatedEvidence.generatedAt, automatedEvidence.generatedAt);
    assert.equal(evidence.automatedEvidence.releaseVersion, automatedEvidence.releaseVersion);
    assert.equal(evidence.automatedEvidence.status, "passed");
    assert.equal(evidence.releaseVersion, automatedEvidence.releaseVersion);
    assert.equal(evidence.manualEvidence.releaseVersion, manualEvidence.releaseVersion);
    assert.equal(evidence.manualEvidence.status, "passed");
    assert.equal(evidence.manualEvidence.testedAt, manualEvidence.testedAt);
    assert.equal(evidence.build.path, "build");
    assert.equal(evidence.build.bytes, walkFiles(fixture.buildDir).reduce((total, file) => total + file.size, 0));
    assert.equal(evidence.build.formattedBytes, formatBytes(evidence.build.bytes));
    assert.equal(evidence.build.fileCount, buildFingerprint.fileCount);
    assert.equal(evidence.build.sha256, buildFingerprint.sha256);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("package release stops before touching extension zip when manual gate fails", () => {
  const fixture = makeFixture({ invalidManualEvidence: true });
  try {
    const zipPath = join(fixture.dir, "extension.zip");
    const evidencePath = join(fixture.artifactsDir, "package-release.json");
    writeFileSync(zipPath, "existing zip");
    const before = { size: statSync(zipPath).size, sha256: sha256File(zipPath) };

    const result = runPackager(fixture.dir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /tester\.name still contains template or fixture placeholder text/);
    assert.match(
      result.stderr,
      /Existing extension\.zip was not updated and must not be used as a release artifact without fresh release-artifacts\/package-release\.json/,
    );
    assert.equal(statSync(zipPath).size, before.size);
    assert.equal(sha256File(zipPath), before.sha256);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.kind, "sayless.releasePackageFailed");
    assert.equal(evidence.status, "failed");
    assert.match(evidence.failedStep.script, /verify-manual-qa-evidence\.mjs$/);
    assert.ok(!existsSync(`${zipPath}.tmp`));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("package release stops before touching extension zip when no-secrets scan fails", () => {
  const fixture = makeFixture({ leakedSecret: true });
  try {
    const zipPath = join(fixture.dir, "extension.zip");
    const evidencePath = join(fixture.artifactsDir, "package-release.json");
    writeFileSync(zipPath, "existing zip");
    const before = { size: statSync(zipPath).size, sha256: sha256File(zipPath) };

    const result = runPackager(fixture.dir);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Found 1 secret leak/);
    assert.match(result.stdout, /sk_live_1234567890abcdef/);
    assert.match(
      result.stderr,
      /Existing extension\.zip was not updated and must not be used as a release artifact without fresh release-artifacts\/package-release\.json/,
    );
    assert.equal(statSync(zipPath).size, before.size);
    assert.equal(sha256File(zipPath), before.sha256);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.kind, "sayless.releasePackageFailed");
    assert.equal(evidence.status, "failed");
    assert.match(evidence.failedStep.script, /verify-no-secrets\.mjs$/);
    assert.ok(!existsSync(`${zipPath}.tmp`));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
