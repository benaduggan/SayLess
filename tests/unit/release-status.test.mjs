import assert from "node:assert/strict";
import JSZip from "jszip";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  dirFingerprint,
  dirSize,
  emptyGitWorkingTree,
  formatBytes,
  walkFiles,
  writeCompleteReleaseEvidence,
} from "./releaseEvidenceFixtures.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const STATUS = join(ROOT, "scripts", "release-status.mjs");

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const sha256File = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const requiredAutomatedCommands = [
  "typecheck",
  "test:unit",
  "test:e2e:offline-whisper-assets",
  "test:e2e:offline-transcription-smoke",
  "test:e2e:local-recordings",
  "test:e2e:editor-layout",
  "build:release",
  "test:e2e:built-extension-surface",
  "verify:release",
];

const writeBuildZip = async (zipPath, buildDir) => {
  const zip = new JSZip();
  for (const file of walkFiles(buildDir)) {
    zip.file(file.relativePath, readFileSync(file.path));
  }
  writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
};

const makeFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-release-status-"));
  mkdirSync(join(dir, "release-artifacts"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "build", "assets", "whisper"), { recursive: true });
  writeJson(join(dir, "package.json"), { version: "9.9.9" });
  writeJson(join(dir, "package-lock.json"), {
    version: "9.9.9",
    packages: { "": { version: "9.9.9" } },
  });
  writeJson(join(dir, "src", "manifest.json"), { version: "9.9.9" });
  writeJson(join(dir, "build", "manifest.json"), { version: "9.9.9" });
  writeFileSync(
    join(dir, "build", "editor.html"),
    "<html>SayLess local fixture</html>"
  );
  writeFileSync(
    join(dir, "build", "assets", "whisper", "model.bin"),
    "local whisper bytes"
  );
  const buildDir = join(dir, "build");
  const whisperDir = join(buildDir, "assets", "whisper");
  const buildFingerprint = dirFingerprint(buildDir);
  const whisperFingerprint = dirFingerprint(whisperDir);
  writeJson(join(dir, "release-artifacts", "release-qa-automated.json"), {
    kind: "sayless.releaseQaAutomated",
    status: "passed",
    generatedAt: "2026-07-16T12:34:56.789Z",
    startedAt: "2026-07-16T12:34:55.789Z",
    durationMs: 1000,
    git: {
      branch: "release-status-fixture",
      commit: "b".repeat(40),
      dirty: false,
      workingTree: emptyGitWorkingTree,
    },
    releaseVersion: "9.9.9",
    packageLockVersion: "9.9.9",
    packageLockRootVersion: "9.9.9",
    manifestVersion: "9.9.9",
    buildManifestVersion: "9.9.9",
    build: {
      path: "build",
      bytes: dirSize(buildDir),
      formattedBytes: formatBytes(dirSize(buildDir)),
      fileCount: buildFingerprint.fileCount,
      sha256: buildFingerprint.sha256,
    },
    bundledWhisper: {
      path: "build/assets/whisper",
      bytes: dirSize(whisperDir),
      formattedBytes: formatBytes(dirSize(whisperDir)),
      fileCount: whisperFingerprint.fileCount,
      sha256: whisperFingerprint.sha256,
    },
    commands: requiredAutomatedCommands.map((label) => ({
      label,
      status: "passed",
      command: `npm run ${label}`,
      durationMs: 1,
    })),
    skippedCommands: [
      {
        label: "test:e2e:offline-transcription-speech",
        reason: "fixture platform without speech synthesis tools",
      },
    ],
    releaseSurface: {
      permissions: [],
      optionalPermissions: [],
      hostPermissions: [],
      hasOauth2: false,
      hasExternallyConnectable: false,
      hasIdentityPermission: false,
      hasGoogleDrivePermission: false,
      hasRemoteConnectSrc: false,
      contentSecurityPolicyExtensionPages: "",
    },
  });
  writeJson(join(dir, "release-artifacts", "package-release.json"), {
    kind: "sayless.releasePackageFailed",
    status: "failed",
    generatedAt: "2026-07-16T12:35:00.000Z",
    remainingReleaseWork:
      "Release package has not passed. Rerun npm run package:release after automated and manual release QA pass.",
    failedStep: {
      script: "scripts/verify-manual-qa-evidence.mjs",
      exitCode: 1,
    },
  });
  return dir;
};

const makeReadyFixture = async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-release-status-ready-"));
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

  const automatedEvidence = JSON.parse(
    readFileSync(automatedEvidencePath, "utf8")
  );
  const manualEvidence = JSON.parse(readFileSync(manualEvidencePath, "utf8"));
  const packageGeneratedAt = new Date(
    Date.parse(manualEvidence.testedAt) + 1_000
  ).toISOString();
  const cwsGeneratedAt = new Date(
    Date.parse(packageGeneratedAt) + 1_000
  ).toISOString();
  const extensionBytes = statSync(extensionZipPath).size;
  const cwsBytes = statSync(cwsZipPath).size;
  const buildFingerprint = dirFingerprint(buildDir);
  const buildBytes = dirSize(buildDir);
  const extensionSha256 = sha256File(extensionZipPath);

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
      bytes: extensionBytes,
      formattedBytes: formatBytes(extensionBytes),
      sha256: extensionSha256,
    },
    build: {
      path: "build",
      bytes: buildBytes,
      formattedBytes: formatBytes(buildBytes),
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
      bytes: extensionBytes,
      formattedBytes: formatBytes(extensionBytes),
      sha256: extensionSha256,
    },
    cwsZip: {
      path: "build-cws.zip",
      bytes: cwsBytes,
      formattedBytes: formatBytes(cwsBytes),
      sha256: sha256File(cwsZipPath),
    },
  });

  return dir;
};

const runStatus = (root, args = []) =>
  spawnSync(process.execPath, [STATUS, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SAYLESS_RELEASE_STATUS_ROOT: root },
  });

test("release status reports next manual QA template action without creating artifacts", () => {
  const fixture = makeFixture();
  try {
    const result = runStatus(fixture, ["--json"]);

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, "blocked");
    assert.equal(report.nextAction, "npm run qa:release:manual:template");
    assert.deepEqual(report.nextActions, [
      "npm run qa:release:manual:template",
      "npm run qa:release:manual:profile",
      "complete docs/RELEASE_QA.md, fill release-artifacts/manual-qa-evidence.json, then run npm run qa:release:manual",
    ]);
    assert.equal(report.automatedQa.status, "passed");
    assert.equal(report.manualQa.status, "missing");
    assert.equal(report.manualQa.verifierPassed, false);
    assert.equal(report.manualQa.verifierErrorCount, 2);
    assert.match(
      report.manualQa.verifierSummary[0],
      /manual QA evidence file is missing/
    );
    assert.deepEqual(report.manualQa.todo, [
      "Generate release-artifacts/manual-qa-evidence.json with npm run qa:release:manual:template.",
      "Run npm run qa:release:manual:profile, then use the printed clean Chrome profile command against the current build.",
      "Fill release-specific manual observations, then run npm run qa:release:manual.",
    ]);
    assert.equal(report.releasePackage.status, "failed");
    assert.equal(
      report.releasePackage.remainingReleaseWork,
      "Release package has not passed. Rerun npm run package:release after automated and manual release QA pass."
    );
    assert.equal(
      report.releasePackage.failedStep.script,
      "scripts/verify-manual-qa-evidence.mjs"
    );
    assert.equal(report.cwsPackage.status, "missing");
    assert.throws(() =>
      readFileSync(
        join(fixture, "release-artifacts", "manual-qa-evidence.json")
      )
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status prints a concise human summary", () => {
  const fixture = makeFixture();
  try {
    const result = runStatus(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release status: blocked/);
    assert.match(
      result.stdout,
      /Next action: npm run qa:release:manual:template/
    );
    assert.match(result.stdout, /Next steps:/);
    assert.match(result.stdout, /npm run qa:release:manual:profile/);
    assert.match(
      result.stdout,
      /complete docs\/RELEASE_QA\.md, fill release-artifacts\/manual-qa-evidence\.json/
    );
    assert.match(result.stdout, /automatedQa: passed/);
    assert.match(result.stdout, /manualQa: missing/);
    assert.match(
      result.stdout,
      /2 verifier issue\(s\); first: manual QA evidence file is missing/
    );
    assert.match(result.stdout, /Manual QA todo:/);
    assert.match(
      result.stdout,
      /Generate release-artifacts\/manual-qa-evidence\.json/
    );
    assert.match(result.stdout, /releasePackage: failed/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status require-ready fails closed when evidence is blocked", () => {
  const fixture = makeFixture();
  try {
    const result = runStatus(fixture, ["--require-ready"]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Release status: blocked/);
    assert.match(
      result.stderr,
      /Release status must be ready before this action can continue/
    );
    assert.match(
      result.stderr,
      /Next action: npm run qa:release:manual:template/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status blocks stale automated evidence before manual QA", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      join(fixture, "build", "editor.html"),
      "<html>stale build after QA</html>"
    );

    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.overall, "blocked");
    assert.equal(report.nextAction, "npm run qa:release:auto");
    assert.deepEqual(report.nextActions, [
      "npm run qa:release:auto",
      "npm run qa:release:status",
    ]);
    assert.equal(report.automatedQa.gateStatus, "invalid");
    assert.equal(report.automatedQa.verifierPassed, false);
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /automated QA evidence build\.(bytes|formattedBytes|sha256) must match current build/
    );

    const humanResult = runStatus(fixture);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /Next action: npm run qa:release:auto/);
    assert.match(humanResult.stdout, /automatedQa: invalid/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status blocks incomplete automated command evidence before manual QA", () => {
  const fixture = makeFixture();
  try {
    const evidencePath = join(
      fixture,
      "release-artifacts",
      "release-qa-automated.json"
    );
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    writeJson(evidencePath, {
      ...evidence,
      git: {
        branch: "release-status-fixture",
        commit: "not-a-sha",
        dirty: false,
        workingTree: emptyGitWorkingTree,
      },
      commands: evidence.commands
        .filter((command) => command.label !== "verify:release")
        .map((command) =>
          command.label === "build:release"
            ? { ...command, command: "npm run fake-release-build" }
            : command
        ),
      skippedCommands: [],
    });

    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.overall, "blocked");
    assert.equal(report.nextAction, "npm run qa:release:auto");
    assert.deepEqual(report.nextActions, [
      "npm run qa:release:auto",
      "npm run qa:release:status",
    ]);
    assert.equal(report.automatedQa.gateStatus, "invalid");
    assert.equal(report.automatedQa.verifierPassed, false);
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /git\.commit must be a 40-character SHA-1 commit/
    );
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /automated QA evidence command build:release must be "npm run build:release"/
    );
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /automated QA evidence command verify:release is required/
    );
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /automated QA evidence command test:e2e:offline-transcription-speech must be completed or skipped/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status blocks automated git worktree drift before manual QA", () => {
  const fixture = makeFixture();
  try {
    const evidencePath = join(
      fixture,
      "release-artifacts",
      "release-qa-automated.json"
    );
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    writeJson(evidencePath, {
      ...evidence,
      git: {
        ...evidence.git,
        workingTree: {
          ...evidence.git.workingTree,
          sha256: "f".repeat(64),
        },
      },
    });

    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.overall, "blocked");
    assert.equal(report.nextAction, "npm run qa:release:auto");
    assert.equal(report.automatedQa.gateStatus, "invalid");
    assert.match(
      report.automatedQa.verifierSummary.join("\n"),
      /git\.workingTree\.sha256 must match the current git worktree/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status tells releasers to complete manual evidence when the template still exists", () => {
  const fixture = makeFixture();
  try {
    writeJson(join(fixture, "release-artifacts", "manual-qa-evidence.json"), {
      kind: "sayless.manualQaEvidence",
      status: "template",
      releaseVersion: "9.9.9",
      automatedEvidencePath: "release-artifacts/release-qa-automated.json",
      automatedEvidenceGeneratedAt: "2026-07-16T12:34:56.789Z",
    });

    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.overall, "blocked");
    assert.equal(report.nextAction, "npm run qa:release:manual:profile");
    assert.deepEqual(report.nextActions, [
      "npm run qa:release:manual:profile",
      "complete docs/RELEASE_QA.md, fill release-artifacts/manual-qa-evidence.json, then run npm run qa:release:manual",
    ]);
    assert.equal(report.manualQa.status, "template");
    assert.equal(report.manualQa.gateStatus, "invalid");
    assert.equal(report.manualQa.verifierPassed, false);
    assert.match(
      report.manualQa.verifierSummary[0],
      /manual QA evidence status must be "passed"/
    );
    assert.match(
      report.manualQa.todo.join("\n"),
      /npm run qa:release:manual:profile/
    );
    assert.match(
      report.manualQa.todo.join("\n"),
      /Record at least two real recordings/
    );
    assert.match(
      report.manualQa.todo.join("\n"),
      /Fill offline transcription evidence/
    );
    assert.match(
      report.manualQa.todo.join("\n"),
      /account-tier\/license-key\/activation\/contact-sales/
    );

    const humanResult = runStatus(fixture);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(
      humanResult.stdout,
      /Next action: npm run qa:release:manual:profile/
    );
    assert.match(
      humanResult.stdout,
      /complete docs\/RELEASE_QA\.md, fill release-artifacts\/manual-qa-evidence\.json/
    );
    assert.match(humanResult.stdout, /manualQa: invalid/);
    assert.match(humanResult.stdout, /Manual QA todo:/);
    assert.match(humanResult.stdout, /Fill export evidence for MP4, WebM, GIF/);
    assert.match(
      humanResult.stdout,
      /Fill publication-surface evidence for release notes, screenshots, and docs\/STORE_LISTING\.md store text/
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status does not display unverified manual evidence as passed", () => {
  const fixture = makeFixture();
  try {
    writeJson(join(fixture, "release-artifacts", "manual-qa-evidence.json"), {
      kind: "sayless.manualQaEvidence",
      status: "passed",
      releaseVersion: "9.9.9",
      automatedEvidencePath: "release-artifacts/release-qa-automated.json",
      automatedEvidenceGeneratedAt: "2026-07-16T12:34:56.789Z",
    });

    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);
    assert.equal(report.manualQa.status, "passed");
    assert.equal(report.manualQa.gateStatus, "invalid");
    assert.equal(report.manualQa.verifierPassed, false);
    assert.ok(report.manualQa.verifierErrorCount > 0);
    assert.ok(report.manualQa.verifierSummary[0].length > 0);
    assert.match(
      report.manualQa.todo[0],
      /Fix release-artifacts\/manual-qa-evidence\.json/
    );
    assert.equal(report.nextAction, "npm run qa:release:manual");
    assert.deepEqual(report.nextActions, [
      "fix release-artifacts/manual-qa-evidence.json",
      "npm run qa:release:manual",
    ]);

    const humanResult = runStatus(fixture);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /manualQa: invalid/);
    assert.match(humanResult.stdout, /verifier issue\(s\); first:/);
    assert.doesNotMatch(humanResult.stdout, /manualQa: passed/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("release status reports publication handoff only when all evidence verifies", async () => {
  const fixture = await makeReadyFixture();
  try {
    const jsonResult = runStatus(fixture, ["--json"]);
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    const report = JSON.parse(jsonResult.stdout);

    assert.equal(report.overall, "ready");
    assert.equal(report.nextAction, "npm run verify:release-package");
    assert.deepEqual(report.nextActions, [
      "npm run verify:release-package",
      "npm run verify:cws-package",
      "npm run release:cws",
      "npm run release:cws:publish",
      "attach release-artifacts/release-qa-automated.json",
      "attach release-artifacts/manual-qa-evidence.json",
      "attach release-artifacts/package-release.json",
      "attach release-artifacts/cws-package.json",
      "attach docs/STORE_LISTING.md",
      "attach extension.zip",
      "attach build-cws.zip",
    ]);
    assert.equal(report.manualQa.gateStatus, "passed");
    assert.equal(report.releasePackage.gateStatus, "passed");
    assert.equal(report.cwsPackage.gateStatus, "passed");

    const humanResult = runStatus(fixture);
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /Release status: ready/);
    assert.match(humanResult.stdout, /Release handoff:/);
    assert.match(humanResult.stdout, /npm run release:cws:publish/);
    assert.match(
      humanResult.stdout,
      /attach release-artifacts\/cws-package\.json/
    );
    assert.match(humanResult.stdout, /attach docs\/STORE_LISTING\.md/);
    assert.match(humanResult.stdout, /attach extension\.zip/);
    assert.match(humanResult.stdout, /attach build-cws\.zip/);

    const requireReadyResult = runStatus(fixture, ["--require-ready"]);
    assert.equal(requireReadyResult.status, 0, requireReadyResult.stderr);
    assert.match(requireReadyResult.stdout, /Release status: ready/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
