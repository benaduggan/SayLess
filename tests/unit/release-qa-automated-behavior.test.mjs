import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = new URL("../..", import.meta.url).pathname;
const AUTOMATED_QA = join(ROOT, "scripts", "release-qa-automated.mjs");

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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

const makeFixture = ({ failCommand = null } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "sayless-release-qa-auto-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });

  writeJson(join(dir, "package.json"), {
    version: "9.9.9",
    scripts: {
      "test:unit": "node scripts/fixture-command.mjs test-unit",
      "test:e2e:offline-whisper-assets":
        "node scripts/fixture-command.mjs offline-whisper-assets",
      "test:e2e:offline-transcription-smoke":
        "node scripts/fixture-command.mjs offline-transcription-smoke",
      "test:e2e:offline-transcription-speech":
        "node scripts/fixture-command.mjs offline-transcription-speech",
      "test:e2e:local-recordings": "node scripts/fixture-command.mjs local-recordings",
      "test:e2e:editor-layout": "node scripts/fixture-command.mjs editor-layout",
      "build:release": "node scripts/fixture-build.mjs",
      "test:e2e:built-extension-surface":
        "node scripts/fixture-command.mjs built-extension-surface",
      "verify:release": "node scripts/fixture-command.mjs verify-release",
    },
  });
  writeJson(join(dir, "package-lock.json"), {
    version: "9.9.9",
    packages: { "": { version: "9.9.9" } },
  });
  writeJson(join(dir, "src", "manifest.json"), { version: "9.9.9" });
  writeFileSync(
    join(dir, "scripts", "fixture-command.mjs"),
    [
      "import { appendFileSync } from 'node:fs';",
      "const label = process.argv[2];",
      "appendFileSync('commands.log', `${label}\\n`);",
      failCommand
        ? `if (label === ${JSON.stringify(failCommand)}) process.exit(42);`
        : "",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "scripts", "fixture-build.mjs"),
    [
      "import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "appendFileSync('commands.log', 'build-release\\n');",
      "mkdirSync(join('build', 'assets', 'whisper'), { recursive: true });",
      "writeFileSync(join('build', 'manifest.json'), JSON.stringify({ version: '9.9.9' }));",
      "writeFileSync(join('build', 'editor.html'), '<html>SayLess local fixture</html>');",
      "writeFileSync(join('build', 'assets', 'whisper', 'model.bin'), 'local whisper bytes');",
      "",
    ].join("\n"),
  );

  return dir;
};

const runAutomatedQa = (root) =>
  spawnSync(process.execPath, [AUTOMATED_QA], {
    cwd: ROOT,
    env: { ...process.env, SAYLESS_RELEASE_QA_ROOT: root },
    encoding: "utf8",
  });

test("automated release QA writes traceable build evidence atomically", () => {
  const fixture = makeFixture();
  try {
    const result = runAutomatedQa(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Automated release QA passed/);

    const evidencePath = join(fixture, "release-artifacts", "release-qa-automated.json");
    const buildDir = join(fixture, "build");
    const whisperDir = join(buildDir, "assets", "whisper");
    assert.ok(existsSync(evidencePath));
    assert.ok(!existsSync(`${evidencePath}.tmp`));

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const buildFingerprint = dirFingerprint(buildDir);
    const whisperFingerprint = dirFingerprint(whisperDir);
    assert.equal(evidence.kind, "sayless.releaseQaAutomated");
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.releaseVersion, "9.9.9");
    assert.equal(evidence.packageLockVersion, "9.9.9");
    assert.equal(evidence.packageLockRootVersion, "9.9.9");
    assert.equal(evidence.manifestVersion, "9.9.9");
    assert.equal(evidence.buildManifestVersion, "9.9.9");
    assert.ok(Object.hasOwn(evidence, "git"));
    assert.ok(Object.hasOwn(evidence.git, "branch"));
    assert.ok(Object.hasOwn(evidence.git, "commit"));
    assert.equal(typeof evidence.git.dirty, "boolean");
    assert.equal(typeof evidence.git.workingTree.sha256, "string");
    assert.equal(typeof evidence.git.workingTree.fileCount, "number");
    assert.equal(typeof evidence.git.workingTree.statusSha256, "string");
    assert.equal(evidence.build.path, "build");
    assert.equal(evidence.build.fileCount, buildFingerprint.fileCount);
    assert.equal(evidence.build.sha256, buildFingerprint.sha256);
    assert.equal(evidence.bundledWhisper.path, "build/assets/whisper");
    assert.equal(evidence.bundledWhisper.fileCount, whisperFingerprint.fileCount);
    assert.equal(evidence.bundledWhisper.sha256, whisperFingerprint.sha256);
    assert.deepEqual(evidence.releaseSurface, {
      permissions: [],
      optionalPermissions: [],
      hostPermissions: [],
      hasOauth2: false,
      hasExternallyConnectable: false,
      hasIdentityPermission: false,
      hasGoogleDrivePermission: false,
      hasRemoteConnectSrc: false,
      contentSecurityPolicyExtensionPages: "",
    });

    const commandsByLabel = new Map(evidence.commands.map((command) => [command.label, command]));
    for (const label of [
      "test:unit",
      "test:e2e:offline-whisper-assets",
      "test:e2e:offline-transcription-smoke",
      "test:e2e:local-recordings",
      "test:e2e:editor-layout",
      "build:release",
      "test:e2e:built-extension-surface",
      "verify:release",
    ]) {
      const command = commandsByLabel.get(label);
      assert.equal(command.status, "passed");
      assert.match(command.command, /npm(?:\.cmd)? run /);
      assert.ok(command.durationMs >= 0);
    }
    if (process.platform === "darwin") {
      assert.ok(commandsByLabel.has("test:e2e:offline-transcription-speech"));
    } else {
      assert.deepEqual(evidence.skippedCommands, [
        {
          label: "test:e2e:offline-transcription-speech",
          reason: "requires macOS say/afconvert speech synthesis tools",
        },
      ]);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("automated release QA overwrites stale passing evidence on failure", () => {
  const fixture = makeFixture({ failCommand: "offline-transcription-smoke" });
  try {
    const evidencePath = join(fixture, "release-artifacts", "release-qa-automated.json");
    mkdirSync(join(fixture, "release-artifacts"), { recursive: true });
    writeJson(evidencePath, {
      kind: "sayless.releaseQaAutomated",
      generatedAt: "2026-07-16T00:00:00.000Z",
      commands: [{ label: "stale", status: "passed", command: "npm run stale", durationMs: 1 }],
    });

    const result = runAutomatedQa(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Automated release QA failed: test:e2e:offline-transcription-smoke failed with exit code 42/);
    assert.ok(!existsSync(`${evidencePath}.tmp`));

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.kind, "sayless.releaseQaAutomatedFailed");
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.failedCommand.label, "test:e2e:offline-transcription-smoke");
    assert.equal(evidence.failedCommand.command, "npm run test:e2e:offline-transcription-smoke");
    assert.equal(evidence.failedCommand.exitCode, 42);
    assert.ok(evidence.durationMs > 0);
    assert.deepEqual(
      evidence.commands.map((command) => command.label),
      ["test:unit", "test:e2e:offline-whisper-assets"],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
