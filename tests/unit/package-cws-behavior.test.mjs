import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeCompleteReleaseEvidence } from "./releaseEvidenceFixtures.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const CWS_PACKAGER = join(ROOT, "scripts", "package-cws.mjs");

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const makeFixture = ({ invalidManualEvidence = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-package-cws-"));
  const buildDir = join(dir, "build");
  const artifactsDir = join(dir, "release-artifacts");
  mkdirSync(join(buildDir, "nested"), { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  writeFileSync(join(buildDir, "manifest.json"), '{"version":"9.9.9"}\n');
  writeFileSync(join(buildDir, "nested", "asset.txt"), "offline asset bytes");
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

  return { artifactsDir, dir };
};

const runPackager = (root) =>
  spawnSync(process.execPath, [CWS_PACKAGER], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_PACKAGE_CWS_ROOT: root },
    encoding: "utf8",
  });

test("CWS packager writes zip and traceable evidence from verified release package", () => {
  const fixture = makeFixture();
  try {
    const result = runPackager(fixture.dir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Chrome Web Store package created/);

    const extensionZipPath = join(fixture.dir, "extension.zip");
    const cwsZipPath = join(fixture.dir, "build-cws.zip");
    const packageEvidencePath = join(fixture.artifactsDir, "package-release.json");
    const cwsEvidencePath = join(fixture.artifactsDir, "cws-package.json");
    assert.equal(readFileSync(cwsZipPath, "utf8"), readFileSync(extensionZipPath, "utf8"));
    assert.ok(!existsSync(`${cwsZipPath}.tmp`));
    assert.ok(!existsSync(`${cwsEvidencePath}.tmp`));

    const cwsEvidence = JSON.parse(readFileSync(cwsEvidencePath, "utf8"));
    const packageEvidence = JSON.parse(readFileSync(packageEvidencePath, "utf8"));
    assert.equal(cwsEvidence.kind, "sayless.cwsPackage");
    assert.equal(cwsEvidence.status, "passed");
    assert.equal(cwsEvidence.releaseVersion, packageEvidence.releaseVersion);
    assert.deepEqual(cwsEvidence.git, packageEvidence.git);
    assert.equal(cwsEvidence.packageEvidence.path, "release-artifacts/package-release.json");
    assert.equal(cwsEvidence.packageEvidence.releaseVersion, packageEvidence.releaseVersion);
    assert.equal(cwsEvidence.packageEvidence.generatedAt, packageEvidence.generatedAt);
    assert.equal(cwsEvidence.packageEvidence.sha256, sha256File(packageEvidencePath));
    assert.deepEqual(cwsEvidence.automatedEvidence, packageEvidence.automatedEvidence);
    assert.deepEqual(cwsEvidence.manualEvidence, packageEvidence.manualEvidence);
    assert.equal(cwsEvidence.sourceZip.path, "extension.zip");
    assert.equal(cwsEvidence.sourceZip.bytes, statSync(extensionZipPath).size);
    assert.equal(cwsEvidence.sourceZip.formattedBytes, formatBytes(statSync(extensionZipPath).size));
    assert.equal(cwsEvidence.sourceZip.sha256, sha256File(extensionZipPath));
    assert.equal(cwsEvidence.cwsZip.path, "build-cws.zip");
    assert.equal(cwsEvidence.cwsZip.bytes, statSync(cwsZipPath).size);
    assert.equal(cwsEvidence.cwsZip.formattedBytes, formatBytes(statSync(cwsZipPath).size));
    assert.equal(cwsEvidence.cwsZip.sha256, sha256File(cwsZipPath));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("CWS packager rejects failed release package evidence gate before writing CWS artifacts", () => {
  const fixture = makeFixture({ invalidManualEvidence: true });
  try {
    const result = runPackager(fixture.dir);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tester\.name still contains template or fixture placeholder text/);
    assert.ok(!existsSync(join(fixture.dir, "build-cws.zip")));
    const cwsEvidence = JSON.parse(readFileSync(join(fixture.artifactsDir, "cws-package.json"), "utf8"));
    assert.equal(cwsEvidence.kind, "sayless.cwsPackageFailed");
    assert.equal(cwsEvidence.status, "failed");
    assert.match(cwsEvidence.failedStep.script, /package-release\.mjs$/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
